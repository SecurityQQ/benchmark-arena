import assert from "node:assert/strict";
import { test } from "node:test";
import { agentOf, authorName, BOARD, BOARD_API, boardToCompetition, buildRiemannHub, declaredModel, harnessTool, str, USER_AGENT, utcDay } from "../src/structured/riemannHub.js";
import { postprocess } from "../src/postprocess.js";
import { isEntry } from "../src/aggregate.js";
import { buildProfiles } from "../src/profiles.js";

const NOW = Date.parse("2026-11-26T08:30:00Z");
const repo = { owner: "Osgood001", name: "riemann-hypothesis", url: "https://github.com/Osgood001/riemann-hypothesis", defaultBranch: "main", stars: 23, topics: [] };
const PREV_ID = "osgood001-riemann-hypothesis-27b8a22da0a4924e";

// ─── Trimmed copies of https://riemann.verifytask.cn/api/board (2026-11-26) ───
const CORE1_URL = "https://play.bohrium.com/challenges/lean-4-verification-rh-core-pillar-1-5-classical-z-c7f72729";
const sub = (id: number, rank: number, authorName: string, score: number, extra: Record<string, unknown> = {}) => ({
  rank, id, authorName, score, char_saved_pct: 90.4, token_saved_pct: 95.41, axiom_status: "verified_clean",
  quality: { code: "substantive", en: "Substantive Simplification", zh: "实质性简化 ✨" }, model_display: "The Council", harness_display: "pi", chars: 7104, tokens: 993, ...extra,
});
const challenge = (key: string, extra: Record<string, unknown> = {}) => ({
  id: `lean-4-verification-rh-${key}-abc`, key, code: key.toUpperCase(), badge_en: `Core ${key.slice(4)}`, badge_zh: "核心", tier: "core", metric: "tokens", is_main: false,
  title_en: `Long title of ${key}`, title_zh: "标题", short_en: `Pillar ${key}`, short_zh: "短", desc_en: `Statement of ${key}.`, url: `https://play.bohrium.com/challenges/lean-4-verification-rh-${key}-abc`,
  l0: 100_000, t0: 30_000, subs: 20, scored_subs: 12, participants_count: 4, top_score: 0, leader: null, top_submissions: [], ...extra,
});
const challenges = [
  challenge("core1", {
    badge_en: "Core 1", short_en: "ζ(s) Zero-Free Region", url: CORE1_URL, l0: 74010, t0: 21641, subs: 313, scored_subs: 267, participants_count: 68,
    desc_en: "Unconditional core theorem: prove an absolute constant c > 0 exists so ζ(s) ≠ 0 throughout the region Re(s) ≥ 1 − c / log(|Im(s)| + 2).",
    leader: sub(101470, 1, "Mikko Nyman", 70.04, { model_display: "Fable 5.2, Astra 6.2, Neon 4, Carbon 4", harness_display: "Claude Code + Codex + Antigravity" }),
    top_submissions: [
      sub(101470, 1, "Mikko Nyman", 70.04, { model_display: "Fable 5.2, Astra 6.2, Neon 4, Carbon 4", harness_display: "Claude Code + Codex + Antigravity" }),
      // on the board, but no longer in the runs list: still an author's standing, undated
      sub(90001, 4, "Early Bird", 66.5, { model_display: "Claude Opus 5.5", harness_display: "Claude Code", tokens: 2100, chars: 9000, token_saved_pct: 90.3 }),
    ],
  }),
  // a pillar the hub ran unmodified (exactly the original's size), and a reproduction the board labels "Baseline verified" a few tokens off
  challenge("core6", { badge_en: "Core 6", short_en: "CM j-Invariant Integrality", l0: 3318710, t0: 951787, scored_subs: 3, participants_count: 2 }),
  challenge("core2", { badge_en: "Core 2", short_en: "Chebotarev Density (ℚ)", l0: 211345, t0: 60726, scored_subs: 2 }),
  // nobody has a verified run yet
  challenge("core15", { badge_en: "Core 15", short_en: "Arithmetic Covolume Bounds", l0: 211322952, t0: 60808488, subs: 20, scored_subs: 0, participants_count: 0 }),
  // the Grand Challenge: scored on characters, its only scored submission is the hub's build of the unmodified proof
  {
    ...challenge("main"), code: "GRAND CHALLENGE", badge_en: "Grand Challenge", tier: "main", metric: "chars", is_main: true, short_en: "Full Riemann Hypothesis",
    url: "https://play.bohrium.com/challenges/lean-4-verification-riemann-hypothesis-levent-alpo-78ee076d", l0: 980408459, t0: null, subs: 49, scored_subs: 1, participants_count: 1,
    leader: sub(93193, 1, "osgood", 50, { char_saved_pct: 0, token_saved_pct: 0, axiom_status: "offline_build_verified", model_display: "Gemini 4 Hydrogen (Medium)", chars: 980408459, tokens: undefined,
      core_en: "Verified end-to-end baseline formalization of the full Riemann Hypothesis repository" }),
    top_submissions: [sub(93193, 1, "osgood", 50, { char_saved_pct: 0, token_saved_pct: 0, model_display: "Gemini 4 Hydrogen (Medium)", chars: 980408459, tokens: undefined })],
  },
  // dropped: a key that is not one, no title; a link that is not the Playground falls back to the board
  challenge("../etc", { short_en: "bad" }),
  challenge("core99", { short_en: undefined, title_en: undefined }),
  challenge("core7", { badge_en: "Core 7", short_en: "Connectedness", url: "javascript:alert(1)" }),
];

