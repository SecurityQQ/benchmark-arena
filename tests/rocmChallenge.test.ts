import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRocmChallenge, isNoop, modelOf, problemToTrack, str, USER_AGENT, type RocmBoard, type RocmProblem } from "../src/structured/rocmChallenge.js";
import { postprocess } from "../src/postprocess.js";
import { validateCompetition } from "../src/validation.js";

const repo = { owner: "Kaihui-AMD", name: "modelbot-cli", url: "https://github.com/Kaihui-AMD/modelbot-cli", defaultBranch: "main", stars: 2, topics: [] };

// ─── Trimmed copies of https://rocm-challenge.amddev.ai/problems and /leaderboard/{name} (2026-11-25) ───
const statement = (model: string, verb = "run") => `Make the llama.cpp/ggml ROCm (HIP) backend ${verb} ${model} faster than the
Vulkan backend on an AMD Radeon PRO W7900D (gfx1100), without changing the model,
quantization, benchmark parameters or computational semantics.

Submit one unified diff against llama.cpp commit
aa39d7a3e145a88202793a89462d65e94a5fc25f that only touches files under \`ggml/\` and
\`src/\`.

Gates, in order (the first failure ends the evaluation):
4. Performance: ... A submission is qualified when every item is faster than its Vulkan baseline.`;
const spec = (name: string, model: string, benches: [string, number][], over: Partial<RocmProblem> = {}): RocmProblem => ({
  name, version: "2026-11-19.1", ref: `${name}@2026-11-19.1`, deadline: "2026-12-31T23:59:00+00:00", accepting: true, description: statement(model),
  base: { repo: "https://github.com/ggml-org/llama.cpp", commit: "aa39d7a3e145a88202793a89462d65e94a5fc25f" },
  image: "modelbot-eval:rocm10.1-20261119@sha256:2641d0f412af5b135de8b1f8076c3949f8c788cd123bcf3f78c4ad45ca7aa8dd",
  allowed_paths: ["ggml/", "src/"], max_patch_bytes: 1048576, gpu_type: "W7900D",
  tests: [{ name: "fa0_c32768" }, { name: "fa1_ub128" }, { name: "fa1_ub256" }], accuracy: { mode: "two_sided", tolerance: 0.05, chunk_fraction: 0.3 },
  benchmarks: benches.map(([n, v], i) => ({ name: n, case: i < 3 ? 1 : 2, vulkan_avg_ts: v })),
  score: { better: "higher", method: "geomean_ratio_to_baseline", metric: "avg_ts" },
  ...over,
} as RocmProblem);
const P1 = spec("llamacpp-navi3-p1", "Qwen3.8-27B Q4_K_M", [["tg128-d2048-fa0", 34.21], ["tg128-d8192-fa0", 32.27], ["tg128-d32768-fa0", 26.62], ["pp4096-ub128-fa1", 637.43], ["pp4096-ub256-fa1", 687.88]]);
const P3 = spec("llamacpp-navi3-p3", "Kimi-Linear-48B-A3B-Instruct IQ4_XS", [["tg128-fa1", 136.93], ["tg128-d2048-fa1", 133.39]], { description: statement("Kimi-Linear-48B-A3B-Instruct IQ4_XS", "decode") });

const items = (ratios: number[], names = P1.benchmarks!.map((b) => b.name!)) => ratios.map((ratio, i) => ({ name: names[i], value: ratio * 30, baseline: 30, ratio, passed: ratio > 1 }));
const row = (rank: number, user: string, score: number, ratios: number[], over: object = {}) => ({
  rank, user, submission_id: 100 + rank, file_name: "flash.patch", submitted_at: `2026-11-2${rank % 5}T03:00:00.000000+00:00`, score, cv: 0.0051, items: items(ratios), ...over,
});
const noop = (rank: number, user: string, score: number, day: string) => row(rank, user, score, [0.886, 0.831, 0.674, 0.835, 1.094], { file_name: "noop.patch", submitted_at: `${day}T02:42:29.589598+00:00` });

