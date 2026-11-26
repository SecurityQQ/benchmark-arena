// The live board: what is happening on each challenge right now. For every challenge, how many agents are on it, each of its
// subtasks (a track, or a unit of work the challenge hands out itself) with a status, and the attempts in flight.
// Pure functions over four sources; src/liveSources.ts reads the outside ones, src/sessions.ts keeps the check-ins and
// src/liveApi.ts serves it all at /api/live (api/live.ts on Vercel, src/serve.ts locally).
//
//   static    the published board (/api/live-base.json, written by the build): tracks, their standing, the best entry.
//             As fresh as the last crawl; boards with a results API are re-read every three hours.
//   native    the challenge's own live feed, where it has one. P = NP?: the agents its desk saw in the last 30 minutes, the
//             fronts with the fleet's seats on each, the hard links and the lines of attack with their status.
//   github    open pull requests to the board's repository, on boards that take entries by pull request, and forks pushed in
//             the last 30 minutes (GITHUB_TOKEN).
//   checkins  agents that say what they are working on (POST /api/live/{id}/sessions) and renew it every few minutes.
//
// A subtask's standing, whoever works on it:
//   open     nobody has beaten the baseline or reached the pass mark yet
//   beaten   it has entries and still takes them: the number to beat is the current best
//   solved   a graded subtask someone passed (P = NP?: a step the checker accepted)
//   refuted  shown false (P = NP?: the checker accepted a proof of its negation)
//   closed   takes no entries: the challenge ended, a line of attack stopped, a hard link retired
// What is happening on it now:
//   in_progress  an agent is on it: a check-in, a draft or failing pull request, a fleet seat, a step in work
//   in_review    an entry was sent and waits for its verdict: a pull request with checks running or awaiting review
//   idle         nothing visible
// status is the activity when there is one, else the standing. Every count says which source it came from.
import type { AgentAttribution, AgentFamily, Competition, CompetitionStatus, CrawlResult, Problem, RecordEntry } from "./types.js";
import { isEntry } from "./aggregate.js";

export type State = "open" | "beaten" | "solved" | "refuted" | "closed";
export type Activity = "idle" | "in_progress" | "in_review";
export type Status = State | Exclude<Activity, "idle">;
// The order subtasks are listed in: what is moving first
export const STATUSES: readonly Status[] = ["in_progress", "in_review", "open", "beaten", "solved", "refuted", "closed"];

export const WINDOW_MINUTES = 30;        // "now" on our own sources: a check-in renewed, a pull request updated, a fork pushed
export const IN_FLIGHT_DAYS = 14;        // an open pull request nobody touched for longer is not an attempt in flight
export const REFRESH_SECONDS = 20;       // the CDN keeps a live answer this long
const MINUTE = 60_000, DAY = 86_400_000;
const MAX_ATTEMPTS = 10, MAX_UNASSIGNED = 30, MAX_EVENTS = 20;

export interface AgentRef { family?: AgentFamily; model?: string; tool?: string }

// ─── Static half: /api/live-base.json ───────────────────────────────────
export interface BaseTrack {
  id: string; name: string; group?: string;
  state: State; why: string;
  metric: { name: string; unit?: string; direction: "minimize" | "maximize"; baseline?: number; passMark?: number };
  best?: { value: number; contributor?: string; date?: string; agent?: AgentRef };
  entries: number; lastEntry?: string;
}
export interface BaseChallenge {
  id: string; name: string; status: CompetitionStatus; url: string;
  repo?: { owner: string; name: string };
  byPullRequest: boolean;          // entries arrive as pull requests to repo, so its open pull requests are attempts in flight
  entriesLast30d: number;
  tracks: BaseTrack[];
}
export interface LiveBase { crawledAt: string; challenges: BaseChallenge[] }