let idx = 0;
const run = (id: number, key: string, authorName: string, score: number, ts: string, extra: Record<string, unknown> = {}) => ({
  run_idx: ++idx, id, ts, challenge_key: key, authorName, score, compression_pct: 50, aggregate_score: 0, aggregate_pct: 0, running_best_score: 0, running_best_pct: 0,
  kept: false, model_display: "GPT-6", harness_display: "Codex CLI", chars: 40_000, tokens: 11_000, ...extra,
});
const runs = [
  run(94317, "core2", "肖雨航", 49.98, "2026-11-21T07:10:00+00:00", { kept: true, compression_pct: 0, tokens: 60838, chars: 211775, chart_method_en: "Core 2: Baseline verified (L₀)" }),
  run(94400, "core2", "肖雨航", 58.61, "2026-11-21T09:00:00+00:00", { kept: true, compression_pct: 40, tokens: 36000, chars: 120000, chart_method_en: "Core 2: Prune 12 files + Inline 3 helpers" }),
  run(99120, "core6", "osgood", 50, "2026-11-22T20:59:50+00:00", { kept: true, compression_pct: 0, tokens: 951787, chars: 3318710, model_display: null, harness_display: null, chart_method_en: "Core 6: Baseline verified (L₀)" }),
  run(99300, "core6", "Andrew Pullin", 60.1, "2026-11-23T01:00:00+00:00", { kept: true, model_display: "The Council", harness_display: "pi", tokens: 400000, chars: 1500000, compression_pct: 57.97 }),
  run(99301, "core6", "Andrew Pullin", 70.21, "2026-11-25T18:33:39+00:00", { kept: true, model_display: "The Council", harness_display: "pi", tokens: 41849, chars: 161165, compression_pct: 95.6 }),
  run(100705, "core1", "justwingdong", 68.74, "2026-11-23T10:00:00+00:00", { kept: true, model_display: "DeepSeek Flash", harness_display: "DeepSeek Harness", tokens: 1368, chars: 7900, compression_pct: 93.68 }),
  run(100800, "core1", "Mikko Nyman", 69.1, "2026-11-23T12:00:00+00:00", { kept: true, model_display: "Fable 5.2, Astra 6.2, Neon 4, Carbon 4", harness_display: "Claude Code + Codex + Antigravity", tokens: 1200 }),
  run(101470, "core1", "Mikko Nyman", 70.04, "2026-11-23T13:54:57+00:00", { kept: true, model_display: "Fable 5.2, Astra 6.2, Neon 4, Carbon 4", harness_display: "Claude Code + Codex + Antigravity", tokens: 993, chars: 7104, compression_pct: 95.41,
    chart_method_en: "Core 1: Borel–Carathéodory + DSlope + grind automation" }),
  run(101651, "core1", "Andrew Pullin", 69.36, "2026-11-23T15:00:00+00:00", { model_display: "The Council", harness_display: "pi", tokens: 1180, chars: 7644, compression_pct: 94.55 }),
  // an offset the board could write: 03:00 at +08:00 is the day before in UTC
  run(101700, "core1", "Renxiu Song", 60, "2026-11-26T03:00:00+08:00", { model_display: "Neon + GPT-6.2 Astra + Opus 5.5", harness_display: "Codex CLI" }),
  run(101701, "core1", "Kexiang Mao", 59, "2026-11-25T11:00:00+00:00", { model_display: "<synthetic>", harness_display: "Claude Code" }),
  run(101702, "core1", "doubao fan", 58, "2026-11-25T12:00:00+00:00", { model_display: "doubao-agent", harness_display: "custom loop" }),
  run(101703, "core1", "<img src=x onerror=alert(1)>", 57, "2026-11-25T13:00:00+00:00", { model_display: "", harness_display: "Cursor" }),
  run(101704, "core1", "mail me: someone@example.com", 56, "2026-11-25T14:00:00+00:00", { model_display: "qwen3.8-flash-next-unsloth", harness_display: "OpenCode" }),
  run(101705, "core1", "Slower Proof", 49.97, "2026-11-25T15:00:00+00:00", { compression_pct: 0, tokens: 21695, chars: 74227 }), // longer than the original: a verified run all the same
  run(101706, "core1", "Future Clock", 55, "2026-11-27T15:00:00+00:00"),        // a time ahead of now is no date
  // dropped: no author, a score that is not a number, a pillar the board does not list, no id; a repeated id counts once
  run(101707, "core1", "", 80, "2026-11-25T16:00:00+00:00"),
  run(101708, "core1", "Bad Score", "high" as unknown as number, "2026-11-25T16:00:00+00:00"),
  run(101709, "nope", "Lost Pillar", 80, "2026-11-25T16:00:00+00:00"),
  { ...run(0, "core1", "No Id", 80, "2026-11-25T16:00:00+00:00"), id: "x" },
  run(101470, "core1", "Mikko Nyman", 99, "2026-11-25T17:00:00+00:00"),
];
const board = (over: Record<string, unknown> = {}) => ({
  revision: "8a6012e0ed9a2647", updated_at: "2026-11-26T16:24:24.142236+08:00", snapshot_source: "live_api",
  summary: { total_participants: 121, scored_participants: 98, total_submissions: 2391, scored_submissions: 1689, evaluating_count: 12, core_solved: 42, core_total: 48 },
  progress: { core: { saved_tokens_pct: 33.48 } },
  challenges,
  autoresearch: {
    overall_core: { key: "overall_core", total_runs: 1688, kept_count: 612, runs },
    by_challenge: { core1: { key: "core1", total_runs: 267, kept_count: 54, lazy: true }, main: { key: "main", total_runs: 0, kept_count: 0 } },
  },
  recent_activity: [{ id: 112974, ts: "2026-11-26T08:19:45+00:00" }],
  ...over,
});