const B1: RocmBoard = {
  problem: "llamacpp-navi3-p1", version: "2026-11-19.1",
  qualified: [row(1, "fast-dev", 1.0712, [1.02, 1.05, 1.11, 1.08, 1.10])],
  accuracy_passed: [
    row(1, "geomean-high", 1.0301, [1.20, 1.15, 0.97, 0.90, 1.01]), // geomean past 1, two items slower: not qualified
    noop(2, "danielwang730", 0.85352, "2026-11-24"),
    noop(3, "chejh-amd", 0.853115, "2026-11-23"),
    row(4, "slow-dev", 0.8401, [0.9, 0.8, 0.7, 0.8, 1.05]),
    noop(5, "AIwork4me", 0.816139, "2026-11-24"),
    row(6, "fast-dev", 0.5, [0.5, 0.5, 0.5, 0.5, 0.5]),               // a repeat of a qualified user is not a second entry
  ],
};
const B3: RocmBoard = { problem: "llamacpp-navi3-p3", version: "2026-11-19.1", qualified: [], accuracy_passed: [{ ...noop(1, "Kaihui-AMD", 0.769493, "2026-11-19"), items: items([0.710473, 0.737768], ["tg128-fa1", "tg128-d2048-fa1"]) }] };

function mockSite(t: any, override?: (url: string) => Response | undefined) {
  const calls: { url: string; ua: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, ua: new Headers(init?.headers).get("user-agent") });
    const o = override?.(url); if (o) return o;
    if (url === "https://rocm-challenge.amddev.ai/problems") return Response.json([P1, P3]);
    if (url === "https://rocm-challenge.amddev.ai/leaderboard/llamacpp-navi3-p1") return Response.json(B1);
    if (url === "https://rocm-challenge.amddev.ai/leaderboard/llamacpp-navi3-p3") return Response.json(B3);
    return new Response("not found", { status: 404 });
  });
  return calls;
}

test("helpers: noop patches, the model in the statement, untrusted text", () => {
  assert.ok(isNoop("noop.patch") && isNoop("NOOP.diff") && isNoop("no-op.patch"));
  assert.ok(!isNoop("noop-fa.patch") && !isNoop("my.patch") && !isNoop(undefined));
  assert.equal(modelOf(P1.description), "Qwen3.8-27B Q4_K_M");
  assert.equal(modelOf(P3.description), "Kimi-Linear-48B-A3B-Instruct IQ4_XS");
  assert.equal(modelOf("Something else entirely."), undefined);
  assert.equal(str("a\u202e<b>evil</b>\n\tz", 40), "a bevil/b z");
  assert.ok(str("x".repeat(100), 10)!.length <= 10);
  assert.equal(str(42, 10), undefined);
});

