// Discover competition repos via multiple sources

import { getOctokit } from "./github.js";
import type { DiscoveredRepo } from "./types.js";
import { fetchRaw } from "./github.js";
import { parseStandardDoc, isStandardDoc, SPEC_MARKERS } from "./standard.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Community submissions approved by a maintainer (see .github/workflows/submission.yml)
function communitySeeds(): { owner: string; name: string }[] {
  const p = join(process.cwd(), "data", "seeds.json");
  if (!existsSync(p)) return [];
  try { return (JSON.parse(readFileSync(p, "utf-8")) as { owner: string; name: string }[]).filter((s) => s?.owner && s?.name); } catch { return []; }
}

// ─── GitHub Search queries ──────────────────────────────────────────────
// Must be specific — "leaderboard" alone matches awesome-lists
const SEARCH_QUERIES = [
  // "record history" tables (Sutro pattern)
  '"record history" submission leaderboard in:readme',
  // Submit + leaderboard + benchmark together
  'submit leaderboard benchmark "best" in:readme stars:>3',
  // Competition with submissions folder
  '"submissions" leaderboard "cost" in:readme stars:>3',
  // Arena-style benchmarks
  '"arena" benchmark "submit" "leaderboard" in:readme stars:>3',
  // Lean/formal verification competitions
  'lean theorem proving benchmark leaderboard in:readme',
  // Energy/hardware optimization
  '"energy" "benchmark" "submission" "leaderboard" in:readme stars:>3',
  // Optimization competitions with records
  '"record" "best" "submit" "benchmark" in:readme stars:>5',
  // Kaggle-like competitions on GitHub
  '"competition" "leaderboard" "submissions" "rules" in:readme stars:>5',
  // Agent benchmark leaderboards (new pattern found in research)
  'agent benchmark leaderboard "submit" "PR" in:readme stars:>3',
  // SWE-bench style coding agent benchmarks
  '"swe-bench" OR "terminal-bench" OR "agent-anvil" leaderboard in:readme',
  // GEO-Bench and similar
  '"geo-bench" OR "frontier-bench" OR "deep-swe" leaderboard in:readme',
  // Speedruns and kernel/optimization records
  '"speedrun" leaderboard "record" in:readme stars:>5',
  'kernel optimization leaderboard "submission" in:readme stars:>3',
  '"open problems" leaderboard "submit" in:readme stars:>3',
  '"world record" benchmark "submit" "leaderboard" in:readme stars:>3',
  // Theorem-proving / verification leaderboards
  'verified proofs leaderboard "submit" lean OR coq OR isabelle OR dafny in:readme',
];

// ─── GitHub Topics to search ───────────────────────────────────────────
const SEARCH_TOPICS = [
  "leaderboard",
  "speedrun",
  "benchmark-competition",
  "ai-competition",
  "benchmark-leaderboard",
  "agent-evals",
  "ai-benchmark",
  "eval-leaderboard",
];

// ─── Seed repos (known competitions + newly discovered) ─────────────────
const SEED_REPOS = [
  // Original seeds
  { owner: "cybertronai", name: "sutro-problems" },
  { owner: "leanprover", name: "lean-eval-submissions" },
  { owner: "leanprover", name: "lean-eval-leaderboard" },
  { owner: "kings-crown", name: "s2n-bignum-bench" },
  { owner: "SAIRcompetition", name: "equational-theories-lean-stage2" },
  // Newly discovered from web research
  { owner: "actava-ai", name: "leaderboard" },             // CHI-Bench
  { owner: "RDI-Foundation", name: "swe-bench-leaderboard" },
  { owner: "RDI-Foundation", name: "terminal-bench-leaderboard" },
  { owner: "agent-axiom", name: "agent-anvil-leaderboard" },
  { owner: "The-AI-Alliance", name: "GEO-Bench-2-Leaderboard" },
  { owner: "programbench", name: "submissions" },          // ProgramBench
  { owner: "tatsu-lab", name: "alpaca_eval" },             // AlpacaEval
];

