// Static build for Vercel: site/ + pre-rendered API → public/
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CrawlResult } from "./types.js";
import { aggregateAgents, aggregatePeople, openProblems } from "./aggregate.js";
import { competitionToMarkdown, llmsTxt } from "./render.js";

const ROOT = process.cwd();
const OUT = join(ROOT, "public");
const data: CrawlResult = JSON.parse(readFileSync(join(ROOT, "data", "competitions.json"), "utf-8"));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "api", "competitions"), { recursive: true });
cpSync(join(ROOT, "site"), OUT, { recursive: true });

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