test("a problem becomes one track: qualified entries first, noop.patch runs folded into one baseline row", () => {
  const t = problemToTrack(P1, B1, Date.parse("2026-11-25T00:00:00Z"));
  assert.equal(t.id, "llamacpp-navi3-p1");
  assert.equal(t.name, "llamacpp-navi3-p1 · Qwen3.8-27B Q4_K_M");
  assert.equal(t.metricDirection, "maximize");
  assert.equal(t.passMark, 1);
  assert.deepEqual(t.records.map((r) => r.contributor), ["fast-dev", "geomean-high", "slow-dev", "unmodified build (noop.patch)"]);

  const [fast, high, slow, base] = t.records;
  assert.equal(fast.isCurrentBest, true);
  assert.equal(fast.passed, true);
  assert.equal(fast.value, 1.0712);
  assert.equal(fast.contributorUrl, "https://github.com/fast-dev");
  assert.equal(fast.agent, undefined);
  assert.match(fast.description!, /^qualified \(rank 1\) · faster than Vulkan on all 5 items · mean cv 0.0051 · submission #101$/);
  assert.equal(high.passed, false);
  assert.equal(high.isCurrentBest, false);
  assert.match(high.description!, /accuracy passed \(rank 1\) · faster than Vulkan on 3 of 5 items; slower on tg128-d32768-fa0, pp4096-ub128-fa1/);
  assert.equal(slow.date, "2026-11-24");

  assert.equal(base.isBaseline, true);
  assert.equal(base.contributorKind, "method");
  assert.equal(base.date, undefined, "the baseline is not an entry with a date");
  assert.equal(base.value, 0.8531); // median of 0.85352, 0.853115, 0.816139
  assert.equal(t.baseline, 0.8531);
  assert.match(base.description!, /median of 3 noop\.patch runs by 3 accounts \(2026-11-23 to 2026-11-24\) · range 0\.8161–0\.8535 · per item, ROCm ÷ Vulkan: tg128-d2048-fa0 ×0\.886/);
  assert.deepEqual(base.submissionUrls, ["https://github.com/Kaihui-AMD/modelbot-cli/blob/main/examples/noop.patch"]);

  assert.match(t.description!, /^Make the llama\.cpp\/ggml ROCm \(HIP\) backend run Qwen3\.8-27B Q4_K_M faster than the Vulkan backend/);
  assert.match(t.description!, /geometric mean over 5 llama-bench items .*tg128-d2048-fa0 34\.21 t\/s/);
  assert.match(t.description!, /stricter than a geometric mean of 1 or more: the track stays open until an entry qualifies/);
  assert.match(t.description!, /llama\.cpp aa39d7a3 and touches only ggml\/ and src\/, builds for ROCm, and 3 llama-perplexity runs on wikitext-2 stay within 5% of the unmodified build/);
  assert.match(t.description!, /AMD Radeon PRO W7900D \(gfx1100 \/ RDNA3\) with ROCm 10\.1, problem version 2026-11-19\.1\. Deadline 2026-12-31 23:59 UTC\.$/);

  const late = problemToTrack(P1, { problem: P1.name }, Date.parse("2027-01-02T00:00:00Z"));
  assert.match(late.description!, /Submissions closed\.$/);
  assert.equal(late.records.length, 0);
  assert.equal(late.baseline, undefined);
});

test("open means nobody qualified: a geometric mean past 1 that is slower on one item keeps the track open", () => {
  const now = Date.parse("2026-11-25T00:00:00Z");
  const onlyHigh = { ...B1, qualified: [] };
  const c = postprocess({ name: "ROCm", problems: [problemToTrack(P1, onlyHigh, now), problemToTrack(P1, B1, now), problemToTrack(P3, B3, now)].map((t, i) => ({ ...t, id: `t${i}` })) }, repo);
  const [high, qualified, baselineOnly] = c.problems.sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(high.records.find((r) => r.isCurrentBest)!.value, 1.0301);
  assert.equal(high.isOpen, true, "1.0301 ≥ the pass mark, but the site did not qualify it");
  assert.equal(qualified.isOpen, false);
  assert.equal(qualified.contested, true);
  assert.equal(baselineOnly.isOpen, true);
  assert.equal(baselineOnly.contested, false);
  assert.deepEqual(baselineOnly.records.map((r) => [r.contributor, r.isBaseline, r.isCurrentBest]), [["unmodified build (noop.patch)", true, true]]);
  // the baseline is not a participant, not a model being benchmarked, and its name gets no GitHub profile
  assert.ok(!c.participants.some((p) => p.name.startsWith("unmodified")));
  assert.equal(baselineOnly.records[0].contributorUrl, undefined);
  assert.ok(c.problems.every((p) => p.records.every((r) => r.agent === undefined)));
  assert.deepEqual(c.agentStats, []);
  // the verdict survives a reload of the saved data
  const again = validateCompetition(JSON.parse(JSON.stringify(c)), repo);
  assert.deepEqual(again.problems.find((p) => p.id === high.id)!.records.map((r) => r.passed), [false, false, false, undefined]);
});

test("buildRocmChallenge reads the problems and each board, and survives postprocess", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = mockSite(t);
  const built = await buildRocmChallenge();
  assert.deepEqual(calls.map((c) => c.url), [
    "https://rocm-challenge.amddev.ai/problems",
    "https://rocm-challenge.amddev.ai/leaderboard/llamacpp-navi3-p1",
    "https://rocm-challenge.amddev.ai/leaderboard/llamacpp-navi3-p3",
  ]);
  assert.ok(calls.every((c) => c.ua === USER_AGENT));
  assert.equal(built.host, "website");
  assert.equal(built.status, "active");
  assert.equal(built.participation.compute, "none");
  assert.equal(built.participation.deadline, "2026-12-31 23:59 UTC");
  assert.match(built.participation.howToSubmit!, /modelbot submit my\.patch --problem <name>/);
  assert.match(built.participation.howToSubmit!, /20 per user per day/);
  assert.match(built.description, /3 contestant entries from 3 users, 1 qualified\. The unmodified build \(examples\/noop\.patch, which only adds a comment\) scores 0\.8531 on llamacpp-navi3-p1, 0\.7695 on llamacpp-navi3-p3/);
  assert.match(built.quickstart!, /git checkout aa39d7a3e145a88202793a89462d65e94a5fc25f/);
  const c = postprocess(built, repo);
  assert.deepEqual(c.problems.map((p) => [p.id, p.isOpen]), [["llamacpp-navi3-p3", true], ["llamacpp-navi3-p1", false]]); // open tracks lead
  assert.equal(c.stats.totalRecords, 5);
  assert.deepEqual(c.participants.map((p) => p.name).sort(), ["fast-dev", "geomean-high", "slow-dev"]);
  assert.deepEqual(c.agentStats, []);
});

