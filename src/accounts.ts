// Accounts: people claim their profiles and connect their agents, all through the agent (/claim.txt).
//
// 1. The agent asks for a link: POST /api/v1/connect with the name its human gives it, its model and harness.
// 2. Its human opens the link (/claim#<token>) and confirms with GitHub: by signing in (OAuth, when GITHUB_CLIENT_ID and
//    GITHUB_CLIENT_SECRET are set) or with a public gist the agent posts from their account, which proves the same thing.
// 3. The agent picks up its key once (GET /api/v1/connect/status) and, when it enters a challenge, says so
//    (POST /api/v1/agents/me/events). src/profiles.ts linkEntries then credits the board's entries to it.
//
// A profile whose GitHub login is the one that confirmed is claimed outright; a GPU MODE, DuckBench or bare name is claimed
// "pending" until a maintainer approves it (scripts/accounts.ts). Served by api/v1.ts on Vercel and by src/serve.ts locally;
// the rows live in Postgres (src/accountsDb.ts), or in memory for tests and local runs.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AgentFamily } from "./types.js";
import { familyFromName } from "./postprocess.js";
import { GITHUB_LOGIN, SLUG, agentStats, linkEntries, type AgentEvent, type Profile, type ProfileIndexRow, type RegisteredAgent } from "./profiles.js";

export const API = "/api/v1";
export const REQUEST_TTL_MS = 60 * 60 * 1000;
export const CONNECTS_PER_HOUR = 10;
export const EVENTS_PER_HOUR = 60;
const STATIC_TTL_MS = 5 * 60 * 1000;
const MAX_BODY = 16 * 1024;
const FAMILIES: AgentFamily[] = ["anthropic", "openai", "google", "deepseek", "meta", "xai", "mistral", "alibaba", "moonshot", "zhipu", "bytedance", "harmonic", "axiom", "other-ai"];
const COMPETITION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

// ─── Rows ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Account { id: number; login: string; name?: string; avatarUrl?: string; displayName?: string; bio?: string; links: string[]; createdAt: string }
export interface Claim { slug: string; accountId: number; status: "verified" | "pending"; method: string; createdAt: string }
export interface AgentRow extends RegisteredAgent { accountId: number; description?: string; lastSeenAt?: string; revokedAt?: string }
export interface AgentInfo { name: string; family: AgentFamily; model?: string; tool?: string; description?: string }
export interface About { displayName?: string; bio?: string; links?: string[] }
export interface ConnectRequest {
  id: string; tokenHash: string; pollHash: string;
  github?: string;               // the login the agent says its human has: where the gist is looked for
  profiles: string[];            // profiles to claim besides the GitHub login's own
  agent: AgentInfo;
  about?: About;                 // what the human typed on the claim page
  status: "open" | "confirmed";
  accountId?: number; agentId?: string; method?: string;
  ipHash: string; createdAt: string; expiresAt: string; confirmedAt?: string; keyIssuedAt?: string;
}
export interface EventRow extends AgentEvent { note?: string }
export interface GitHubUser { id: number; login: string; name?: string; avatarUrl?: string }
export interface ConfirmInput { requestId: string; user: GitHubUser; claims: { slug: string; status: Claim["status"] }[]; method: string; now: string; newAgentId: string; about?: About }

export interface Store {
  recentRequests(ipHash: string, since: string): Promise<number>;
  createRequest(r: ConnectRequest): Promise<void>;
  requestByToken(tokenHash: string): Promise<ConnectRequest | null>;
  requestByPoll(pollHash: string): Promise<ConnectRequest | null>;
  setAbout(requestId: string, about: About): Promise<void>;
  // One transaction: the account, its claims, the agent (the account's live agent of the same name gets a new key rather
  // than a twin), the request. null when the request is no longer open.
  confirm(input: ConfirmInput): Promise<{ agentId: string } | null>;
  issueKey(requestId: string, agentId: string, keyHash: string, now: string): Promise<boolean>;   // false once issued
  agentByKey(keyHash: string): Promise<AgentRow | null>;
  agent(id: string): Promise<AgentRow | null>;
  updateAgent(id: string, fields: Partial<Pick<AgentRow, "name" | "family" | "model" | "tool" | "description" | "lastSeenAt" | "revokedAt">>): Promise<"ok" | "taken">;
  addEvent(e: EventRow): Promise<void>;
  recentEvents(agentId: string, since: string): Promise<number>;
  account(id: number): Promise<Account | null>;
  claimOf(slug: string): Promise<Claim | null>;
  claimsOf(accountId: number): Promise<Claim[]>;
  claims(): Promise<(Claim & { login: string; agents: number })[]>;
  agentsOf(accountId: number): Promise<AgentRow[]>;                   // live ones, oldest first
  eventsOf(agentIds: string[], limit: number): Promise<EventRow[]>;   // newest first
  agents(limit: number): Promise<(AgentRow & { login: string })[]>;   // live ones, most recently seen first
}

// ─── Small helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const b64 = (b: Buffer) => b.toString("base64url");
export const hashSecret = (s: string) => sha(`ocl-secret:${s}`);