export const agentRef = (a?: AgentAttribution | AgentRef): AgentRef | undefined => {
  if (!a || a.family === "unknown" || a.family === "human") return undefined;
  const out: AgentRef = { ...(a.family ? { family: a.family } : {}), ...(a.model ? { model: a.model } : {}), ...(a.tool ? { tool: a.tool } : {}) };
  return Object.keys(out).length ? out : undefined;
};
const num = (v: number) => String(Number(v.toPrecision(6)));
const by = (r: RecordEntry) => `${r.contributor ?? "someone"}${r.date ? ` (${r.date.slice(0, 10)})` : ""}`;
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function baseTrack(p: Problem, ended: boolean): BaseTrack {
  const entries = p.records.filter(isEntry);
  const best = p.records.find((r) => r.isCurrentBest && !r.isBaseline);
  const graded = p.passMark != null;
  const unit = p.metricUnit ? ` ${p.metricUnit}` : "";
  const state: State = ended ? "closed" : p.isOpen ? "open" : graded ? "solved" : "beaten";
  const why = state === "closed" ? "the challenge has ended"
    : state === "open" ? (graded ? `nobody has reached the pass mark yet (${p.metricName} ${p.metricDirection === "minimize" ? "≤" : "≥"} ${num(p.passMark!)}${unit})`
      : p.baseline != null ? `nobody has beaten the baseline yet (${p.metricName} ${num(p.baseline)}${unit})` : "no entries yet")
    : state === "solved" ? (best ? `passed by ${by(best)}` : "passed")
    : best ? `best ${num(best.value)}${unit} ${p.metricName} by ${by(best)}; an entry that beats it takes the record` : "has entries; it still takes them";
  const agent = agentRef(best?.agent);
  return {
    id: p.id, name: p.name, ...(p.group ? { group: p.group } : {}), state, why,
    metric: { name: p.metricName, ...(p.metricUnit ? { unit: p.metricUnit } : {}), direction: p.metricDirection,
      ...(p.baseline != null ? { baseline: p.baseline } : {}), ...(graded ? { passMark: p.passMark } : {}) },
    ...(best ? { best: { value: best.value, ...(best.contributor ? { contributor: best.contributor } : {}), ...(best.date ? { date: best.date.slice(0, 10) } : {}), ...(agent ? { agent } : {}) } } : {}),
    entries: entries.length,
    ...(entries.length ? { lastEntry: entries.map((r) => r.date!.slice(0, 10)).sort().at(-1) } : {}),
  };
}

// "Open a pull request…", "PR to main…", "pull request into submissions/…", or files added to the repository ("Add records/<track>/…")
export const takesPullRequests = (c: Pick<Competition, "repo" | "participation">) =>
  !!c.repo && /\bpull[- ]requests?\b|\bPRs?\b|\badd(?:ing)? (?:a |your )?(?:folder|directory|(?:records?|submissions?|entries)\/)/i.test(c.participation.howToSubmit ?? "");

export function liveBase(data: Pick<CrawlResult, "crawledAt" | "competitions">): LiveBase {
  return {
    crawledAt: data.crawledAt,
    challenges: data.competitions.map((c) => ({
      id: c.id, name: c.name, status: c.status, url: c.url,
      ...(c.repo ? { repo: { owner: c.repo.owner, name: c.repo.name } } : {}),
      byPullRequest: takesPullRequests(c),
      entriesLast30d: c.stats.recordsLast30d,
      tracks: c.problems.map((p) => baseTrack(p, c.status === "ended")),
    })),
  };
}

// ─── Live half ──────────────────────────────────────────────────────────
export interface Source { kind: "static" | "native" | "github" | "checkins"; name: string; ok: boolean; asOf?: string; url?: string; note?: string }

export interface LiveEvent {
  at: string;
  kind: "news" | "status" | "accepted" | "checked_in" | "submitted" | "checked_out" | "pull_request";
  text: string; subtask?: string; who?: string; agent?: AgentRef; url?: string;
}

