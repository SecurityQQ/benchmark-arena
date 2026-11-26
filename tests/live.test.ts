import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { assembleLive, baseTrack, liveBase, liveOrder, liveRow, matchTrack, pullStatus, takesPullRequests, type BaseChallenge, type LiveBase, type RepoLive, type SessionView } from "../src/live.js";
import { githubRepos, nativeFor, parseRepo, pequalnpLive, reposQuery, type JsonGetter } from "../src/liveSources.js";
import { MAX_ACTIVE_PER_IP, MAX_STARTS_PER_HOUR, TTL_MS, memorySessions, parseCheckin, parseOutcome, parsePatch, submissionUrl, toolName, type CheckinContext } from "../src/sessions.js";
import { createLiveHandler } from "../src/liveApi.js";
import { pageType, agentEvent } from "../src/agentTraffic.js";
import type { Competition, Problem, RecordEntry } from "../src/types.js";

const T0 = Date.parse("2026-11-26T07:00:00Z");
const ago = (ms: number) => new Date(T0 - ms).toISOString();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

function problem(id: string, o: Partial<Problem> = {}): Problem {
  return { id, name: id.toUpperCase(), metricName: "score", metricDirection: "maximize", isOpen: true, records: [], ...o };
}
function comp(id: string, o: Partial<Competition> = {}): Competition {
  return {
    id, name: `Challenge ${id}`, tagline: "t", description: "d", url: `https://github.com/o/${id}`, repo: { owner: "o", name: id }, host: "github",
    status: "active", tags: [], domain: "test", images: [],
    participation: { requirements: [], compute: "cpu", howToSubmit: "Open a pull request adding submissions/<track>/<you>/" },
    links: [], problems: [], participants: [], stats: { totalRecords: 0, uniqueParticipants: 0, recordsLast30d: 3, recordsLast90d: 3 }, agentStats: [], lastUpdated: "2026-11-25", ...o,
  };
}
const rec = (value: number, o: Partial<RecordEntry> = {}): RecordEntry => ({ value, ...o });

const BOARD = comp("board", { problems: [
  problem("t_small", { name: "Small", baseline: 10, metricUnit: "ms", metricDirection: "minimize" }),
  problem("t-big", { name: "Big", isOpen: false, records: [
    rec(5, { isBaseline: true }), rec(3.2, { contributor: "eve", date: "2026-11-20", isCurrentBest: true, agent: { family: "openai", tool: "Codex", confidence: "high", role: "author" } }),
    rec(4, { contributor: "fay", date: "2026-11-22" })] }),
  problem("graded", { name: "Graded", passMark: 1, metricName: "proofs", isOpen: false, records: [rec(1, { contributor: "gus", date: "2026-11-01", isCurrentBest: true })] }),
  problem("mnist-a", { name: "MNIST A", group: "mnist", isOpen: false, records: [rec(0.9, { contributor: "hal", date: "2026-11-02", isCurrentBest: true })] }),
] });
const PNP = comp("pnp", {
  url: "https://pequalnp.com/", repo: { owner: "open-goat", name: "pequalnp-proofs" }, host: "website",
  participation: { requirements: [], compute: "cpu", howToSubmit: "The desk hands out a step; send its proof as a pull request to open-goat/pequalnp-proofs." },
  problems: [problem("p-vs-np", { passMark: 1, metricName: "accepted proofs" }), problem("front-meta", { name: "Meta (static)", isOpen: false, records: [rec(3, { contributor: "zed", date: "2026-11-25", isCurrentBest: true })] }), problem("l-meta-60", { passMark: 1 })],
});
const ENDED = comp("ended", { status: "ended", problems: [problem("x")] });
const SITE_BOARD = comp("site", { url: "https://duck.example/play", repo: undefined, host: "website", participation: { requirements: [], compute: "cpu", howToSubmit: "Run the CLI" }, problems: [problem("race")] });
const DATA = { crawledAt: "2026-11-26T05:00:00Z", competitions: [BOARD, PNP, ENDED, SITE_BOARD] };
const BASE: LiveBase = liveBase(DATA);
const base = (id: string) => BASE.challenges.find((c) => c.id === id)!;

test("the static half: each track's standing, the best entry, and whether pull requests are entries", () => {
  const b = base("board");
  assert.equal(b.byPullRequest, true);
  assert.equal(base("site").byPullRequest, false);
  assert.equal(takesPullRequests({ repo: { owner: "o", name: "r" }, participation: { requirements: [], compute: "cpu", howToSubmit: "Open a PR to main" } }), true);
  assert.equal(takesPullRequests({ repo: undefined, participation: { requirements: [], compute: "cpu", howToSubmit: "Open a pull request" } }), false);
  const how = (howToSubmit: string) => takesPullRequests({ repo: { owner: "o", name: "r" }, participation: { requirements: [], compute: "cpu", howToSubmit } });
  assert.equal(how("Add records/<track>/<YYYY-MM-DD>_<Name>/ with the residual module and logs"), true);
  assert.equal(how("Email a report or open a GitHub issue with your results"), false);
  assert.equal(how("Submit through the platform; the referee runs it"), false);
  const [small, big, graded, mnist] = b.tracks;
  assert.deepEqual([small.state, big.state, graded.state, mnist.state], ["open", "beaten", "solved", "beaten"]);
  assert.equal(small.why, "nobody has beaten the baseline yet (score 10 ms)");
  assert.equal(big.why, "best 3.2 score by eve (2026-11-20); an entry that beats it takes the record");
  assert.deepEqual(big.best, { value: 3.2, contributor: "eve", date: "2026-11-20", agent: { family: "openai", tool: "Codex" } });
  assert.equal(big.entries, 2);
  assert.equal(big.lastEntry, "2026-11-22");
  assert.equal(graded.why, "passed by gus (2026-11-01)");
  assert.deepEqual(graded.metric, { name: "proofs", direction: "maximize", passMark: 1 });
  assert.equal(base("pnp").tracks[0].why, "nobody has reached the pass mark yet (accepted proofs ≥ 1)");
  assert.deepEqual(base("ended").tracks.map((t) => [t.state, t.why]), [["closed", "the challenge has ended"]]);
  assert.equal(baseTrack(problem("q"), false).why, "no entries yet");
});

