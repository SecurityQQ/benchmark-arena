// Discover competition repos via multiple sources

import { getOctokit, isPublicRepo } from "./github.js";
import type { DiscoveredRepo } from "./types.js";
import { fetchRaw } from "./github.js";
import { isStandardDoc, SPEC_MARKERS } from "./standard.js";
import { parseIngestedDoc } from "./fetcher.js";
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
  { owner: "gpu-mode", name: "reference-kernels" },        // GPU MODE (leaderboards on gpumode.com)
  { owner: "1stproof", name: "batch-2" },                  // First Proof (1stproof.org), referee-graded research math
  { owner: "open-goat", name: "pequalnp-proofs" },         // P = NP? (pequalnp.com): Lean proofs from the AI fleet attacking P vs NP
  // Trending, November 2026: agent-driven races with public records
  { owner: "bigospeedrun", name: "verifier" },             // Big O Speedrun (bigospeedrun.com): Lean-verified complexity records
  { owner: "CrocSwap", name: "integer-mult-bounds" },      // Big O Speedrun's integer-multiplication race: community proofs and certificates
  { owner: "Osgood001", name: "riemann-hypothesis" },      // compressing the Lean proof of the Riemann Hypothesis (riemann.verifytask.cn)
  { owner: "qlabs-eng", name: "noise" },                   // pretraining speedrun without backpropagation
  { owner: "KellerJordan", name: "modded-nanogpt" },       // the original NanoGPT speedrun
  { owner: "google-deepmind", name: "formal-conjectures" }, // formalized open conjectures in Lean (Erdős problems)
  { owner: "teorth", name: "optimizationproblems" },       // best known bounds for optimization problems in mathematics
  { owner: "ndif-team", name: "looped-lens-challenge" },   // NDIF Looped Lens Challenge: interpretability lenses scored on NDIF-hosted models (opened 2026-11-23)
  { owner: "harbor-framework", name: "terminal-bench-challenges" }, // Terminal-Bench Challenges: single hard tasks solved by fully autonomous agents
  { owner: "Saivineeth147", name: "lora-speedrun" },       // LoRA Speedrun: listed since September; a 2026-11-25 crawl dropped it when search missed it
  { owner: "Kaihui-AMD", name: "modelbot-cli" },           // ROCm llama.cpp challenge (rocm-challenge.amddev.ai): patches evaluated on AMD's GPUs, open to 2026-12-31
];

/** Repos anywhere on GitHub that ship PROBLEM.md / SUBMISSION.md with our front matter. Needs an authenticated token (code search). */
export async function discoverStandardRepos(): Promise<DiscoveredRepo[]> {
  const octokit = getOctokit();
  const found = new Map<string, DiscoveredRepo>();
  // the problem file is the anchor: entries (SUBMISSION.md) are found through its submit.path
  for (const q of [`"${SPEC_MARKERS.problem}" filename:PROBLEM.md`]) {
    try {
      const { data } = await octokit.rest.search.code({ q, per_page: 100 });
      for (const item of data.items) {
        const r = item.repository; const key = r.full_name;
        if (found.has(key) || r.fork || !isPublicRepo(r)) continue;
        try {
          const { data: full } = await octokit.rest.repos.get({ owner: r.owner.login, repo: r.name });
          if (!isPublicRepo(full)) continue;
          // verify before it costs anything: the file must parse and carry our marker
          const doc = parseIngestedDoc(item.path, await fetchRaw(full.owner.login, full.name, item.path, full.default_branch));
          if (!isStandardDoc(doc)) continue;
          found.set(key, { owner: full.owner.login, name: full.name, url: full.html_url, description: full.description ?? undefined, stars: full.stargazers_count, topics: full.topics ?? [], defaultBranch: full.default_branch, pushedAt: full.pushed_at ?? undefined, priority: true });
        } catch { /* gone */ }
      }
      console.log(`    standard search "${q.slice(0, 40)}…": ${data.items.length} files`);
    } catch { console.log("    standard search failed"); }
  }
  return [...found.values()];
}

