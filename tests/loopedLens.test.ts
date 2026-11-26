import assert from "node:assert/strict";
import { test } from "node:test";
import { boardsToCompetition, buildLoopedLens, LEADERBOARD, phasesOf, phaseToTrack, rowOf, SPACE, str, teamName, USER_AGENT, utcDay } from "../src/structured/loopedLens.js";
import { postprocess } from "../src/postprocess.js";
import { isEntry } from "../src/aggregate.js";
import { buildProfiles } from "../src/profiles.js";

const NOW = Date.parse("2026-11-26T08:30:00Z");
const repo = { owner: "ndif-team", name: "looped-lens-challenge", url: "https://github.com/ndif-team/looped-lens-challenge", defaultBranch: "main", stars: 11, topics: ["interpretability"] };
const PREV_ID = "ndif-team-looped-lens-challenge-760f0dba003c4c92";

// ─── Rows as https://ndif-looped-lens-challenge.hf.space/api/leaderboard serves them (space/board.py, 2026-11-26) ───
const sets = (a: number, b: number, c: number) => [{ name: "Dataset A", metrics: { pass_rate: a } }, { name: "Dataset B", metrics: { pass_rate: b } }, { name: "Dataset C", metrics: { pass_rate: c } }];
const row = (team: string, rate: number, at: string, extra: Record<string, unknown> = {}) => ({
  id: `${at.replace(/[-:]/g, "").slice(0, 15)}-${team.length.toString(16).padStart(8, "0")}`, team, submitted_at: at, fields: {}, seconds: 669.11,
  baseline: false, best: false, flagged: false, rank: null, metrics: { pass_rate: rate }, breakdown: sets(rate, rate, rate),
  message: "Passed 281 of 290 questions. Layers read: 5, 17, 22, 29, 39, 42, 43, 44, 45, 46.", ...extra,
});
const rows = [
  row("Arnav Raj", 0.97, "2026-11-26T06:35:37+00:00", { best: true, rank: 1, breakdown: sets(0.98, 1, 0.93) }),
  row("team-macromackie", 0.9559, "2026-11-26T02:33:11+00:00", { best: true, rank: 2, breakdown: sets(0.94, 0.9778, 0.95), message: "Passed 277 of 290 questions. Layers read: 12, 24, 39, 40, 41, 43, 44, 45, 46, 47." }),
  row("team-macromackie", 0.9526, "2026-11-26T06:34:51+00:00"),
  // a tie on pass rate: the board ranks whoever got there first higher
  row("Early Tie", 0.9, "2026-11-25T01:00:00+00:00", { best: true, rank: 3, message: "Passed 260 of 290 questions." }),
  row("Late Tie", 0.9, "2026-11-25T02:00:00+00:00", { best: true, rank: 4, message: "garbage that is not the evaluator's sentence <script>" }),
  // the team's best is under review: it keeps its place on the board, here the team stands on its best submission that is not
  row("JB Rubinovitz", 0.7596, "2026-11-24T12:06:50+00:00", { best: true, rank: 5, flagged: true }),
  row("JB Rubinovitz", 0.7593, "2026-11-25T15:32:56+00:00"),
  row("JB Rubinovitz", 0.7, "2026-11-24T10:00:00+00:00"),
  row("Arnav Raj", 0.9, "2026-11-25T23:59:00+00:00"),
  // a time with an offset: the UTC day, not the first ten characters
  row("Offset Team", 0.8, "2026-11-26T01:00:00+05:00", { best: true, rank: 6 }),
  row("wileyrya@gmail.com", 0.65, "2026-11-25T19:43:25+00:00", { best: true, rank: 7 }),
  // only under review: not on the list until cleared
  row("Only Flagged", 0.99, "2026-11-25T10:00:00+00:00", { best: true, rank: 8, flagged: true }),
  // the organizers' reference lens: shown in place, never ranked
  row("Starter logit lens", 0.6619, "2026-11-23T20:24:06+00:00", { baseline: true, best: true, rank: null, breakdown: sets(0.66, 0.5556, 0.77), message: "Passed 193 of 290 questions. Layers read: 12, 24, 34, 35, 36, 43, 44, 45, 46, 47." }),
  // dropped: a pass rate that is not one, no team, a team that is not text
  row("Seven", 7, "2026-11-25T10:00:00+00:00"),
  row("", 0.5, "2026-11-25T10:00:00+00:00"),
  { ...row("x", 0.5, "2026-11-25T10:00:00+00:00"), team: { name: "x" } },
  row("No Time", 0.5, "not a time"),
];
const board = (phase: number, phases: number, list: unknown[] = rows) => ({ phase, phases, rows: list });

