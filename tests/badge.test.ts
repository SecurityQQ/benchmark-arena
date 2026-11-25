import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BADGE_COLORS, BADGE_LABEL, BADGE_NOTE, BADGE_PATTERN, badgeLayout, badgeMarkdown, badgeMessage, badgeSvg, competitionBadge, listedBadge, textWidth } from "../src/badge.js";
import { build, loadPublished } from "../src/build.js";
import { answerFor } from "../src/listing.js";
import { pages } from "../src/prerender.js";
import { competitionToMarkdown, joinTxt, llmsTxt } from "../src/render.js";
import type { Competition, Problem } from "../src/types.js";

const track = (isOpen: boolean): Problem => ({ id: "t", name: "T", metricName: "score", metricDirection: "maximize", isOpen, records: [] }) as Problem;
function board(over: { status?: Competition["status"]; recent?: number; open?: number; closed?: number; name?: string } = {}): Competition {
  return {
    id: "some-board", name: over.name ?? "Board", tagline: "", description: "", url: "https://github.com/o/r", host: "github", status: over.status ?? "active",
    tags: [], domain: "other", images: [], participation: { requirements: [], compute: "cpu" }, links: [], participants: [], agentStats: [], lastUpdated: "2026-11-01",
    problems: [...Array(over.open ?? 0).fill(0).map(() => track(true)), ...Array(over.closed ?? 0).fill(0).map(() => track(false))],
    stats: { totalRecords: 0, uniqueParticipants: 0, recordsLast30d: over.recent ?? 0, recordsLast90d: over.recent ?? 0 },
  };
}

// Well-formed XML, checked by hand: one root, every tag closed in order, every attribute quoted, entities only the five XML ones
function assertWellFormed(svg: string) {
  const stack: string[] = [];
  let roots = 0;
  for (const m of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|<|>/g)) {
    assert.ok(m[2], `stray angle bracket near ${svg.slice(m.index!, m.index! + 40)}`);
    if (m[1]) assert.equal(stack.pop(), m[2], `</${m[2]}> closes the wrong element`);
    else if (!m[4]) { if (!stack.length) roots++; stack.push(m[2]); }
    else if (!stack.length) roots++;
  }
  assert.deepEqual(stack, [], "unclosed elements");
  assert.equal(roots, 1, "one root element");
  for (const e of svg.matchAll(/&[^;\s]*;?/g)) assert.match(e[0], /^&(amp|lt|gt|quot|apos);$/, "only XML entities");
}

test("message: entries in 30 days, else open tracks, else upcoming or listed; singular and plural", () => {
  const m = (o: Parameters<typeof board>[0]) => badgeMessage(board(o));
  assert.deepEqual(m({ recent: 16, open: 3 }), { kind: "entries", text: "16 entries in 30 days", color: BADGE_COLORS.entries });
  assert.equal(m({ recent: 1 }).text, "1 entry in 30 days");
  assert.equal(m({ recent: 2, status: "ended" }).text, "2 entries in 30 days", "entries count whatever the status");
  assert.deepEqual(m({ open: 3, closed: 2 }), { kind: "open", text: "3 open tracks", color: BADGE_COLORS.open });
  assert.equal(m({ open: 1, closed: 4 }).text, "1 open track");
  assert.equal(m({ open: 2, status: "upcoming" }).text, "2 open tracks");
  assert.deepEqual(m({ open: 2, status: "ended" }), { kind: "listed", text: "listed", color: BADGE_COLORS.listed }, "an ended board has no open tracks");
  assert.deepEqual(m({ status: "upcoming", closed: 1 }), { kind: "upcoming", text: "upcoming", color: BADGE_COLORS.upcoming });
  for (const status of ["active", "unknown", "ended"] as const) assert.equal(m({ status, closed: 2 }).kind, "listed", status);
  // only a count that is a positive whole number is a count
  for (const bad of [Number.NaN, -3, 2.5, Infinity, "7" as unknown as number]) assert.equal(m({ recent: bad }).kind, "listed", String(bad));
  assert.equal(new Set(Object.values(BADGE_COLORS)).size, 4, "each kind its own color");
});