test("a pull request's state and the track it is for", () => {
  assert.deepEqual(pullStatus({ isDraft: true, checks: "SUCCESS" }), { status: "draft", activity: "in_progress" });
  assert.deepEqual(pullStatus({ isDraft: false, review: "CHANGES_REQUESTED" }), { status: "changes_requested", activity: "in_progress" });
  assert.deepEqual(pullStatus({ isDraft: false, checks: "FAILURE" }), { status: "checks_failed", activity: "in_progress" });
  assert.deepEqual(pullStatus({ isDraft: false, checks: "PENDING" }), { status: "checks_running", activity: "in_review" });
  assert.deepEqual(pullStatus({ isDraft: false }), { status: "awaiting_review", activity: "in_review" });

  const tracks = base("board").tracks;
  const pr = (title: string, files: string[] = [], branch = "patch-1") => ({ title, branch, files });
  assert.equal(matchTrack(tracks, pr("New record", ["submissions/t_small/ann/README.md"])), "t_small", "a path segment names the track, _ and - alike");
  assert.equal(matchTrack(tracks, pr("t-big: 3.1")), "t-big", "the title names it");
  assert.equal(matchTrack(tracks, pr("x", ["mnist/sub/x.py"])), "mnist-a", "a group with one track");
  assert.equal(matchTrack(tracks, pr("x", ["README.md", "src/main.py", "submissions/foo.json"])), undefined, "generic paths say nothing");
  assert.equal(matchTrack([{ id: "mnist-a", group: "mnist" }, { id: "mnist-b", group: "mnist" }], pr("x", ["mnist/y.py"])), undefined, "ambiguous: left unassigned");
  assert.equal(matchTrack([{ id: "main" }], pr("anything")), "main", "a board with one track takes every pull request");
  assert.equal(matchTrack([{ id: "track-1" }, { id: "track-1-short" }], pr("x", ["records/track_1_short/r.md"])), "track-1-short", "the most specific id");
});

// ─── P = NP? ────────────────────────────────────────────────────────────
const PNP_HEAD = {
  generated_at: ago(30_000), agents_now_total: 7, agents_now_fleet: 2, agents_now_public: 5, agents_now_window_s: 1800, sessions_total: 99,
  counters: { checked: 10, refuted: 2, in_work: 1, conjecture: 5, lemmas: 20, checked_last_hour: 3, agents_active: 2 },
  status: { at: ago(9 * MIN), text: "On the desk now: a step against our own bound." },
  just_in: { at: ago(2 * MIN), text: "Checked from outside: an inclusion is false", href: "lemma.html#L-meta-18914" },
  outside: { count: 3, steps: 4, newest: { github: "alice", lemma_id: "L-meta-9", at: ago(MIN) } },
  files: { map: "data/map/overview.abc123.json", plan: "data/plan.abc123.json", seats: "data/seats.abc123.json" },
};
const PNP_MAP = {
  programs: [
    { id: "meta_complexity", key: "meta", title: "Meta-complexity", counts: { checked: 8, in_work: 1, conjecture: 4, refuted: 2, "bad key": 1 } },
    { id: "library", key: "lib", title: "Library", counts: { checked: 2 } },
    { id: "../escape", key: "x", title: "Bad" },
  ],
  attack: [
    { id: "live-line", title: "A live line", status: "live", program: "meta_complexity", why: "We are on it." },
    { id: "old-line", title: "An old line", status: "stopped", program: "library" },
    { id: "nobody", title: "A dormant line", status: "dormant", program: "library" },
    { id: "Bad Id", title: "x", status: "live" },
  ],
};
const PNP_PLAN = { programs: {
  meta_complexity: { hard_link: { lemma_id: "L-meta-60", title: "OPEN TARGET: grid criterion", status: "in_work", attempts_in_flight: "1", why_hard: "Finer than any known method." } },
  library: { hard_link: { title: "None of its own" } },
} };
const PNP_SEATS = [{ id: "s1", program: "meta_complexity", active: true }, { id: "s2", program: "meta_complexity", active: true }, { id: "s3", program: "library", active: false }, { id: "s4", program: "red_team", active: true }];
const PNP_FILES = new Map<string, unknown>([
  ["https://data.pequalnp.com/head.json", PNP_HEAD], ["https://data.pequalnp.com/data/map/overview.abc123.json", PNP_MAP],
  ["https://data.pequalnp.com/data/plan.abc123.json", PNP_PLAN], ["https://data.pequalnp.com/data/seats.abc123.json", PNP_SEATS],
]);
const getter = (files = PNP_FILES): JsonGetter & { asked: string[] } => {
  const asked: string[] = [];
  return Object.assign(async (url: string) => { asked.push(url); if (!files.has(url)) throw new Error("404"); return structuredClone(files.get(url)); }, { asked });
};