test("third-party text, times and the board's own words", () => {
  assert.equal(str("c > 0 and x < y", 80), "c > 0 and x < y", "a statement's comparisons stay");
  assert.equal(str("a‮<b>evil</b>\n\tz", 40), "a b>evil/b> z", "a < that could open a tag is dropped, control and bidi characters too");
  assert.equal(str(42, 10), undefined);
  assert.ok(str("x".repeat(100), 10)!.length <= 10);
  assert.equal(authorName("mail me: someone@example.com"), "mail me: someone@…", "an email address is never republished whole");
  assert.equal(utcDay("2026-11-26T06:15:49+00:00", NOW), "2026-11-26");
  assert.equal(utcDay("2026-11-26T03:00:00+08:00", NOW), "2026-11-25", "the day is the UTC day, not the first ten characters");
  assert.equal(utcDay("2026-11-26T16:24:24.142236+08:00", NOW), "2026-11-26");
  assert.equal(utcDay("2026-11-27T00:00:00+00:00", NOW), undefined, "a time ahead of the clock is no date");
  assert.equal(utcDay("2026-11-26", NOW), undefined);
  assert.equal(utcDay("yesterday", NOW), undefined);
});

test("the model a run reports is read as the dataset writes model names; the first one named decides", () => {
  const m = (s: string) => declaredModel(s);
  assert.deepEqual(m("Claude Fable 5.2"), { model: "Claude Fable 5.2", family: "anthropic" });
  assert.deepEqual(m("Fable 5.2, Astra 6.2, Neon 4, Carbon 4"), { model: "Claude Fable 5.2", family: "anthropic" });
  assert.deepEqual(m("corecode/claude-opus-5-5"), { model: "Claude Opus 5.5", family: "anthropic" });
  assert.deepEqual(m("Claude-Opus-5.5"), { model: "Claude Opus 5.5", family: "anthropic" });
  assert.deepEqual(m("Fable5.2+Opus5.5+Gemini4+DeepSeek"), { model: "Claude Fable 5.2", family: "anthropic" });
  assert.deepEqual(m("Neon + GPT-6.2 Astra + Opus 5.5"), { model: "GPT-6.2 Astra", family: "openai" }, "\"Neon\" alone names no model, GPT-6.2 Astra is the first that does");
  assert.deepEqual(m("Neon + Opus 5.5"), { model: "Claude Opus 5.5", family: "anthropic" });
  assert.deepEqual(m("GPT-6.2 Astra Ultra"), { model: "GPT-6.2 Astra", family: "openai" });
  assert.deepEqual(m("gpt-6.1-sol"), { model: "GPT-6.1 Sol", family: "openai" });
  assert.deepEqual(m("openai-codex/gpt-6.2-astra"), { model: "GPT-6.2 Astra", family: "openai" });
  assert.deepEqual(m("gpt-5.2-codex"), { model: "GPT-5.2 Codex", family: "openai" });
  assert.deepEqual(m("GPT-6"), { model: "GPT-6", family: "openai" });
  assert.deepEqual(m("Gemini 4 Neon + Claude Opus 5.5"), { model: "Gemini 4 Neon", family: "google" });
  assert.deepEqual(m("gemini-4-neon-high"), { model: "Gemini 4 Neon", family: "google" });
  assert.deepEqual(m("Gemini 4 Hydrogen (Medium)"), { model: "Gemini 4 Hydrogen", family: "google" });
  assert.deepEqual(m("Gemini 3.1 Pro"), { model: "Gemini 3.1 Pro", family: "google" });
  assert.deepEqual(m("Gemini"), { family: "google" }, "a family alone is not a model");
  assert.deepEqual(m("deepseek/deepseek-v4.1-flash"), { model: "DeepSeek V4.1 Flash", family: "deepseek" }, "the provider prefix is a bare name, the model follows");
  assert.deepEqual(m("Fortytwo Engine:Deepseek Flash V4.1 1017"), { model: "DeepSeek Flash", family: "deepseek" });
  assert.deepEqual(m("deepseek-v4-flash-max"), { model: "DeepSeek V4 Flash", family: "deepseek" });
  assert.deepEqual(m("GLM-5.3-Flash"), { model: "GLM-5.3 Flash", family: "zhipu" });
  assert.deepEqual(m("Grok 4.7"), { model: "Grok 4.7", family: "xai" });
  assert.deepEqual(m("qwen3.8-flash-next-unsloth"), { model: "Qwen3.8 Flash", family: "alibaba" }, "postprocess's family table misses \"Qwen3.8\"; the pattern carries it");
  assert.deepEqual(m("alibaba-token-plan/qwen4-max-preview"), { model: "Qwen4 Max", family: "alibaba" });
  for (const none of ["The Council", "Composer", "Hy4 flash Free", "swe-2-high", "audit-canary", "synthetic", "Fortytwo Laser Blue", "Magnopus", "Astra 6.2"]) assert.deepEqual(m(none), {}, none);

  assert.equal(harnessTool("Claude Code + Codex + Antigravity"), "Claude Code");
  assert.equal(harnessTool("Antigravity + Codex + Claude"), "Antigravity");
  assert.equal(harnessTool("t3-code/devin-acp"), "T3 Code");
  assert.equal(harnessTool("Codex CLI"), "Codex");
  assert.equal(harnessTool("pi"), "pi");
  assert.equal(harnessTool("pipeline"), undefined);
  assert.equal(harnessTool("custom loop"), undefined);
  assert.equal(harnessTool(undefined), undefined);
});