/** Repos anywhere on GitHub that ship PROBLEM.md / SUBMISSION.md with our front matter. Needs an authenticated token (code search). */
export async function discoverStandardRepos(): Promise<DiscoveredRepo[]> {
  const octokit = getOctokit();
  const found = new Map<string, DiscoveredRepo>();
  for (const q of [`"${SPEC_MARKERS.problem}" filename:PROBLEM.md`, `"${SPEC_MARKERS.submission}" filename:SUBMISSION.md`]) {
    try {
      const { data } = await octokit.rest.search.code({ q, per_page: 100 });
      for (const item of data.items) {
        const r = item.repository; const key = r.full_name;
        if (found.has(key) || r.fork || r.private) continue;
        try {
          const { data: full } = await octokit.rest.repos.get({ owner: r.owner.login, repo: r.name });
          // verify before it costs anything: the file must parse and carry our marker
          const doc = parseStandardDoc(item.path, await fetchRaw(full.owner.login, full.name, item.path, full.default_branch));
          if (!isStandardDoc(doc)) continue;
          found.set(key, { owner: full.owner.login, name: full.name, url: full.html_url, description: full.description ?? undefined, stars: full.stargazers_count, topics: full.topics ?? [], defaultBranch: full.default_branch, priority: true });
        } catch { /* gone */ }
      }
      console.log(`    standard search "${q.slice(0, 40)}…": ${data.items.length} files`);
    } catch (e) { console.log(`    standard search failed: ${(e as Error).message.slice(0, 120)}`); }
  }
  return [...found.values()];
}

export async function discoverRepos(maxResults = 80): Promise<DiscoveredRepo[]> {
  const octokit = getOctokit();
  const found = new Map<string, DiscoveredRepo>();

  // 0. The standard: repos that ship PROBLEM.md / SUBMISSION.md skip every heuristic filter below
  console.log("  [standard]");
  const standard = await discoverStandardRepos();
  for (const r of standard) found.set(`${r.owner}/${r.name}`, r);

  // 1. Add seed repos
  console.log("  [seeds]");
  for (const { owner, name } of [...SEED_REPOS, ...communitySeeds()]) {
    try {
      const { data } = await octokit.rest.repos.get({ owner, repo: name });
      const key = `${owner}/${name}`;
      found.set(key, {
        owner, name, url: data.html_url,
        description: data.description ?? undefined,
        stars: data.stargazers_count,
        topics: data.topics ?? [],
        defaultBranch: data.default_branch,
      });
      console.log(`    ✓ ${key} ★${data.stargazers_count}`);
    } catch (e) {
      console.log(`    ✗ ${owner}/${name}: ${(e as Error).message}`);
    }
  }

  // 2. GitHub text search
  console.log("  [text search]");
  for (const query of SEARCH_QUERIES) {
    try {
      console.log(`    searching: "${query.slice(0, 60)}..."`);
      const { data } = await octokit.rest.search.repos({
        q: query,
        sort: "stars",
        order: "desc",
        per_page: 15,
      });
      for (const repo of data.items) {
        const key = repo.full_name;
        if (found.has(key)) continue;
        found.set(key, {
          owner: repo.owner?.login ?? "",
          name: repo.name,
          url: repo.html_url,
          description: repo.description ?? undefined,
          stars: repo.stargazers_count,
          topics: repo.topics ?? [],
          defaultBranch: repo.default_branch,
        });
      }
      if (found.size >= maxResults) break;
    } catch (e) {
      console.log(`    FAILED: ${(e as Error).message}`);
    }
  }

  // 3. GitHub topic search
  console.log("  [topic search]");
  for (const topic of SEARCH_TOPICS) {
    try {
      console.log(`    topic: ${topic}`);
      const { data } = await octokit.rest.search.repos({
        q: `topic:${topic}`,
        sort: "stars",
        order: "desc",
        per_page: 15,
      });
      for (const repo of data.items) {
        const key = repo.full_name;
        if (found.has(key)) continue;
        found.set(key, {
          owner: repo.owner?.login ?? "",
          name: repo.name,
          url: repo.html_url,
          description: repo.description ?? undefined,
          stars: repo.stargazers_count,
          topics: repo.topics ?? [],
          defaultBranch: repo.default_branch,
        });
      }
      if (found.size >= maxResults) break;
    } catch (e) {
      console.log(`    FAILED: ${(e as Error).message}`);
    }
  }

  // 4. Crawl: look at stargazers/forks of seed repos for similar competitions
  //    (GitHub API: list repos that starred the same people who starred seeds)
  //    Skip for now — expensive, add later

  const results = [...found.values()];

  // Pre-filter: exclude obvious non-competitions
  const filtered = results.filter((r) => {
    if (r.priority) return true;
    const name = (r.owner + "/" + r.name).toLowerCase();
    const desc = (r.description ?? "").toLowerCase();
    if (name.includes("awesome")) return false;
    if (desc.startsWith("a curated list") || desc.startsWith("a collection of")) return false;
    if (r.stars > 5000) return false;
    if (desc.includes("list of free apis") || desc.includes("papers and datasets")) return false;
    // Exclude obvious non-competition topic matches
    if (desc.includes("awesome list") || desc.includes("tracking the progress")) return false;
    return true;
  });

  filtered.sort((a, b) => Number(!!b.priority) - Number(!!a.priority) || b.stars - a.stars);
  console.log(`  ${results.length} found, ${filtered.length} after filtering`);
  return filtered;
}