test("third-party text, times and the board's rows", () => {
  assert.equal(str("a‮<b>evil</b>\n\tz", 40), "a b>evil/b> z");
  assert.equal(str(42, 10), undefined);
  assert.equal(teamName("wileyrya@gmail.com"), "wileyrya@…", "a team named with an email address is shown up to the @");
  assert.equal(teamName("LatentLens (vocabulary pool, z-scored)"), "LatentLens (vocabulary pool, z-scored)");
  assert.equal(utcDay("2026-11-26T01:00:00+05:00", NOW), "2026-11-25");
  assert.equal(utcDay("2026-11-26T06:35:37+00:00", NOW), "2026-11-26");
  assert.equal(utcDay("2026-11-27T06:35:37+00:00", NOW), undefined, "a time ahead of the clock is no date");

  const r = rowOf(rows[0])!;
  assert.deepEqual(r, {
    team: "Arnav Raj", rate: 0.97, best: true, baseline: false, flagged: false, ts: "2026-11-26T06:35:37+00:00", rank: 1,
    sets: [{ name: "Dataset A", rate: 0.98 }, { name: "Dataset B", rate: 1 }, { name: "Dataset C", rate: 0.93 }],
    passed: 281, questions: 290, layers: [5, 17, 22, 29, 39, 42, 43, 44, 45, 46],
  });
  assert.equal(rowOf(rows[4])!.passed, undefined, "a message that is not the evaluator's sentence is not read");
  assert.equal(rowOf({ ...rows[0], rank: 9, best: false })!.rank, undefined, "only a team's best row carries the board's rank");
  assert.equal(rowOf({ ...rows[0], message: "Passed 300 of 290 questions." })!.passed, undefined);
  assert.equal(rowOf({ ...rows[0], breakdown: [{ name: "<img src=x>", metrics: { pass_rate: 0.5 } }, { name: "Dataset D", metrics: { pass_rate: 2 } }] })!.sets.length, 0);
  for (const bad of [rows[13], rows[14], rows[15], null, "row"]) assert.equal(rowOf(bad), undefined);

  assert.deepEqual(phasesOf(board(1, 1)), { current: 1, phases: 1 });
  assert.deepEqual(phasesOf(board(2, 2)), { current: 2, phases: 2 });
  assert.deepEqual(phasesOf({ phase: "open", phases: [], rows: [] }), { current: 1, phases: 1 }, "anything that is not a count is one phase");
  assert.deepEqual(phasesOf({ phase: 5, phases: 2 }), { current: 2, phases: 2 });
});

