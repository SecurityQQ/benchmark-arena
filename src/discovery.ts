// Discover competition repos via multiple sources

import { boundedFetch, getOctokit, isPublicRepo } from "./github.js";
import type { DiscoveredRepo } from "./types.js";
import { isStandardDoc, SPEC_MARKERS } from "./standard.js";
import { parseIngestedDoc } from "./fetcher.js";
import { LISTING_TOPIC, listingRequests } from "./listing.js";
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
  { owner: "Kaihui-AMD", name: "modelbot-cli" },
  { owner: "keyu-wang-2002", name: "DepthDash" },          // DepthDash: modded-NanoGPT-style speedrun on residual-connection design at depth (created 2026-11-15)
  { owner: "basicv8vc", name: "modded-supermimic" },       // Unitree G1 motion-tracking speedrun on 1× Colab G4: training wall time to a 40-clip return target, records by PR           // ROCm llama.cpp challenge (rocm-challenge.amddev.ai): patches evaluated on AMD's GPUs, open to 2026-12-31
  { owner: "rtl-ai", name: "silicon-arena" },              // SiliconArena: agent-driven RTL/ASIC research challenge for AI training/inference chips; adopted problem.md/v1 on 2026-11-25; ranked tracks upcoming
];

// A raw file on a branch, or null when GitHub says it is not there. Any other failure throws: it may pass by the next run.
export async function rawFile(owner: string, name: string, path: string, branch: string): Promise<string | null> {
  const res = await boundedFetch(`https://raw.githubusercontent.com/${owner}/${name}/${branch}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("GitHub raw file request failed");
  return res.text();
}

export type StandardCheck = { ok: true; repo: DiscoveredRepo } | { ok: false; reason: string };

/** Verify before it costs anything: public, not a fork, and the PROBLEM.md on the default branch parses and carries our marker.
 *  A reason only when GitHub answered (it goes back to the organizer); a 5xx or a dropped connection throws, as in assertPublicRepo. */
export async function verifyStandardRepo(owner: string, name: string, path = "PROBLEM.md", raw = rawFile): Promise<StandardCheck> {
  let full;
  try { ({ data: full } = await getOctokit().rest.repos.get({ owner, repo: name })); }
  catch (e) { if ([404, 451].includes((e as { status?: number }).status ?? 0)) return { ok: false, reason: `no public repository at github.com/${owner}/${name}` }; throw e; }
  if (!isPublicRepo(full)) return { ok: false, reason: "the repository is not public" };
  if (full.fork) return { ok: false, reason: "the repository is a fork; list the original repository" };
  const branch = /^[\w./-]{1,100}$/.test(full.default_branch) ? `\`${full.default_branch}\`` : "the default branch";
  // the reasons are posted to the organizer: fixed wording, never text from their file
  const text = await raw(full.owner.login, full.name, path, full.default_branch);
  if (text === null) return { ok: false, reason: `no ${path} with \`spec: ${SPEC_MARKERS.problem}\` at the root of ${branch}` };
  let doc;
  try { doc = parseIngestedDoc(path, text); } catch { return { ok: false, reason: `${path} is over the parser limits (64 KB, 500 front-matter lines)` }; }
  if (doc.errors.some((e) => e.startsWith("invalid YAML") || e.includes("not a mapping"))) return { ok: false, reason: `the front matter of ${path} on ${branch} is not valid YAML` };
  if (!isStandardDoc(doc)) return { ok: false, reason: `${path} on ${branch} does not start with front matter carrying \`spec: ${SPEC_MARKERS.problem}\`` };
  return { ok: true, repo: { owner: full.owner.login, name: full.name, url: full.html_url, description: full.description ?? undefined, stars: full.stargazers_count, topics: full.topics ?? [], defaultBranch: full.default_branch, pushedAt: full.pushed_at ?? undefined, priority: true } };
}

/** Repos anywhere on GitHub that ship PROBLEM.md with our front matter, every one verified. Code search alone finds nothing new
 *  (it does not index new or unstarred repositories), so candidates also come from the open-challenge-list topic, listing issues
 *  on this repository and, with `seeds`, the seed list (the priority lane; the full crawl looks seeds up on its own).
 *  `listed`: repos already on the list, not looked at again (NEW_ONLY: the live refresh follows them). */
export async function discoverStandardRepos(listed: { owner: string; name: string }[] = [], { seeds = false, raw = rawFile } = {}): Promise<DiscoveredRepo[]> {
  const octokit = getOctokit();
  const skip = new Set(listed.map((r) => `${r.owner}/${r.name}`.toLowerCase()));
  const candidates = new Map<string, { owner: string; name: string; path?: string; from: string }>();
  const add = (owner: string, name: string, from: string, path?: string) => {
    const key = `${owner}/${name}`.toLowerCase();
    if (!skip.has(key) && !candidates.has(key)) candidates.set(key, { owner, name, from, path });
  };
  // 1. code search: established repos (the problem file is the anchor; entries are found through its submit.path)
  try {
    const { data } = await octokit.rest.search.code({ q: `"${SPEC_MARKERS.problem}" filename:PROBLEM.md`, per_page: 100 });
    for (const item of data.items) if (!item.repository.fork && isPublicRepo(item.repository)) add(item.repository.owner.login, item.repository.name, "code search", item.path);
    console.log(`    standard code search: ${data.items.length} files`);
  } catch { console.log("    standard search failed"); }
  // 2. the topic: repository search indexes a new repository's topics within minutes
  try {
    const { data } = await octokit.rest.search.repos({ q: `topic:${LISTING_TOPIC}`, sort: "updated", order: "desc", per_page: 50 });
    for (const r of data.items) if (r.owner && !r.fork && isPublicRepo(r)) add(r.owner.login, r.name, `topic ${LISTING_TOPIC}`);
    console.log(`    topic ${LISTING_TOPIC}: ${data.items.length} repos`);
  } catch { console.log("    standard topic search failed"); }
  // 3. listing issues on this repository (only owner/name pairs come out of the issue text)
  try {
    const reqs = await listingRequests();
    for (const q of reqs) for (const r of q.repos) add(r.owner, r.name, `issue #${q.issue}`);
    console.log(`    listing issues: ${reqs.length}`);
  } catch { console.log("    listing issues could not be read"); }
  // 4. seeds not on the list yet: picked by hand, listed within hours once they adopt the standard
  if (seeds) for (const s of [...SEED_REPOS, ...communitySeeds()]) add(s.owner, s.name, "seed");

  const found = new Map<string, DiscoveredRepo>();
  for (const c of candidates.values()) {
    try {
      const v = await verifyStandardRepo(c.owner, c.name, c.path, raw);
      if (v.ok) { found.set(`${v.repo.owner}/${v.repo.name}`.toLowerCase(), v.repo); console.log(`    ✓ ${v.repo.owner}/${v.repo.name} (${c.from})`); }
      else if (c.from !== "seed") console.log(`    ${c.owner}/${c.name} (${c.from}): ${v.reason}`);
    } catch { console.log(`    ${c.owner}/${c.name} (${c.from}): GitHub did not answer, retried on the next run`); }
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