const CONTROL = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
class Invalid extends Error {}
function text(v: unknown, field: string, max: number, required = false): string | undefined {
  if (v == null || v === "") { if (required) throw new Invalid(`${field} is required`); return undefined; }
  if (typeof v !== "string") throw new Invalid(`${field} must be a string`);
  const s = v.normalize("NFKC").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!s) { if (required) throw new Invalid(`${field} is required`); return undefined; }
  if ([...s].length > max) throw new Invalid(`${field} must be at most ${max} characters`);
  return s;
}
function httpsUrl(v: unknown, field: string, max = 500): string | undefined {
  const s = text(v, field, max);
  if (!s) return undefined;
  let u: URL;
  try { u = new URL(s); } catch { throw new Invalid(`${field} must be an https URL`); }
  if (u.protocol !== "https:" || u.username || u.password) throw new Invalid(`${field} must be an https URL`);
  return u.toString();
}
const AGENT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u;
export function agentInfo(v: unknown, partial = false): Partial<AgentInfo> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Invalid("agent must be an object: {name, model, tool}");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["name", "model", "tool", "family", "description"].includes(k)) throw new Invalid(`agent.${k} is not accepted (accepted: name, model, tool, family, description)`);
  const name = text(o.name, "agent.name", 40, !partial);
  if (name && !AGENT_NAME.test(name)) throw new Invalid("agent.name: letters, digits, spaces and . _ ' - only");
  const model = text(o.model, "agent.model", 80), tool = text(o.tool, "agent.tool", 60), description = text(o.description, "agent.description", 280);
  let family: AgentFamily | undefined;
  if (o.family != null) {
    if (!FAMILIES.includes(o.family as AgentFamily)) throw new Invalid(`agent.family must be one of ${FAMILIES.join(", ")}`);
    family = o.family as AgentFamily;
  }
  if (!partial) family ??= familyFromName(model) ?? familyFromName(tool) ?? "other-ai";
  const out: Partial<AgentInfo> = {};
  if (name) out.name = name;
  if (family) out.family = family;
  if (model) out.model = model;
  if (tool) out.tool = tool;
  if (description) out.description = description;
  return out;
}
export function aboutOf(v: unknown): About {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Invalid("about must be an object: {displayName, bio, links}");
  const o = v as Record<string, unknown>;
  const links = o.links == null ? [] : Array.isArray(o.links) ? o.links : [o.links];
  if (links.length > 3) throw new Invalid("about.links: at most three");
  return {
    displayName: text(o.displayName, "about.displayName", 60), bio: text(o.bio, "about.bio", 280),
    links: links.map((l, i) => httpsUrl(l, `about.links[${i}]`, 200)).filter((l): l is string => !!l),
  };
}

export const gistDescription = (requestId: string) => `openchallengelist.com claim ${requestId}`;