test("P = NP?: the desk's count, fronts with the fleet's seats, hard links, lines of attack, news", async () => {
  assert.equal(nativeFor(base("pnp"))?.name, "pequalnp.com");
  assert.equal(nativeFor(base("board")), undefined);
  const n = await pequalnpLive(getter());
  assert.deepEqual(n.agents, { now: 7, windowMinutes: 30, breakdown: { fleet: 2, public: 5 } });
  assert.equal(n.source.asOf, PNP_HEAD.generated_at);
  assert.deepEqual(n.counters, { checked: 10, refuted: 2, inWork: 1, conjectures: 5, statements: 20, checkedLastHour: 3, sessionsTotal: 99, outsideContributors: 3, outsideSteps: 4 });
  const t = Object.fromEntries(n.tracks.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(t), ["front-meta", "front-lib", "l-meta-60", "attack-live-line", "attack-old-line", "attack-nobody"]);
  assert.deepEqual([t["front-meta"].agentsNow, t["front-meta"].activity, t["front-lib"].agentsNow, t["front-lib"].activity], [2, "in_progress", 0, "idle"]);
  assert.deepEqual(t["front-meta"].counts, { checked: 8, in_work: 1, conjecture: 4, refuted: 2 });
  assert.equal(t["front-meta"].why, "the fleet's record: 1 step in work, 8 steps checked, 4 open conjectures, 2 steps refuted");
  assert.deepEqual([t["l-meta-60"].name, t["l-meta-60"].state, t["l-meta-60"].activity, t["l-meta-60"].parent, t["l-meta-60"].sourceStatus], ["Grid criterion", "open", "in_progress", "front-meta", "in_work"]);
  assert.match(t["l-meta-60"].why!, /stuck on: in work, 1 attempt in flight$/);
  assert.deepEqual([t["attack-live-line"].activity, t["attack-old-line"].state, t["attack-nobody"].why], ["in_progress", "closed", "no fleet seat is on it now"]);
  assert.equal(n.subtaskOf!("L-meta-60"), "l-meta-60");
  assert.equal(n.subtaskOf!("R_meta_77_1 reduction"), "front-meta");
  assert.equal(n.subtaskOf!("L-zzz-1"), undefined);
  assert.deepEqual(n.events.map((e) => [e.kind, e.url]), [["news", "https://pequalnp.com/lemma.html#L-meta-18914"], ["accepted", "https://pequalnp.com/lemma#L-meta-9"], ["status", "https://pequalnp.com/"]]);
  assert.equal(n.events[1].subtask, "front-meta");

  // seats are optional; a file outside data/ is never followed
  const noSeats = new Map(PNP_FILES); noSeats.delete("https://data.pequalnp.com/data/seats.abc123.json");
  assert.equal((await pequalnpLive(getter(noSeats))).tracks[0].agentsNow, 0);
  const evil = new Map(PNP_FILES); evil.set("https://data.pequalnp.com/head.json", { ...PNP_HEAD, files: { ...PNP_HEAD.files, map: "../../etc/passwd" } });
  await assert.rejects(pequalnpLive(getter(evil)), /pequalnp download failed/);
});

// ─── GitHub ─────────────────────────────────────────────────────────────
function pullNode(n: number, o: Record<string, unknown> = {}) {
  return { number: n, title: `PR ${n}`, url: `https://github.com/o/board/pull/${n}`, isDraft: false, createdAt: ago(HOUR), updatedAt: ago(5 * MIN), headRefName: `patch-${n}`,
    reviewDecision: null, author: { login: `user${n}` }, body: "", commits: { nodes: [{ commit: { message: "update", statusCheckRollup: null } }] }, files: { nodes: [] }, ...o };
}
const BOARD_REPO = {
  pullRequests: { totalCount: 4, nodes: [
    pullNode(1, { title: "New record", author: { login: "ann" }, headRefName: "claude/t-small", createdAt: ago(50 * MIN), body: "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
      commits: { nodes: [{ commit: { message: "x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", statusCheckRollup: { state: "PENDING" } } }] },
      files: { nodes: [{ path: "submissions/t_small/ann/README.md" }] } }),
    pullNode(2, { isDraft: true, author: { login: "bob" }, createdAt: ago(3 * DAY), updatedAt: ago(2 * DAY), files: { nodes: [{ path: "mnist/sub/x.py" }] } }),
    pullNode(3, { updatedAt: ago(30 * DAY) }),
    pullNode(4, { url: "https://evil.example/pull/4" }),
  ] },
  forks: { nodes: [
    { url: "https://github.com/carol/board", owner: { login: "carol" }, createdAt: ago(3 * DAY), pushedAt: ago(10 * MIN) },
    { url: "https://github.com/dan/board", owner: { login: "dan" }, createdAt: ago(5 * MIN), pushedAt: ago(5 * MIN + 30_000) },
    { url: "https://github.com/ann/board", owner: { login: "ann" }, createdAt: ago(5 * DAY), pushedAt: ago(3 * MIN) },
    { url: "https://github.com/old/board", owner: { login: "old" }, createdAt: ago(9 * DAY), pushedAt: ago(2 * HOUR) },
  ] },
};