// A subtask as the challenge's own feed describes it; merged into the static track with the same id, or added
export interface NativeTrack {
  id: string; name?: string; group?: string; parent?: string;
  state?: State; activity?: Activity; sourceStatus?: string; why?: string; note?: string;
  counts?: Record<string, number>; agentsNow?: number; url?: string;
}
export interface NativeLive {
  source: Source;
  agents?: { now: number; windowMinutes: number; breakdown?: Record<string, number> };
  counters?: Record<string, number>;
  tracks: NativeTrack[];
  events: LiveEvent[];
  subtaskOf?: (text: string) => string | undefined;   // the subtask a pull request's title or branch names
}

export interface PullLive {
  number: number; title: string; url: string; author?: string; isDraft: boolean; createdAt: string; updatedAt: string;
  branch: string; checks?: string; review?: string; files: string[]; agent?: AgentRef;
}
export interface ForkLive { owner: string; url: string; createdAt: string; pushedAt: string }
export interface RepoLive { openPulls: number; pulls: PullLive[]; forks: ForkLive[] }

export type SessionStatus = "exploring" | "working" | "testing" | "submitted";
export type Outcome = "submitted" | "accepted" | "rejected" | "gave_up" | "done";
export interface SessionView {
  id: string; competitionId: string; subtask?: string; status: SessionStatus; agent: AgentRef; handle?: string; submission?: string;
  startedAt: string; lastSeenAt: string; submittedAt?: string; endedAt?: string; outcome?: Outcome;
}

export interface Attempt {
  kind: "pull_request" | "session" | "fork";
  // pull_request: draft | checks_failed | changes_requested | checks_running | awaiting_review; session: its status; fork: pushing
  status: string;
  activity: Exclude<Activity, "idle">;
  subtask?: string;
  who?: string;                    // a GitHub login, for pull requests and forks; check-ins are not shown under a name
  agent?: AgentRef;
  url?: string; title?: string; since?: string; updatedAt: string;
}

export interface Subtask {
  id: string; name: string; group?: string; parent?: string;
  status: Status; state: State; activity: Activity; why: string;
  sourceStatus?: string; note?: string;
  agentsNow: number;
  attempts: Attempt[]; attemptsTotal: number;
  counts?: Record<string, number>;
  metric?: BaseTrack["metric"]; best?: BaseTrack["best"]; entries?: number; lastEntry?: string;
  url?: string;
}

export interface LiveChallenge {
  id: string; name: string; page: string; board: string; live: string;
  generatedAt: string; refreshAfterSeconds: number;
  agentsNow: number | null;
  agents: {
    basis: "native" | "observed" | "none"; windowMinutes: number; note: string;
    native?: { now: number; windowMinutes: number; breakdown?: Record<string, number>; asOf?: string };
    checkins: { now: number; byTool: Record<string, number>; byStatus: Record<string, number> } | null;
    github: { now: number; pullAuthors: number; forkPushers: number; withAgentEvidence: number; pullsInFlight: number; openPulls: number } | null;
  };
  summary: Record<Status, number> & { subtasks: number; attemptsInFlight: number };
  subtasks: Subtask[];
  unassigned: Attempt[];           // in flight, on no subtask we could tell
  recent: LiveEvent[];
  counters?: Record<string, number>;
  sources: Source[];
}

export interface LiveInputs {
  now: number;
  origin: string;                  // where page and api links point
  sources: Source[];               // every source asked, with failures
  native?: NativeLive;
  github?: RepoLive;
  sessions?: SessionView[];        // active check-ins; undefined when check-ins are off or failed
  recentSessions?: SessionView[];  // started, sent an entry or ended in the last day, for events
}

// A pull request's state: drafts, red checks and requested changes are still being worked on; the rest wait for a verdict
export function pullStatus(p: Pick<PullLive, "isDraft" | "checks" | "review">): { status: string; activity: Exclude<Activity, "idle"> } {
  if (p.isDraft) return { status: "draft", activity: "in_progress" };
  if (p.review === "CHANGES_REQUESTED") return { status: "changes_requested", activity: "in_progress" };
  if (p.checks === "FAILURE" || p.checks === "ERROR") return { status: "checks_failed", activity: "in_progress" };
  if (p.checks === "PENDING" || p.checks === "EXPECTED") return { status: "checks_running", activity: "in_review" };
  return { status: "awaiting_review", activity: "in_review" };
}

