import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGpuMode, boardToProblem, toMicros, trackId, summarize } from "../src/structured/gpuMode.js";
import { postprocess } from "../src/postprocess.js";

const repo = { owner: "gpu-mode", name: "reference-kernels", url: "https://github.com/gpu-mode/reference-kernels", defaultBranch: "main", stars: 0, topics: [] };
const summaries = [
  { id: 776, name: "cholesky", deadline: "2026-07-30T00:00:00+00:00", gpu_types: ["B200"], priority_gpu_type: "B200", visibility: "public" },
  { id: 771, name: "princeton_cross_entropy", deadline: "2026-04-17T03:59:00+00:00", gpu_types: ["A100"], priority_gpu_type: "A100", visibility: "closed" },
  { id: 540, name: "matmul_v2", deadline: "2100-12-31T00:00:00+00:00", gpu_types: ["A100", "B200", "H100", "L4"], priority_gpu_type: "B200", visibility: "public" },
];
const boards: Record<number, unknown> = {
  776: { name: "cholesky", description: "Implement batched dense Cholesky factorization.\n\nMore text.", rankings: { B200: [
    { rank: 2, score: 0.00024067712131121827, user_name: "Frosty40", submission_time: "2026-07-20T10:00:00+00:00", submission_count: 3 },
    { rank: 1, score: 0.0002015311576338281, user_name: "zhongmingee", submission_time: "2026-07-28T22:00:09.602599+00:00", submission_count: 28, validation_status: "completed", validation_shapes_passed: 8, validation_shapes_total: 8 },
  ] } },
  771: { name: "princeton_cross_entropy", description: "Cross entropy.", rankings: { A100: [{ rank: 1, score: 1.1264000087976463e-05, user_name: "fs9084", submission_time: "2026-04-01T00:00:00+00:00" }] } },
  540: { name: "matmul_v2", description: "", rankings: { B200: [], A100: [{ rank: 1, score: 1, user_name: "other-gpu" }] } },
};

function mockSite(t: any, override?: (url: string) => Response | undefined) {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const o = override?.(url); if (o) return o;
    if (url.endsWith("/api/leaderboard-summaries")) return Response.json({ code: 0, data: { leaderboards: summaries } });
    const m = url.match(/\/api\/leaderboard\/(\d+)$/);
    if (m && boards[+m[1]]) return Response.json({ code: 0, data: boards[+m[1]] });
    return new Response("not found", { status: 404 });
  });
  return calls;
}

test("helpers: ids, units and summaries", () => {
  assert.equal(trackId("gated_deltanet_chunk_fwd_o"), "gated-deltanet-chunk-fwd-o");
  assert.equal(trackId("amd-mxfp4-mm"), "amd-mxfp4-mm");
  assert.equal(toMicros(0.0002015311576338281), 201.531);
  assert.equal(toMicros(1.1264000087976463e-05), 11.264);
  assert.equal(summarize("\n## Title\n\nFirst para\nwraps.\n\nSecond."), "First para wraps.");
  assert.ok(summarize("x ".repeat(400), 50).length <= 50);
});

test("a leaderboard becomes one track ranked on its priority GPU, closed boards included", () => {
  const now = Date.parse("2026-09-28T00:00:00Z");
  const p = boardToProblem(summaries[0], boards[776] as any, now);
  assert.equal(p.id, "cholesky");
  assert.equal(p.group, "B200");
  assert.equal(p.metricDirection, "minimize");
  assert.equal(p.metricUnit, "µs");
  assert.deepEqual(p.records.map((r) => r.contributor), ["zhongmingee", "Frosty40"]);
  assert.equal(p.records[0].isCurrentBest, true);
  assert.equal(p.records[0].date, "2026-07-28");
  assert.equal(p.records[0].contributorUrl, "https://www.gpumode.com/leaderboard/776");
  assert.match(p.records[0].description!, /re-validated 8\/8 shapes/);
  assert.equal(p.records[0].agent, undefined);
  assert.match(p.description!, /Closed 2026-07-30/);

  const closed = boardToProblem(summaries[1], boards[771] as any, now);
  assert.equal(closed.records.length, 1);
  assert.match(closed.description!, /no longer accepted/);

  const empty = boardToProblem(summaries[2], boards[540] as any, now);
  assert.equal(empty.records.length, 0, "rows from non-priority GPUs are not mixed in");
  assert.equal(empty.isOpen, true);
  assert.match(empty.description!, /Open-ended/);
});

test("buildGpuMode assembles every leaderboard and survives postprocess without GitHub URL guesses", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = mockSite(t);
  const built = await buildGpuMode();
  assert.equal(built.host, "website");
  assert.deepEqual(built.problems.map((p) => p.id), ["cholesky", "princeton-cross-entropy", "matmul-v2"]);
  assert.equal(calls.filter((u) => /\/api\/leaderboard\/\d+$/.test(u)).length, 3);
  const c = postprocess(built, repo);
  const urls = c.problems.flatMap((p) => p.records.map((r) => r.contributorUrl));
  assert.ok(urls.every((u) => u?.startsWith("https://www.gpumode.com/leaderboard/")));
  assert.equal(c.stats.totalRecords, 3);
  assert.deepEqual(c.agentStats, []);
});

test("buildGpuMode retries once, then fails with a generic error", async (t) => {
  t.mock.method(console, "log", () => {});
  let failures = 0;
  mockSite(t, (url) => url.endsWith("/api/leaderboard/771") && failures++ < 1 ? new Response("SECRET", { status: 503 }) : undefined);
  const built = await buildGpuMode();
  assert.equal(built.problems.length, 3);

  mockSite(t, (url) => url.endsWith("/api/leaderboard-summaries") ? new Response("SECRET upstream", { status: 500 }) : undefined);
  await assert.rejects(buildGpuMode(), /^Error: GPU MODE download failed$/);
});