test("GitHub: one query per two repositories, repositories as variables, partial answers kept", async () => {
  const q = reposQuery(2);
  assert.match(q, /r0: repository\(owner: \$o0, name: \$n0\)/);
  assert.match(q, /r1: repository\(owner: \$o1, name: \$n1\)/);
  const seen: any[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body));
    seen.push({ url, auth: new Headers(init!.headers).get("authorization"), body });
    if (body.variables.n0 === "down") return new Response("bad gateway", { status: 502 });
    const data: Record<string, unknown> = {};
    for (let i = 0; `n${i}` in body.variables; i++) data[`r${i}`] = body.variables[`n${i}`] === "gone" ? null : body.variables[`n${i}`] === "board" ? BOARD_REPO : { pullRequests: { totalCount: 0, nodes: [] }, forks: { nodes: [] } };
    return Response.json({ data });
  };
  const { repos, failed } = await githubRepos([{ owner: "o", name: "board" }, { owner: "o", name: "gone" }, { owner: "o", name: "down" }, { owner: "o", name: "quiet" }, { owner: "o", name: "bad name!" }], "tok", fetchImpl);
  assert.equal(seen.length, 2, "four valid repositories, two per query; an invalid name is never sent");
  assert.ok(seen.every((s) => s.url === "https://api.github.com/graphql" && s.auth === "bearer tok" && !s.body.query.includes("board")), "the token, and no repository in the query text");
  assert.deepEqual([...repos.keys()].sort(), ["o/board"]);
  assert.deepEqual(failed.sort(), ["o/down", "o/gone", "o/quiet"]);
  await assert.rejects(githubRepos([{ owner: "o", name: "down" }], "tok", fetchImpl), /GitHub answered 502/);

  const r = parseRepo(BOARD_REPO, "o/board")!;
  assert.equal(r.openPulls, 4);
  assert.deepEqual(r.pulls.map((p) => p.number), [1, 2, 3], "a pull request whose link is not on github.com is dropped");
  assert.deepEqual(r.pulls[0].agent, { family: "anthropic", model: "Claude Opus 5.5", tool: "Claude Code" });
  assert.equal(r.pulls[0].checks, "PENDING");
  assert.deepEqual(r.pulls[0].files, ["submissions/t_small/ann/README.md"]);
  assert.equal(r.pulls[1].agent, undefined);
  assert.equal(r.forks.length, 4);
});

// ─── Assembling a live answer ───────────────────────────────────────────
const session = (id: string, o: Partial<SessionView> = {}): SessionView => ({
  id, competitionId: "board", status: "working", agent: { family: "anthropic", tool: "Claude Code" }, startedAt: ago(20 * MIN), lastSeenAt: ago(2 * MIN), ...o,
});

test("a live answer: subtasks by status, who is on them, agents now de-duplicated, events of the last day", () => {
  const sessions = [session("s_a", { subtask: "t-big", handle: "ann" }), session("s_b", { subtask: "t_small", status: "submitted", submittedAt: ago(MIN), agent: { tool: "Codex", family: "openai" } })];
  const recentSessions = [...sessions, session("s_c", { startedAt: ago(3 * HOUR), lastSeenAt: ago(HOUR), endedAt: ago(HOUR), outcome: "gave_up", subtask: "graded" }),
    session("s_old", { startedAt: ago(3 * DAY), endedAt: ago(2 * DAY) })];
  const l = assembleLive(base("board"), { now: T0, origin: "https://site.test", github: parseRepo(BOARD_REPO, "o/board"), sessions, recentSessions, sources: [] });
  assert.equal(l.page, "https://site.test/c/board");
  assert.equal(l.live, "https://site.test/api/live/board");
  assert.equal(l.refreshAfterSeconds, 20);
  // ann (pull request in the last 30 minutes, and the handle of a check-in), carol (pushed her fork), the check-in with no handle
  assert.equal(l.agentsNow, 3);
  assert.equal(l.agents.basis, "observed");
  assert.deepEqual(l.agents.github, { now: 2, pullAuthors: 1, forkPushers: 1, withAgentEvidence: 1, pullsInFlight: 2, openPulls: 4 });
  assert.deepEqual(l.agents.checkins, { now: 2, byTool: { "Claude Code": 1, Codex: 1 }, byStatus: { working: 1, submitted: 1 } });

  const s = Object.fromEntries(l.subtasks.map((x) => [x.id, x]));
  assert.deepEqual(l.subtasks.map((x) => [x.id, x.status]), [["t-big", "in_progress"], ["mnist-a", "in_progress"], ["t_small", "in_review"], ["graded", "solved"]]);
  assert.equal(s["t_small"].why, "1 agent checked in, 1 pull request with checks running; nobody has beaten the baseline yet (score 10 ms)");
  assert.deepEqual(s["t_small"].attempts.map((a) => [a.kind, a.status, a.who]), [["session", "submitted", undefined], ["pull_request", "checks_running", "ann"]]);
  assert.deepEqual([s["t_small"].state, s["t_small"].activity, s["t_small"].agentsNow], ["open", "in_review", 1]);
  assert.equal(s["mnist-a"].attempts[0].status, "draft");
  assert.equal(s["t-big"].why, "1 agent checked in; best 3.2 score by eve (2026-11-20); an entry that beats it takes the record");
  assert.ok(!JSON.stringify(l).includes('"handle"'), "a check-in's handle is never published");
  assert.deepEqual(l.unassigned.map((a) => [a.kind, a.who]), [["fork", "carol"]], "dan pushed only when he forked; ann's fork push is her pull request; old pushed too long ago");
  assert.deepEqual(l.summary, { in_progress: 2, in_review: 1, open: 0, beaten: 0, solved: 1, refuted: 0, closed: 0, subtasks: 4, attemptsInFlight: 5 });
  assert.deepEqual(l.recent.map((e) => [e.kind, e.text]), [
    ["submitted", "Codex sent an entry on Small"],
    ["checked_in", "Claude Code checked in on Big"],
    ["checked_in", "Codex checked in on Small"],
    ["pull_request", "ann with Claude Code opened a pull request on Small: New record"],
    ["checked_out", "Claude Code finished on Graded: gave up"],
    ["checked_in", "Claude Code checked in on Graded"],
  ]);
  const row = liveRow(l, base("board"));
  assert.deepEqual({ ...row, lastActivity: undefined }, { id: "board", name: "Challenge board", page: "https://site.test/c/board", live: "https://site.test/api/live/board", agentsNow: 3, basis: "observed", windowMinutes: 30,
    subtasks: 4, statuses: { in_progress: 2, in_review: 1, open: 0, beaten: 0, solved: 1, refuted: 0, closed: 0 }, attemptsInFlight: 5, lastActivity: undefined, entriesLast30d: 3, lastEntry: "2026-11-22" });
  assert.equal(row.lastActivity, ago(MIN));
});