test("attribution only from model text that names a known model, self-reported, as the author's agent", () => {
  assert.deepEqual(agentOf("Fable 5.2, Astra 6.2, Neon 4, Carbon 4", "Claude Code + Codex + Antigravity", "run #101470"), {
    family: "anthropic", model: "Claude Fable 5.2", tool: "Claude Code", confidence: "high", role: "author",
    evidence: "riemann.verifytask.cn run #101470: model \"Fable 5.2, Astra 6.2, Neon 4, Carbon 4\", harness \"Claude Code + Codex + Antigravity\" (self-reported CLI telemetry)",
  });
  assert.equal(agentOf("The Council", "pi", "run #1"), undefined, "a name that is no model is no attribution, whatever the harness");
  assert.equal(agentOf(null, "Claude Code", "run #1"), undefined, "a harness alone names no model");
  assert.equal(agentOf("", "Codex CLI", "run #1"), undefined);
  assert.equal(agentOf("<synthetic>", "Claude Code", "run #1"), undefined);
  assert.equal(agentOf({ model: "GPT-6" }, "Codex", "run #1"), undefined, "only a string is read");
  const family = agentOf("doubao-agent", "custom loop", "run #2")!;
  assert.deepEqual([family.family, family.model, family.tool, family.confidence], ["bytedance", undefined, undefined, "medium"], "a family with no model is thinner evidence");
  assert.ok(!agentOf("GPT-6 \"><script>", "Codex", "run #3")!.evidence!.includes("<"), "the reported text is quoted back as data");
});