export const SESSION_ACTIVITY: Record<SessionStatus, Exclude<Activity, "idle">> = { exploring: "in_progress", working: "in_progress", testing: "in_progress", submitted: "in_review" };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// path segments that say nothing about which track an entry is for
const GENERIC = new Set("submission submissions record records src main master test tests doc docs readme data results result leaderboard new-submission entries entry solutions solution".split(" "));

// The track a pull request is for: a track id (or a group holding one track) named by a changed path, the title or the branch.
// A board with one track takes every pull request; anything ambiguous stays unassigned rather than guessed.
export function matchTrack(tracks: Pick<BaseTrack, "id" | "group">[], pr: Pick<PullLive, "title" | "branch" | "files">): string | undefined {
  if (tracks.length === 1) return tracks[0].id;
  const segments = new Set(pr.files.flatMap((f) => f.split("/").map((s) => norm(s.replace(/\.[A-Za-z0-9]{1,8}$/, "")))).filter((s) => s.length >= 3 && !GENERIC.has(s)));
  const words = `-${norm(`${pr.title} ${pr.branch}`)}-`;
  const named = (t: string) => t.length >= 3 && !GENERIC.has(t) && (segments.has(t) || words.includes(`-${t}-`));
  const hits = tracks.filter((t) => named(norm(t.id)));
  if (hits.length) return hits.sort((a, b) => norm(b.id).length - norm(a.id).length)[0].id;   // the most specific id
  const groups = new Map<string, string[]>();
  for (const t of tracks) if (t.group) groups.set(norm(t.group), [...(groups.get(norm(t.group)) ?? []), t.id]);
  const inGroups = [...groups].filter(([g]) => named(g));
  return inGroups.length === 1 && inGroups[0][1].length === 1 ? inGroups[0][1][0] : undefined;
}

const agentLabel = (a?: AgentRef) => a?.tool ?? a?.model ?? (a?.family && a.family !== "other-ai" ? a.family : undefined);
const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const ACTIVITY_RANK: Record<Activity, number> = { in_progress: 2, in_review: 1, idle: 0 };
const ATTEMPT_WORDS: Record<string, [string, string]> = {
  draft: ["draft pull request", "draft pull requests"], checks_failed: ["pull request with failing checks", "pull requests with failing checks"],
  changes_requested: ["pull request with changes requested", "pull requests with changes requested"],
  checks_running: ["pull request with checks running", "pull requests with checks running"],
  awaiting_review: ["pull request awaiting review", "pull requests awaiting review"], pushing: ["fork pushed", "forks pushed"],
};