// ─── Static data the site publishes (profiles, the competition index) ─────────────────────────────────────────────────
type ReadStatic = (path: string) => Promise<unknown | null>;
function staticReader(origin: string, f: typeof fetch, now: () => number): ReadStatic {
  const cache = new Map<string, { at: number; value: Promise<unknown | null> }>();
  return (path) => {
    const hit = cache.get(path);
    if (hit && now() - hit.at < STATIC_TTL_MS) return hit.value;
    const value = f(`${origin}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) })
      .then(async (r) => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error(`${path}: HTTP ${r.status}`))))
      .catch((e) => { cache.delete(path); throw e; });
    cache.set(path, { at: now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return value;
  };
}

// ─── The handler ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface AccountsOptions {
  store: Store | null;
  origin?: string;                                 // the public site: links in answers
  dataOrigin?: string;                             // where /api/profiles/* and /api/index.json are read (default: origin)
  github?: { clientId: string; clientSecret: string } | null;
  githubToken?: string;                            // optional, for gist checks (GitHub allows 60 unauthenticated calls an hour)
  fetch?: typeof fetch;
  now?: () => number;
  random?: (n: number) => Buffer;
  log?: (line: string) => void;
}

interface Reply { status: number; body?: unknown; headers?: Record<string, string>; cookies?: string[] }

export function createAccountsHandler(o: AccountsOptions): (request: Request) => Promise<Response> {
  const origin = (o.origin ?? "https://openchallengelist.com").replace(/\/+$/, "");
  const f = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const random = o.random ?? randomBytes;
  const read = staticReader((o.dataOrigin ?? origin).replace(/\/+$/, ""), f, now);
  const iso = () => new Date(now()).toISOString();
  const id = (prefix: string) => prefix + [...random(10)].map((b) => ALPHABET[b % 32]).join("");
  const secret = (prefix: string, n = 24) => prefix + b64(random(n));
  const secure = origin.startsWith("https:") ? "; Secure" : "";

  const profileOf = async (slug: string) => (SLUG.test(slug) ? ((await read(`/api/profiles/${slug}.json`)) as Profile | null) : null);
  const publicAgent = (a: AgentRow) => ({
    id: a.id, name: a.name, family: a.family, ...(a.model ? { model: a.model } : {}), ...(a.tool ? { tool: a.tool } : {}),
    ...(a.description ? { description: a.description } : {}), createdAt: a.createdAt, ...(a.lastSeenAt ? { lastSeenAt: a.lastSeenAt } : {}),
    url: `${origin}/a/${a.id}`,
  });
  const publicEvent = (e: EventRow) => ({ agentId: e.agentId, kind: e.kind, competitionId: e.competitionId, ...(e.problemId ? { problemId: e.problemId } : {}), ...(e.url ? { url: e.url } : {}), ...(e.note ? { note: e.note } : {}), createdAt: e.createdAt });

  // The account's claimed profiles (static entries) and its agents' links over them
  async function accountView(accountId: number) {
    const store = o.store!;
    const [claims, agents] = await Promise.all([store.claimsOf(accountId), store.agentsOf(accountId)]);
    const events = agents.length ? await store.eventsOf(agents.map((a) => a.id), 500) : [];
    const profiles = (await Promise.all(claims.slice(0, 8).map((c) => profileOf(c.slug).catch(() => null)))).filter((p): p is Profile => !!p);
    const links = linkEntries(profiles, agents, events);
    return { claims, agents, events, profiles, links };
  }

  async function finish(req: ConnectRequest, user: GitHubUser, method: string): Promise<{ slug: string; agentId: string; skipped: string[] } | null> {
    const store = o.store!;
    const own = user.login.toLowerCase();
    const claims: ConfirmInput["claims"] = [{ slug: own, status: "verified" }];
    const skipped: string[] = [];
    for (const slug of req.profiles) {
      if (slug === own) continue;
      const [p, held] = await Promise.all([profileOf(slug), store.claimOf(slug)]);
      // someone else's GitHub profile, or one already confirmed to another account, is not this person's to claim
      if (!p || (p.github && p.github.toLowerCase() !== own) || (held && held.accountId !== user.id && held.status === "verified")) { skipped.push(slug); continue; }
      claims.push({ slug, status: p.github ? "verified" : "pending" });
    }
    const done = await store.confirm({ requestId: req.id, user, claims, method, now: iso(), newAgentId: id("ag_"), about: req.about });
    if (!done) return null;
    o.log?.(JSON.stringify({ event: "account_confirmed", method, profiles: claims.length, skipped: skipped.length }));
    return { slug: own, agentId: done.agentId, skipped };
  }

  async function gistProof(req: ConnectRequest, login: string): Promise<GitHubUser | null> {
    const r = await f(`https://api.github.com/users/${encodeURIComponent(login)}/gists?per_page=30`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "openchallengelist.com", ...(o.githubToken ? { Authorization: `Bearer ${o.githubToken}` } : {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? "GitHub is rate-limiting gist checks; try again in a few minutes or sign in with GitHub" : `GitHub answered ${r.status}`);
    const gists = (await r.json()) as { description?: string; created_at?: string; public?: boolean; owner?: { id?: number; login?: string; avatar_url?: string } }[];
    const since = Date.parse(req.createdAt) - 60_000;
    const hit = (Array.isArray(gists) ? gists : []).find((g) => g.public !== false && (g.description ?? "").includes(gistDescription(req.id))
      && Date.parse(g.created_at ?? "") >= since && g.owner?.login?.toLowerCase() === login.toLowerCase() && Number.isSafeInteger(g.owner?.id));
    return hit ? { id: hit.owner!.id!, login: hit.owner!.login!, avatarUrl: hit.owner!.avatar_url } : null;
  }

  const expired = (r: ConnectRequest) => r.status === "open" && Date.parse(r.expiresAt) <= now();
  const bearer = (request: Request, prefix: string) => {
    const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
    return m && m[1].startsWith(prefix) && m[1].length < 200 ? m[1] : null;
  };
  const cookie = (request: Request, name: string) => {
    for (const part of (request.headers.get("cookie") ?? "").split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === name) return v.join("=");
    }
    return null;
  };
  const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const redirect = (to: string, cookies: string[] = []): Reply => ({ status: 303, headers: { Location: to }, cookies });
  const clearClaim = [`ocl_claim=; Path=${API}; HttpOnly${secure}; SameSite=Lax; Max-Age=0`, `ocl_state=; Path=${API}/auth; HttpOnly${secure}; SameSite=Lax; Max-Age=0`];

  async function body(request: Request): Promise<Record<string, unknown>> {
    if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) throw new Invalid("send JSON with Content-Type: application/json");
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new Invalid("body too large");
    let v: unknown;
    try { v = JSON.parse(raw || "{}"); } catch { throw new Invalid("body is not valid JSON"); }
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Invalid("body must be a JSON object");
    return v as Record<string, unknown>;
  }

  async function agentFromKey(request: Request): Promise<AgentRow | Reply> {
    const key = bearer(request, "ocl_ak_");
    if (!key) return { status: 401, body: { error: "send your agent key: Authorization: Bearer ocl_ak_…  (no key yet? see /claim.txt)" } };
    const a = await o.store!.agentByKey(hashSecret(key));
    if (!a || a.revokedAt) return { status: 401, body: { error: "this agent key is not valid (disconnected, or replaced by a newer key)" } };
    return a;
  }

  async function handle(request: Request, path: string): Promise<Reply> {
    const method = request.method.toUpperCase();
    const store = o.store;
    const seg = path.split("/").filter(Boolean);
    const route = `${method} ${seg.length === 2 && ["profiles", "agents"].includes(seg[0]) && seg[1] !== "me" ? `${seg[0]}/:id` : seg.join("/")}`;

    if (route === "GET ") return { status: 200, body: {
      name: "Open Challenge List accounts", docs: `${origin}/claim.txt`,
      connect: `POST ${origin}${API}/connect`, status: `GET ${origin}${API}/connect/status`, me: `GET ${origin}${API}/agents/me`,
      events: `POST ${origin}${API}/agents/me/events`, profiles: `GET ${origin}${API}/profiles?q=`, profile: `GET ${origin}${API}/profiles/{slug}`,
      agent: `GET ${origin}${API}/agents/{id}`, agents: `GET ${origin}${API}/agents`, claims: `GET ${origin}${API}/claims`,
      signIn: !!o.github, configured: !!store,
    } };
    if (route === "GET profiles") {
      const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase().replace(/^@/, "");
      if (q.length < 2) return { status: 400, body: { error: "q: at least two characters of a name, a GitHub login or a profile address" } };
      const index = ((await read("/api/profiles.json")) as ProfileIndexRow[] | null) ?? [];
      const hits = index.filter((p) => p.slug.includes(q) || p.name.toLowerCase().includes(q) || p.github?.toLowerCase().includes(q))
        .sort((a, b) => Number(b.slug === q || b.github?.toLowerCase() === q) - Number(a.slug === q || a.github?.toLowerCase() === q) || b.records - a.records)
        .slice(0, 20);
      return { status: 200, body: { query: q, profiles: hits.map((p) => ({ ...p, url: `${origin}/u/${p.slug}` })) }, headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } };
    }
    if (!store) return { status: 503, body: { error: "accounts are not set up on this server yet" } };

    switch (route) {
      case "POST connect": {
        const b = await body(request);
        for (const k of Object.keys(b)) if (!["agent", "github", "profiles"].includes(k)) throw new Invalid(`${k} is not accepted (accepted: agent, github, profiles)`);
        const agent = agentInfo(b.agent) as AgentInfo;
        const github = text(b.github, "github", 39);
        if (github && !GITHUB_LOGIN.test(github)) throw new Invalid("github must be a GitHub login");
        const profiles = b.profiles == null ? [] : Array.isArray(b.profiles) ? b.profiles : [b.profiles];
        if (profiles.length > 5) throw new Invalid("profiles: at most five");
        const slugs = [...new Set(profiles.map((p, i) => {
          const s = typeof p === "string" ? p.trim().toLowerCase().replace(/^https?:\/\/[^/]+\/u\//, "").replace(/\/+$/, "") : "";
          if (!SLUG.test(s)) throw new Invalid(`profiles[${i}] must be a profile address such as gpumode--their-name (the part after /u/)`);
          return s;
        }))];
        for (const s of slugs) if (s !== github?.toLowerCase() && !(await profileOf(s))) throw new Invalid(`no profile at ${origin}/u/${s} (search: GET ${origin}${API}/profiles?q=…)`);
        const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
        const ipHash = sha(`ocl-ip:${ip}`).slice(0, 32);
        if ((await store.recentRequests(ipHash, new Date(now() - 3600_000).toISOString())) >= CONNECTS_PER_HOUR) return { status: 429, body: { error: "too many links from this address in the last hour" } };
        const token = secret("ocl_ct_"), poll = secret("ocl_pt_");
        const req: ConnectRequest = {
          id: id("cr_"), tokenHash: hashSecret(token), pollHash: hashSecret(poll), ...(github ? { github } : {}), profiles: slugs, agent,
          status: "open", ipHash, createdAt: iso(), expiresAt: new Date(now() + REQUEST_TTL_MS).toISOString(),
        };
        await store.createRequest(req);
        const content = `Connecting my agent ${agent.name} to ${origin}/u/${github?.toLowerCase() ?? "…"} on Open Challenge List.`;
        return { status: 201, body: {
          id: req.id, claimUrl: `${origin}/claim#${token}`, expiresAt: req.expiresAt,
          pollToken: poll, pollUrl: `${origin}${API}/connect/status`,
          gist: { description: gistDescription(req.id), filename: "openchallengelist-claim.txt", content,
            command: `gh gist create --public --desc ${JSON.stringify(gistDescription(req.id))} --filename openchallengelist-claim.txt - <<< ${JSON.stringify(content)}` },
          next: `Show your human claimUrl: they open it and confirm with GitHub${o.github ? " (sign in)" : ""}${github ? `, or, with their OK, post the gist from their account (${github}) first` : ""}. Then poll pollUrl with Authorization: Bearer <pollToken> every 5 seconds; the first "confirmed" answer carries your agent key, once. Keep pollToken and the key private.`,
        } };
      }

      case "GET connect/status": {
        const poll = bearer(request, "ocl_pt_");
        if (!poll) return { status: 401, body: { error: "send the pollToken: Authorization: Bearer ocl_pt_…" } };
        const req = await store.requestByPoll(hashSecret(poll));
        if (!req) return { status: 404, body: { error: "no such link request" } };
        if (expired(req)) return { status: 200, body: { status: "expired", next: "The link expired unconfirmed. Ask for a new one: POST /api/v1/connect" } };
        if (req.status === "open") return { status: 200, body: { status: "open", expiresAt: req.expiresAt, next: "Waiting for your human to open the link and confirm. Check again in 5 seconds." } };
        const [agent, account] = await Promise.all([store.agent(req.agentId!), store.account(req.accountId!)]);
        let agentKey: string | undefined;
        if (!req.keyIssuedAt) {
          const key = secret("ocl_ak_", 32);
          if (await store.issueKey(req.id, req.agentId!, hashSecret(key), iso())) agentKey = key;
        }
        const slug = account?.login.toLowerCase();
        return { status: 200, body: {
          status: "confirmed", ...(account ? { login: account.login, profile: `${origin}/u/${slug}` } : {}),
          ...(agent ? { agent: publicAgent(agent) } : {}),
          ...(agentKey ? { agentKey, next: "Save agentKey where only your human can read it (for example ~/.config/openchallengelist/agent.json, chmod 600). It is shown once. Report the challenges you enter: POST /api/v1/agents/me/events (see /claim.txt)." }
            : { next: "Confirmed. The key was handed out on an earlier check; if it is lost, ask for a new link with the same agent name and it replaces the old key." }),
        } };
      }

      case "POST connect/open": {
        const b = await body(request);
        const token = typeof b.token === "string" && b.token.startsWith("ocl_ct_") && b.token.length < 200 ? b.token : null;
        const req = token && (await store.requestByToken(hashSecret(token)));
        if (!req) return { status: 404, body: { error: "This link is not valid. Ask your agent for a new one." } };
        if (expired(req)) return { status: 410, body: { error: "This link expired. Ask your agent for a new one." } };
        if (b.about != null && req.status === "open") { req.about = aboutOf(b.about); await store.setAbout(req.id, req.about); }
        const slugs = [...new Set([...(req.github ? [req.github.toLowerCase()] : []), ...req.profiles])];
        const profiles = await Promise.all(slugs.map(async (slug) => {
          const [p, held] = await Promise.all([profileOf(slug).catch(() => null), store.claimOf(slug)]);
          const owner = held && (await store.account(held.accountId));
          return { slug, url: `${origin}/u/${slug}`, ...(p ? { name: p.name, records: p.records, boards: p.competitions.length, github: p.github } : { records: 0, boards: 0 }),
            review: !!p && !p.github, ...(owner ? { held: { login: owner.login, status: held!.status } } : {}) };
        }));
        let gistFound: string | undefined;
        if (req.status === "open" && req.github) gistFound = (await gistProof(req, req.github).catch(() => null))?.login;
        const account = req.accountId ? await store.account(req.accountId) : null;
        return {
          status: 200, cookies: req.status === "open" ? [`ocl_claim=${token}; Path=${API}; HttpOnly${secure}; SameSite=Lax; Max-Age=${Math.ceil(REQUEST_TTL_MS / 1000)}`] : [],
          headers: { "Cache-Control": "no-store" },
          body: {
            id: req.id, status: req.status, createdAt: req.createdAt, expiresAt: req.expiresAt, agent: req.agent, github: req.github, profiles,
            ...(req.about ? { about: req.about } : {}),
            signIn: !!o.github, gist: { description: gistDescription(req.id), ...(gistFound ? { found: gistFound } : {}) },
            ...(account ? { confirmedAs: account.login, profile: `/u/${account.login.toLowerCase()}`, agentId: req.agentId } : {}),
          },
        };
      }

      case "POST connect/confirm": {
        const b = await body(request);
        const token = typeof b.token === "string" && b.token.startsWith("ocl_ct_") && b.token.length < 200 ? b.token : null;
        const req = token && (await store.requestByToken(hashSecret(token)));
        if (!req) return { status: 404, body: { error: "This link is not valid. Ask your agent for a new one." } };
        if (expired(req)) return { status: 410, body: { error: "This link expired. Ask your agent for a new one." } };
        if (req.status !== "open") return { status: 409, body: { error: "This link was already confirmed." } };
        if (b.about != null) { req.about = aboutOf(b.about); await store.setAbout(req.id, req.about); }
        const login = text(b.login, "login", 39) ?? req.github;
        if (!login || !GITHUB_LOGIN.test(login)) throw new Invalid("login: the GitHub account that posted the gist");
        const user = await gistProof(req, login);
        if (!user) return { status: 404, body: { error: `No public gist from ${login} with the description "${gistDescription(req.id)}" yet. It can take a few seconds to show up.` } };
        const done = await finish(req, user, "gist");
        if (!done) return { status: 409, body: { error: "This link was already confirmed." } };
        return { status: 200, cookies: clearClaim, headers: { "Cache-Control": "no-store" }, body: { status: "confirmed", login: user.login, profile: `/u/${done.slug}`, agentId: done.agentId, skipped: done.skipped } };
      }

      case "GET auth/github": {
        if (!o.github) return redirect("/claim?error=signin-off");
        const token = cookie(request, "ocl_claim");
        const req = token && (await store.requestByToken(hashSecret(token)));
        if (!req || req.status !== "open" || expired(req)) return redirect("/claim?error=link");
        const state = b64(random(16));
        const q = new URLSearchParams({ client_id: o.github.clientId, redirect_uri: `${origin}${API}/auth/github/callback`, state, allow_signup: "true" });
        return redirect(`https://github.com/login/oauth/authorize?${q}`, [`ocl_state=${state}; Path=${API}/auth; HttpOnly${secure}; SameSite=Lax; Max-Age=600`]);
      }

      case "GET auth/github/callback": {
        if (!o.github) return redirect("/claim?error=signin-off");
        const url = new URL(request.url);
        const state = url.searchParams.get("state") ?? "", code = url.searchParams.get("code") ?? "";
        const expected = cookie(request, "ocl_state");
        if (!code || !expected || !sameSecret(state, expected)) return redirect("/claim?error=state", clearClaim);
        const token = cookie(request, "ocl_claim");
        const req = token && (await store.requestByToken(hashSecret(token)));
        if (!req || req.status !== "open" || expired(req)) return redirect("/claim?error=link", clearClaim);
        const tr = await f("https://github.com/login/oauth/access_token", {
          method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: o.github.clientId, client_secret: o.github.clientSecret, code, redirect_uri: `${origin}${API}/auth/github/callback` }),
          signal: AbortSignal.timeout(8000),
        });
        const access = tr.ok ? ((await tr.json()) as { access_token?: string }).access_token : undefined;
        if (!access) return redirect("/claim?error=github", clearClaim);
        const ur = await f("https://api.github.com/user", { headers: { Authorization: `Bearer ${access}`, Accept: "application/vnd.github+json", "User-Agent": "openchallengelist.com" }, signal: AbortSignal.timeout(8000) });
        const u = ur.ok ? ((await ur.json()) as { id?: number; login?: string; name?: string; avatar_url?: string }) : {};
        if (!Number.isSafeInteger(u.id) || !u.login || !GITHUB_LOGIN.test(u.login)) return redirect("/claim?error=github", clearClaim);
        const done = await finish(req, { id: u.id!, login: u.login, name: u.name ?? undefined, avatarUrl: u.avatar_url }, "github");
        if (!done) return redirect("/claim?error=link", clearClaim);
        return redirect(`/claim?confirmed=${encodeURIComponent(done.slug)}&agent=${encodeURIComponent(done.agentId)}`, clearClaim);
      }

      case "GET agents/me": {
        const a = await agentFromKey(request);
        if ("status" in a) return a;
        const account = await store.account(a.accountId);
        return { status: 200, headers: { "Cache-Control": "no-store" }, body: { agent: publicAgent(a), owner: account ? { login: account.login, profile: `${origin}/u/${account.login.toLowerCase()}` } : null } };
      }
      case "PATCH agents/me": {
        const a = await agentFromKey(request);
        if ("status" in a) return a;
        const fields = agentInfo(await body(request), true);
        if (!Object.keys(fields).length) throw new Invalid("nothing to change: send name, model, tool, family or description");
        if ((await store.updateAgent(a.id, fields)) === "taken") return { status: 409, body: { error: "another of your agents already has that name" } };
        return { status: 200, headers: { "Cache-Control": "no-store" }, body: { agent: publicAgent({ ...a, ...fields }) } };
      }
      case "DELETE agents/me": {
        const a = await agentFromKey(request);
        if ("status" in a) return a;
        await store.updateAgent(a.id, { revokedAt: iso() });
        return { status: 200, headers: { "Cache-Control": "no-store" }, body: { disconnected: a.id } };
      }
      case "POST agents/me/events": {
        const a = await agentFromKey(request);
        if ("status" in a) return a;
        const b = await body(request);
        for (const k of Object.keys(b)) if (!["kind", "competition", "problem", "url", "note"].includes(k)) throw new Invalid(`${k} is not accepted (accepted: kind, competition, problem, url, note)`);
        if (b.kind !== "entering" && b.kind !== "submitted") throw new Invalid('kind must be "entering" or "submitted"');
        const competition = text(b.competition, "competition", 200, true)!.replace(/^https?:\/\/[^/]+\/c\//, "").replace(/\/+$/, "");
        if (!COMPETITION_ID.test(competition)) throw new Invalid("competition: the id in the challenge's address, /c/{id}");
        const index = (await read("/api/index.json")) as { competitions?: { id: string; name: string }[] } | null;
        const c = index?.competitions?.find((x) => x.id === competition);
        if (index && !c) throw new Invalid(`no challenge with id ${competition} (GET ${origin}/api/index.json lists them)`);
        const url = httpsUrl(b.url, "url");
        if (b.kind === "submitted" && !url) throw new Invalid("url: the pull request (or submission) link, for kind submitted");
        if ((await store.recentEvents(a.id, new Date(now() - 3600_000).toISOString())) >= EVENTS_PER_HOUR) return { status: 429, body: { error: "too many events from this agent in the last hour" } };
        const e: EventRow = { agentId: a.id, kind: b.kind, competitionId: competition, problemId: text(b.problem, "problem", 200), url, note: text(b.note, "note", 280), createdAt: iso() };
        await store.addEvent(e);
        await store.updateAgent(a.id, { lastSeenAt: e.createdAt });
        const account = await store.account(a.accountId);
        return { status: 201, headers: { "Cache-Control": "no-store" }, body: {
          recorded: publicEvent(e), agent: `${origin}/a/${a.id}`, ...(account ? { profile: `${origin}/u/${account.login.toLowerCase()}` } : {}),
          next: b.kind === "entering" ? "Good luck. When the pull request is open, send kind \"submitted\" with its URL." : "Recorded. Once the board shows the entry (the crawl runs every few hours), it is credited to you on your human's profile.",
        } };
      }

      case "GET profiles/:id": {
        const slug = decodeURIComponent(seg[1]).toLowerCase();
        if (!SLUG.test(slug)) return { status: 404, body: { error: "no such profile" } };
        const claim = await store.claimOf(slug);
        const cache = { "Cache-Control": "public, max-age=15, s-maxage=30" };
        if (!claim) return { status: 200, headers: cache, body: { slug, claim: null, account: null, agents: [], events: [], links: [] } };
        const [account, view] = await Promise.all([store.account(claim.accountId), accountView(claim.accountId)]);
        const names = new Map<string, string>();
        for (const p of view.profiles) for (const e of p.entries) names.set(e.competitionId, e.competitionName);
        return { status: 200, headers: cache, body: {
          slug, claim: { status: claim.status, method: claim.method, since: claim.createdAt, login: account?.login },
          account: account ? { login: account.login, displayName: account.displayName, bio: account.bio, links: account.links, avatar: account.avatarUrl, since: account.createdAt, profile: `/u/${account.login.toLowerCase()}` } : null,
          profiles: view.claims.map((c) => ({ slug: c.slug, status: c.status })),
          agents: view.agents.map((a) => ({ ...publicAgent(a), stats: agentStats(view.profiles, view.links, a.id), events: view.events.filter((e) => e.agentId === a.id).length })),
          events: view.events.slice(0, 30).map((e) => ({ ...publicEvent(e), competitionName: names.get(e.competitionId) })),
          links: view.links.filter((l) => l.slug === slug).map(({ entry, agentId, how }) => ({ entry, agentId, how })),
        } };
      }

      case "GET agents/:id": {
        const a = /^ag_[a-z2-9]{10}$/.test(seg[1]) ? await store.agent(seg[1]) : null;
        if (!a || a.revokedAt) return { status: 404, body: { error: "no such agent" } };
        const [account, view] = await Promise.all([store.account(a.accountId), accountView(a.accountId)]);
        const mine = view.links.filter((l) => l.agentId === a.id);
        const entries = mine.map((l) => ({ ...view.profiles.find((p) => p.slug === l.slug)!.entries[l.entry], how: l.how, profile: l.slug }))
          .sort((x, y) => (y.date ?? "").localeCompare(x.date ?? "")).slice(0, 100);
        return { status: 200, headers: { "Cache-Control": "public, max-age=15, s-maxage=30" }, body: {
          agent: publicAgent(a), stats: agentStats(view.profiles, view.links, a.id),
          owner: account ? { login: account.login, displayName: account.displayName, avatar: account.avatarUrl, profile: `/u/${account.login.toLowerCase()}` } : null,
          siblings: view.agents.filter((x) => x.id !== a.id).map(publicAgent),
          events: view.events.filter((e) => e.agentId === a.id).slice(0, 50).map(publicEvent), entries,
        } };
      }

      case "GET agents": {
        const list = await store.agents(60);
        const byAccount = new Map<number, Awaited<ReturnType<typeof accountView>>>();
        for (const accountId of new Set(list.map((a) => a.accountId))) byAccount.set(accountId, await accountView(accountId));
        return { status: 200, headers: { "Cache-Control": "public, max-age=30, s-maxage=60" }, body: { agents: list.map((a) => {
          const v = byAccount.get(a.accountId)!;
          return { ...publicAgent(a), owner: { login: a.login, profile: `/u/${a.login.toLowerCase()}` }, stats: agentStats(v.profiles, v.links, a.id), events: v.events.filter((e) => e.agentId === a.id).length };
        }).sort((x, y) => y.stats.entries - x.stats.entries || y.events - x.events) } };
      }

      case "GET claims":
        return { status: 200, headers: { "Cache-Control": "public, max-age=30, s-maxage=60" }, body: { claims: (await store.claims()).map((c) => ({ slug: c.slug, status: c.status, login: c.login, agents: c.agents })) } };
    }
    return { status: 404, body: { error: `no route ${method} ${API}/${seg.join("/")} (see GET ${origin}${API})` } };
  }

  return async (request: Request) => {
    const url = new URL(request.url);
    // vercel.json rewrites /api/v1/{path} to /api/v1?path={path}; the dev server passes the path itself
    const path = url.pathname.startsWith(`${API}/`) ? url.pathname.slice(API.length + 1) : url.searchParams.get("path") ?? "";
    const cookieRoute = /^(connect\/(open|confirm)|auth\/)/.test(path);
    const cors: Record<string, string> = cookieRoute ? {} : { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
    let reply: Reply;
    if (request.method === "OPTIONS") reply = { status: cookieRoute ? 403 : 204 };
    else {
      try { reply = await handle(request, path.replace(/\/+$/, "")); }
      catch (e) {
        if (e instanceof Invalid) reply = { status: 400, body: { error: e.message } };
        else { o.log?.(JSON.stringify({ event: "accounts_error", path, error: (e as Error).message })); reply = { status: 502, body: { error: (e as Error).message.includes("GitHub") ? (e as Error).message : "something went wrong; try again" } }; }
      }
    }
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors, ...reply.headers });
    for (const c of reply.cookies ?? []) headers.append("Set-Cookie", c);
    if (reply.body === undefined) return new Response(null, { status: reply.status, headers });
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers });
  };
}

