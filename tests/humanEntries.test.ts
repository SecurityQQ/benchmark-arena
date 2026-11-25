import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregatePeople, recentActivity } from "../src/aggregate.js";
import { postprocess } from "../src/postprocess.js";
import type { Competition, RecordEntry } from "../src/types.js";

const board = (records: RecordEntry[]): Competition => ({
  id: "noise", name: "Noise", tagline: "", description: "", url: "https://github.com/o/noise", host: "github", status: "active", tags: [], domain: "ml-research", images: [],
  participation: { requirements: [], compute: "datacenter-gpu" }, links: [], participants: [], agentStats: [], lastUpdated: "2026-11-25",
  stats: { totalRecords: records.length, uniqueParticipants: 1, recordsLast30d: 0, recordsLast90d: 0 },
  problems: [{ id: "t2", name: "Track 2", metricName: "time", metricDirection: "minimize", isOpen: false, records }],
});

test("a person's entry stays in the feeds even when the extraction tagged it as a benchmark subject", () => {
  const c = board([
    { value: 9.9, date: "2026-11-19", contributor: "conglu1997", contributorKind: "person", agent: { family: "human", confidence: "low", role: "subject" } },
    { value: 14.2, date: "2026-11-03", contributor: "GPT-9", contributorKind: "model", agent: { family: "openai", confidence: "high", role: "subject" } },
    { value: 15.9, date: "2026-11-01", contributor: "CharlesDDDD", contributorKind: "person", agent: { family: "anthropic", tool: "Claude Code", confidence: "high", role: "author" } },
  ]);
  const feed = recentActivity([c]);
  assert.deepEqual(feed.map((a) => a.contributor), ["conglu1997", "CharlesDDDD"], "the benchmarked model stays out");
  assert.equal(feed[0].agent, undefined, "no \"with Human\"");
  assert.equal(feed[1].agent?.tool, "Claude Code");
  assert.deepEqual(aggregatePeople([c]).map((p) => p.name).sort(), ["CharlesDDDD", "conglu1997"]);
});

test("postprocess never leaves a person as the benchmark subject", () => {
  const c = postprocess({
    name: "Noise", tagline: "t", description: "d", url: "https://github.com/o/noise", host: "github", status: "active", tags: [], domain: "ml-research",
    participation: { requirements: [], compute: "datacenter-gpu" }, links: [],
    problems: [{ id: "t2", name: "Track 2", metricName: "time", metricDirection: "minimize", records: [
      { value: 9.9, date: "2026-11-19", contributor: "conglu1997", contributorKind: "person", agent: { family: "human", confidence: "low", role: "subject" } },
    ] }],
  }, { owner: "o", name: "noise", url: "https://github.com/o/noise", stars: 1, topics: [], defaultBranch: "main" });
  assert.equal(c.problems[0].records[0].agent?.role, "author");
});
