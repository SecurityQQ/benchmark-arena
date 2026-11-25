// The core metric, measured on GitHub: pull requests and issues that say they came from this directory
// ("Found via https://openchallengelist.com/c/{id}"), split by listed competition and by month, plus repositories
// whose code links here. Prints JSON; with WRITE=1 also saves data/agent-metrics.json.
//
//   GITHUB_TOKEN=$(gh auth token) npx tsx scripts/agent-metrics.ts
//
// Fetches of join.txt and the digests are the other half of the funnel: GA4 `agent_fetch` events (middleware.ts).

import { loadEnv } from "../src/env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getOctokit } from "../src/github.js";
import type { CrawlResult } from "../src/types.js";

loadEnv();
const QUERIES = ['"openchallengelist.com"', '"problem.md/v1"'];
const SELF = "securityqq/benchmark-arena";

async function main() {
  const gh = getOctokit();
  const data: CrawlResult = JSON.parse(readFileSync(join(process.cwd(), "data", "competitions.json"), "utf-8"));
  const byRepo = new Map(data.competitions.filter((c) => c.repo).map((c) => [`${c.repo!.owner}/${c.repo!.name}`.toLowerCase(), c.id]));
  const seen = new Map<string, { url: string; repo: string; kind: "pr" | "issue"; state: string; createdAt: string; author?: string; competition?: string; via?: string }>();
  for (const q of QUERIES) {
    const items = await gh.paginate(gh.search.issuesAndPullRequests, { q, per_page: 100 }, (r) => r.data);
    for (const it of items) {
      const repo = it.repository_url.split("/repos/")[1]?.toLowerCase() ?? "";
      if (repo === SELF) continue; // submissions to the directory itself are not entries
      if (!/openchallengelist\.com|problem\.md\/v1/i.test(`${it.title}\n${it.body ?? ""}`)) continue; // search tokenizes: keep literal mentions only
      const via = /openchallengelist\.com\/c\/([A-Za-z0-9_-]{1,200})/.exec(it.body ?? "")?.[1];
      seen.set(it.html_url, { url: it.html_url, repo, kind: it.pull_request ? "pr" : "issue", state: it.state, createdAt: it.created_at, author: it.user?.login,
        competition: byRepo.get(repo) ?? via, via });
    }
  }
  const code = await gh.search.code({ q: '"openchallengelist.com"', per_page: 100 }).then((r) => r.data.items.map((i) => i.repository.full_name.toLowerCase()), () => [] as string[]);
  const refs = [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const month = (d: string) => d.slice(0, 7);
  const result = {
    checkedAt: new Date().toISOString(),
    // headline: PRs into a listed competition that say they came from here
    entriesViaDirectory: refs.filter((r) => r.kind === "pr" && byRepo.has(r.repo)).length,
    byCompetition: Object.fromEntries([...new Set(refs.map((r) => r.competition).filter(Boolean))].map((id) => [id, refs.filter((r) => r.competition === id).length])),
    byMonth: Object.fromEntries([...new Set(refs.map((r) => month(r.createdAt)))].sort().map((m) => [m, refs.filter((r) => month(r.createdAt) === m).length])),
    references: refs,
    reposLinkingHere: [...new Set(code)].filter((r) => r !== SELF).sort(),
  };
  console.log(JSON.stringify(result, null, 2));
  if (process.env.WRITE === "1") writeFileSync(join(process.cwd(), "data", "agent-metrics.json"), JSON.stringify(result, null, 2) + "\n");
}

main().catch((e) => { console.error(`agent-metrics failed: ${(e as Error).message}`); process.exit(1); });