// ─── In memory: tests, and the dev server when no database is configured ─────────────────────────────────────────────
export function memoryStore(): Store & { keys: Map<string, string> } {
  const requests = new Map<string, ConnectRequest>();
  const accounts = new Map<number, Account>();
  const claims = new Map<string, Claim>();
  const agents = new Map<string, AgentRow>();
  const keys = new Map<string, string>();         // key hash → agent id
  const events: EventRow[] = [];
  const live = (a: AgentRow) => !a.revokedAt;
  return {
    keys,
    async recentRequests(ipHash, since) { return [...requests.values()].filter((r) => r.ipHash === ipHash && r.createdAt >= since).length; },
    async createRequest(r) { requests.set(r.id, structuredClone(r)); },
    async requestByToken(h) { const r = [...requests.values()].find((x) => x.tokenHash === h); return r ? structuredClone(r) : null; },
    async requestByPoll(h) { const r = [...requests.values()].find((x) => x.pollHash === h); return r ? structuredClone(r) : null; },
    async setAbout(id, about) { const r = requests.get(id); if (r) r.about = about; },
    async confirm({ requestId, user, claims: wanted, method, now, newAgentId, about }) {
      const r = requests.get(requestId);
      if (!r || r.status !== "open") return null;
      const prev = accounts.get(user.id);
      // a GitHub login moves with its account: whoever held it before loses the address
      for (const [id, a] of accounts) if (id !== user.id && a.login.toLowerCase() === user.login.toLowerCase()) a.login = `${a.login}~${id}`;
      accounts.set(user.id, { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl, links: [], createdAt: now, ...prev,
        ...(prev ? { login: user.login, name: user.name ?? prev.name, avatarUrl: user.avatarUrl ?? prev.avatarUrl } : {}),
        ...(about?.displayName ? { displayName: about.displayName } : {}), ...(about?.bio ? { bio: about.bio } : {}), ...(about?.links?.length ? { links: about.links } : {}) });
      for (const c of wanted) {
        const held = claims.get(c.slug);
        if (held && held.accountId !== user.id && held.status === "verified" && c.status !== "verified") continue;
        if (held && held.accountId === user.id && held.status === "verified") continue;
        claims.set(c.slug, { slug: c.slug, accountId: user.id, status: c.status, method, createdAt: now });
      }
      const same = [...agents.values()].find((a) => a.accountId === user.id && live(a) && a.name.toLowerCase() === r.agent.name.toLowerCase());
      let agentId: string;
      if (same) {
        agentId = same.id;
        Object.assign(same, { family: r.agent.family, model: r.agent.model, tool: r.agent.tool, description: r.agent.description ?? same.description });
        for (const [k, v] of keys) if (v === same.id) keys.delete(k);
      } else {
        agentId = newAgentId;
        agents.set(agentId, { id: agentId, accountId: user.id, ...r.agent, createdAt: now });
      }
      Object.assign(r, { status: "confirmed", accountId: user.id, agentId, method, confirmedAt: now });
      return { agentId };
    },
    async issueKey(requestId, agentId, keyHash, now) {
      const r = requests.get(requestId);
      if (!r || r.keyIssuedAt) return false;
      r.keyIssuedAt = now;
      for (const [k, v] of keys) if (v === agentId) keys.delete(k);
      keys.set(keyHash, agentId);
      return true;
    },
    async agentByKey(h) { const id = keys.get(h); const a = id ? agents.get(id) : undefined; return a ? { ...a } : null; },
    async agent(id) { const a = agents.get(id); return a ? { ...a } : null; },
    async updateAgent(id, fields) {
      const a = agents.get(id);
      if (!a) return "ok";
      if (fields.name && [...agents.values()].some((x) => x.id !== id && x.accountId === a.accountId && live(x) && x.name.toLowerCase() === fields.name!.toLowerCase())) return "taken";
      Object.assign(a, fields);
      if (fields.revokedAt) for (const [k, v] of keys) if (v === id) keys.delete(k);
      return "ok";
    },
    async addEvent(e) { events.push({ ...e }); },
    async recentEvents(agentId, since) { return events.filter((e) => e.agentId === agentId && e.createdAt >= since).length; },
    async account(id) { const a = accounts.get(id); return a ? { ...a } : null; },
    async claimOf(slug) { const c = claims.get(slug); return c && accounts.has(c.accountId) ? { ...c } : null; },
    async claimsOf(accountId) { return [...claims.values()].filter((c) => c.accountId === accountId).sort((a, b) => Number(b.status === "verified") - Number(a.status === "verified") || a.createdAt.localeCompare(b.createdAt)); },
    async claims() { return [...claims.values()].filter((c) => accounts.has(c.accountId)).map((c) => ({ ...c, login: accounts.get(c.accountId)!.login, agents: [...agents.values()].filter((a) => a.accountId === c.accountId && live(a)).length })); },
    async agentsOf(accountId) { return [...agents.values()].filter((a) => a.accountId === accountId && live(a)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); },
    async eventsOf(ids, limit) { return events.filter((e) => ids.includes(e.agentId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit); },
    async agents(limit) {
      return [...agents.values()].filter(live).filter((a) => accounts.has(a.accountId)).map((a) => ({ ...a, login: accounts.get(a.accountId)!.login }))
        .sort((a, b) => (b.lastSeenAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.createdAt)).slice(0, limit);
    },
  };
}
