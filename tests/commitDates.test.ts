import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { datePinnedRecords, loadCommitDates, pinnedSha, saveCommitDates, type CommitLookup } from "../src/commitDates.js";
import { datePinned } from "../src/main.js";
import { postprocess } from "../src/postprocess.js";
import type { RecordEntry } from "../src/types.js";

const SHA = "de9732b9882fdc21ff9be566f6f577f37be500a1";
const OTHER = "8be79219cf53d409060261477cf54ce8f1a03a28";
const noise = { owner: "qlabs-eng", name: "noise" };

function ctx(dates: Record<string, string | null>, budget = 200, cache: Record<string, string | null> = {}) {
  const asked: string[] = [];
  const lookup: CommitLookup = async (_o, _n, sha) => {
    asked.push(sha);
    if (!(sha in dates)) throw new Error("rate limited");
    return dates[sha];
  };
  const dir = mkdtempSync(join(tmpdir(), "commit-dates-"));
  writeFileSync(join(dir, "c.json"), JSON.stringify(cache));
  const d = loadCommitDates(join(dir, "c.json"), lookup, budget);
  rmSync(dir, { recursive: true, force: true });
  return { d, asked };
}

test("only a full SHA pinned in the competition's own repository counts", () => {
  assert.equal(pinnedSha(`https://github.com/qlabs-eng/noise/blob/${SHA}/train/speedrun/run.py`, noise), SHA);
  assert.equal(pinnedSha(`https://github.com/QLabs-Eng/Noise/tree/${SHA.toUpperCase()}`, noise), SHA);
  assert.equal(pinnedSha(`https://github.com/qlabs-eng/noise/commit/${SHA}#diff`, noise), SHA);
  assert.equal(pinnedSha(`https://github.com/someone/noise/blob/${SHA}/run.py`, noise), null);          // a fork or another repo
  assert.equal(pinnedSha(`https://github.com/qlabs-eng/noise-2/blob/${SHA}/run.py`, noise), null);
  assert.equal(pinnedSha(`https://github.com/qlabs-eng/noise/blob/main/train/run.py`, noise), null);    // a branch moves
  assert.equal(pinnedSha(`https://github.com/qlabs-eng/noise/blob/${SHA.slice(0, 12)}/run.py`, noise), null); // short SHA
  assert.equal(pinnedSha(`https://github.com/qlabs-eng/noise/blob/${SHA}0/run.py`, noise), null);       // 41 hex is not a SHA
  assert.equal(pinnedSha(`https://raw.githubusercontent.com/qlabs-eng/noise/${SHA}/run.py`, noise), null);
  assert.equal(pinnedSha(`https://github.com/qlabs-eng/noise/pull/12/commits/${SHA}`, noise), null);
});

test("undated records get the pinned commit's day; dated ones, other repos and unknown commits get nothing", async () => {
  const records: RecordEntry[] = [
    { value: 9.9, submissionUrls: [`https://github.com/qlabs-eng/noise/blob/${SHA}/train/speedrun/run.py`] },
    { value: 12, date: "2026-01-01", submissionUrls: [`https://github.com/qlabs-eng/noise/blob/${SHA}/run.py`] },
    { value: 13, submissionUrls: [`https://github.com/other/repo/blob/${OTHER}/run.py`] },
    { value: 14, submissionUrls: [`https://github.com/qlabs-eng/noise/blob/${OTHER}/run.py`] },
    { value: 15, submissionUrls: ["https://github.com/qlabs-eng/noise/blob/main/run.py"] },
  ];
  const { d, asked } = ctx({ [SHA]: "2026-11-19", [OTHER]: null });
  assert.equal(await datePinnedRecords([{ records }], noise, d), 1);
  assert.deepEqual(records.map((r) => r.date), ["2026-11-19", "2026-01-01", undefined, undefined, undefined]);
  assert.deepEqual(asked, [SHA, OTHER]);
  assert.deepEqual(d.cache, { [SHA]: "2026-11-19", [OTHER]: null }); // "no such commit" is remembered, not asked again
});

