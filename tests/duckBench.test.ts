import assert from "node:assert/strict";
import { test } from "node:test";
import { agentOf, boardToProblem, buildDuckBench, harnessLabel, ladderToProblem, modelLabel, USER_AGENT } from "../src/structured/duckBench.js";
import { postprocess } from "../src/postprocess.js";

const site = { site: "duckbench", url: "https://duckbench.app/" };
const challenges = [
  { id: "sumo", title: "Sumo", tagline: "Push the other duck out", what_counts: "Push the other duck out of the ring.", metric: "match_points", metric_unit: "pts", lower_is_better: false, ranking: { kind: "score", unit: "pts", lower_is_better: false, miss_s: null }, ranked_seed_count: 24, duel: true, tag: "PvP" },
  { id: "sprint", title: "Sprint", tagline: "Run to the line, fast", what_counts: "Your time when the duck's body crosses the line.", metric: "torso_reach", metric_unit: "m", lower_is_better: false, ranking: { kind: "finish", unit: "s", lower_is_better: true, miss_s: 30 }, ranked_seed_count: 24, duel: false },
  { id: "saucer", title: "Saucer", tagline: "Spin the saucer", metric: "disc_peak_rpm", metric_unit: "rpm", lower_is_better: false, ranking: { kind: "score", unit: "rpm", lower_is_better: false, miss_s: null }, ranked_seed_count: 24, duel: false },
  { id: "../escape", title: "Bad id", duel: false },
];
const boards: Record<string, unknown> = {
  sprint: { challenge_id: "sprint", entries: [
    { rank: 1, attempt_id: "4evrui8rkyk4", handle: "bonuck", house: null, author_kind: "agent", declared_model: "gpt-5.6-terra", submitted_at: "2026-11-05T17:19:15.014Z", seed_count: 24, result: 2.170867471771033, worst_result: 2.3179314895558107, trained: { model: "gpt-5.6-terra", minutes: 27.43, caption: "trained by GPT-5.6 Terra · 27 min (self-reported)" }, exploit: false, exploit_flags: [] },
    { rank: 2, attempt_id: "2t3xy1sdivcy", handle: "astro-super-duck", house: null, author_kind: "agent", declared_model: "gpt-6.1-sol", submitted_at: "2026-10-31T04:44:57.937Z", seed_count: 24, result: 2.221827535968829, exploit: true, exploit_flags: ["trunk_speed"] },
    { rank: 3, attempt_id: "1b7ckz4l87nz", handle: "shpq", house: null, author_kind: "hand", declared_model: null, submitted_at: "2026-10-10T09:00:00.000Z", seed_count: 24, result: 3.074, trained: { model: null, caption: "trained moves" } },
    { rank: null, attempt_id: "1u7j9yqghpo3", handle: "arena-bot-hard", house: "hard", author_kind: "hand", submitted_at: "2026-10-29T22:34:10.052Z", result: 7.366475526600799 },
    { rank: null, attempt_id: "zzzzzzzzzzzz", handle: "arena-bot-easy", house: "easy", author_kind: "hand", submitted_at: "2026-10-29T22:34:10.052Z", result: 24.147 },
    { rank: 4, attempt_id: "x", handle: "<script>", result: 1 },
    { rank: 5, attempt_id: "x", handle: "nan-row", result: "fast" },
  ] },
  saucer: { challenge_id: "saucer", entries: [
    { rank: 1, attempt_id: "3i8cq60gxsuu", handle: "emillio", house: null, author_kind: "agent", declared_model: "claude-opus-5-5", submitted_at: "2026-10-31T10:00:00.000Z", result: 59.243 },
    { rank: null, attempt_id: "b5oczz9d196b", handle: "arena-bot-hard", house: "hard", result: 55.445 },
  ] },
};
const ladders: Record<string, unknown> = {
  sumo: { challenge: { id: "sumo", version: 3, title: "Sumo" }, rows: [
    { rank: 1, entry: { entry_id: "fqzmvtgz51at", handle: "lenant", house: null, declared_model: "gpt-6-astra", agent: { model: "gpt-6-astra", harness: "codex" } }, rating: 1682, rating_provisional: false, rating_margin: 20, matches: 326, wins: 230, losses: 70, draws: 26 },
    { rank: 2, entry: { entry_id: "wb541rlqt5t2", handle: "shpq", house: null, declared_model: "claude-opus-5-5", agent: { model: "claude-opus-5-5", harness: "Claude Code" } }, rating: 1671, rating_provisional: false, matches: 73, wins: 55, losses: 16, draws: 2 },
    { rank: null, entry: { entry_id: "b0th4rd00000", handle: "arena-bot-hard", house: "hard" }, rating: 1461, matches: 6, wins: 2, losses: 3, draws: 1 },
    { rank: 3, entry: { entry_id: "n0m0de100000", handle: "newduck", house: null, declared_model: null, agent: null }, rating: 1461, rating_provisional: true, matches: 2, wins: 1, losses: 1, draws: 0 },
  ] },
};