// One known repository by name (seeds, repos already on the list): metadata from the API, public repos only
async function lookupRepo(owner: string, name: string): Promise<DiscoveredRepo | null> {
  const { data } = await getOctokit().rest.repos.get({ owner, repo: name });
  if (!isPublicRepo(data)) return null;
  return {
    owner, name, url: data.html_url,
    description: data.description ?? undefined,
    stars: data.stargazers_count,
    topics: data.topics ?? [],
    defaultBranch: data.default_branch,
    pushedAt: data.pushed_at ?? undefined,
  };
}

/** `listed`: repos of competitions already on the list. They are always looked up and kept past the pre-filter, so a
 *  listed competition leaves the list only through a check (not a competition any more, ended, delisted), never because
 *  this run's searches happened not to return it. */
export async function discoverRepos(maxResults = 80, listed: { owner: string; name: string }[] = []): Promise<DiscoveredRepo[]> {
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
      const repo = await lookupRepo(owner, name);
      if (!repo) continue;
      found.set(`${owner}/${name}`, repo);
      console.log(`    ✓ ${owner}/${name} ★${repo.stars}`);
    } catch {
      console.log("    seed repository lookup failed");
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
        if (found.has(key) || !isPublicRepo(repo)) continue;
        found.set(key, {
          owner: repo.owner?.login ?? "",
          name: repo.name,
          url: repo.html_url,
          description: repo.description ?? undefined,
          stars: repo.stargazers_count,
          topics: repo.topics ?? [],
          defaultBranch: repo.default_branch,
          pushedAt: repo.pushed_at ?? undefined,
        });
      }
      if (found.size >= maxResults) break;
    } catch {
      console.log("    repository text search failed");
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
        if (found.has(key) || !isPublicRepo(repo)) continue;
        found.set(key, {
          owner: repo.owner?.login ?? "",
          name: repo.name,
          url: repo.html_url,
          description: repo.description ?? undefined,
          stars: repo.stargazers_count,
          topics: repo.topics ?? [],
          defaultBranch: repo.default_branch,
          pushedAt: repo.pushed_at ?? undefined,
        });
      }
      if (found.size >= maxResults) break;
    } catch {
      console.log("    repository topic search failed");
    }
  }

  // 4. Crawl: look at stargazers/forks of seed repos for similar competitions
  //    (GitHub API: list repos that starred the same people who starred seeds)
  //    Skip for now — expensive, add later

  // 5. Repos already on the list that the searches above did not return this time
  const seen = new Set([...found.keys()].map((k) => k.toLowerCase()));
  const missing = listed.filter((r) => !seen.has(`${r.owner}/${r.name}`.toLowerCase()));
  if (missing.length) console.log(`  [listed] ${missing.length} not returned by search this run`);
  for (const { owner, name } of missing) {
    try {
      const repo = await lookupRepo(owner, name);
      if (repo) found.set(`${owner}/${name}`, repo);
    } catch {
      console.log("    listed repository lookup failed");
    }
  }

  const results = [...found.values()];
  const filtered = preFilter(results, new Set([...SEED_REPOS, ...communitySeeds(), ...listed].map((s) => `${s.owner}/${s.name}`.toLowerCase())));
  filtered.sort((a, b) => Number(!!b.priority) - Number(!!a.priority) || b.stars - a.stars);
  console.log(`  ${results.length} found, ${filtered.length} after filtering`);
  return filtered;
}

// Exclude obvious non-competitions among search hits. Seeds were picked by hand and the standard's repos declare
// themselves, so neither is second-guessed: modded-nanogpt has 6K stars, formal-conjectures is "a collection of…".
export function preFilter(results: DiscoveredRepo[], seeds: Set<string>): DiscoveredRepo[] {
  return results.filter((r) => {
    if (r.priority || seeds.has(`${r.owner}/${r.name}`.toLowerCase())) return true;
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
}
