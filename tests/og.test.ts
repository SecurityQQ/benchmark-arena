import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { cardAlt, drawable, plain } from "../src/og.js";
import { pages } from "../src/prerender.js";
import type { Competition } from "../src/types.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));

function competition(id: string, patch: Partial<Competition> = {}): Competition {
  return {
    id, name: "Test", tagline: "Test", description: "Test", url: "https://example.com",
    host: "website", status: "active", tags: [], domain: "test", images: [],
    participation: { requirements: [], compute: "cpu" }, links: [], problems: [], participants: [],
    stats: { totalRecords: 0, uniqueParticipants: 0, recordsLast30d: 0, recordsLast90d: 0 },
    agentStats: [], lastUpdated: "2026-09-18", ...patch,
  };
}

// A board people and agents entered this month: entries, an agent, an open track, a dated deadline
const busy = competition("busy", {
  name: "P = NP?", tagline: "Prove open steps in Lean 4; only the proof checker decides.", domain: "formal-methods",
  participation: { requirements: [], compute: "none", deadline: "2026-12-31 23:59 UTC" },
  stats: { totalRecords: 3, uniqueParticipants: 2, recordsLast30d: 3, recordsLast90d: 3, lastSubmission: "2026-09-17" },
  problems: [
    { id: "a", name: "A", metricName: "proofs", metricDirection: "maximize", passMark: 1, isOpen: true, records: [
      { value: 0, date: "2026-09-17", contributor: "ann", agent: { family: "anthropic", tool: "Claude Code", confidence: "high", role: "author" } },
      { value: 0, date: "2026-09-16", contributor: "bob" },
      { value: 0, date: "2026-07-01", contributor: "old" },
    ] },
  ],
});

test("card text: control and bidi characters dropped, undrawable glyphs spelled out or left out, alt reads as sentences", () => {
  assert.equal(plain("a‮b\u0007c\n d", 50), "a b c d");
  assert.equal(plain("x".repeat(30), 10), `${"x".repeat(9)}…`);
  assert.equal(drawable("P ≠ NP, κ ≥ 2 漢字 🚀 Привет"), "P != NP, κ >= 2 Привет");
  assert.equal(cardAlt({ title: "P = NP?", stats: [{ value: 1608, label: "entries" }], notes: ["No GPU needed"] }), "P = NP? 1,608 entries. No GPU needed. openchallengelist.com.");
});

test("competition meta descriptions end one sentence once", () => {
  const all = pages({ crawledAt: "2026-09-18T12:00:00Z", competitions: [busy, competition("plain", { tagline: "No full stop" })] });
  assert.match(all.find((p) => p.path === "/c/busy")!.description, /^Prove open steps in Lean 4; only the proof checker decides\. 1 track \(1 open\), 3 entries, 2 in the last 30 days\./);
  assert.match(all.find((p) => p.path === "/c/plain")!.description, /^No full stop\. 0 tracks/);
});

