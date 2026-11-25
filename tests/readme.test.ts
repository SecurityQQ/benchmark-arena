import assert from "node:assert/strict";
import { test } from "node:test";
import { END, START, openNowSection, withOpenNow } from "../src/readme.js";

const rec = (date: string, contributor: string, agent?: object) => ({ contributor, date, value: 1, agent, submissionUrls: [] });
const comp = (id: string, status: string, records: object[], tagline = "A board") => ({
  id, name: id.toUpperCase(), tagline, status, domain: "formal-methods", tags: [], url: "https://example.com",
  participation: { requirements: [], compute: "cpu" },
  problems: [{ id: "p", name: "P", isOpen: true, metricName: "score", records }],
  stats: { totalRecords: records.length, recordsLast30d: records.length, recordsLast90d: records.length, uniqueParticipants: 1 },
  agentStats: [], participants: [], links: [],
}) as any;

test("readme: ranks active boards by this month's entries, leaves ended ones out, links only to the site", () => {
  const data = { crawledAt: "2026-11-25T10:00:00Z", competitions: [
    comp("quiet", "active", []),
    comp("busy", "active", [rec("2026-11-20", "a", { family: "anthropic", tool: "Claude Code", role: "author" }), rec("2026-11-21", "b")]),
    comp("closed", "ended", [rec("2026-11-22", "c")]),
  ] };
  const s = openNowSection(data);
  assert.ok(s.startsWith(START) && s.endsWith(END));
  assert.ok(s.indexOf("[BUSY]") < s.indexOf("[QUIET]"));
  assert.ok(!s.includes("CLOSED"));
  assert.match(s, /2 active competitions, 2 open tracks, 2 entries in the last 30 days \(1 credited to an AI agent\)/);
  assert.match(s, /2 entries from 2 people in 30 days, 1 with AI agents \(Claude Code\)/);
  for (const [, url] of s.matchAll(/\]\((https?:[^)]+)\)/g)) assert.ok(url.startsWith("https://openchallengelist.com"), url);
});

test("readme: crawled text cannot break the table or add markup", () => {
  const s = openNowSection({ crawledAt: "2026-11-25T10:00:00Z", competitions: [comp("x", "active", [], "a | b [link](https://evil.example) <img src=x>\n`code`")] });
  const row = s.split("\n").find((l) => l.startsWith("| [X]"))!;
  assert.equal(row.split(/(?<!\\)\|/).length - 2, 5);
  assert.ok(!row.includes("evil.example") && !/(?<!\\)[<[]/.test(row.slice(row.indexOf(") |"))), row);
});

test("readme: replaces only what sits between the markers, and refuses a README without them", () => {
  const readme = `# T\n\nintro\n\n<!-- open-now:start -->\nold\n${END}\n\n## Run\n`;
  const out = withOpenNow(readme, `${START}\nnew\n${END}`);
  assert.equal(out, `# T\n\nintro\n\n${START}\nnew\n${END}\n\n## Run\n`);
  assert.equal(withOpenNow(out, `${START}\nnew\n${END}`), out);
  assert.throws(() => withOpenNow("# T\n", "x"));
});
