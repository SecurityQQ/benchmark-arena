import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchDiscoveries, fromEntry, refreshDiscoveries, validDiscoveries, type Discoveries, type GetJson } from "../src/discoveries.js";
import { pages, topicMarkdown } from "../src/prerender.js";
import { TOPICS } from "../src/topics.js";
import type { Competition } from "../src/types.js";

const NOW = Date.parse("2026-11-25T11:00:00Z"); // the window is 2026-11-19 … 2026-11-25
const API = "https://data.palomar-registry.org/api/v1/results?order=registered&from=2026-11-19";

// An entry as GET /api/v1/results lists it, abstract and all
const entry = (day: string, n: number, extra: Record<string, unknown> = {}) => ({
  id: `PALOMAR-${day}-${String(n).padStart(6, "0")}`, version: 1, title: `Result ${day} #${n}`,
  authors: [{ name: "Ada Lovelace" }], published_at: `${day}T0${n % 10}:00:00Z`, status: "registered",
  classification: { arxiv: ["math.CO", "math-ph"], msc2020: ["05A15"] }, source: { repository: "owner/repo", commit: "a".repeat(40) },
  trust: { level: "high" }, abstract: "A long abstract that is never kept", ...extra,
});
const page = (entries: unknown[], next: string | null) => ({ status: 200, body: { schema_version: 1, totals: { results: 1357, projects: 1032 }, entries, next, previous: null } });
const recorder = (answers: Awaited<ReturnType<GetJson>>[]) => {
  const urls: string[] = [];
  const get: GetJson = async (url) => { urls.push(url); const a = answers.shift(); if (!a) throw new Error("no more pages"); return a; };
  return { urls, get };
};

test("palomar: follows the cursor with the same filters and stops at the first entry older than 7 days", async () => {
  const { urls, get } = recorder([
    page([entry("2026-11-25", 2), entry("2026-11-25", 1), entry("2026-11-24", 7)], "c/1+="),
    page([entry("2026-11-20", 3), entry("2026-11-19", 1), entry("2026-11-18", 9)], "c2"),
    page([entry("2026-11-17", 1)], null),
  ]);
  const d = await fetchDiscoveries({ get, now: NOW });
  assert.deepEqual(urls, [API, `${API}&cursor=c%2F1%2B%3D`], "page 3 is never asked for");
  assert.deepEqual(d.items.map((i) => i.id), ["PALOMAR-2026-11-25-000002", "PALOMAR-2026-11-25-000001", "PALOMAR-2026-11-24-000007", "PALOMAR-2026-11-20-000003", "PALOMAR-2026-11-19-000001"]);
  assert.deepEqual(d.days, { "2026-11-25": 2, "2026-11-24": 1, "2026-11-20": 1, "2026-11-19": 1 });
  assert.deepEqual(d.totals, { results: 1357, projects: 1032 });
  assert.equal(d.partial, undefined);
  assert.equal(d.fetchedAt, "2026-11-25T11:00:00.000Z");
  assert.deepEqual(d.items[0], {
    source: "palomar", id: "PALOMAR-2026-11-25-000002", version: 1, title: "Result 2026-11-25 #2", authors: ["Ada Lovelace"],
    date: "2026-11-25", at: "2026-11-25T02:00:00Z", url: "https://palomar-registry.org/entry?id=PALOMAR-2026-11-25-000002&version=1",
    repo: "owner/repo", subjects: ["math.CO", "math-ph"],
  });
  assert.ok(!JSON.stringify(d).includes("abstract"), "no abstracts");
});

test("palomar: a busy week stops at the page cap and says the count is short", async () => {
  let n = 0;
  const get: GetJson = async () => page(Array.from({ length: 25 }, () => entry("2026-11-24", 1000 - ++n)), `c${n}`); // newest first
  const d = await fetchDiscoveries({ get, now: NOW });
  assert.equal(n, 250);
  assert.equal(d.partial, true);
  assert.equal(d.days["2026-11-24"], 250);
  assert.equal(d.items.length, 60, "the newest 60 are kept");
  assert.deepEqual([d.items[0].id, d.items[59].id], ["PALOMAR-2026-11-24-000999", "PALOMAR-2026-11-24-000940"]);
});

test("palomar: HTTP 409 restarts the walk without a cursor once; a second 409 or a bad answer fails", async () => {
  const ok = recorder([page([entry("2026-11-25", 1)], "old"), { status: 409 }, page([entry("2026-11-25", 2), entry("2026-11-25", 1)], null)]);
  const d = await fetchDiscoveries({ get: ok.get, now: NOW });
  assert.deepEqual(ok.urls, [API, `${API}&cursor=old`, API]);
  assert.deepEqual(d.items.map((i) => i.id), ["PALOMAR-2026-11-25-000002", "PALOMAR-2026-11-25-000001"]);
  assert.equal(d.days["2026-11-25"], 2, "nothing counted twice across the restart");
  await assert.rejects(fetchDiscoveries({ get: recorder([{ status: 409 }, { status: 409 }]).get, now: NOW }), /kept changing/);
  await assert.rejects(fetchDiscoveries({ get: recorder([{ status: 200, body: { schema_version: 2, entries: [] } }]).get, now: NOW }));
  await assert.rejects(fetchDiscoveries({ get: recorder([{ status: 200, body: { schema_version: 1, entries: [] } }]).get, now: NOW }), /totals/);
  await assert.rejects(fetchDiscoveries({ get: recorder([]).get, now: NOW }));
});