test("every sitemap page's og:image and twitter:image is a published file: its own card, or /og.jpg", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "og-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // the real shell, so its markers are the ones filled
  for (const f of ["index.html", "app.js", "style.css", "og.jpg", "standard/PROBLEM.md", "standard/SUBMISSION.md"]) {
    mkdirSync(dirname(join(root, "site", f)), { recursive: true });
    copyFileSync(join(REPO, "site", f), join(root, "site", f));
  }
  const ended = competition("over", { ...busy, id: "over", name: "Finished Race", status: "ended" });
  const hostile = competition("hostile", { name: `</script>"><img src=x> 漢字 ${"Very long name ".repeat(12)}`, tagline: "‮evil\u0007" });
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "data/competitions.json"), JSON.stringify({ crawledAt: "2026-09-18T12:00:00Z", competitions: [busy, ended, hostile, competition("quiet")] }));
  writeFileSync(join(root, "data/discoveries.json"), JSON.stringify({ fetchedAt: "2026-09-18T12:00:00Z", totals: { results: 5, projects: 4 }, days: { "2026-09-18": 2 }, items: [] }));
  await build(root);

  const pub = (p: string) => join(root, "public", p);
  const meta = (html: string, key: string) => {
    const all = [...html.matchAll(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`, "g"))];
    assert.equal(all.length, 1, key);
    return all[0][1];
  };
  const locs = [...readFileSync(pub("sitemap.xml"), "utf8").matchAll(/<loc>https:\/\/openchallengelist\.com([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 12);
  const carded: string[] = [];
  for (const path of locs) {
    const html = readFileSync(pub(path === "/" ? "index.html" : `${decodeURIComponent(path.slice(1))}.html`), "utf8");
    const src = meta(html, "og:image");
    assert.equal(meta(html, "twitter:image"), src, path);
    assert.equal(meta(html, "og:image:secure_url"), src, path);
    assert.equal(meta(html, "twitter:card"), "summary_large_image");
    assert.equal(meta(html, "og:image:width"), "1200");
    assert.equal(meta(html, "og:image:height"), "630");
    assert.ok(meta(html, "og:image:alt") && meta(html, "twitter:image:alt"), path);
    const url = new URL(src.replace(/&amp;/g, "&"));
    assert.equal(url.origin, "https://openchallengelist.com");
    const file = readFileSync(pub(url.pathname.slice(1)));
    if (url.pathname === "/og.jpg") {
      assert.equal(meta(html, "og:image:type"), "image/jpeg");
      continue;
    }
    carded.push(path);
    assert.match(url.pathname, /^\/og\/(home|topics\/[a-z-]+|challenges\/[a-z-]+|c\/[A-Za-z0-9_-]+)\.png$/);
    assert.equal(meta(html, "og:image:type"), "image/png");
    assert.equal(meta(html, "twitter:image:alt"), meta(html, "og:image:alt"), path);
    assert.equal(url.searchParams.get("v"), createHash("sha256").update(file).digest("hex").slice(0, 10), "the URL changes with the image");
    assert.equal(file.subarray(1, 4).toString(), "PNG");
    assert.deepEqual([file.readUInt32BE(16), file.readUInt32BE(20)], [1200, 630]);
    assert.ok(file.length < 150_000, `${path}: ${file.length} bytes`);
  }
  // the pages people share have their own card; the rest keep the site's picture
  assert.deepEqual(carded.sort(), ["/", "/c/busy", "/c/hostile", "/c/over", "/c/quiet", "/challenges/cure-disease", "/challenges/energy", "/challenges/p-vs-np", "/challenges/riemann-hypothesis", "/topics/gpu-kernels", "/topics/math", "/topics/no-gpu", "/topics/speedruns"]);
  assert.ok(existsSync(pub("og/topics/math.png")) && !existsSync(pub("og/agents.png")));

  const alt = (p: string) => meta(readFileSync(pub(p), "utf8"), "og:image:alt");
  assert.equal(alt("c/busy.html"), "P = NP? 2 entries in 30 days, 2 people, 1 with an AI agent, 1 open track. No GPU needed. Deadline Dec 31, 2026. Agents: Claude Code. openchallengelist.com.");
  assert.equal(alt("c/over.html"), "Finished Race. 3 entries, 2 participants, 1 track. Closed to new entries. Last entry 2026-09-17. openchallengelist.com.");
  // site-wide and per topic, as the pages count them: the ended board's entries this month count, its tracks are not open
  assert.equal(alt("index.html"), "Open competitions on the world&#39;s hardest problems. 4 competitions, 1 open track, 4 entries in 30 days, 2 by AI agents. Fresh discoveries: 2 Lean-verified results this week. openchallengelist.com.");
  assert.equal(alt("topics/math.html"), "Math and Lean proof challenges for AI agents. 2 competitions, 1 open track, 4 entries in 30 days, 2 by AI agents. Busiest: P = NP? openchallengelist.com.");
  // crawled text in the alt is escaped like the rest of the head
  const hostileHtml = readFileSync(pub("c/hostile.html"), "utf8");
  assert.ok(meta(hostileHtml, "og:image:alt").startsWith("&lt;/script&gt;&quot;&gt;&lt;img src=x&gt;"));
  assert.ok(!/<img src=x/.test(hostileHtml.split("</head>")[0]));
});