test("svg: role, aria-label and title carry the full text; interpolated text is escaped; no crawled text gets in", () => {
  for (const bad of ["<svg><g></svg>", "<svg></svg><svg></svg>", `<svg a="1"><title>a < b</title></svg>`, `<svg a=1></svg>`, "<svg>&nbsp;</svg>", `<svg><text>"x" & y</text></svg>`]) {
    assert.throws(() => assertWellFormed(bad), bad);
  }
  const svg = competitionBadge(board({ recent: 16 }));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20" role="img" aria-label="open challenge list: 16 entries in 30 days">/);
  assert.ok(svg.includes("<title>open challenge list: 16 entries in 30 days</title>"));
  assertWellFormed(svg);

  const hostile = `"><script>alert(1)</script>&'`;
  const escaped = badgeSvg(hostile, hostile, `red"/><script>`);
  assertWellFormed(escaped);
  assert.ok(!escaped.includes("<script") && !escaped.includes(`red"`), "nothing breaks out of an attribute or into markup");
  assert.ok(escaped.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;&apos;"));
  assert.ok(escaped.includes(`fill="${BADGE_COLORS.listed}"`), "a color that is not a hex color falls back to grey");

  const named = competitionBadge(board({ name: "<b>Secret board</b>", recent: 2 }));
  assert.ok(!/secret|board/i.test(named), "the competition's name never goes into a badge");
  assert.deepEqual([...named.matchAll(/>([^<]+)</g)].map((x) => x[1]), [`${BADGE_LABEL}: 2 entries in 30 days`, ...Array(2).fill(BADGE_LABEL), ...Array(2).fill("2 entries in 30 days")]);

  const listed = listedBadge();
  assertWellFormed(listed);
  assert.ok(listed.includes('aria-label="open challenge list: listed"') && listed.includes("<title>open challenge list: listed</title>"));
});

// Advance widths in Verdana.ttf's hmtx (unitsPerEm 2048), read from the font file, for every character a badge can show
const VERDANA_UNITS: Record<string, number> = {
  " ": 720, a: 1230, c: 1067, d: 1276, e: 1220, g: 1276, h: 1296, i: 562, k: 1212, l: 562, m: 1992, n: 1296, o: 1243, p: 1276,
  r: 874, s: 1067, t: 807, u: 1296, y: 1212, ...Object.fromEntries([..."0123456789"].map((d) => [d, 1302])),
};
const verdana11 = (s: string) => [...s].reduce((w, ch) => w + VERDANA_UNITS[ch] * 11 / 2048, 0);
// shields.io's own text widths (textLength / 10) for the same strings in Verdana 11px, 2026-11-25
const SHIELDS = { "open challenge list": 103, "16 entries in 30 days": 117, "99999 entries in 30 days": 137, "1 entry in 30 days": 101, "999 open tracks": 89, upcoming: 53, listed: 29 };

test("width: no text overflows its box, up to the longest message a board can have", () => {
  const longest = ["99999 entries in 30 days", "999 open tracks", "1 entry in 30 days", "1 open track", "upcoming", "listed", BADGE_LABEL];
  for (const s of longest) {
    for (const ch of s) assert.ok(ch in VERDANA_UNITS, `measured: ${JSON.stringify(ch)}`);
    const bound = Math.ceil(verdana11(s));
    assert.ok(textWidth(s) >= bound, `${s}: ${textWidth(s)} >= ${bound} (Verdana 11px)`);
    assert.ok(textWidth(s) <= bound + 1, `${s}: no more than a pixel of slack`);
  }
  for (const [s, w] of Object.entries(SHIELDS)) assert.ok(textWidth(s) >= w, `${s}: ${textWidth(s)} >= shields' ${w}`);

  const msg = badgeMessage(board({ recent: 99999 })).text;
  assert.equal(msg, "99999 entries in 30 days");
  const L = badgeLayout(BADGE_LABEL, msg), svg = badgeSvg(BADGE_LABEL, msg, BADGE_COLORS.entries);
  assert.ok(L.message.width >= Math.ceil(verdana11(msg)) + 10 && L.label.width >= Math.ceil(verdana11(BADGE_LABEL)) + 10, "5px padding each side");
  assert.equal(L.width, L.label.width + L.message.width);
  assert.ok(svg.includes(`width="${L.width}" height="20"`) && svg.includes(`<rect x="${L.label.width}" width="${L.message.width}"`));
  // textLength holds the drawn text to the estimate in whatever font the viewer has, so the box always fits it
  assert.deepEqual([...svg.matchAll(/textLength="(\d+)"/g)].map((x) => Number(x[1])), [L.label.text * 10, L.label.text * 10, L.message.text * 10, L.message.text * 10]);
  const centers = [...svg.matchAll(/<text[^>]* x="(\d+)"/g)].map((x) => Number(x[1]) / 10);
  assert.deepEqual(centers, [L.label.width / 2, L.label.width / 2, L.label.width + L.message.width / 2, L.label.width + L.message.width / 2]);
});

const real = loadPublished(process.cwd());

test("real data: every board gets a well-formed badge with the board page's numbers", () => {
  const kinds = new Map<string, number>();
  for (const c of real.competitions) {
    const m = badgeMessage(c), svg = competitionBadge(c);
    assertWellFormed(svg);
    kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
    const open = c.status === "ended" ? 0 : c.problems.filter((p) => p.isOpen).length;
    if (c.stats.recordsLast30d > 0) assert.match(m.text, new RegExp(`^${c.stats.recordsLast30d} entr(y|ies) in 30 days$`), c.id);
    else if (open) assert.match(m.text, new RegExp(`^${open} open tracks?$`), c.id);
    else assert.equal(m.text, c.status === "upcoming" ? "upcoming" : "listed", c.id);
    assert.ok(svg.includes(`aria-label="${BADGE_LABEL}: ${m.text}"`), c.id);
    assert.ok(textWidth(m.text) >= Math.ceil(verdana11(m.text)), c.id);
  }
  assert.ok(real.competitions.length > 20 && (kinds.get("entries") ?? 0) > 0 && (kinds.get("open") ?? 0) > 0, JSON.stringify([...kinds]));
});

test("build writes a badge for every board and the generic one", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "badges-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, body: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); };
  const shell = readFileSync(join(process.cwd(), "site/index.html"), "utf8");
  put("site/index.html", shell); put("site/app.js", ""); put("site/style.css", ""); put("site/standard/PROBLEM.md", "# P"); put("site/standard/SUBMISSION.md", "# S");
  const comps = [board({ recent: 3 }), { ...board({ open: 1 }), id: "second" }, { ...board({ status: "upcoming" }), id: "Third_3" }];
  put("data/competitions.json", JSON.stringify({ crawledAt: "2026-11-25T00:00:00Z", competitions: comps }));
  const log = console.log; console.log = () => {};
  try { await build(root); } finally { console.log = log; }
  const read = (p: string) => readFileSync(join(root, "public", p), "utf8");
  // withEntryCounts recounts from dated entries, as the board page does: this fixture has none
  assert.match(read("badge/c/some-board.svg"), /aria-label="open challenge list: listed"/);
  assert.match(read("badge/c/second.svg"), /aria-label="open challenge list: 1 open track"/);
  assert.match(read("badge/c/Third_3.svg"), /aria-label="open challenge list: upcoming"/);
  assert.equal(read("badge/listed.svg"), listedBadge());
  assert.ok(!existsSync(join(root, "public/badge/c/missing.svg")));
});