test("the challenge's own feed wins for agents now and for its subtasks; an ended challenge stays closed", async () => {
  const native = await pequalnpLive(getter());
  const pulls: RepoLive = { openPulls: 1, forks: [], pulls: [{ number: 9, title: "L-meta-60", url: "https://github.com/open-goat/pequalnp-proofs/pull/9", author: "ann", isDraft: false,
    createdAt: ago(10 * MIN), updatedAt: ago(MIN), branch: "proof", checks: "SUCCESS", files: [] }] };
  const l = assembleLive(base("pnp"), { now: T0, origin: "https://site.test", native, github: pulls, sessions: [], sources: [] });
  assert.equal(l.agentsNow, 7);
  assert.equal(l.agents.basis, "native");
  assert.equal(l.agents.note, "pequalnp.com's own count: agents seen in the last 30 minutes (2 fleet, 5 public)");
  assert.deepEqual(l.agents.native, { now: 7, windowMinutes: 30, breakdown: { fleet: 2, public: 5 }, asOf: PNP_HEAD.generated_at });
  assert.equal(l.agents.github!.now, 1, "GitHub is still reported, beside the native count");
  const s = Object.fromEntries(l.subtasks.map((x) => [x.id, x]));
  assert.equal(s["front-meta"].name, "Meta-complexity", "the feed's name over the crawl's");
  assert.equal(s["front-meta"].agentsNow, 2);
  assert.equal(s["front-meta"].state, "beaten", "the feed says nothing about the front's standing: the crawl's stays");
  assert.equal(s["l-meta-60"].attempts[0].url, "https://github.com/open-goat/pequalnp-proofs/pull/9", "the step in the title names the subtask");
  assert.equal(s["l-meta-60"].status, "in_progress");
  assert.equal(s["attack-old-line"].status, "closed");
  assert.equal(s["p-vs-np"].status, "open");
  assert.deepEqual(l.counters?.inWork, 1);
  assert.deepEqual(l.recent.map((e) => e.kind), ["accepted", "news", "status", "pull_request"]);

  const ended = assembleLive({ ...base("ended"), tracks: base("ended").tracks }, { now: T0, origin: "https://site.test", native: { ...native, tracks: [{ id: "x", state: "open" }] }, sources: [] });
  assert.equal(ended.subtasks[0].state, "closed");
  const none = assembleLive(base("site"), { now: T0, origin: "https://site.test", sources: [] });
  assert.deepEqual([none.agentsNow, none.agents.basis, none.agents.github, none.agents.checkins], [null, "none", null, null]);
  assert.match(none.agents.note, /^No live source reaches this challenge yet/);
});

test("the list orders challenges by agents now, then attempts in flight, then entries in the last 30 days", () => {
  const row = (name: string, agentsNow: number | null, attemptsInFlight: number, entriesLast30d: number, inProgress = 0) =>
    ({ name, agentsNow, attemptsInFlight, entriesLast30d, statuses: { in_progress: inProgress, in_review: 0 } }) as any;
  const rows = [row("d", null, 0, 50), row("c", 0, 0, 9), row("b", 0, 2, 0), row("a", 4, 0, 0), row("e", 0, 0, 9, 1)];
  assert.deepEqual(rows.sort(liveOrder).map((r) => r.name), ["a", "b", "e", "c", "d"]);
});

// ─── Check-ins ──────────────────────────────────────────────────────────
const CTX: CheckinContext = { subtasks: new Set(["t-big", "t_small", "mnist-a"]), repo: { owner: "o", name: "board" }, boardUrl: "https://github.com/o/board" };

test("check-ins: what an agent may say, and nothing free-form is published", () => {
  assert.equal(toolName("claude-code"), "Claude Code");
  assert.equal(toolName("Codex CLI"), "Codex");
  assert.equal(toolName("OpenHands"), "OpenHands");
  assert.equal(toolName("Buy cheap followers"), "other");
  const ok = parseCheckin({ agent: "Cursor", model: "Claude Opus 5.5", subtask: "T-BIG", status: "testing", handle: "@Ann", submission: "https://github.com/O/Board/pull/12?utm=1#x" }, CTX);
  assert.deepEqual(ok, { ok: true, value: { status: "testing", agent: { family: "anthropic", model: "Claude Opus 5.5", tool: "Cursor" }, subtask: "t-big", handle: "ann", submission: "https://github.com/o/board/pull/12" } });
  assert.deepEqual(parseCheckin({ agent: "codex" }, CTX), { ok: true, value: { status: "working", agent: { family: "openai", tool: "Codex" } } });
  const bad = (body: unknown) => { const r = parseCheckin(body, CTX); assert.equal(r.ok, false, JSON.stringify(body)); return (r as { error: string }).error; };
  assert.match(bad(undefined), /send a JSON object/);
  assert.match(bad({}), /agent is required/);
  assert.match(bad({ agent: "x".repeat(41) }), /at most 40/);
  assert.match(bad({ agent: "Codex", note: "hi" }), /not accepted: note/);
  assert.match(bad({ agent: "Codex", model: "see https://spam.example" }), /no links/);
  assert.match(bad({ agent: "Codex", model: "gpt.com" }), /no links/);
  assert.match(bad({ agent: "Codex", subtask: "nope" }), /subtask must be one of/);
  assert.match(bad({ agent: "Codex", status: "sleeping" }), /status must be one of/);
  assert.match(bad({ agent: "Codex", handle: "not a handle" }), /GitHub username/);
  assert.match(bad({ agent: "Codex", submission: "https://github.com/someone/else/pull/1" }), /submission must be/);
  assert.match(bad({ agent: "Codex", submission: "http://github.com/o/board/pull/1" }), /submission must be/);
  assert.match(bad({ agent: "Codex", submission: "https://github.com/o/board/blob/main/x" }), /submission must be/, "a GitHub board takes only its pull requests");
  const site: CheckinContext = { subtasks: new Set(["race"]), boardUrl: "https://duck.example/play" };
  assert.equal(submissionUrl("https://duck.example/runs/42#top", site), "https://duck.example/runs/42");
  assert.equal(submissionUrl("https://duck.example:8443/runs/42", site), null);
  assert.equal(submissionUrl("https://user:pw@duck.example/x", site), null);

  assert.deepEqual(parsePatch(undefined, CTX), { ok: true, value: {} });
  assert.deepEqual(parsePatch({ subtask: null, status: "submitted", submission: "https://github.com/o/board/pull/3" }, CTX), { ok: true, value: { status: "submitted", subtask: null, submission: "https://github.com/o/board/pull/3" } });
  assert.equal(parsePatch({ agent: "Codex" }, CTX).ok, false, "the agent is set once");
  assert.equal(parsePatch({ subtask: "nope" }, CTX).ok, false);
  assert.deepEqual([parseOutcome(undefined), parseOutcome("gave_up"), parseOutcome("won")], ["done", "gave_up", null]);
});

