import assert from "node:assert/strict";
import { test } from "node:test";
import { withEntryCounts } from "../src/aggregate.js";
import { loadPublished } from "../src/build.js";
import { boardsView } from "../src/prerender.js";
import type { Competition, RecordEntry } from "../src/types.js";

const board = (records: RecordEntry[]): Competition => ({
  id: "b", name: "B", tagline: "", description: "", url: "https://github.com/o/b", host: "github", status: "active", tags: [], domain: "ml-research", images: [],
  participation: { requirements: [], compute: "cpu" }, links: [], participants: [], agentStats: [], lastUpdated: "2026-11-25",
  stats: { totalRecords: records.length, uniqueParticipants: 1, recordsLast30d: 99, recordsLast90d: 99 },
  problems: [{ id: "p", name: "P", metricName: "score", metricDirection: "maximize", isOpen: true, records }],
});

test("30/90-day counts are entries as of the crawl: no baselines, no benchmarked models, no method rows", () => {
  const [c] = withEntryCounts([board([
    { value: 1, date: "2026-11-24", contributor: "AMD", isBaseline: true },
    { value: 2, date: "2026-11-23", contributor: "GPT-9", contributorKind: "model", agent: { family: "openai", confidence: "high", role: "subject" } },
    { value: 3, date: "2026-11-22", contributor: "greedy search", contributorKind: "method" },
    { value: 4, date: "2026-11-20", contributor: "alice" },
    { value: 5, date: "2026-10-26", contributor: "bob" }, // exactly 30 days before the crawl day: in
    { value: 6, date: "2026-09-01", contributor: "carol" },
    { value: 7, date: "2026-07-01", contributor: "dave" },
    { value: 8, contributor: "undated" },
  ])], "2026-11-25T12:00:00Z");
  assert.equal(c.stats.recordsLast30d, 2);
  assert.equal(c.stats.recordsLast90d, 3);
  assert.equal(c.stats.totalRecords, 8, "other stats are left alone");
});

test("every surface reads the same 30-day count: index.json, MCP and join.txt agree with the pages", () => {
  const data = loadPublished(process.cwd());
  const v = boardsView(data.competitions, data.crawledAt);
  for (const c of data.competitions) assert.equal(c.stats.recordsLast30d, v.months.get(c.id)!.entries, c.id);
});