test("one track per pillar: each author's best verified run, the board's leader on top, a baseline row for the unmodified proof", () => {
  const c = boardToCompetition(board(), NOW);
  assert.deepEqual(c.problems.map((p) => p.id), ["core1", "core6", "core2", "core15", "main", "core7"], "the board's order; a bad key or a pillar with no title is dropped");
  const [core1, core6, core2, core15, main, core7] = c.problems;
  assert.equal(core1.name, "Core 1: ζ(s) Zero-Free Region");
  assert.equal(main.name, "Grand Challenge: Full Riemann Hypothesis");
  assert.equal(core1.metricName, "score");
  assert.equal(core1.metricDirection, "maximize");
  assert.equal(core1.baseline, 50);
  assert.match(core1.description!, /^Unconditional core theorem: prove an absolute constant c > 0 exists/);
  assert.match(core1.description!, /The original proof: 21,641 normalized tokens \(74,010 chars\)\. Ranked by the board's score, higher is better: it rises as the proof gets shorter in normalized Lean tokens and the unmodified proof scores 50; a run counts only with 0 sorry and the standard axioms\. 267 verified runs \(54 breakthroughs\) by 68 contributors, 313 submitted on the board\.$/);

  assert.deepEqual(core1.records.map((r) => [r.contributor, r.value, r.date ?? null, !!r.isCurrentBest, !!r.isBaseline]), [
    ["Mikko Nyman", 70.04, "2026-11-23", true, false],
    ["Andrew Pullin", 69.36, "2026-11-23", false, false],
    ["justwingdong", 68.74, "2026-11-23", false, false],
    ["Early Bird", 66.5, null, false, false],
    ["Renxiu Song", 60, "2026-11-25", false, false],
    ["Kexiang Mao", 59, "2026-11-25", false, false],
    ["doubao fan", 58, "2026-11-25", false, false],
    ["img src=x onerror=alert(1)>", 57, "2026-11-25", false, false],
    ["mail me: someone@…", 56, "2026-11-25", false, false],
    ["Future Clock", 55, null, false, false],
    ["Slower Proof", 49.97, "2026-11-25", false, false],
    ["original proof (unmodified)", 50, null, false, true],
  ]);
  const [mikko, pullin, deepseek, early] = core1.records;
  assert.equal(mikko.description, "Borel–Carathéodory + DSlope + grind automation · 993 normalized tokens (−95.41% vs the original 21,641) · 7,104 chars · a breakthrough: it beat the pillar's best score when verified · best of 2 verified runs by this author here · run #101470",
    "the repeated id is the same run, not a third one");
  assert.equal(mikko.contributorKind, "person");
  assert.equal(mikko.contributorUrl, CORE1_URL, "the pillar's page, never a guessed GitHub profile");
  assert.equal(mikko.agent!.model, "Claude Fable 5.2");
  assert.equal(pullin.agent, undefined, "\"The Council\" names no model");
  assert.equal(deepseek.agent!.family, "deepseek");
  assert.equal(early.description, "2,100 normalized tokens (−90.3% vs the original 21,641) · 9,000 chars · listed among the pillar's top submissions · run #90001");
  assert.match(early.agent!.evidence!, /^riemann\.verifytask\.cn top submission #90001: model "Claude Opus 5\.5"/);
  assert.equal(core1.records.find((r) => r.contributor === "Renxiu Song")!.agent!.model, "GPT-6.2 Astra");
  assert.equal(core1.records.find((r) => r.contributor === "Kexiang Mao")!.agent, undefined);
  assert.equal(core1.records.find((r) => r.contributor === "mail me: someone@…")!.agent!.family, "alibaba");
  assert.match(core1.records.find((r) => r.contributor === "Slower Proof")!.description!, /^21,695 normalized tokens \(the original has 21,641\)/);
  assert.equal(core1.records.at(-1)!.description, "the proof as published: 21,641 normalized tokens, 74,010 chars · an unmodified proof scores 50 on the board (2 reference runs of exactly the original's size)");

  // the hub's run of the unmodified pillar is the baseline row, not osgood's entry
  assert.deepEqual(core6.records.map((r) => [r.contributor, r.value, !!r.isBaseline]), [["Andrew Pullin", 70.21, false], ["original proof (unmodified)", 50, true]]);
  assert.equal(core6.records[1].description, "the proof as published: 951,787 normalized tokens, 3,318,710 chars · baseline verified here by run #99120 (2026-11-22), score 50");
  assert.match(core6.records[0].description!, /best of 2 verified runs by this author here/);
  // the board's own "Baseline verified (L₀)" label marks a reproduction a few tokens off as a reference too; the scale stays the exact runs'
  assert.deepEqual(core2.records.map((r) => [r.contributor, r.value, !!r.isBaseline]), [["肖雨航", 58.61, false], ["original proof (unmodified)", 50, true]]);
  assert.match(core2.records[1].description!, /baseline verified here by run #94317 \(2026-11-21\), score 49\.98$/);
  assert.match(core2.records[0].description!, /this author's only verified run here/);

  assert.deepEqual(core15.records.map((r) => [r.contributor, r.value, !!r.isBaseline]), [["original proof (unmodified)", 50, true]]);
  assert.match(core15.description!, /No verified run has shortened it yet\.$/);
  // the Grand Challenge is scored on characters, and its only scored submission is the unmodified proof
  assert.equal(main.records.length, 1);
  assert.equal(main.records[0].description, "the proof as published: 980,408,459 chars · baseline verified here by run #93193, score 50");
  assert.match(main.description!, /The original proof: 980,408,459 chars\. Ranked by the board's score, higher is better: it rises as the proof gets shorter in characters/);
  assert.equal(core7.records.length, 1);
  assert.ok(c.problems.flatMap((p) => p.records).every((r) => !r.contributorUrl || r.contributorUrl === BOARD || r.contributorUrl.startsWith("https://play.bohrium.com/challenges/")));
});

test("the competition survives postprocess under the repository's id; entries, people and agents are counted the site's way", (t) => {
  t.mock.method(console, "log", () => {});
  const built = boardToCompetition(board(), NOW);
  assert.equal(built.url, "https://github.com/Osgood001/riemann-hypothesis", "src/pulse.ts finds this board by its repository URL");
  assert.equal(built.host, "website");
  assert.equal(built.status, "active");
  assert.equal(built.participation.compute, "cpu");
  assert.match(built.description, /1,688 verified runs and 612 breakthroughs from 98 contributors \(2,391 submissions in all\) so far; 42 of 48 core pillars have a verified run, and their best proofs are 33\.48% shorter in normalized tokens than the originals\./);
  assert.ok(built.links.some((l) => l.url === BOARD) && built.links.some((l) => l.url === BOARD_API));

  const prev = postprocess(boardToCompetition(board(), NOW), repo);
  assert.equal(prev.id, PREV_ID, "with no saved entry the id comes from the repository, the same as the listed one");
  const c = postprocess(built, repo, { ...prev, id: PREV_ID });
  assert.equal(c.id, PREV_ID);
  assert.deepEqual(c.problems.filter((p) => p.isOpen).map((p) => p.id), ["core15", "main", "core7"], "open pillars lead: no verified run on them yet");
  assert.equal(c.problems.find((p) => p.id === "core1")!.contested, true);
  const rows = c.problems.flatMap((p) => p.records);
  assert.ok(rows.every((r) => !r.contributorUrl?.startsWith("https://github.com/")), "a Bohrium display name never gets a guessed GitHub profile");
  assert.ok(!c.participants.some((p) => /original proof|osgood/.test(p.name)), "the reference runs are not anyone's entries");
  assert.equal(rows.filter((r) => !r.isBaseline).length, 13, "one row per author per pillar");
  assert.equal(c.participants.length, 12, "Andrew Pullin is on two pillars");
  assert.equal(rows.filter(isEntry).length, 11, "the entries the counts use are the dated rows: a top submission alone and a future time have no date");
  assert.equal(c.stats.recordsLast30d, rows.filter((r) => isEntry(r) && Date.parse(r.date!) > Date.now() - 30 * 86_400_000).length);
  assert.ok(rows.filter((r) => r.agent).every((r) => r.agent!.role === "author"));
  assert.deepEqual(c.agentStats.map((a) => a.family).sort(), ["alibaba", "anthropic", "bytedance", "deepseek", "openai"]);
  assert.equal(c.agentStats.find((a) => a.family === "anthropic")!.currentBests, 1, "Mikko Nyman's Fable 5.2 run leads a contested pillar");
  const { profiles } = buildProfiles([c]);
  assert.ok(profiles.length && profiles.every((p) => p.slug.startsWith("name--")), "names on this board are its own, never a GitHub account");
});

test("buildRiemannHub reads the board once with its user agent, retries once, and fails with a generic error", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls: { url: string; ua: string | null }[] = [];
  let fail = 1;
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, ua: new Headers(init?.headers).get("user-agent") });
    if (fail-- > 0) return new Response("SECRET upstream", { status: 503 });
    return Response.json(board());
  });
  const built = await buildRiemannHub();
  assert.deepEqual(calls.map((c) => c.url), [BOARD_API, BOARD_API]);
  assert.ok(calls.every((c) => c.ua === USER_AGENT));
  assert.equal(built.problems.length, 6);

  t.mock.method(globalThis, "fetch", async () => new Response("SECRET upstream", { status: 500 }));
  await assert.rejects(buildRiemannHub(), /^Error: Riemann board download failed$/);
  for (const bad of [{ challenges: [] , autoresearch: { overall_core: { runs: [] } } }, { challenges }, { autoresearch: { overall_core: { runs } } }, []]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(bad));
    await assert.rejects(buildRiemannHub(), /^Error: Riemann board download failed$/, JSON.stringify(bad).slice(0, 60));
  }
});

test("the baseline is the board's own scale: no uniform score for an unmodified proof, no baseline for a pillar it never ran", (t) => {
  t.mock.method(console, "log", () => {});
  const odd = runs.map((r) => (r.id === 99120 ? { ...r, score: 49.5 } : r));
  const c = boardToCompetition(board({ autoresearch: { overall_core: { total_runs: 10, kept_count: 3, runs: odd } } }), NOW);
  const byId = Object.fromEntries(c.problems.map((p) => [p.id, p]));
  assert.equal(byId.core6.baseline, 49.5, "a pillar's own run of exactly the original keeps its score");
  assert.equal(byId.main.baseline, 50);
  assert.equal(byId.core2.baseline, 49.98, "no scale: the pillar's baseline-verification run decides");
  assert.equal(byId.core1.baseline, undefined, "no scale and no run of its own: no baseline");
  assert.ok(!byId.core1.records.some((r) => r.isBaseline));
  assert.equal(c.status, "active");
  const stale = boardToCompetition(board(), Date.parse("2027-02-01T00:00:00Z"));
  assert.equal(stale.status, "unknown", "no run in 30 days: postprocess decides from the last entry");
});