test("sessions: counted while renewed, ended by their token only, limited per address, kept 30 days", async () => {
  const store = memorySessions();
  const s = { competitionId: "board", status: "working" as const, agent: { tool: "Codex" }, ipHash: "ip1" };
  const a = await store.start({ ...s, subtask: "t-big", handle: "ann" }, T0);
  assert.ok("token" in a && /^s_[A-Za-z0-9_-]{12}$/.test(a.id) && /^t_[A-Za-z0-9_-]{32}$/.test(a.token), "an id and a token");
  if (!("token" in a)) return;
  assert.ok(![...store.rows.values()].some((r) => JSON.stringify(r).includes(a.token)), "only the token's hash is kept");
  assert.equal((await store.active(T0)).length, 1);
  assert.equal((await store.active(T0 + TTL_MS + 1)).length, 0, "not renewed for 15 minutes: no longer counted");
  assert.equal(await store.update("board", a.id, "t_wrong", {}, T0 + MIN), null);
  assert.equal(await store.update("other", a.id, a.token, {}, T0 + MIN), null);
  const renewed = await store.update("board", a.id, a.token, { status: "submitted", subtask: null }, T0 + TTL_MS + 2);
  assert.deepEqual([renewed?.status, renewed?.subtask, renewed?.submittedAt], ["submitted", undefined, new Date(T0 + TTL_MS + 2).toISOString()]);
  assert.equal((await store.active(T0 + TTL_MS + 3)).length, 1, "a late renewal counts it again");
  assert.equal(await store.update("board", a.id, a.token, {}, T0 + 13 * HOUR), null, "a session ends 12 hours after it starts");
  const ended = await store.end("board", a.id, a.token, "submitted", T0 + 2 * HOUR);
  assert.deepEqual([ended?.outcome, ended?.endedAt], ["submitted", new Date(T0 + 2 * HOUR).toISOString()]);
  assert.equal(await store.end("board", a.id, a.token, "done", T0 + 2 * HOUR), null, "once");
  assert.equal((await store.recent(T0 + 3 * HOUR, "board", DAY)).length, 1);

  // limits, on a store of their own
  const lim = memorySessions();
  for (let i = 0; i < MAX_ACTIVE_PER_IP; i++) assert.ok("token" in (await lim.start(s, T0 + i)), `session ${i}`);
  const limited = await lim.start(s, T0 + 10);
  assert.ok("limited" in limited, "the sixth open session from one address");
  assert.match((limited as { limited: string }).limited, /at most 5 sessions at once/);
  assert.ok("token" in (await lim.start({ ...s, ipHash: "ip2" }, T0 + 10)), "another address is not limited");
  let n = 0;
  for (let i = 0; i < MAX_STARTS_PER_HOUR + 5; i++) {
    const r = await lim.start({ ...s, ipHash: "ip3" }, T0 + i * 1000);
    if ("token" in r) { n++; await lim.end("board", r.id, r.token, "done", T0 + i * 1000 + 1); }
  }
  assert.equal(n, MAX_STARTS_PER_HOUR, "starts per hour are capped even when none overlap");
  const old = memorySessions();
  await old.start({ ...s, ipHash: "ip4" }, T0);
  await old.start({ ...s, ipHash: "ip5" }, T0 + 31 * DAY);
  assert.equal(old.rows.size, 1, "rows older than 30 days go as new sessions start");
});