test("palomar: registry text is sanitized and clipped; links are only permalinks built here", () => {
  const d = fromEntry(entry("2026-11-25", 1, {
    title: `Bidi‮ and\u0000 control\nchars ${"x".repeat(300)}`,
    authors: [...Array.from({ length: 7 }, (_, i) => ({ name: `Author ${i}` })), { name: "y".repeat(120) }],
    source: { repository: "../../etc/passwd" }, classification: { arxiv: ["math.CO", "<script>", "javascript:alert(1)", "math.CO"] },
    url: "javascript:alert(1)", published_at: "not a date",
  }))!;
  assert.match(d.title, /^Bidi and control chars x+…$/);
  assert.equal(Array.from(d.title).length, 200);
  assert.deepEqual(d.authors, ["Author 0", "Author 1", "Author 2", "Author 3", "Author 4"]);
  assert.equal(d.repo, undefined);
  assert.deepEqual(d.subjects, ["math.CO"]);
  assert.equal(d.url, "https://palomar-registry.org/entry?id=PALOMAR-2026-11-25-000001&version=1");
  assert.equal(d.at, "2026-11-25T00:00:00Z", "an unreadable timestamp falls back to the registration day");
  assert.equal(fromEntry({ ...entry("2026-11-25", 1), id: "PALOMAR-2026-13-45-000001" }), undefined);
  assert.equal(fromEntry({ ...entry("2026-11-25", 1), id: "javascript:alert(1)" }), undefined);
  assert.equal(fromEntry({ ...entry("2026-11-25", 1), version: 0 }), undefined);
  assert.equal(fromEntry({ ...entry("2026-11-25", 1), title: " \u0007 " }), undefined);
  assert.equal(fromEntry({ ...entry("2026-11-25", 1), status: "withdrawn" }), undefined);
  assert.equal(fromEntry({ ...entry("2026-11-25", 1), authors: [{ name: "x".repeat(100) }] })!.authors[0].length, 80);
});

test("palomar: the stored file is checked again: links rebuilt, bad items dropped, abstracts gone", () => {
  const good = fromEntry(entry("2026-11-25", 1))!;
  const d = validDiscoveries({
    fetchedAt: "2026-11-25T11:00:00.000Z", totals: { results: 10, projects: 9 },
    days: { "2026-11-25": 2, "2026-11-24": -1, "__proto__": 5, "not-a-day": 3 }, partial: "yes",
    items: [
      { ...good, url: "javascript:alert(1)", abstract: "never", title: `${"t".repeat(250)}\u0000` },
      { ...good, id: "PALOMAR-2026-11-25-000002", url: "http://palomar-registry.org.evil.test/entry", repo: "o/r" },
      { ...good, id: "evil" },
      good, // a duplicate id
    ],
  })!;
  assert.deepEqual(d.days, { "2026-11-25": 2 });
  assert.equal(d.partial, undefined);
  assert.deepEqual(d.items.map((i) => i.url), [
    "https://palomar-registry.org/entry?id=PALOMAR-2026-11-25-000002&version=1",
    "https://palomar-registry.org/entry?id=PALOMAR-2026-11-25-000001&version=1",
  ]);
  assert.equal(Array.from(d.items[1].title).length, 200);
  assert.ok(!JSON.stringify(d).includes("abstract"));
  assert.equal(validDiscoveries({ ...d, totals: { results: -1, projects: 0 } }), null);
  assert.equal(validDiscoveries({ ...d, fetchedAt: "yesterday" }), null);
  assert.equal(validDiscoveries(null), null);
});

test("palomar: the live refresh keeps the previous file on any failure and rewrites it only when something new shows", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "discoveries-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "data"));
  const path = join(root, "data", "discoveries.json");
  const snapshot = (fetchedAt: string, items = [fromEntry(entry("2026-11-25", 1))!]): Discoveries => ({ fetchedAt, totals: { results: 10, projects: 9 }, days: { "2026-11-25": items.length }, items });
  const log = console.log;
  console.log = () => {};
  t.after(() => { console.log = log; });
  assert.equal(await refreshDiscoveries(root, async () => { throw new Error("offline"); }), "failed");
  assert.equal(existsSync(path), false, "no file is made from a failed read");
  assert.equal(await refreshDiscoveries(root, async () => snapshot("2026-11-25T08:00:00.000Z")), "updated");
  const first = readFileSync(path, "utf8");
  assert.equal(await refreshDiscoveries(root, async () => { throw new Error("HTTP 500"); }), "failed");
  assert.equal(await refreshDiscoveries(root, async () => ({ nonsense: true }) as unknown as Discoveries), "failed");
  assert.equal(readFileSync(path, "utf8"), first, "failures keep the previous file");
  assert.equal(await refreshDiscoveries(root, async () => snapshot("2026-11-25T11:00:00.000Z")), "unchanged");
  assert.equal(readFileSync(path, "utf8"), first, "a new timestamp alone does not rewrite (and so commit) the file");
  assert.equal(await refreshDiscoveries(root, async () => snapshot("2026-11-25T14:00:00.000Z", [fromEntry(entry("2026-11-25", 2))!, fromEntry(entry("2026-11-25", 1))!])), "updated");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).items.length, 2);
});