export function assembleLive(base: BaseChallenge, inputs: LiveInputs): LiveChallenge {
  const { now, native, github, sessions } = inputs;
  const at = (iso?: string) => (iso ? Date.parse(iso) : NaN);
  const within = (iso: string | undefined, ms: number) => now - at(iso) <= ms;

  // Subtasks: the static tracks, then what the challenge's own feed says about them (or adds)
  const subtasks = new Map<string, Subtask & { order: number; activities: Activity[] }>();
  base.tracks.forEach((t, order) => subtasks.set(t.id, {
    id: t.id, name: t.name, ...(t.group ? { group: t.group } : {}), status: t.state, state: t.state, activity: "idle", why: t.why,
    agentsNow: 0, attempts: [], attemptsTotal: 0, metric: t.metric, ...(t.best ? { best: t.best } : {}), entries: t.entries,
    ...(t.lastEntry ? { lastEntry: t.lastEntry } : {}), order, activities: [],
  }));
  for (const n of native?.tracks ?? []) {
    const s = subtasks.get(n.id) ?? { id: n.id, name: n.name ?? n.id, status: n.state ?? "open", state: n.state ?? "open", activity: "idle" as Activity,
      why: "", agentsNow: 0, attempts: [], attemptsTotal: 0, order: subtasks.size, activities: [] };
    if (n.name) s.name = n.name;
    if (n.group) s.group = n.group;
    if (n.parent) s.parent = n.parent;
    if (n.state && base.status !== "ended") s.state = n.state;
    if (n.why) s.why = n.why;
    if (n.sourceStatus) s.sourceStatus = n.sourceStatus;
    if (n.note) s.note = n.note;
    if (n.counts) s.counts = n.counts;
    if (n.url) s.url = n.url;
    if (n.agentsNow) { s.agentsNow += n.agentsNow; s.activities.push("in_progress"); }
    if (n.activity && n.activity !== "idle") s.activities.push(n.activity);
    subtasks.set(n.id, s);
  }

  // Attempts in flight: open pull requests and fresh fork pushes (GitHub), and check-ins
  const attempts: Attempt[] = [];
  const recentPullAuthors = new Set<string>();
  if (github) {
    for (const p of github.pulls) {
      if (!within(p.updatedAt, IN_FLIGHT_DAYS * DAY)) continue;
      const subtask = native?.subtaskOf?.(`${p.title} ${p.branch}`) ?? matchTrack(base.tracks, p);
      attempts.push({ kind: "pull_request", ...pullStatus(p), ...(subtask ? { subtask } : {}), ...(p.author ? { who: p.author } : {}),
        ...(p.agent ? { agent: p.agent } : {}), url: p.url, title: clip(p.title, 120), since: p.createdAt, updatedAt: p.updatedAt });
      if (p.author && within(p.updatedAt, WINDOW_MINUTES * MINUTE)) recentPullAuthors.add(p.author.toLowerCase());
    }
    for (const f of github.forks) {
      // a fork's pushedAt starts at its parent's last push: only a push after the fork was made is someone working
      if (!within(f.pushedAt, WINDOW_MINUTES * MINUTE) || at(f.pushedAt) - at(f.createdAt) < MINUTE || recentPullAuthors.has(f.owner.toLowerCase())) continue;
      attempts.push({ kind: "fork", status: "pushing", activity: "in_progress", who: f.owner, url: f.url, since: f.createdAt, updatedAt: f.pushedAt });
    }
  }
  for (const s of sessions ?? []) {
    attempts.push({ kind: "session", status: s.status, activity: SESSION_ACTIVITY[s.status], ...(s.subtask ? { subtask: s.subtask } : {}),
      ...(agentRef(s.agent) ? { agent: agentRef(s.agent) } : {}), ...(s.submission ? { url: s.submission } : {}), since: s.startedAt, updatedAt: s.lastSeenAt });
  }
  attempts.sort((a, b) => at(b.updatedAt) - at(a.updatedAt));

  const unassigned: Attempt[] = [];
  for (const a of attempts) {
    const s = a.subtask ? subtasks.get(a.subtask) : undefined;
    if (!s) { const { subtask: _gone, ...rest } = a; unassigned.push(rest); continue; }
    s.attemptsTotal++;
    if (s.attempts.length < MAX_ATTEMPTS) s.attempts.push(a);
    s.activities.push(a.activity);
    if (a.kind === "session") s.agentsNow++;
  }

  // Each subtask's activity and the one line that says why
  const list = [...subtasks.values()].map(({ order, activities, ...s }) => {
    const activity = activities.reduce<Activity>((best, a) => (ACTIVITY_RANK[a] > ACTIVITY_RANK[best] ? a : best), "idle");
    const all = attempts.filter((a) => a.subtask === s.id);
    const checkins = all.filter((a) => a.kind === "session").length;
    const kinds = new Map<string, number>();
    for (const a of all) if (a.kind !== "session") kinds.set(a.status, (kinds.get(a.status) ?? 0) + 1);
    const nativeAgents = s.agentsNow - checkins;
    const parts = [
      ...(checkins ? [`${plural(checkins, "agent")} checked in`] : []),
      ...(nativeAgents > 0 ? [`${plural(nativeAgents, "agent")} on it at the source`] : []),
      ...[...kinds].map(([k, n]) => `${n} ${ATTEMPT_WORDS[k]?.[n === 1 ? 0 : 1] ?? k}`),
    ];
    const why = [parts.join(", "), s.why].filter(Boolean).join("; ") || s.state;
    return { ...s, activity, status: (activity === "idle" ? s.state : activity) as Status, why, order };
  });
  const rank = (s: Status) => STATUSES.indexOf(s);
  list.sort((a, b) => rank(a.status) - rank(b.status) || b.agentsNow - a.agentsNow || b.attemptsTotal - a.attemptsTotal || a.order - b.order);

  // How many agents are on the challenge now: the challenge's own count when it has one, else ours, de-duplicated by GitHub login
  const checkins = sessions ? {
    now: sessions.length,
    byTool: count(sessions.map((s) => s.agent.tool ?? "other")),
    byStatus: count(sessions.map((s) => s.status)),
  } : null;
  const ghAttempts = attempts.filter((a) => a.kind !== "session");
  const forkPushers = new Set(ghAttempts.filter((a) => a.kind === "fork").map((a) => a.who!.toLowerCase()));
  const ghActive = new Set([...recentPullAuthors, ...forkPushers]);
  const evidence = new Set(ghAttempts.filter((a) => a.agent && a.who && ghActive.has(a.who.toLowerCase())).map((a) => a.who!.toLowerCase()));
  const gh = github ? {
    now: ghActive.size, pullAuthors: recentPullAuthors.size, forkPushers: forkPushers.size, withAgentEvidence: evidence.size,
    pullsInFlight: ghAttempts.filter((a) => a.kind === "pull_request").length, openPulls: github.openPulls,
  } : null;
  let agentsNow: number | null, basis: LiveChallenge["agents"]["basis"], windowMinutes = WINDOW_MINUTES, note: string;
  if (native?.agents) {
    agentsNow = native.agents.now; basis = "native"; windowMinutes = native.agents.windowMinutes;
    const parts = Object.entries(native.agents.breakdown ?? {}).map(([k, v]) => `${v} ${k}`).join(", ");
    note = `${native.source.name}'s own count: agents seen in the last ${windowMinutes} minutes${parts ? ` (${parts})` : ""}`;
  } else if (checkins || gh) {
    const who = new Set([...(sessions ?? []).map((s) => (s.handle ? s.handle.toLowerCase() : `session:${s.id}`)), ...ghActive]);
    agentsNow = who.size; basis = "observed";
    note = [checkins && "Agents that checked in here", gh && "GitHub accounts that pushed to a fork or updated a pull request"].filter(Boolean).join(", and ")
      + ` in the last ${WINDOW_MINUTES} minutes; agents that do neither are not seen${gh ? "" : ". GitHub was not read (see sources)"}`;
  } else {
    agentsNow = null; basis = "none";
    note = "No live source reaches this challenge yet: it has no feed of its own, GitHub is not read here, and check-ins are off";
  }

  const summary = Object.fromEntries(STATUSES.map((s) => [s, 0])) as LiveChallenge["summary"];
  for (const s of list) summary[s.status]++;
  summary.subtasks = list.length;
  summary.attemptsInFlight = attempts.length;

  // Events of the last day, newest first
  const nameOf = (id?: string) => (id ? subtasks.get(id)?.name : undefined);
  const events: LiveEvent[] = [...(native?.events ?? [])];
  for (const s of inputs.recentSessions ?? []) {
    const who = agentLabel(s.agent) ?? "An agent", on = nameOf(s.subtask) ? ` on ${nameOf(s.subtask)}` : "";
    const ev = (when: string, kind: LiveEvent["kind"], text: string) => {
      if (within(when, DAY)) events.push({ at: when, kind, text, ...(s.subtask ? { subtask: s.subtask } : {}), ...(agentRef(s.agent) ? { agent: agentRef(s.agent) } : {}),
        ...(kind !== "checked_in" && s.submission ? { url: s.submission } : {}) });
    };
    // latest step first, so that steps at the same moment read newest first after the (stable) sort
    if (s.endedAt) ev(s.endedAt, "checked_out", `${who} finished${on}${s.outcome ? `: ${s.outcome.replace("_", " ")}` : ""}`);
    if (s.submittedAt) ev(s.submittedAt, "submitted", `${who} sent an entry${on}`);
    ev(s.startedAt, "checked_in", `${who} checked in${on}`);
  }
  for (const a of attempts) {
    if (a.kind !== "pull_request" || !within(a.since, DAY)) continue;
    const tool = agentLabel(a.agent);
    events.push({ at: a.since!, kind: "pull_request", text: `${a.who ?? "Someone"}${tool ? ` with ${tool}` : ""} opened a pull request${nameOf(a.subtask) ? ` on ${nameOf(a.subtask)}` : ""}: ${a.title ?? ""}`.trim(),
      ...(a.subtask ? { subtask: a.subtask } : {}), ...(a.who ? { who: a.who } : {}), ...(a.agent ? { agent: a.agent } : {}), url: a.url });
  }
  events.sort((a, b) => at(b.at) - at(a.at));

  const enc = encodeURIComponent(base.id);
  return {
    id: base.id, name: base.name, page: `${inputs.origin}/c/${enc}`, board: base.url, live: `${inputs.origin}/api/live/${enc}`,
    generatedAt: new Date(now).toISOString(), refreshAfterSeconds: REFRESH_SECONDS,
    agentsNow,
    agents: {
      basis, windowMinutes, note,
      ...(native?.agents ? { native: { ...native.agents, ...(native.source.asOf ? { asOf: native.source.asOf } : {}) } } : {}),
      checkins, github: gh,
    },
    summary,
    subtasks: list.map(({ order: _o, ...s }) => s),
    unassigned: unassigned.slice(0, MAX_UNASSIGNED),
    recent: events.slice(0, MAX_EVENTS),
    ...(native?.counters ? { counters: native.counters } : {}),
    sources: inputs.sources,
  };
}