// ─── The HTTP API ───────────────────────────────────────────────────────
function world(o: { githubDown?: boolean; baseMissing?: boolean; siteDown?: boolean } = {}) {
  let clock = T0;
  const calls: string[] = [];
  const pending: Promise<unknown>[] = [];
  const files = new Map<string, unknown>([...PNP_FILES, ["https://site.test/api/competitions.json", DATA]]);
  if (!o.baseMissing) files.set("https://site.test/api/live-base.json", BASE);
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (o.siteDown && url.startsWith("https://site.test/")) throw new Error("fetch failed");
    if (url === "https://api.github.com/graphql") {
      if (o.githubDown) return new Response("down", { status: 502 });
      const { variables } = JSON.parse(String(init!.body));
      const data: Record<string, unknown> = {};
      for (let i = 0; `n${i}` in variables; i++) data[`r${i}`] = variables[`n${i}`] === "board" ? BOARD_REPO : { pullRequests: { totalCount: 0, nodes: [] }, forks: { nodes: [] } };
      return Response.json({ data });
    }
    return files.has(url) ? Response.json(files.get(url)) : new Response("Not found", { status: 404 });
  };
  const store = memorySessions();
  const log: string[] = [];
  const handle = createLiveHandler({ origin: "https://site.test", publicOrigin: "https://site.test", fetch: fetchImpl, githubToken: "tok", store, now: () => clock,
    log: (l) => log.push(l), waitUntil: (p) => pending.push(p) });
  const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => handle(new Request(`https://site.test${path}`, {
    method, headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7", ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }));
  return { handle, req, calls, store, log, pending, tick: (ms: number) => { clock += ms; } };
}

test("GET /api/live: every challenge that has not ended, busiest first, with the sources it was built from", async () => {
  const w = world();
  const res = await w.req("GET", "/api/live");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("cache-control"), "public, max-age=10, s-maxage=20, stale-while-revalidate=60");
  const body = await res.json();
  assert.deepEqual(body.challenges.map((c: any) => [c.id, c.agentsNow, c.basis]), [["pnp", 7, "native"], ["board", 2, "observed"], ["site", 0, "observed"]]);
  assert.equal(body.agentsNow, 9);
  assert.deepEqual(body.sources.map((s: any) => [s.kind, s.ok]), [["static", true], ["native", true], ["github", true], ["checkins", true]]);
  // the ended challenge is left out; its repository is not read
  assert.equal(w.calls.filter((u) => u === "https://api.github.com/graphql").length, 1, "board and pequalnp-proofs in one query");
  assert.equal((await w.req("HEAD", "/api/live")).status, 200);
  assert.equal((await w.req("POST", "/api/live")).status, 405);
  assert.equal((await w.req("OPTIONS", "/api/live/board/sessions")).status, 204);
});

test("GET /api/live/{id}: one challenge, by its id in any case, or by the rewrite's ?path=", async () => {
  const w = world();
  const one = await (await w.req("GET", "/api/live/BOARD")).json();
  assert.equal(one.id, "board");
  assert.equal(one.subtasks.length, 4);
  assert.deepEqual(one.sources.map((s: any) => s.kind), ["static", "github", "checkins"]);
  assert.equal((await (await w.req("GET", "/api/live?path=board")).json()).id, "board");
  const pnp = await (await w.req("GET", "/api/live/pnp")).json();
  assert.deepEqual([pnp.agentsNow, pnp.sources.map((s: any) => s.kind)], [7, ["static", "native", "github", "checkins"]]);
  const site = await (await w.req("GET", "/api/live/site")).json();
  assert.deepEqual(site.sources.map((s: any) => s.kind), ["static", "checkins"], "no repository: GitHub is not asked");
  const missing = await w.req("GET", "/api/live/boar");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'no challenge has the id "boar"', closeMatches: ["board"] });
  for (const path of ["/api/live/a%2Fb", "/api/live/board/x", "/api/live/board/sessions/s_12345678/x", "/api/live/%E0%A4%A"]) assert.equal((await w.req("GET", path)).status, 404, path);
  assert.equal((await w.req("GET", "/api/live/board/sessions")).status, 405);
});

test("the live board is built from what still answers, and a stale copy is refreshed in the background", async () => {
  const down = world({ githubDown: true });
  const b = await (await down.req("GET", "/api/live/board")).json();
  assert.equal(b.sources.find((s: any) => s.kind === "github").ok, false);
  assert.match(b.sources.find((s: any) => s.kind === "github").note, /1 of 1 repository could not be read just now \(GitHub answered 502\)/);
  assert.equal(b.agents.github, null);
  assert.equal(b.agentsNow, 0, "check-ins still count");
  assert.equal((await (await world({ baseMissing: true }).req("GET", "/api/live/board")).json()).subtasks.length, 4, "a site built before live-base.json: the full dataset");
  const res = await world({ siteDown: true }).req("GET", "/api/live");
  assert.equal(res.status, 503);

  const w = world();
  await w.req("GET", "/api/live/board");
  const gh = () => w.calls.filter((u) => u === "https://api.github.com/graphql").length;
  assert.equal(gh(), 1);
  w.tick(30_000);
  await w.req("GET", "/api/live/board");
  assert.equal(gh(), 1, "fresh for a minute");
  w.tick(60_000);
  const stale = await (await w.req("GET", "/api/live/board")).json();
  assert.equal(stale.agents.github.openPulls, 4, "the last copy answers at once…");
  await Promise.all(w.pending);
  assert.equal(gh(), 2, "…while a new one is read");
});