// ─── Rendering ──────────────────────────────────────────────────────────
function competition(id: string, domain: string): Competition {
  return {
    id, name: id, tagline: "t", description: "d", url: "https://example.com", host: "github", status: "active", tags: [], domain, images: [],
    participation: { requirements: [], compute: "cpu" }, links: [], problems: [], participants: [],
    stats: { totalRecords: 0, uniqueParticipants: 0, recordsLast30d: 0, recordsLast90d: 0 }, agentStats: [], lastUpdated: "2026-11-25",
  };
}
const hostile = (n: number) => fromEntry(entry("2026-11-25", n, { title: `<script>alert(${n})</script> & proof`, authors: [{ name: "<img src=x onerror=alert(1)>" }, { name: "B" }, { name: "C" }, { name: "D" }] }))!;
const fixture: Discoveries = {
  fetchedAt: "2026-11-25T11:00:00.000Z", totals: { results: 1357, projects: 1032 },
  days: { "2026-11-25": 6, "2026-11-24": 22, "2026-11-18": 40 }, // the 18th is outside the window
  items: [6, 5, 4, 3, 2, 1].map(hostile),
};
const data = { crawledAt: "2026-11-25T10:00:00Z", competitions: [competition("proofs", "formal-methods"), competition("kernels", "coding-agents")] };
const band = (html: string) => html.match(/<section class="band pre" id="discoveries">[\s\S]*?<\/section>/)?.[0];
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const PERMALINK = /^https:\/\/palomar-registry\.org\/entry\?id=PALOMAR-\d{4}-\d{2}-\d{2}-\d{6}&version=\d+$/;

test("fresh discoveries: the home page and the math topic show the band, linking only to the registry and our pages", () => {
  const all = pages(data, [], fixture);
  const home = band(all.find((p) => p.path === "/")!.body)!;
  assert.ok(home, "home has the band");
  assert.match(home, /28 Lean-verified results registered in the last 7 days, 6 today\./);
  assert.equal((home.match(/<li>/g) ?? []).length, 5);
  assert.ok(home.includes("&lt;script&gt;alert(6)&lt;/script&gt; &amp; proof") && !home.includes("<script>") && !home.includes("<img"));
  assert.ok(home.includes("&lt;img src=x onerror=alert(1)&gt;, B, C et al."));
  assert.ok(home.includes("Proved something with your agent?") && home.includes("Register it on Palomar") && home.includes("Open math challenges"));
  assert.ok(!/\bAI\b|agents? (?:made|found|proved)/i.test(home.replace("Proved something with your agent?", "")), "no claim about who made them");
  for (const h of hrefs(home)) assert.ok(PERMALINK.test(h) || h === "https://palomar-registry.org/" || h === "/topics/math", h);
  const math = band(all.find((p) => p.path === "/topics/math")!.body)!;
  assert.ok(math, "the math topic has the band");
  assert.equal((math.match(/<li>/g) ?? []).length, 3);
  assert.ok(!math.includes('href="/topics/math"'), "no link to the page it is on");
  for (const h of hrefs(math)) assert.ok(PERMALINK.test(h) || h === "https://palomar-registry.org/", h);
  for (const p of all.filter((p) => p.path !== "/" && p.path !== "/topics/math")) assert.equal(band(p.body), undefined, p.path);
  // the band is left out when there is nothing in the window, or no file yet
  assert.equal(band(pages(data, [], { ...fixture, fetchedAt: "2026-12-09T00:00:00.000Z" })[0].body), undefined);
  assert.equal(band(pages(data, [], null)[0].body), undefined);
});

test("fresh discoveries: the math topic's Markdown twin carries a shorter band, other topics none", () => {
  const md = topicMarkdown(TOPICS.find((t) => t.slug === "math")!, data, "https://openchallengelist.com", fixture);
  assert.match(md, /## Fresh discoveries\n\n28 Lean-verified results registered in the last 7 days, 6 today\./);
  assert.equal((md.match(/^- 2026-11-25 · \[/gm) ?? []).length, 3);
  assert.ok(md.includes("(https://palomar-registry.org/entry?id=PALOMAR-2026-11-25-000006&version=1)"));
  assert.ok(md.includes("https://openchallengelist.com/api/discoveries.json") && md.includes("https://submit.palomar-registry.org/llms.txt"));
  assert.ok(md.includes("only when your human says so"));
  assert.ok(!topicMarkdown(TOPICS.find((t) => t.slug === "no-gpu")!, data, "https://openchallengelist.com", fixture).includes("Fresh discoveries"));
  assert.ok(!topicMarkdown(TOPICS.find((t) => t.slug === "math")!, data).includes("Fresh discoveries"));
});