test("a cached SHA costs no API call; a transient failure is not cached; the per-run cap defers the rest", async () => {
  const rec = (sha: string): RecordEntry => ({ value: 1, submissionUrls: [`https://github.com/qlabs-eng/noise/blob/${sha}/run.py`] });
  const cached = ctx({}, 200, { [SHA]: "2026-11-19" });
  const a = rec(SHA);
  await datePinnedRecords([{ records: [a] }], noise, cached.d);
  assert.equal(a.date, "2026-11-19");
  assert.deepEqual(cached.asked, []);
  assert.equal(cached.d.dirty, false);

  const flaky = ctx({});
  const b = rec(OTHER);
  await datePinnedRecords([{ records: [b] }], noise, flaky.d);
  assert.equal(b.date, undefined);
  assert.equal(Object.hasOwn(flaky.d.cache, OTHER), false);

  const capped = ctx({ [SHA]: "2026-11-19", [OTHER]: "2026-11-03" }, 1);
  const recs = [rec(SHA), rec(OTHER)];
  await datePinnedRecords([{ records: recs }], noise, capped.d);
  assert.deepEqual(recs.map((r) => r.date), ["2026-11-19", undefined]);
  assert.deepEqual([...capped.d.deferred], [OTHER]);
});

test("the cache file keeps only well-formed rows and is written sorted, only when it changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "commit-dates-"));
  const path = join(dir, "c.json");
  writeFileSync(path, JSON.stringify({ [OTHER]: "2026-11-03", [SHA]: "2026-02-30", short: "2026-01-01", ["f".repeat(40)]: "<script>" }));
  const d = loadCommitDates(path, async () => null);
  assert.deepEqual(d.cache, { [OTHER]: "2026-11-03" });
  saveCommitDates(d, path);
  assert.match(readFileSync(path, "utf-8"), /2026-02-30/); // untouched: nothing new
  d.cache[SHA] = "2026-11-19"; d.dirty = true;
  saveCommitDates(d, path);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, "utf-8"))), [OTHER, SHA]);
  rmSync(dir, { recursive: true, force: true });
});

test("dating a saved entry recomputes its stats", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const source = { owner: "qlabs-eng", name: "noise", url: "https://github.com/qlabs-eng/noise", defaultBranch: "main", stars: 0, topics: [] };
  const saved = postprocess({
    name: "Noise", url: source.url, status: "unknown", participation: { requirements: [], compute: "datacenter-gpu" }, links: [],
    problems: [{ id: "speedrun", name: "Speedrun", metricName: "time", metricDirection: "minimize", records: [
      { value: 9.9, contributor: "conglu1997", submissionUrls: [`https://github.com/qlabs-eng/noise/blob/${SHA}/train/speedrun/run.py`] },
      { value: 22.9, contributor: "RobertTLange", submissionUrls: ["https://github.com/qlabs-eng/noise/blob/main/train/speedrun/run.py"] },
    ] }],
  }, source);
  assert.equal(saved.stats.recordsLast30d, 0);
  assert.equal(saved.stats.lastSubmission, undefined);
  assert.equal(saved.status, "unknown");
  const structured = { ...saved, id: "gpu", repo: { owner: "gpu-mode", name: "reference-kernels", branch: "main" } };
  const { d } = ctx({ [SHA]: today });
  const [dated, untouched] = await datePinned([saved, structured], d);
  assert.equal(dated.problems[0].records.find((r) => r.value === 9.9)!.date, today);
  assert.equal(dated.stats.recordsLast30d, 1);
  assert.equal(dated.stats.lastSubmission, today);
  assert.equal(dated.status, "active");
  assert.equal(dated.participants.find((p) => p.name === "conglu1997")!.lastActive, today);
  assert.equal(dated.id, saved.id);
  assert.equal(untouched, structured); // a structured board is never touched
});
