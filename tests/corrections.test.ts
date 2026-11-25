import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCorrections, validCorrections } from "../src/corrections.js";
import { openProblems } from "../src/aggregate.js";
import type { Competition } from "../src/types.js";

const comp = (id: string): Competition => ({
  id, name: id, tagline: "", description: "", url: "https://example.com", host: "website", status: "active", tags: [], domain: "other", images: [],
  participation: { requirements: [], compute: "cpu", deadline: "rolling" }, links: [], participants: [], agentStats: [], lastUpdated: "2026-11-25",
  stats: { totalRecords: 0, uniqueParticipants: 0, recordsLast30d: 0, recordsLast90d: 0 },
  problems: [{ id: "p", name: "P", metricName: "score", metricDirection: "maximize", isOpen: true, records: [] }],
});

test("corrections: only sourced, dated fixes to listed competitions are kept", () => {
  const ids = new Set(["a", "b"]);
  const raw = { corrections: [
    { id: "a", status: "ended", deadline: "closed 2026-08-31", source: "https://example.com/rules", checked: "2026-11-25" },
    { id: "ghost", status: "ended", source: "https://example.com", checked: "2026-11-25" },        // not listed
    { id: "b", status: "ended", source: "javascript:alert(1)", checked: "2026-11-25" },           // no https source
    { id: "b", status: "finished", source: "https://example.com", checked: "2026-11-25" },        // unknown status, no deadline
    { id: "b", status: "ended", source: "https://example.com", checked: "yesterday" },            // undated
  ] };
  assert.deepEqual(validCorrections(raw, ids).map((c) => c.id), ["a"]);
  assert.deepEqual(validCorrections(null, ids), []);
});

test("corrections: status and deadline are overridden, the source is linked, and closed tracks leave the open list", () => {
  const fixes = validCorrections({ corrections: [{ id: "a", status: "ended", deadline: "closed 2026-08-31", source: "https://example.com/rules", checked: "2026-11-25" }] }, new Set(["a", "b"]));
  const [a, b] = applyCorrections([comp("a"), comp("b")], fixes);
  assert.equal(a.status, "ended");
  assert.equal(a.participation.deadline, "closed 2026-08-31");
  assert.deepEqual(a.links.at(-1), { label: "Checked 2026-11-25: ended, closed 2026-08-31", url: "https://example.com/rules" });
  assert.equal(b.status, "active");
  assert.deepEqual(openProblems([a, b]).map((o) => o.competitionId), ["b"]);
});