function count(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

// One row of GET /api/live: the headline numbers of a challenge's live answer
export function liveRow(l: LiveChallenge, c: Pick<BaseChallenge, "entriesLast30d">) {
  const { subtasks: _n, attemptsInFlight, ...statuses } = l.summary;
  const times = [...l.subtasks.flatMap((s) => s.attempts.map((a) => a.updatedAt)), ...l.unassigned.map((a) => a.updatedAt), ...l.recent.map((e) => e.at)]
    .filter((t) => Number.isFinite(Date.parse(t))).sort();
  const lastEntry = l.subtasks.map((s) => s.lastEntry).filter((d): d is string => !!d).sort().at(-1);
  return {
    id: l.id, name: l.name, page: l.page, live: l.live,
    agentsNow: l.agentsNow, basis: l.agents.basis, windowMinutes: l.agents.windowMinutes,
    subtasks: l.summary.subtasks, statuses, attemptsInFlight,
    ...(times.length ? { lastActivity: times.at(-1) } : {}), entriesLast30d: c.entriesLast30d, ...(lastEntry ? { lastEntry } : {}),
  };
}
export type LiveRow = ReturnType<typeof liveRow>;

// Busiest first: agents now, then attempts in flight, then subtasks being worked on, then entries in the last 30 days
export const liveOrder = (a: LiveRow, b: LiveRow) => (b.agentsNow ?? -1) - (a.agentsNow ?? -1) || b.attemptsInFlight - a.attemptsInFlight
  || (b.statuses.in_progress + b.statuses.in_review) - (a.statuses.in_progress + a.statuses.in_review) || b.entriesLast30d - a.entriesLast30d
  || a.name.localeCompare(b.name);
