// Main pipeline: discover repos → fetch pages → process with LLM → save

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./env.js";
loadEnv();

import type { CrawlResult, Competition, DiscoveredRepo } from "./types.js";
import { discoverRepos } from "./discovery.js";
import { fetchRepoPages } from "./fetcher.js";
import { processRepoWithLLM, attributeRecordsWithLLM } from "./llm.js";
import { postprocess } from "./postprocess.js";

const DATA_DIR = join(process.cwd(), "data");
const DISCOVERED_PATH = join(DATA_DIR, "discovered.json");
const RESULT_PATH = join(DATA_DIR, "competitions.json");

async function main() {
  const mode = process.argv[2] ?? "full"; // "discover" | "process" | "full"

  console.log("=== Benchmark Arena Crawler ===");
  console.log(`Mode: ${mode}\n`);

  let repos: DiscoveredRepo[] = [];

  // repost: recompute derived fields (participants, stats, agentStats, roles) from saved data, no LLM calls
  if (mode === "repost") {
    const prev: CrawlResult = JSON.parse(readFileSync(RESULT_PATH, "utf-8"));
    const comps = prev.competitions.map((c) => {
      const repo: DiscoveredRepo = { owner: c.repo!.owner, name: c.repo!.name, url: c.url, stars: 0, topics: [], defaultBranch: c.repo!.branch ?? "main" };
      for (const p of c.problems) for (const r of p.records) if (r.agent) delete (r.agent as any).role;
      return postprocess(c as any, repo);
    });
    writeFileSync(RESULT_PATH, JSON.stringify({ ...prev, competitions: comps }, null, 2));
    console.log(`Recomputed ${comps.length} competitions`);
    return;
  }

  // Step 1: Discovery
  if (mode === "discover" || mode === "full") {
    console.log("[1] Discovering repos...\n");
    repos = await discoverRepos(50);
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DISCOVERED_PATH, JSON.stringify(repos, null, 2));
    console.log(`  Saved ${repos.length} repos to ${DISCOVERED_PATH}\n`);
  } else {
    // Load previously discovered repos
    if (!existsSync(DISCOVERED_PATH)) {
      console.error("No discovered.json found. Run with 'discover' or 'full' mode first.");
      process.exit(1);
    }
    repos = JSON.parse(readFileSync(DISCOVERED_PATH, "utf-8"));
    console.log(`[1] Loaded ${repos.length} repos from cache\n`);
  }

  // Step 2: Process repos with LLM
  if (mode === "discover") {
    console.log("[2] Skipping processing (discover-only mode)\n");
    return;
  }

  console.log("[2] Processing repos with LLM...\n");
  const competitions: Competition[] = [];
  const errors: { repo: string; error: string }[] = [];

  const only = process.env.ONLY?.toLowerCase();
  if (only) repos = repos.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(only));
  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    const repoKey = `${repo.owner}/${repo.name}`;
    console.log(`  [${i + 1}/${repos.length}] ${repoKey} ★${repo.stars}`);

    try {
      // Fetch pages
      const pages = await fetchRepoPages(repo.owner, repo.name, repo.defaultBranch);
      if (pages.pages.length === 0) {
        console.log(`    no pages found, skipping`);
        errors.push({ repo: repoKey, error: "no pages found" });
        continue;
      }
      console.log(`    fetched ${pages.pages.length} pages, ${pages.totalChars} chars`);

      // Process with LLM
      const llmResult = await processRepoWithLLM(pages);
      if (llmResult === null) {
        console.log(`    not a competition, skipping`);
        errors.push({ repo: repoKey, error: "not a competition" });
        continue;
      }

      // Second pass: focused agent attribution using commits/PRs/reports as evidence
      const evidencePages = pages.pages.filter((p) => p.path === "__attribution__" || /submissions?\/.*\.md$/i.test(p.path) || /report|writeup/i.test(p.path));
      const evidence = evidencePages.map((p) => `=== ${p.path} ===\n${p.content}`).join("\n\n");
      const flat: { key: string; problem: string; contributor?: string; date?: string; value: number; description?: string; files?: string[] }[] = [];
      (llmResult.problems ?? []).forEach((p, pi) => (p.records ?? []).forEach((r, ri) => {
        if (!r.agent || r.agent.confidence !== "high") flat.push({ key: `${pi}.${ri}`, problem: p.id, contributor: r.contributor, date: r.date, value: r.value, description: r.description, files: r.submissionUrls });
      }));
      if (flat.length && evidence.length > 200) {
        try {
          const attrs = await attributeRecordsWithLLM(llmResult.id ?? repoKey, flat, evidence);
          let n = 0;
          for (const [key, a] of Object.entries(attrs)) {
            const [pi, ri] = key.split(".").map(Number);
            const rec = llmResult.problems?.[pi]?.records?.[ri];
            if (rec && a && a.family) { rec.agent = a; n++; }
          }
          console.log(`    attribution pass: ${n}/${flat.length} records attributed (${evidencePages.length} evidence pages)`);
        } catch (e) { console.log(`    attribution pass failed: ${(e as Error).message}`); }
      }

      const competition = postprocess(llmResult, repo);
      const { totalRecords, uniqueParticipants } = competition.stats;
      const fams = competition.agentStats.map((a) => `${a.family}:${a.records}`).join(" ");
      console.log(`    ✓ ${competition.name} [${competition.status}] ${competition.problems.length} problems, ${totalRecords} records, ${uniqueParticipants} participants, compute=${competition.participation.compute}${fams ? ` · agents ${fams}` : ""}`);
      competitions.push(competition);
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`    ✗ FAILED: ${msg}`);
      errors.push({ repo: repoKey, error: msg });
    }
  }

  // Step 3: Save results
  console.log(`\n[3] Saving results...`);
  let finalComps = competitions;
  if (only && existsSync(RESULT_PATH)) {
    const prev: CrawlResult = JSON.parse(readFileSync(RESULT_PATH, "utf-8"));
    const ids = new Set(competitions.map((c) => c.repo?.owner + "/" + c.repo?.name));
    finalComps = [...prev.competitions.filter((c) => !ids.has(c.repo?.owner + "/" + c.repo?.name)), ...competitions];
  }
  const result: CrawlResult = {
    crawledAt: new Date().toISOString(),
    competitions: finalComps,
    errors,
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));

  console.log(`  ${competitions.length} competitions found`);
  console.log(`  ${errors.length} repos skipped/failed`);
  console.log(`  Saved to ${RESULT_PATH}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
