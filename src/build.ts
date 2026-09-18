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
w("competitions.json", j(data));

console.log(`built public/ — ${data.competitions.length} competitions`);
