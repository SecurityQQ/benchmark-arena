// Compare extraction models on a fixed sample of repos against the current data/competitions.json.
// Every model sees the same fetched pages (snapshotted once), so only the model differs.
//
//   npx tsx scripts/compare-models.ts                       # default candidates
//   MODELS=a/b,c/d REPOS=owner/name,... npx tsx scripts/compare-models.ts
//
// Needs OPENROUTER_API_KEY and GITHUB_TOKEN (e.g. GITHUB_TOKEN=$(gh auth token)).

import { loadEnv } from "../src/env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchRepoPages, type RepoPages } from "../src/fetcher.js";
import { llmUsage, processRepoWithLLM } from "../src/llm.js";
import type { Competition } from "../src/types.js";

loadEnv();
const MODELS = (process.env.MODELS ?? [
  "anthropic/claude-haiku-5.5",
  "openai/gpt-6-luna",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4.1-flash",
  "qwen/qwen3.7-flash",
  "qwen/qwen3.8-flash",
  "z-ai/glm-5.3-flash",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const REPOS = (process.env.REPOS ?? [
  "THUDM/CogDL", "cybertronai/sutro-problems", "zhaoyiyidan/modded-nanogpt-npu", "fstandhartinger/jevbench",
  "tatsu-lab/alpaca_eval", "openai/mle-bench", "LudwigStumpp/llm-leaderboard", "trishullab/PutnamBench",
  "AGI-Edgerunners/LLM-Agents-Papers", "cporter202/scraping-apis-for-devs", "LiveSplit/LiveSplit",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const OUT = join(process.cwd(), "cache", "model-eval");
mkdirSync(OUT, { recursive: true });

const baseline = new Map<string, Competition>(
  (JSON.parse(readFileSync("data/competitions.json", "utf-8")).competitions as Competition[])
    .map((c) => [`${c.repo?.owner}/${c.repo?.name}`.toLowerCase(), c]),
);
const discovered = JSON.parse(readFileSync("data/discovered.json", "utf-8")) as { owner: string; name: string; defaultBranch: string }[];

async function snapshot(repo: string): Promise<RepoPages> {
  const file = join(OUT, `${repo.replace("/", "__")}.pages.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf-8"));
  const [owner, name] = repo.split("/");
  const branch = discovered.find((d) => `${d.owner}/${d.name}`.toLowerCase() === repo.toLowerCase())?.defaultBranch ?? baseline.get(repo.toLowerCase())?.repo?.defaultBranch ?? "main";
  const pages = await fetchRepoPages(owner, name, branch);
  writeFileSync(file, JSON.stringify(pages));
  return pages;
}

const valueKeys = (c: { problems?: { records?: { value: number }[] }[] } | null | undefined) =>
  new Set((c?.problems ?? []).flatMap((p) => (p.records ?? []).map((r) => String(Math.round(r.value * 1e4) / 1e4))));

interface Row { model: string; repo: string; ok: boolean; verdict: "comp" | "none" | "error"; tracks: number; records: number; recall: number | null; cost: number; secs: number; err?: string }

async function runModel(model: string, inputs: [string, RepoPages][]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const [repo, pages] of inputs) {
    const base = baseline.get(repo.toLowerCase());
    const before = llmUsage.byModel[model] ?? 0;
    const outFile = join(OUT, `${repo.replace("/", "__")}.${model.replace(/\//g, "_")}.json`);
    const metaFile = outFile.replace(/\.json$/, ".meta.json");
    if (process.env.RERUN !== "1" && existsSync(metaFile)) { const r = JSON.parse(readFileSync(metaFile, "utf-8")) as Row; if (r.ok) { rows.push(r); continue; } }
    const t = Date.now();
    try {
      const out = await processRepoWithLLM(pages, model, (base?.problems ?? []).map((p) => ({ id: p.id, name: p.name })));
      const recs = (out?.problems ?? []).reduce((s, p) => s + (p.records?.length ?? 0), 0);
      const bk = valueKeys(base), ck = valueKeys(out);
      const recall = bk.size ? [...bk].filter((k) => ck.has(k)).length / bk.size : null;
      rows.push({ model, repo, ok: true, verdict: out ? "comp" : "none", tracks: out?.problems?.length ?? 0, records: recs, recall, cost: (llmUsage.byModel[model] ?? 0) - before, secs: (Date.now() - t) / 1000 });
      writeFileSync(outFile, JSON.stringify(out, null, 2));
    } catch (e) {
      rows.push({ model, repo, ok: false, verdict: "error", tracks: 0, records: 0, recall: null, cost: (llmUsage.byModel[model] ?? 0) - before, secs: (Date.now() - t) / 1000, err: (e as Error).message });
    }
    const r = rows[rows.length - 1];
    writeFileSync(metaFile, JSON.stringify(r));
    console.log(`${model.padEnd(30)} ${repo.padEnd(38)} ${r.verdict.padEnd(5)} tracks ${r.tracks} recs ${r.records} recall ${r.recall === null ? "-" : r.recall.toFixed(2)} $${r.cost.toFixed(4)} ${r.secs.toFixed(0)}s${r.err ? " " + r.err : ""}`);
  }
  return rows;
}

const inputs: [string, RepoPages][] = [];
for (const repo of REPOS) {
  try { inputs.push([repo, await snapshot(repo)]); }
  catch (e) { console.log(`snapshot failed for ${repo}: ${(e as Error).message}`); }
}
console.log(`\n${inputs.length} repos snapshotted, ${MODELS.length} models\n`);

const all = (await Promise.all(MODELS.map((m) => runModel(m, inputs)))).flat();
writeFileSync(join(OUT, "results.json"), JSON.stringify(all, null, 2));

console.log("\nBaseline (current data, gemini-3.5-flash):");
for (const [repo] of inputs) { const b = baseline.get(repo.toLowerCase()); console.log(`  ${repo.padEnd(38)} ${b ? `tracks ${b.problems.length} recs ${b.stats.totalRecords}` : "not a competition"}`); }

console.log("\nSummary (verdictAgree = matches baseline comp/not-comp; recall = share of baseline record values found):");
for (const m of MODELS) {
  const rs = all.filter((r) => r.model === m);
  const agree = rs.filter((r) => r.verdict === (baseline.has(r.repo.toLowerCase()) ? "comp" : "none")).length;
  const recalls = rs.map((r) => r.recall).filter((x): x is number => x !== null);
  const cost = rs.reduce((s, r) => s + r.cost, 0);
  console.log(`  ${m.padEnd(30)} errors ${rs.filter((r) => !r.ok).length}/${rs.length}  verdictAgree ${agree}/${rs.length}  meanRecall ${recalls.length ? (recalls.reduce((a, b) => a + b, 0) / recalls.length).toFixed(2) : "-"}  cost $${cost.toFixed(4)}  avg ${(rs.reduce((s, r) => s + r.secs, 0) / rs.length).toFixed(0)}s`);
}
