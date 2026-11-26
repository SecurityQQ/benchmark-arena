// HTTP API of the live board (src/live.ts), served by api/live.ts on Vercel and by src/serve.ts locally:
//   GET    /api/live                               every challenge that has not ended: agents now, subtasks by status, busiest first
//   GET    /api/live/{id}                          one challenge: agents now, each subtask with its status and attempts, recent events
//   POST   /api/live/{id}/sessions                 check in: {"agent": "Claude Code", "model"?, "subtask"?, "status"?, "handle"?}
//   PATCH  /api/live/{id}/sessions/{session}       renew (empty body) or change subtask / status / submission; Authorization: Bearer <token>
//   DELETE /api/live/{id}/sessions/{session}       check out, ?outcome=submitted|accepted|rejected|gave_up|done; same token
// Reads are public and cached by the CDN for REFRESH_SECONDS; check-ins need a database (SessionStore) and answer 503 without one.
import { INTERNAL_UA } from "./agentTraffic.js";
import { SITE } from "./render.js";
import { REFRESH_SECONDS, assembleLive, liveBase, liveOrder, liveRow, type BaseChallenge, type LiveBase, type NativeLive, type RepoLive, type SessionView, type Source } from "./live.js";
import { githubRepos, nativeFor, repoKey, USER_AGENT, type JsonGetter } from "./liveSources.js";
import { MAX_SESSION_MS, RENEW_SECONDS, TTL_MS, ipHash, parseCheckin, parseOutcome, parsePatch, type CheckinContext, type SessionStore } from "./sessions.js";
import { boundedFetch } from "./github.js";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface LiveOptions {
  origin?: string;            // the site whose /api/live-base.json is read; SITE by default
  publicOrigin?: string;      // where links in answers point; SITE by default
  fetch?: Fetch;              // every outside read (tests inject one)
  githubToken?: string;       // without it GitHub is not read
  store?: SessionStore;       // without it check-ins are off
  salt?: string;              // for the IP hashes behind rate limits
  now?: () => number;
  log?: (line: string) => void;
  waitUntil?: (p: Promise<unknown>) => void;   // keeps a background refresh alive after the answer (@vercel/functions)
}

export const MAX_BODY = 4 * 1024;
const BASE_TTL = 5 * 60_000, GITHUB_TTL = 60_000, GITHUB_LIST_TTL = 120_000, TIMEOUT_MS = 8000, GITHUB_TIMEOUT_MS = 10_000, DAY = 86_400_000;
const ID = /^[A-Za-z0-9_-]{1,200}$/, SESSION = /^s_[A-Za-z0-9_-]{8,40}$/;
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};
const READ_CACHE = `public, max-age=${Math.round(REFRESH_SECONDS / 2)}, s-maxage=${REFRESH_SECONDS}, stale-while-revalidate=60`;

class HttpError extends Error {
  status: number; extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) { super(message); this.status = status; this.extra = extra; }
}

function json(status: number, body: unknown, cache = "no-store", extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache, ...extra } });
}

// The body as JSON, read no further than MAX_BODY whatever Content-Length says; empty → undefined
async function readBody(request: Request): Promise<unknown> {
  const tooBig = new HttpError(413, `body over ${MAX_BODY} bytes`);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) throw tooBig;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel().catch(() => {}); throw tooBig; }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return undefined;
  try { return JSON.parse(text); } catch { throw new HttpError(400, "the body is not JSON"); }
}