test("a phase becomes one track: each team's best submission not under review, the board's order, the reference lens as baseline", () => {
  const t = phaseToTrack(1, 1, board(1, 1), NOW);
  assert.equal(t.id, "phase-1");
  assert.equal(t.name, "Phase 1");
  assert.equal(t.metricName, "pass rate");
  assert.equal(t.metricUnit, "%");
  assert.equal(t.metricDirection, "maximize");
  assert.equal(t.baseline, 66.19);
  assert.deepEqual(t.records.map((r) => [r.contributor, r.value, r.date ?? null, !!r.isCurrentBest, !!r.isBaseline]), [
    ["Arnav Raj", 97, "2026-11-26", true, false],
    ["team-macromackie", 95.59, "2026-11-26", false, false],
    ["Early Tie", 90, "2026-11-25", false, false],
    ["Late Tie", 90, "2026-11-25", false, false],
    ["Offset Team", 80, "2026-11-25", false, false],
    ["JB Rubinovitz", 75.93, "2026-11-25", false, false],
    ["wileyrya@…", 65, "2026-11-25", false, false],
    ["No Time", 50, null, false, false],
    ["Starter logit lens", 66.19, null, false, true],
  ]);
  const [arnav, macro, , late, , jb] = t.records;
  assert.equal(arnav.description, "rank 1 on the board · Dataset A 98%, Dataset B 100%, Dataset C 93% · passed 281 of 290 questions · reads layer visits 5, 17, 22, 29, 39, 42, 43, 44, 45, 46 · best of the team's 2 scored submissions");
  assert.equal(arnav.contributorKind, "team");
  assert.equal(arnav.contributorUrl, LEADERBOARD, "a team name an account chose, never a guessed GitHub profile");
  assert.equal(arnav.agent, undefined, "the board records no model or agent");
  assert.match(macro.description!, /^rank 2 on the board · Dataset A 94%, Dataset B 97\.78%, Dataset C 95% · passed 277 of 290 questions/);
  assert.equal(late.description, "rank 4 on the board · Dataset A 90%, Dataset B 90%, Dataset C 90% · the team's only scored submission");
  assert.equal(jb.description, "Dataset A 75.93%, Dataset B 75.93%, Dataset C 75.93% · passed 281 of 290 questions · reads layer visits 5, 17, 22, 29, 39, 42, 43, 44, 45, 46 · best of the team's 2 scored submissions not under review (1 under review left out)",
    "its board rank belongs to the flagged row, so this one carries none");
  assert.ok(!t.records.some((r) => r.contributor === "Only Flagged"), "a team with nothing but a submission under review is not listed");
  const ref = t.records.at(-1)!;
  assert.equal(ref.contributorKind, "method");
  assert.equal(ref.contributorUrl, undefined);
  assert.equal(ref.description, "the organizers' reference lens, shown on the board but not ranked · Dataset A 66%, Dataset B 55.56%, Dataset C 77% · passed 193 of 290 questions · reads layer visits 12, 24, 34, 35, 36, 43, 44, 45, 46, 47");
  assert.equal(t.description, "The current phase. A lens answers 290 hidden questions in 3 datasets (Dataset A, Dataset B, Dataset C); a question passes when the judge model finds the intermediate named on more of the lens's layer readouts than any of the four distractors, and a tie fails. Pass rate is the mean of the datasets' shares of questions passed, higher is better. 8 teams, 11 scored submissions; 2 submissions under review left out.");

  const closed = phaseToTrack(1, 2, board(1, 2, []), NOW);
  assert.equal(closed.name, "Phase 1 (closed)");
  assert.deepEqual(closed.records, []);
  assert.equal(closed.baseline, undefined);
  assert.match(closed.description!, /^An earlier phase: submissions made since are ranked on a newer board\. A lens answers the hidden questions;/);
});