test("buildRocmChallenge retries once, then fails with a generic error; a changed scoring rule or a mismatched board fails too", async (t) => {
  t.mock.method(console, "log", () => {});
  let failures = 0;
  mockSite(t, (url) => (url.endsWith("/leaderboard/llamacpp-navi3-p3") && failures++ < 1 ? new Response("SECRET", { status: 503 }) : undefined));
  assert.equal((await buildRocmChallenge()).problems.length, 2);

  mockSite(t, (url) => (url.endsWith("/problems") ? new Response("SECRET upstream", { status: 500 }) : undefined));
  await assert.rejects(buildRocmChallenge(), /^Error: ROCm challenge download failed$/);

  mockSite(t, (url) => (url.endsWith("/problems") ? Response.json([{ ...P1, score: { better: "lower", method: "geomean_ratio_to_baseline" } }]) : undefined));
  await assert.rejects(buildRocmChallenge(), /^Error: ROCm challenge download failed$/);

  mockSite(t, (url) => (url.endsWith("/leaderboard/llamacpp-navi3-p3") ? Response.json(B1) : undefined));
  await assert.rejects(buildRocmChallenge(), /^Error: ROCm challenge download failed$/);

  mockSite(t, (url) => (url.endsWith("/problems") ? Response.json([]) : undefined));
  await assert.rejects(buildRocmChallenge(), /^Error: ROCm challenge download failed$/);
});

test("third-party rows are bounded: bad scores and names are dropped, odd handles link to the site, markup is stripped", () => {
  const board: RocmBoard = { problem: P1.name, accuracy_passed: [
    row(1, "<img src=x onerror=alert(1)>", 0.9, [0.9, 0.9, 0.9, 0.9, 0.9]),
    row(2, "", 0.8, [0.8]),
    row(3, "nan-score", Number.NaN, [0.8]),
    { ...row(4, "bad-items", 0.7, []), items: [{ name: "../../etc", ratio: 2, passed: true }, { name: "ok-item", ratio: "1.5" }] },
    "not a row",
  ] as any };
  const t = problemToTrack(P1, board);
  assert.deepEqual(t.records.map((r) => r.contributor), ["img src=x onerror=alert(1)", "bad-items"]);
  assert.equal(t.records[0].contributorUrl, "https://rocm-challenge.amddev.ai/");
  assert.equal(t.records[1].contributorUrl, "https://github.com/bad-items");
  assert.doesNotMatch(t.records[1].description!, /etc|ok-item|items/);
});