export function createLiveHandler(opts: LiveOptions = {}): (request: Request) => Promise<Response> {
  const origin = (opts.origin ?? SITE).replace(/\/+$/, "");
  const publicOrigin = (opts.publicOrigin ?? SITE).replace(/\/+$/, "");
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const salt = opts.salt ?? "openchallengelist-live";
  // outside reads: bounded in size and time; the site's own files may be on plain http locally
  const outside: Fetch = opts.fetch ?? ((url, init) => boundedFetch(url, init, 8 * 1024 * 1024, url.startsWith("https://api.github.com/") ? GITHUB_TIMEOUT_MS : TIMEOUT_MS));
  const site: Fetch = opts.fetch ?? ((url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) }));

  // A small cache: fresh within its TTL, a stale copy when the source fails, one read in flight per key
  const cache = new Map<string, { at: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();
  async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value as T;
    const running = pending.get(key);
    if (running) return running as Promise<T>;
    const p = load().then((value) => { cache.set(key, { at: now(), value }); return value; })
      .catch((error) => { if (hit) return hit.value as T; throw error; })
      .finally(() => pending.delete(key));
    pending.set(key, p);
    if (cache.size > 500) for (const [k, v] of cache) if (now() - v.at > BASE_TTL * 2) cache.delete(k);
    return p;
  }

  const getJson: JsonGetter = (url, ttl) => cached(`json:${url}`, ttl, async () => {
    const res = await outside(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`${new URL(url).hostname} answered ${res.status}`); }
    return res.json();
  });

  // The static half: /api/live-base.json, or the full dataset on a site built before it existed
  const loadBase = () => cached("base", BASE_TTL, async (): Promise<LiveBase> => {
    const read = (path: string) => site(origin + path, { headers: { "user-agent": INTERNAL_UA, accept: "application/json" } });
    let res = await read("/api/live-base.json");
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      res = await read("/api/competitions.json");
      if (!res.ok) throw new Error(`the site answered ${res.status}`);
      const data: any = await res.json();
      if (!Array.isArray(data?.competitions)) throw new Error("the dataset is not in the expected shape");
      return liveBase(data);
    }
    if (!res.ok) throw new Error(`the site answered ${res.status}`);
    const base: any = await res.json();
    if (!Array.isArray(base?.challenges)) throw new Error("live-base.json is not in the expected shape");
    return base as LiveBase;
  });

  async function findChallenge(id: string): Promise<{ base: LiveBase; c: BaseChallenge }> {
    if (!ID.test(id)) throw new HttpError(404, `no challenge has the id "${id.slice(0, 200)}"`);
    let base: LiveBase;
    try { base = await loadBase(); } catch { throw new HttpError(503, "the list of challenges cannot be read right now; try again in a minute"); }
    const lower = id.toLowerCase();
    const c = base.challenges.find((x) => x.id === id) ?? base.challenges.find((x) => x.id.toLowerCase() === lower);
    if (!c) {
      const near = base.challenges.filter((x) => x.id.toLowerCase().includes(lower) || x.name.toLowerCase().includes(lower)).slice(0, 5).map((x) => x.id);
      throw new HttpError(404, `no challenge has the id "${id}"`, near.length ? { closeMatches: near } : {});
    }
    return { base, c };
  }

  // Native feeds and GitHub for a set of challenges; failures become sources marked not ok, never an error
  async function readNative(c: BaseChallenge): Promise<{ native?: NativeLive; source?: Source }> {
    const adapter = nativeFor(c);
    if (!adapter) return {};
    try {
      const native = await cached(`native:${adapter.name}`, 15_000, () => adapter.read(getJson));
      return { native, source: native.source };
    } catch (error) {
      return { source: { kind: "native", name: adapter.name, ok: false, note: `could not be read (${(error as Error).message.slice(0, 120)})` } };
    }
  }
  // Each repository's answer is kept on its own, so the list and a challenge's page share them. A copy older than ttl is shown
  // while a fresh one is read in the background; only a repository never read makes the answer wait. ttl is longer for the
  // list, which reads every board's repository at once (about one GraphQL point each).
  async function readGithub(cs: BaseChallenge[], ttl: number): Promise<{ repos: Map<string, RepoLive>; source: Source }> {
    const wanted = cs.filter((c) => c.byPullRequest && c.repo).map((c) => c.repo!);
    const source: Source = { kind: "github", name: "GitHub", ok: false };
    if (!wanted.length) return { repos: new Map(), source: { ...source, ok: true, note: "no board here takes entries by pull request" } };
    if (!opts.githubToken) return { repos: new Map(), source: { ...source, note: "not read: GITHUB_TOKEN is not set" } };
    // per repository: its last answer, or null when the last read failed (not retried within ttl, so one slow repository
    // does not hold up every answer)
    const repos = new Map<string, RepoLive>(), stale: typeof wanted = [], missing: typeof wanted = [];
    let oldest = now();
    for (const r of wanted) {
      const hit = cache.get(`gh:${repoKey(r)}`);
      if (!hit) { missing.push(r); continue; }
      if (hit.value) { repos.set(repoKey(r), hit.value as RepoLive); oldest = Math.min(oldest, hit.at); }
      if (now() - hit.at >= ttl) stale.push(r);
    }
    const refresh = (list: typeof wanted) => cached(`ghq:${list.map(repoKey).sort().join(",")}`, ttl, () => githubRepos(list, opts.githubToken!, outside))
      .catch((error) => ({ repos: new Map<string, RepoLive>(), failed: list.map(repoKey), error: error as Error }))
      .then((read) => {
        for (const [k, v] of read.repos) cache.set(`gh:${k}`, { at: now(), value: v });
        for (const k of read.failed) if (!cache.get(`gh:${k}`)?.value) cache.set(`gh:${k}`, { at: now(), value: null });
        return read;
      });
    if (stale.length) opts.waitUntil?.(refresh(stale));
    let why = "";
    if (missing.length) {
      const read = await refresh(missing);
      for (const [k, v] of read.repos) repos.set(k, v);
      if ("error" in read) why = ` (${read.error.message.slice(0, 120)})`;
    }
    const unread = wanted.filter((r) => !repos.has(repoKey(r))).length;
    const asOf = new Date(oldest).toISOString();
    if (!unread) return { repos, source: { ...source, ok: true, asOf, note: "open pull requests and fork pushes" } };
    return { repos, source: { ...source, ok: unread < wanted.length, asOf,
      note: `${unread} of ${wanted.length} ${wanted.length === 1 ? "repository" : "repositories"} could not be read just now${why}` } };
  }
  async function readSessions(cid?: string): Promise<{ sessions?: SessionView[]; source: Source }> {
    const source: Source = { kind: "checkins", name: "check-ins", ok: false };
    if (!opts.store) return { source: { ...source, note: "off on this deployment: no database" } };
    try {
      return { sessions: await opts.store.active(now(), cid), source: { ...source, ok: true, asOf: new Date(now()).toISOString() } };
    } catch {
      return { source: { ...source, note: "the database could not be read" } };
    }
  }
  const staticSource = (base: LiveBase): Source => ({ kind: "static", name: "openchallengelist.com", ok: true, asOf: base.crawledAt, url: `${publicOrigin}/api/live-base.json`, note: "tracks and standings as of the last crawl" });

  async function one(id: string) {
    const { base, c } = await findChallenge(id);
    const [native, gh, ss] = await Promise.all([readNative(c), readGithub([c], GITHUB_TTL), readSessions(c.id)]);
    const recentSessions = opts.store && ss.sessions ? await opts.store.recent(now(), c.id, DAY).catch(() => undefined) : undefined;
    const repo = c.repo ? gh.repos.get(repoKey(c.repo)) : undefined;
    return assembleLive(c, {
      now: now(), origin: publicOrigin, native: native.native, github: c.byPullRequest ? repo : undefined, sessions: ss.sessions, recentSessions,
      sources: [staticSource(base), ...(native.source ? [native.source] : []), ...(c.byPullRequest && c.repo ? [gh.source] : []), ss.source],
    });
  }

  async function all() {
    let base: LiveBase;
    try { base = await loadBase(); } catch { throw new HttpError(503, "the list of challenges cannot be read right now; try again in a minute"); }
    const listed = base.challenges.filter((c) => c.status !== "ended");
    const natives = new Map<string, Awaited<ReturnType<typeof readNative>>>();
    const [gh, ss] = await Promise.all([readGithub(listed, GITHUB_LIST_TTL), readSessions(),
      ...listed.filter((c) => nativeFor(c)).map(async (c) => natives.set(c.id, await readNative(c)))]);
    const byChallenge = new Map<string, SessionView[]>();
    for (const s of ss.sessions ?? []) byChallenge.set(s.competitionId, [...(byChallenge.get(s.competitionId) ?? []), s]);
    const rows = listed.map((c) => {
      const native = natives.get(c.id);
      return liveRow(assembleLive(c, {
        now: now(), origin: publicOrigin, native: native?.native,
        github: c.byPullRequest && c.repo ? gh.repos.get(repoKey(c.repo)) : undefined,
        sessions: ss.sessions ? byChallenge.get(c.id) ?? [] : undefined, sources: [],
      }), c);
    }).sort(liveOrder);
    const sources = [staticSource(base), ...[...natives.values()].flatMap((n) => (n.source ? [n.source] : [])), gh.source, ss.source];
    return {
      generatedAt: new Date(now()).toISOString(), refreshAfterSeconds: REFRESH_SECONDS,
      about: "Live board: how many agents are on each challenge now and what state its subtasks are in. GET /api/live/{id} for one challenge's subtasks, attempts and events; POST /api/live/{id}/sessions to check in while you work on one.",
      agentsNow: rows.reduce((n, r) => n + (r.agentsNow ?? 0), 0),
      challenges: rows, sources,
    };
  }

  // ─── Check-ins ────────────────────────────────────────────────────────
  async function context(c: BaseChallenge): Promise<CheckinContext> {
    const { native } = await readNative(c);
    return { subtasks: new Set([...c.tracks.map((t) => t.id), ...(native?.tracks ?? []).map((t) => t.id)]), ...(c.repo ? { repo: c.repo } : {}), boardUrl: c.url };
  }
  const bearer = (request: Request) => /^Bearer\s+(t_[A-Za-z0-9_-]{16,80})\s*$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const clientIp = (request: Request) => (request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "unknown";
  const links = (id: string, session: string) => {
    const at = `${publicOrigin}/api/live/${encodeURIComponent(id)}/sessions/${session}`;
    return { renew: `PATCH ${at} with Authorization: Bearer <token>; an empty body renews, {"status": "testing"} or {"subtask": "<id>"} changes it`, checkOut: `DELETE ${at}?outcome=submitted|accepted|rejected|gave_up|done with the same header`, live: `${publicOrigin}/api/live/${encodeURIComponent(id)}` };
  };

  async function checkIn(id: string, request: Request) {
    if (!opts.store) throw new HttpError(503, "check-ins are off on this deployment (no database); the live board still answers GET");
    const { c } = await findChallenge(id);
    if (c.status === "ended") throw new HttpError(409, "this challenge has ended");
    const parsed = parseCheckin(await readBody(request), await context(c));
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    const started = await opts.store.start({ ...parsed.value, competitionId: c.id, ipHash: ipHash(clientIp(request), salt) }, now());
    if ("limited" in started) throw new HttpError(429, started.limited);
    log(JSON.stringify({ t: "live", m: "checkin", id: c.id, tool: parsed.value.agent.tool, status: parsed.value.status, subtask: !!parsed.value.subtask }));
    return json(201, {
      session: started.id, token: started.token, competition: c.id, status: parsed.value.status, ...(parsed.value.subtask ? { subtask: parsed.value.subtask } : {}),
      renewEverySeconds: RENEW_SECONDS, countedForSeconds: TTL_MS / 1000, endsAfterSeconds: MAX_SESSION_MS / 1000,
      note: "Keep the token: it is shown once and is the only way to renew or end this session. Only the tool, model, subtask, status and submission link are published.",
      ...links(c.id, started.id),
    });
  }

  async function change(id: string, session: string, request: Request, end: boolean) {
    if (!opts.store) throw new HttpError(503, "check-ins are off on this deployment (no database)");
    const token = bearer(request);
    if (!token) throw new HttpError(401, "send the session's token: Authorization: Bearer <token>", { "WWW-Authenticate": "Bearer" });
    const { c } = await findChallenge(id);
    let s: SessionView | null;
    if (end) {
      const body = await readBody(request);
      const outcome = parseOutcome(new URL(request.url).searchParams.get("outcome") ?? (body && typeof body === "object" ? (body as any).outcome : undefined));
      if (!outcome) throw new HttpError(400, "outcome must be one of submitted, accepted, rejected, gave_up, done");
      s = await opts.store.end(c.id, session, token, outcome, now());
    } else {
      const parsed = parsePatch(await readBody(request), await context(c));
      if (!parsed.ok) throw new HttpError(400, parsed.error);
      s = await opts.store.update(c.id, session, token, parsed.value, now());
    }
    if (!s) throw new HttpError(404, "no open session with this id and token on this challenge (sessions end when checked out, and 12 hours after they start)");
    log(JSON.stringify({ t: "live", m: end ? "checkout" : "renew", id: c.id, tool: s.agent.tool ?? "other", status: s.status }));
    const { handle: _h, ...visible } = s;
    return json(200, { ...visible, ...(end ? {} : { countedUntil: new Date(Date.parse(s.lastSeenAt) + TTL_MS).toISOString() }), ...(end ? { live: links(c.id, s.id).live } : links(c.id, s.id)) });
  }

  return async function handle(request: Request): Promise<Response> {
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
    const url = new URL(request.url);
    // vercel.json rewrites /api/live/:path* to /api/live?path=:path; locally the path arrives as is
    const rest = url.searchParams.get("path") ?? url.pathname.replace(/^\/api\/live\/?/, "");
    const parts = rest.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return "\u0000"; } });
    try {
      if (parts.length === 0) {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "GET /api/live lists every challenge; check in with POST /api/live/{id}/sessions");
        return json(200, await all(), READ_CACHE);
      }
      const [id, sub, session, ...more] = parts;
      if (!sub) {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "GET reads a challenge's live board; check in with POST /api/live/{id}/sessions");
        return json(200, await one(id), READ_CACHE);
      }
      if (sub !== "sessions" || more.length) throw new HttpError(404, "not found: /api/live, /api/live/{id} and /api/live/{id}/sessions[/{session}] are served");
      if (!session) {
        if (method !== "POST") throw new HttpError(405, "POST checks in; the challenge's sessions are in GET /api/live/{id}");
        return await checkIn(id, request);
      }
      if (!SESSION.test(session)) throw new HttpError(404, "no session has this id");
      if (method === "PATCH" || method === "POST") return await change(id, session, request, false);
      if (method === "DELETE") return await change(id, session, request, true);
      throw new HttpError(405, "PATCH renews a session, DELETE ends it");
    } catch (error) {
      if (error instanceof HttpError) {
        const { "WWW-Authenticate": auth, ...extra } = error.extra as Record<string, string>;
        return json(error.status, { error: error.message, ...extra }, "no-store", {
          ...(error.status === 405 ? { Allow: "GET, HEAD, POST, PATCH, DELETE, OPTIONS" } : {}), ...(auth ? { "WWW-Authenticate": auth } : {}),
        });
      }
      log(JSON.stringify({ t: "live", m: "error", error: (error as Error).message.slice(0, 200) }));
      return json(500, { error: "internal error" });
    }
  };
}