test("check-ins end to end: POST, seen on the board, PATCH, DELETE; tokens, limits and a database that is off", async () => {
  const w = world();
  const res = await w.req("POST", "/api/live/board/sessions", { agent: "Claude Code", model: "Claude Opus 5.5", subtask: "t-big", handle: "zed" });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const s = await res.json();
  assert.match(s.renew, /^PATCH https:\/\/site\.test\/api\/live\/board\/sessions\/s_/);
  assert.deepEqual([s.renewEverySeconds, s.countedForSeconds, s.endsAfterSeconds], [300, 900, 43200]);
  assert.ok(!JSON.stringify(s).includes("zed"), "the handle is not echoed");
  let board = await (await w.req("GET", "/api/live/board")).json();
  assert.equal(board.agents.checkins.now, 1);
  assert.equal(board.subtasks.find((x: any) => x.id === "t-big").agentsNow, 1);
  assert.equal(board.recent[0].text, "Claude Code checked in on Big");

  const auth = { authorization: `Bearer ${s.token}` };
  const path = `/api/live/board/sessions/${s.session}`;
  assert.equal((await w.req("PATCH", path, {})).status, 401);
  assert.equal((await w.req("PATCH", path, {}, { authorization: "Bearer t_00000000000000000000000000000000" })).status, 404);
  assert.equal((await w.req("PATCH", path, { subtask: "nope" }, auth)).status, 400);
  w.tick(5 * MIN);
  const renewed = await w.req("PATCH", path, { status: "submitted", submission: "https://github.com/o/board/pull/7" }, auth);
  assert.equal(renewed.status, 200);
  const r = await renewed.json();
  assert.deepEqual([r.status, r.submission, r.countedUntil, r.handle], ["submitted", "https://github.com/o/board/pull/7", new Date(T0 + 5 * MIN + TTL_MS).toISOString(), undefined]);
  assert.equal((await w.req("POST", path, "", auth)).status, 200, "POST renews too, for clients that cannot PATCH");
  board = await (await w.req("GET", "/api/live/board")).json();
  assert.equal(board.subtasks.find((x: any) => x.id === "t-big").status, "in_review");
  assert.equal((await w.req("DELETE", `${path}?outcome=won`, undefined, auth)).status, 400);
  const out = await w.req("DELETE", `${path}?outcome=accepted`, undefined, auth);
  assert.deepEqual([out.status, (await out.json()).outcome], [200, "accepted"]);
  assert.equal((await w.req("DELETE", path, undefined, auth)).status, 404, "ended already");
  board = await (await w.req("GET", "/api/live/board")).json();
  assert.equal(board.agents.checkins.now, 0);
  assert.equal(board.recent[0].text, "Claude Code finished on Big: accepted");
  assert.deepEqual(w.log.map((l) => JSON.parse(l).m), ["checkin", "renew", "renew", "checkout"]);
  assert.ok(w.log.every((l) => !l.includes("203.0.113.7") && !l.includes(s.token)), "no address or token in the logs");

  assert.equal((await w.req("POST", "/api/live/ended/sessions", { agent: "Codex" })).status, 409);
  assert.equal((await w.req("POST", "/api/live/nope/sessions", { agent: "Codex" })).status, 404);
  assert.equal((await w.req("POST", "/api/live/board/sessions", "{not json")).status, 400);
  assert.equal((await w.req("POST", "/api/live/board/sessions", { agent: "x".repeat(5000) })).status, 413);
  assert.equal((await w.req("POST", "/api/live/pnp/sessions", { agent: "Codex", subtask: "attack-live-line" })).status, 201, "the feed's own subtasks are accepted");
  for (let i = 0; i < 4; i++) await w.req("POST", "/api/live/board/sessions", { agent: "Codex" });
  const limited = await w.req("POST", "/api/live/board/sessions", { agent: "Codex" });
  assert.equal(limited.status, 429);
  assert.equal((await w.req("POST", "/api/live/board/sessions", { agent: "Codex" }, { "x-real-ip": "198.51.100.1" })).status, 201);

  const off = createLiveHandler({ origin: "https://site.test", fetch: async (url) => (url.endsWith("/api/live-base.json") ? Response.json(BASE) : new Response("", { status: 404 })), now: () => T0 });
  const post = await off(new Request("https://site.test/api/live/board/sessions", { method: "POST", body: JSON.stringify({ agent: "Codex" }) }));
  assert.equal(post.status, 503);
  const get = await (await off(new Request("https://site.test/api/live/board"))).json();
  assert.deepEqual(get.sources.find((x: any) => x.kind === "checkins"), { kind: "checkins", name: "check-ins", ok: false, note: "off on this deployment: no database" });
  assert.equal(get.sources.find((x: any) => x.kind === "github").note, "not read: GITHUB_TOKEN is not set");
});

test("api/live.ts serves every method through the handler and reads LIVE_DATA_ORIGIN over HTTP", async (t) => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.url!);
    res.writeHead(req.url === "/api/live-base.json" ? 200 : 404, { "content-type": "application/json" }).end(req.url === "/api/live-base.json" ? JSON.stringify(BASE) : "{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = { ...process.env };
  t.after(() => { server.close(); process.env = saved; });
  for (const k of ["LIVE_DB_URL", "SUPABASE_DB_URL", "POSTGRES_URL", "GITHUB_TOKEN"]) delete process.env[k];   // never a real database or token from a test
  process.env.LIVE_DATA_ORIGIN = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const fn = await import("../api/live.js");
  for (const m of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) assert.equal(typeof fn[m], "function", m);
  const res = await fn.GET(new Request("https://openchallengelist.com/api/live?path=site"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).live, "https://openchallengelist.com/api/live/site");
  assert.deepEqual(seen, ["/api/live-base.json"]);
  assert.equal((await fn.POST(new Request("https://openchallengelist.com/api/live?path=site/sessions", { method: "POST", body: "{}" }))).status, 503);
});

test("discovery: vercel.json routes /api/live to its function and leaves it out of the five-minute cache; agents' fetches are tagged", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.functions["api/live.ts"], "a function config");
  assert.ok(vercel.rewrites.some((r: any) => r.source === "/api/live/:path*" && r.destination === "/api/live?path=:path"), "the rewrite");
  const cached = vercel.headers.find((h: any) => h.headers.some((x: any) => x.key === "Cache-Control" && x.value === "public, max-age=300"));
  const rx = new RegExp(`^${cached.source.replace(/\(\(\?!/, "((?!")}$`);
  assert.ok(rx.test("/api/index.json") && rx.test("/api/live-base.json"), "static files keep the five-minute cache");
  assert.ok(!rx.test("/api/live") && !rx.test("/api/live/board"), "live answers set their own");
  assert.equal(pageType("/api/live/board"), "live");
  assert.equal(pageType("/api/live-base.json"), "api");
  assert.equal(agentEvent("/api/live/board/sessions", "claude-code/2.1", null)!.events[0].params.competition, "board");
});
