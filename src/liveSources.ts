// The outside sources of the live board (src/live.ts): a challenge's own live feed where it publishes one, and GitHub.
// Both are read through a getter the caller caches (src/liveApi.ts), so a busy board costs the source one read per TTL.
import { DATA, SITE as PNP_SITE, agentOfPull, cleanTitle, filePath, stepIds, type PnpHead } from "./structured/pequalnp.js";
import { agentRef, clip, type BaseChallenge, type ForkLive, type LiveEvent, type NativeLive, type NativeTrack, type PullLive, type RepoLive, type State } from "./live.js";

export type JsonGetter = (url: string, ttlMs: number) => Promise<unknown>;
export const USER_AGENT = "openchallengelist-live (+https://openchallengelist.com)";

const HOUR = 3_600_000;
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const iso = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined);
const plural = (n: number, w: string, many = `${w}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? w : many}`;
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

// ─── P = NP? (pequalnp.com) ─────────────────────────────────────────────
// data.pequalnp.com/head.json is rewritten about every minute: how many agents the desk saw in the last 30 minutes (the
// fleet's own and outside ones), counters, the latest news, and the content-addressed names of the other files: map (the
// programs with the fleet's counts, and the lines of attack), plan (each program's hard link) and seats (the fleet's agents
// and the program each works on). The names change only when the content does, so those are cached for an hour.
const STEP = /^L-([a-z]{2,8})-(\d{1,6})$/;
const PROGRAM = /^[a-z][a-z0-9_]{0,40}$/, KEY = /^[a-z]{2,8}$/, ATTACK = /^[a-z0-9][a-z0-9-]{0,80}$/;
// a lemma's status on the site → its standing here; conjecture, open, in_work and blocked stay open
const LEMMA_STATE: Record<string, State> = { checked: "solved", refuted: "refuted", retired: "closed" };
const LEMMA_WORD: Record<string, string> = { conjecture: "a conjecture nobody has proved", in_work: "in work", open: "open", blocked: "blocked", checked: "checked", refuted: "refuted", retired: "retired" };
const ATTACK_WHY: Record<string, string> = {
  live: "a line of attack the fleet is working on", support: "kept as support for the other lines",
  dormant: "no fleet seat is on it now", stopped: "stopped",
};
const COUNTERS: [string, string][] = [["checked", "checked"], ["refuted", "refuted"], ["in_work", "inWork"], ["conjecture", "conjectures"],
  ["lemmas", "statements"], ["checked_last_hour", "checkedLastHour"], ["agent_sessions_total", "fleetSessionsTotal"]];

export async function pequalnpLive(get: JsonGetter): Promise<NativeLive> {
  const head = await get(`${DATA}/head.json`, 30_000);
  if (!isObj(head)) throw new Error("pequalnp head.json is not an object");
  const file = (name: string) => `${DATA}/${filePath(head as PnpHead, name)}`;
  const [map, plan, seats] = await Promise.all([
    get(file("map"), HOUR), get(file("plan"), HOUR),
    get(file("seats"), HOUR).catch(() => []),    // without seats the fronts just carry no agent count
  ]);
  if (!isObj(map) || !Array.isArray(map.programs)) throw new Error("pequalnp map is not in the expected shape");
  const programs = (map.programs as unknown[]).filter((p): p is Record<string, any> => isObj(p) && PROGRAM.test(str(p.id)) && KEY.test(str(p.key)) && !!str(p.title).trim());
  const seatsOn = new Map<string, number>();
  for (const s of Array.isArray(seats) ? seats : []) if (isObj(s) && s.active === true && PROGRAM.test(str(s.program))) seatsOn.set(s.program, (seatsOn.get(s.program) ?? 0) + 1);

  const tracks: NativeTrack[] = [];
  for (const p of programs) {
    const k = isObj(p.counts) ? p.counts : {};
    const counts = Object.fromEntries(Object.entries(k).filter(([key, v]) => /^[a-z_]{1,30}$/.test(key) && typeof v === "number" && Number.isFinite(v)).map(([key, v]) => [key, v as number]));
    const inWork = num(k.in_work);
    tracks.push({
      id: `front-${p.key}`, name: p.title.trim(), group: "Fronts",
      activity: inWork > 0 ? "in_progress" : "idle",
      agentsNow: seatsOn.get(p.id) ?? 0,
      why: `the fleet's record: ${plural(inWork, "step")} in work, ${plural(num(k.checked), "step")} checked, ${plural(num(k.conjecture), "open conjecture")}, ${plural(num(k.refuted), "step")} refuted`,
      counts, url: `${PNP_SITE}/programs`,
    });
  }
  const hardLinks = new Set<string>();
  const programsPlan = isObj(plan) && isObj(plan.programs) ? plan.programs : {};
  for (const p of programs) {
    const h = isObj(programsPlan[p.id]) && isObj(programsPlan[p.id].hard_link) ? programsPlan[p.id].hard_link : undefined;
    if (!h || !STEP.test(str(h.lemma_id)) || !str(h.title).trim()) continue;
    const status = str(h.status), inFlight = Number.parseInt(str(h.attempts_in_flight) || String(num(h.attempts_in_flight)), 10) || 0;
    const id = h.lemma_id.toLowerCase();
    hardLinks.add(id);
    tracks.push({
      id, name: clip(cleanTitle(h.title), 160), group: "Open targets", parent: `front-${p.key}`,
      state: LEMMA_STATE[status] ?? "open", sourceStatus: status || undefined,
      activity: status === "in_work" || inFlight > 0 ? "in_progress" : "idle",
      why: `the hard link the ${p.title.trim()} program is stuck on: ${LEMMA_WORD[status] ?? (status || "status unknown")}${inFlight ? `, ${plural(inFlight, "attempt")} in flight` : ""}`,
      ...(str(h.why_hard).trim() ? { note: clip(h.why_hard.trim(), 300) } : {}),
      url: `${PNP_SITE}/lemma#${h.lemma_id}`,
    });
  }
  for (const a of Array.isArray(map.attack) ? map.attack : []) {
    if (!isObj(a) || !ATTACK.test(str(a.id)) || !str(a.title).trim()) continue;
    const status = str(a.status), program = programs.find((p) => p.id === a.program);
    tracks.push({
      id: `attack-${a.id}`, name: clip(a.title.trim(), 160), group: "Lines of attack", ...(program ? { parent: `front-${program.key}` } : {}),
      state: status === "stopped" ? "closed" : "open", sourceStatus: status || undefined,
      activity: status === "live" ? "in_progress" : "idle",
      why: ATTACK_WHY[status] ?? (status || "status unknown"),
      ...(str(a.why).trim() ? { note: clip(a.why.trim(), 300) } : {}),
      url: `${PNP_SITE}/programs`,
    });
  }

  const keys = new Set(programs.map((p) => p.key as string));
  const subtaskOf = (text: string) => {
    for (const step of stepIds(text)) {
      if (hardLinks.has(step.toLowerCase())) return step.toLowerCase();
      const key = STEP.exec(step)?.[1];
      if (key && keys.has(key)) return `front-${key}`;
    }
    return undefined;
  };

  const events: LiveEvent[] = [];
  const justIn = isObj(head.just_in) ? head.just_in : undefined;
  if (justIn && iso(justIn.at) && str(justIn.text).trim()) {
    const href = str(justIn.href);
    events.push({ at: iso(justIn.at)!, kind: "news", text: clip(justIn.text.trim(), 280), url: /^[A-Za-z0-9_.-]{1,80}(?:#[A-Za-z0-9_-]{1,80})?$/.test(href) ? `${PNP_SITE}/${href}` : `${PNP_SITE}/` });
  }
  const newest = isObj(head.outside) && isObj(head.outside.newest) ? head.outside.newest : undefined;
  if (newest && iso(newest.at) && STEP.test(str(newest.lemma_id)) && HANDLE.test(str(newest.github))) {
    const subtask = subtaskOf(newest.lemma_id);
    events.push({ at: iso(newest.at)!, kind: "accepted", text: `${newest.github}'s proof of ${newest.lemma_id} was accepted by the checker`, who: newest.github,
      ...(subtask ? { subtask } : {}), url: `${PNP_SITE}/lemma#${newest.lemma_id}` });
  }
  const status = isObj(head.status) ? head.status : undefined;
  if (status && iso(status.at) && str(status.text).trim()) events.push({ at: iso(status.at)!, kind: "status", text: clip(status.text.trim(), 280), url: `${PNP_SITE}/` });

  const c = isObj(head.counters) ? head.counters : {};
  const counters: Record<string, number> = {};
  for (const [from, to] of COUNTERS) if (typeof c[from] === "number") counters[to] = c[from];
  if (typeof head.sessions_total === "number") counters.sessionsTotal = head.sessions_total;
  if (isObj(head.outside)) { counters.outsideContributors = num(head.outside.count); counters.outsideSteps = num(head.outside.steps); }

  const total = head.agents_now_total;
  return {
    source: { kind: "native", name: "pequalnp.com", ok: true, asOf: iso(head.generated_at) ?? iso(head.checked_at), url: `${DATA}/head.json` },
    ...(typeof total === "number" && Number.isFinite(total) ? { agents: {
      now: total, windowMinutes: Math.round(num(head.agents_now_window_s) / 60) || 30,
      breakdown: { fleet: num(head.agents_now_fleet), public: num(head.agents_now_public) },
    } } : {}),
    counters, tracks, events, subtaskOf,
  };
}

// Challenges whose own live feed is read, by the host of the board's page (or its repository)
export const NATIVE: { name: string; matches: (c: Pick<BaseChallenge, "url" | "repo">) => boolean; read: (get: JsonGetter) => Promise<NativeLive> }[] = [
  { name: "pequalnp.com", read: pequalnpLive,
    matches: (c) => hostOf(c.url) === "pequalnp.com" || (c.repo?.owner.toLowerCase() === "open-goat" && c.repo.name.toLowerCase() === "pequalnp-proofs") },
];
export const nativeFor = (c: Pick<BaseChallenge, "url" | "repo">) => NATIVE.find((n) => n.matches(c));
function hostOf(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }

// ─── GitHub: open pull requests and fresh fork pushes ───────────────────
// One GraphQL query reads REPOS_PER_QUERY repositories: the 20 most recently updated open pull requests of each (draft
// or not, the last commits' checks, the review decision, the changed paths, and the agent evidence pequalnp.ts reads from merged
// ones) and the 20 forks pushed most recently. Repositories are passed as variables, never spliced into the query.
export const REPOS_PER_QUERY = 2;
const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/;
export const repoKey = (r: { owner: string; name: string }) => `${r.owner}/${r.name}`.toLowerCase();

export function reposQuery(n: number): string {
  const vars = Array.from({ length: n }, (_, i) => `$o${i}: String!, $n${i}: String!`).join(", ");
  const repos = Array.from({ length: n }, (_, i) => `  r${i}: repository(owner: $o${i}, name: $n${i}) { ...live }`).join("\n");
  return `query(${vars}) {\n${repos}\n}
fragment live on Repository {
  pullRequests(states: OPEN, first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
    totalCount
    nodes { number title url isDraft createdAt updatedAt headRefName reviewDecision author { login } body
      commits(last: 3) { nodes { commit { message statusCheckRollup { state } } } }
      files(first: 30) { nodes { path } } }
  }
  forks(first: 20, orderBy: { field: PUSHED_AT, direction: DESC }) { nodes { url createdAt pushedAt owner { login } } }
}`;
}

export function parseRepo(node: unknown, label: string): RepoLive | undefined {
  if (!isObj(node)) return undefined;
  const pulls: PullLive[] = [];
  for (const n of Array.isArray(node.pullRequests?.nodes) ? node.pullRequests.nodes : []) {
    if (!isObj(n) || !Number.isSafeInteger(n.number) || !str(n.url).startsWith("https://github.com/") || !iso(n.createdAt) || !iso(n.updatedAt)) continue;
    const commits = (Array.isArray(n.commits?.nodes) ? n.commits.nodes : []).filter(isObj);
    const login = str(n.author?.login);
    const agent = agentOfPull({ number: n.number, author: HANDLE.test(login) ? { login } : null, headRefName: str(n.headRefName), title: str(n.title), body: str(n.body).slice(0, 20_000), commits: { nodes: commits } }, label);
    const checks = str(commits.at(-1)?.commit?.statusCheckRollup?.state);
    pulls.push({
      number: n.number, title: str(n.title).slice(0, 300), url: n.url, ...(HANDLE.test(login) ? { author: login } : {}),
      isDraft: n.isDraft === true, createdAt: iso(n.createdAt)!, updatedAt: iso(n.updatedAt)!, branch: str(n.headRefName).slice(0, 200),
      ...(checks ? { checks } : {}), ...(str(n.reviewDecision) ? { review: n.reviewDecision } : {}),
      files: (Array.isArray(n.files?.nodes) ? n.files.nodes : []).map((f: unknown) => (isObj(f) ? str(f.path) : "")).filter(Boolean).slice(0, 30),
      ...(agentRef(agent) ? { agent: agentRef(agent) } : {}),
    });
  }
  const forks: ForkLive[] = [];
  for (const f of Array.isArray(node.forks?.nodes) ? node.forks.nodes : []) {
    const owner = str(f?.owner?.login);
    if (!isObj(f) || !HANDLE.test(owner) || !str(f.url).startsWith("https://github.com/") || !iso(f.createdAt) || !iso(f.pushedAt)) continue;
    forks.push({ owner, url: f.url, createdAt: iso(f.createdAt)!, pushedAt: iso(f.pushedAt)! });
  }
  return { openPulls: num(node.pullRequests?.totalCount) || pulls.length, pulls, forks };
}

// GitHub answers a query in about the time its repositories take added up (1–3 s each for these fields, and a 502 past ten
// seconds), so small queries run side by side: every board's repository at once, about one GraphQL point each
const CONCURRENCY = 20;

// The repositories that answered, and the ones that did not (a query GitHub failed, or a repository it does not know: renamed,
// deleted). Throws only when no query succeeded, so the caller can keep its last copy.
export async function githubRepos(repos: { owner: string; name: string }[], token: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): Promise<{ repos: Map<string, RepoLive>; failed: string[] }> {
  const valid = repos.filter((r) => REPO_PART.test(r.owner) && REPO_PART.test(r.name));
  const out = new Map<string, RepoLive>(), failed: string[] = [];
  const chunks = Array.from({ length: Math.ceil(valid.length / REPOS_PER_QUERY) }, (_, i) => valid.slice(i * REPOS_PER_QUERY, (i + 1) * REPOS_PER_QUERY));
  let next = 0, ok = 0, error: unknown;
  const worker = async () => {
    for (let chunk = chunks[next++]; chunk; chunk = chunks[next++]) {
      try {
        const variables = Object.fromEntries(chunk.flatMap((r, i) => [[`o${i}`, r.owner], [`n${i}`, r.name]]));
        const res = await fetchImpl("https://api.github.com/graphql", {
          method: "POST",
          headers: { authorization: `bearer ${token}`, "content-type": "application/json", accept: "application/json", "user-agent": USER_AGENT },
          body: JSON.stringify({ query: reposQuery(chunk.length), variables }),
        });
        if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`GitHub answered ${res.status}`); }
        const body: any = await res.json();
        if (!isObj(body?.data)) throw new Error("GitHub returned no data");
        ok++;
        chunk.forEach((r, i) => {
          const repo = parseRepo(body.data[`r${i}`], `${r.owner}/${r.name}`);
          if (repo) out.set(repoKey(r), repo); else failed.push(repoKey(r));
        });
      } catch (e) {
        error = e;
        failed.push(...chunk.map(repoKey));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  if (chunks.length && !ok) throw error instanceof Error ? error : new Error("GitHub could not be read");
  return { repos: out, failed };
}
