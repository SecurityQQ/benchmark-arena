// Static build for Vercel: site/ + pre-rendered API → public/
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { CrawlResult } from "./types.js";
import { aggregateAgents, aggregatePeople, openProblems } from "./aggregate.js";
import { competitionToMarkdown, llmsTxt } from "./render.js";

const ROOT = process.cwd();
const OUT = join(ROOT, "public");
const data: CrawlResult = JSON.parse(readFileSync(join(ROOT, "data", "competitions.json"), "utf-8"));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "api", "competitions"), { recursive: true });
cpSync(join(ROOT, "site"), OUT, { recursive: true });

// Cloudflare hands browsers a 4 hour TTL for .js and .css, so a deploy stayed invisible (or half-applied: new CSS,
// old JS) until it expired. A content hash in the URL makes every changed file a new URL; index.html is never cached.
const ver = (file: string) => createHash("sha256").update(readFileSync(join(OUT, file))).digest("hex").slice(0, 10);
const html = readFileSync(join(OUT, "index.html"), "utf-8");
const stamped = html
  .replace('href="/style.css"', `href="/style.css?v=${ver("style.css")}"`)
  .replace('src="/app.js"', `src="/app.js?v=${ver("app.js")}"`);
if (stamped === html || !stamped.includes("/app.js?v=") || !stamped.includes("/style.css?v=")) throw new Error("build: could not version app.js / style.css in index.html");
writeFileSync(join(OUT, "index.html"), stamped);

const w = (p: string, body: string) => writeFileSync(join(OUT, p), body);
const j = (v: unknown) => JSON.stringify(v);

w("api/competitions.json", j(data));
w("api/people.json", j(aggregatePeople(data.competitions)));
w("api/agents.json", j(aggregateAgents(data.competitions, "author")));
w("api/agents-subject.json", j(aggregateAgents(data.competitions, "subject")));
w("api/open-problems.json", j(openProblems(data.competitions)));
w("api/summary.json", j({
  crawledAt: data.crawledAt,
  competitions: data.competitions,
  people: aggregatePeople(data.competitions),
  agents: aggregateAgents(data.competitions, "author"),
  evaluated: aggregateAgents(data.competitions, "subject"),
  openProblems: openProblems(data.competitions),
}));
for (const c of data.competitions) {
  w(`api/competitions/${c.id}.json`, JSON.stringify(c, null, 2));
  w(`api/competitions/${c.id}.md`, competitionToMarkdown(c));
}
w("llms.txt", llmsTxt(data));
// both standard templates in one neutral JSON: the page loads this first (some blockers stall requests for *SUBMISSION*.md)
w("standard/templates.json", j({ "PROBLEM.md": readFileSync(join(ROOT, "site", "standard", "PROBLEM.md"), "utf-8"), "SUBMISSION.md": readFileSync(join(ROOT, "site", "standard", "SUBMISSION.md"), "utf-8") }));

// sitemap: static routes, every competition, every model family with records
const ORIGIN = process.env.SITE_ORIGIN ?? "https://problem.md";
const day = (data.crawledAt ?? new Date().toISOString()).slice(0, 10);
const families = [...new Set(data.competitions.flatMap((c) => c.problems.flatMap((p) => p.records.map((r) => r.agent?.family).filter((f): f is NonNullable<typeof f> => !!f && f !== "unknown"))))];
const urls: [string, string, string][] = [["/", "daily", "1.0"], ["/standard", "weekly", "0.9"], ["/submit", "monthly", "0.6"], ["/agents", "daily", "0.8"], ["/people", "daily", "0.7"],
  ...data.competitions.map((c): [string, string, string] => [`/c/${encodeURIComponent(c.id)}`, "daily", "0.8"]),
  ...families.map((f): [string, string, string] => [`/agents/${f}`, "weekly", "0.5"])];
w("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, f, pr]) => `  <url><loc>${ORIGIN}${p}</loc><lastmod>${day}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join("\n")}\n</urlset>\n`);
w("competitions.json", j(data));

console.log(`built public/ — ${data.competitions.length} competitions`);