function mockSite(t: any, override?: (url: string) => Response | undefined) {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    // like the real API: Node's default user agent gets 426 kit_outdated
    if (new Headers(init?.headers).get("user-agent") !== USER_AGENT) return Response.json({ error: { code: "kit_outdated" } }, { status: 426 });
    const o = override?.(url); if (o) return o;
    if (url === "https://duckbench.app/api/challenges") return Response.json({ challenges });
    let m = url.match(/\/api\/challenges\/([a-z-]+)\/board$/);
    if (m && boards[m[1]]) return Response.json(boards[m[1]]);
    m = url.match(/\/api\/pvp\/([a-z-]+)\/leaderboard$/);
    if (m && ladders[m[1]]) return Response.json(ladders[m[1]]);
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  });
  return calls;
}

test("declared ids and harnesses read like the rest of the dataset; no declared model, no attribution", () => {
  assert.equal(modelLabel("claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(modelLabel("claude-fable-5"), "Claude Fable 5");
  assert.equal(modelLabel("claude-sonnet-4-5-20250929"), "Claude Sonnet 4.5");
  assert.equal(modelLabel("gpt-6.1-sol"), "GPT-6.1 Sol");
  assert.equal(modelLabel("gpt-6-astra"), "GPT-6 Astra");
  assert.equal(modelLabel("mystery-model-9"), "mystery-model-9");
  assert.equal(harnessLabel("codex"), "Codex");
  assert.equal(harnessLabel("Claude Code"), "Claude Code");
  assert.equal(harnessLabel("claude-code"), "Claude Code");
  assert.equal(harnessLabel("claude-app"), "Claude app");
  assert.equal(harnessLabel("my-harness"), "my-harness");
  assert.equal(harnessLabel(""), undefined);
  assert.deepEqual(agentOf("gpt-6.1-sol", "codex", "e"), { family: "openai", model: "GPT-6.1 Sol", tool: "Codex", evidence: "e", confidence: "high", role: "author" });
  assert.equal(agentOf("mystery-model-9", null, "e")!.family, "other-ai");
  assert.equal(agentOf(null, "codex", "e"), undefined);
  assert.equal(agentOf("  ", undefined, "e"), undefined);
});

test("a solo board becomes one track: players ranked by the server's number, Arena bots as the baseline", () => {
  const p = boardToProblem(challenges[1] as any, (boards.sprint as any).entries);
  assert.equal(p.id, "sprint");
  assert.equal(p.group, "Races");
  assert.equal(p.metricName, "finish time");
  assert.equal(p.metricUnit, "s");
  assert.equal(p.metricDirection, "minimize", "the ranking's direction, not the raw metric's");
  assert.equal(p.baseline, 7.366, "the best Arena bot");
  assert.match(p.description!, /best half of 24 hidden seeds \(a seed that never finishes counts as 30 s\), lower is better/);
  assert.deepEqual(p.records.map((r) => r.contributor), ["bonuck", "astro-super-duck", "shpq", "Arena bot (hard)", "Arena bot (easy)"], "invalid handles and values are dropped");
  const [first, second, hand, bot] = p.records;
  assert.equal(first.value, 2.171);
  assert.equal(first.date, "2026-11-05");
  assert.equal(first.isCurrentBest, true);
  assert.equal(first.isBaseline, false);
  assert.equal(first.contributorUrl, "https://duckbench.app/@bonuck");
  assert.deepEqual(first.submissionUrls, ["https://duckbench.app/challenges/sprint/attempts/4evrui8rkyk4"]);
  assert.match(first.description!, /rank 1 · best half of 24 hidden seeds · worst seed 2\.318 s · trained by GPT-5\.6 Terra/);
  assert.deepEqual({ ...first.agent, evidence: undefined }, { family: "openai", model: "GPT-5.6 Terra", evidence: undefined, confidence: "high", role: "author" });
  assert.match(first.agent!.evidence!, /declared_model "gpt-5\.6-terra" \(self-reported/);
  assert.match(second.description!, /"exploit" label: trunk_speed/);
  assert.equal(hand.agent, undefined, "hand-made without a declared model");
  assert.equal(bot.isBaseline, true);
  assert.equal(bot.contributorKind, "method");
  assert.equal(bot.agent, undefined);
  assert.equal(bot.contributorUrl, undefined);

  const saucer = boardToProblem(challenges[2] as any, (boards.saucer as any).entries);
  assert.equal(saucer.group, "Scored");
  assert.equal(saucer.metricName, "disc peak rpm");
  assert.equal(saucer.metricDirection, "maximize");
  assert.equal(saucer.records[0].agent!.family, "anthropic");
  assert.equal(saucer.records[0].agent!.model, "Claude Opus 5.5");
});

test("a duel ladder becomes one track ranked by rating, with the harness as the tool", () => {
  const p = ladderToProblem(challenges[0] as any, (ladders.sumo as any).rows);
  assert.equal(p.group, "Duels");
  assert.equal(p.metricName, "rating");
  assert.equal(p.metricDirection, "maximize");
  assert.equal(p.baseline, 1461);
  const [lenant, shpq, bot, newcomer] = p.records;
  assert.equal(lenant.value, 1682);
  assert.equal(lenant.isCurrentBest, true);
  assert.equal(lenant.date, undefined, "the ladder has no submission dates");
  assert.match(lenant.description!, /230–70–26 \(W–L–D\) in 326 matches · ±20/);
  assert.equal(lenant.agent!.tool, "Codex");
  assert.equal(lenant.agent!.family, "openai");
  assert.equal(shpq.agent!.tool, "Claude Code");
  assert.equal(shpq.agent!.model, "Claude Opus 5.5");
  assert.equal(bot.isBaseline, true);
  assert.equal(newcomer.isBaseline, false, "tying the best bot's rating does not make a player a baseline");
  assert.match(newcomer.description!, /provisional rating/);
  assert.equal(newcomer.agent, undefined);
});

test("buildDuckBench reads every challenge from the public API and survives postprocess as a site with no repository", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = mockSite(t);
  const built = await buildDuckBench();
  assert.equal(built.id, "duckbench");
  assert.equal(built.host, "website");
  assert.equal(built.domain, "robotics");
  assert.deepEqual(built.problems.map((p) => p.id), ["sumo", "sprint", "saucer"], "a challenge with an unsafe id is skipped");
  assert.ok(calls.some((u) => u.endsWith("/api/pvp/sumo/leaderboard")));
  assert.ok(!calls.some((u) => u.includes("/api/pvp/sprint")), "solo challenges are read from their board");
  assert.ok(calls.every((u) => u.startsWith("https://duckbench.app/api/")));

  const c = postprocess(built, site, undefined);
  assert.equal(c.id, "duckbench");
  assert.equal("repo" in c, false);
  const urls = c.problems.flatMap((p) => p.records.map((r) => r.contributorUrl)).filter(Boolean);
  assert.ok(urls.length && urls.every((u) => u!.startsWith("https://duckbench.app/@")), "handles link to DuckBench profiles, never guessed GitHub logins");
  assert.ok(!c.participants.some((p) => /bot/.test(p.name)), "Arena bots are not participants");
  assert.deepEqual(c.agentStats.map((a) => a.family).sort(), ["anthropic", "openai"]);
  assert.ok(c.problems.every((p) => !p.isOpen));
  assert.equal(c.status, "active");
});

test("buildDuckBench retries once, then fails with a generic error", async (t) => {
  t.mock.method(console, "log", () => {});
  let n = 0;
  mockSite(t, (url) => (url.endsWith("/api/challenges") && n++ === 0 ? new Response("SECRET busy", { status: 503 }) : undefined));
  const built = await buildDuckBench();
  assert.equal(built.problems.length, 3);
  // one challenge that stays down fails the whole build, so the crawler keeps the previous entry instead of publishing a partial one
  mockSite(t, (url) => (url.endsWith("/sprint/board") ? new Response("SECRET down", { status: 502 }) : undefined));
  await assert.rejects(buildDuckBench(), (e: Error) => e.message === "DuckBench download failed");
});