test("the competition survives postprocess under the repository's id; teams are people the site's way, never GitHub accounts", (t) => {
  t.mock.method(console, "log", () => {});
  const built = boardsToCompetition(new Map([[1, board(1, 1)]]), 1, NOW);
  assert.equal(built.url, "https://github.com/ndif-team/looped-lens-challenge", "src/pulse.ts finds this board by its repository URL");
  assert.equal(built.host, "huggingface");
  assert.equal(built.status, "active");
  assert.equal(built.participation.compute, "none");
  assert.equal(built.domain, "ml-research");
  assert.match(built.description, /Phase 1: 8 teams and 11 scored submissions so far \(2 more under review\); the organizers' reference lens \(Starter logit lens\) passes 66\.19%\./);
  assert.ok(built.links.some((l) => l.url === LEADERBOARD) && built.links.some((l) => l.url === "https://ndif.us/looped-lens-challenge/"));

  const c = postprocess(built, repo);
  assert.equal(c.id, PREV_ID, "with no saved entry the id comes from the repository, the same as the listed one");
  assert.equal(postprocess(boardsToCompetition(new Map([[1, board(1, 1)]]), 1, NOW), repo, c).id, PREV_ID);
  const [track] = c.problems;
  assert.equal(track.isOpen, false);
  assert.equal(track.contested, true);
  assert.equal(track.records.find((r) => r.isCurrentBest)!.contributor, "Arnav Raj");
  assert.deepEqual(c.participants.map((p) => p.name).sort(), ["Arnav Raj", "Early Tie", "JB Rubinovitz", "Late Tie", "No Time", "Offset Team", "team-macromackie", "wileyrya@…"]);
  assert.ok(c.participants.every((p) => p.url === LEADERBOARD), "a team handle never gets a guessed GitHub profile");
  assert.equal(c.problems.flatMap((p) => p.records).filter(isEntry).length, 7, "a team's best is an entry when it has a date");
  assert.deepEqual(c.agentStats, []);
  const { profiles } = buildProfiles([c]);
  assert.equal(profiles.length, 8);
  assert.ok(profiles.every((p) => p.slug.startsWith("name--")), "a team name that reads like a login is still this board's name, not a GitHub account");
});

test("buildLoopedLens reads the current board, then each earlier phase; one retry, then a generic error", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls: { url: string; ua: string | null }[] = [];
  const serve = (handler: (url: string) => Response) => t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, ua: new Headers(init?.headers).get("user-agent") });
    return handler(url);
  });

  serve(() => Response.json(board(1, 1)));
  const one = await buildLoopedLens();
  assert.deepEqual(calls.map((c) => c.url), [`${SPACE}/api/leaderboard`]);
  assert.ok(calls.every((c) => c.ua === USER_AGENT));
  assert.deepEqual(one.problems.map((p) => p.id), ["phase-1"]);

  calls.length = 0;
  const phase2 = [row("New Team", 0.5, "2026-11-26T05:00:00+00:00", { best: true, rank: 1 }), row("Starter logit lens", 0.4, "2026-11-26T00:00:00+00:00", { baseline: true, best: true })];
  serve((url) => (url.endsWith("?phase=1") ? Response.json(board(1, 2)) : Response.json(board(2, 2, phase2))));
  const two = await buildLoopedLens();
  assert.deepEqual(calls.map((c) => c.url), [`${SPACE}/api/leaderboard`, `${SPACE}/api/leaderboard?phase=1`]);
  assert.deepEqual(two.problems.map((p) => [p.id, p.name]), [["phase-2", "Phase 2"], ["phase-1", "Phase 1 (closed)"]], "the current phase first; an earlier one stays as its own track");
  assert.match(two.description, /Phase 2: 1 team and 1 scored submission so far; the organizers' reference lens \(Starter logit lens\) passes 40%\./);
  assert.match(two.participation.deadline!, /^Phase 2 is open/);

  calls.length = 0;
  let fail = 1;
  serve(() => (fail-- > 0 ? new Response("SECRET busy", { status: 503 }) : Response.json(board(1, 1))));
  assert.equal((await buildLoopedLens()).problems.length, 1);
  assert.equal(calls.length, 2);

  serve(() => new Response("SECRET down", { status: 502 }));
  await assert.rejects(buildLoopedLens(), /^Error: Looped Lens leaderboard download failed$/);
  serve((url) => (url.endsWith("?phase=1") ? new Response("SECRET", { status: 500 }) : Response.json(board(2, 2, phase2))));
  await assert.rejects(buildLoopedLens(), /^Error: Looped Lens leaderboard download failed$/, "an earlier phase's board is part of the build");
  for (const bad of [{ phase: 1, phases: 1 }, { rows: "none" }, []]) {
    serve(() => Response.json(bad));
    await assert.rejects(buildLoopedLens(), /^Error: Looped Lens leaderboard download failed$/, JSON.stringify(bad));
  }
});

test("a board that has gone quiet is not called active; postprocess decides from the last entry", (t) => {
  t.mock.method(console, "log", () => {});
  const quiet = boardsToCompetition(new Map([[1, board(1, 1)]]), 1, Date.parse("2027-02-01T00:00:00Z"));
  assert.equal(quiet.status, "unknown");
  const empty = boardsToCompetition(new Map([[1, board(1, 1, [])]]), 1, NOW);
  assert.equal(empty.status, "unknown");
  assert.equal(postprocess(empty, repo).problems[0].isOpen, true, "no team on the board yet: an open track");
});