test("the snippet: on the board page, on /standard and in the listing reply; not in what entrants' agents read", () => {
  const c = real.competitions.find((x) => x.stats.recordsLast30d > 0)!;
  const snippet = badgeMarkdown(c.id);
  assert.equal(snippet, `[![Open Challenge List](https://openchallengelist.com/badge/c/${c.id}.svg)](https://openchallengelist.com/c/${c.id})`);
  assert.equal(BADGE_PATTERN.replaceAll("{id}", c.id), snippet);

  const all = pages(real);
  const html = all.find((p) => p.file === `c/${c.id}.html`)!.body;
  assert.ok(html.includes(`<pre class="quick badge-md"><code>${snippet}</code></pre>`), "the snippet, as text");
  assert.ok(html.includes(`<img src="/badge/c/${c.id}.svg" alt="Open Challenge List badge" height="20" loading="lazy">`), "the badge itself");
  assert.ok(html.includes("For the organizer") && html.includes(BADGE_NOTE.replace("'", "&#39;")));
  assert.ok(all.find((p) => p.path === "/standard")!.body.includes(`<code>${BADGE_PATTERN}</code>`));

  // the SPA renders the same block on navigation: same sentence, same snippet
  const app = readFileSync(join(process.cwd(), "site/app.js"), "utf8");
  assert.ok(app.includes(JSON.stringify(BADGE_NOTE)) && app.includes(JSON.stringify(BADGE_PATTERN)));
  assert.match(app, /\$\{badgeBlock\(c\)\}/);

  const reply = answerFor([{ owner: "o", name: "r", verdict: { kind: "listed", id: c.id } }], [])!;
  assert.ok(reply.close);
  assert.ok(reply.body.includes(`Listed: https://openchallengelist.com/c/${c.id} (\`o/r\`).\n\nTo show the board's live numbers`));
  assert.ok(reply.body.includes("```markdown\n" + snippet + "\n```"), reply.body);
  const two = answerFor([{ owner: "o", name: "r", verdict: { kind: "listed", id: "a" } }, { owner: "o", name: "s", verdict: { kind: "listed", id: "b" } }], [])!;
  assert.ok(two.body.includes(badgeMarkdown("a")) && two.body.includes(badgeMarkdown("b")), "one badge per listed board");
  assert.ok(!answerFor([{ owner: "o", name: "r", verdict: { kind: "rejected", reason: "no PROBLEM.md" } }], [])!.body.includes("/badge/"), "no badge without a listing");

  // entrants' agents read the digests, join.txt and llms.txt: no badge there
  assert.ok(!competitionToMarkdown(c).includes("/badge/"));
  assert.ok(!joinTxt(real).includes("/badge/"));
  assert.ok(!llmsTxt({ ...real, errors: [] }).includes("/badge/"));
});
