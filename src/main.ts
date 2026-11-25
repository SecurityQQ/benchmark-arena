// Main pipeline: discover repos → fetch pages → process with LLM → save

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./env.js";
loadEnv();

import type { CrawlResult, Competition, DiscoveredRepo, RepoState } from "./types.js";
import { discoverRepos } from "./discovery.js";
import { clearRepoCache, fetchRepoPages } from "./fetcher.js";
import { processRepoWithLLM, attributeRecordsWithLLM, EXTRACTION_FINGERPRINT, llmUsage } from "./llm.js";
import { postprocess } from "./postprocess.js";
import { buildLeanEval } from "./structured/leanEval.js";
import { buildGpuMode } from "./structured/gpuMode.js";
import { buildFirstProof } from "./structured/firstProof.js";
import { buildDuckBench } from "./structured/duckBench.js";
import { buildOpenDiscovery } from "./structured/openDiscovery.js";
import { buildPequalnp } from "./structured/pequalnp.js";
import { buildBigOSpeedrun } from "./structured/bigOSpeedrun.js";
import { buildRocmChallenge } from "./structured/rocmChallenge.js";
import { applyStandard } from "./standard.js";
import type { LLMCompetition } from "./llm.js";
import { assertPublicRepo, isNotPublic } from "./github.js";
import { assertUniqueCompetitions, entryKey, repoKey, savedEntries, validateCompetition, type SiteSource } from "./validation.js";
import { branchHead, detectChanges, githubProbe, type SourceProbe } from "./freshness.js";
import { datePinnedRecords, loadCommitDates, saveCommitDates, type CommitDates } from "./commitDates.js";
import { refreshDiscoveries } from "./discoveries.js";
import { pathToFileURL } from "node:url";
export type { RepoState } from "./types.js";

function loadPrevious(): Competition[] {
  if (!existsSync(RESULT_PATH)) return [];
  const entries = savedEntries(JSON.parse(readFileSync(RESULT_PATH, "utf-8"))).map(({ value, source, id }) => {
    const c = postprocess(value, source);
    c.id = id;
    return c;
  });
  assertUniqueCompetitions(entries);
  return entries;
}

export async function publicCompetitions(entries: Competition[], blocked = new Set<string>(), assertPublic = assertPublicRepo): Promise<Competition[]> {
  const publicEntries: Competition[] = [];
  for (const c of entries) {
    // no repository to check: only a registered site is published (its builder reads the site's public API)
    if (!c.repo) { if (Object.hasOwn(SITES, c.id)) publicEntries.push(c); continue; }
    if (blocked.has(repoKey(c.repo))) continue;
    try { await assertPublic(c.repo.owner, c.repo.name); publicEntries.push(c); }
    catch (e) {
      // not public: drop it everywhere. Couldn't ask GitHub: the entry was verified when it was crawled, so it stays
      if (isNotPublic(e)) blocked.add(repoKey(c.repo));
      else { console.log(`  ${repoKey(c.repo)}: GitHub did not answer the visibility check, keeping the entry`); publicEntries.push(c); }
    }
  }
  return publicEntries;
}

export function mergeCompetitions(previous: Competition[], current: Competition[], blocked = new Set<string>()): Competition[] {
  const produced = new Set(current.map(entryKey));
  const result = [...previous.filter((c) => !produced.has(entryKey(c)) && !blocked.has(entryKey(c)) && !MERGED_INTO[entryKey(c)]), ...current.filter((c) => !blocked.has(entryKey(c)))];
  assertUniqueCompetitions(result);
  return result;
}

// Priority lane: its own boards merged into the saved data as it is on disk, so every other board stays byte for byte as the
// last run wrote it. Loading them through postprocess again would reorder the structured boards' participants (GPU MODE alone:
// ~16K lines of diff) and stamp every lastUpdated; dating and visibility checks are the live refresh's job for those boards.
export async function mergeLane(saved: Competition[], produced: Competition[], blocked: Set<string>, dates: CommitDates, assertPublic = assertPublicRepo): Promise<Competition[]> {
  return mergeCompetitions(saved, await publicCompetitions(await datePinned(produced, dates), blocked, assertPublic), blocked);
}

// Repos with an official machine-readable results store: build deterministically, never via LLM
const STRUCTURED: Record<string, () => Promise<LLMCompetition>> = {
  "leanprover/lean-eval-submissions": buildLeanEval,
  "gpu-mode/reference-kernels": buildGpuMode,             // leaderboards live on gpumode.com
  "1stproof/batch-2": buildFirstProof,                    // every graded batch, read from the arXiv reports (1stproof.org)
  "open-goat/pequalnp-proofs": buildPequalnp,             // P = NP? (pequalnp.com): the board lives on the site, agent evidence in the merged PRs
  "bigospeedrun/verifier": buildBigOSpeedrun,             // Big O Speedrun (bigospeedrun.com): the verifier takes Lean proofs, the records live on the site
  "kaihui-amd/modelbot-cli": buildRocmChallenge,          // ROCm llama.cpp challenge (rocm-challenge.amddev.ai): the repo is the contestant CLI, the boards live on the site
};
// Repos that are facets of a competition handled elsewhere (site generator, benchmark source) — skip to avoid duplicates
const MERGED_INTO: Record<string, string> = {
  "leanprover/lean-eval-leaderboard": "leanprover/lean-eval-submissions",
  "leanprover/lean-eval": "leanprover/lean-eval-submissions",
  "1stproof/batch-1": "1stproof/batch-2",
  "1stproof/batch-3": "1stproof/batch-2",
};
// Competitions hosted on their own site with no GitHub repository: no discovery, push check or LLM; the official public API is read on every crawl.
// Keyed by competition id, which is also the published id (/c/<id>).
const SITES: Record<string, { url: string; build: () => Promise<LLMCompetition> }> = {
  duckbench: { url: "https://duckbench.app/", build: buildDuckBench },  // DuckBench: robot-duck challenges for coding agents
  "open-discovery-challenge": { url: "https://huggingface.co/spaces/FINAL-Bench/open-discovery-challenge", build: buildOpenDiscovery },  // Open Discovery Challenge (FINAL-Bench): AI-designed drug candidates, scored on the organizers' GPUs
};

// Built from an official results API: deterministic, no LLM, cheap enough to run every few hours
async function buildStructured(repo: DiscoveredRepo, prev?: Competition): Promise<Competition> {
  return postprocess(await STRUCTURED[repoKey(repo)](), repo, prev);
}
async function buildSite(id: string, prev?: Competition): Promise<Competition> {
  return postprocess(await SITES[id].build(), { site: id, url: SITES[id].url } satisfies SiteSource, prev);
}
// An LLM pass is noisy and an API can hiccup: a sudden shrink keeps the previous, richer version
const shrunk = (c: Competition, prev?: Competition) => !!prev && prev.stats.totalRecords >= 10 && c.stats.totalRecords < prev.stats.totalRecords * 0.6;
const agentSummary = (c: Competition) => c.agentStats.map((a) => `${a.family}:${a.records}`).join(" ");

const DATA_DIR = join(process.cwd(), "data");
const DISCOVERED_PATH = join(DATA_DIR, "discovered.json");
const RESULT_PATH = join(DATA_DIR, "competitions.json");
const STATE_PATH = join(DATA_DIR, "crawl-state.json");

// What the last LLM pass saw per repo (RepoState): an unchanged repo is not re-sent to the LLM
const DAY = 86_400_000;
const MAX_AGE_DAYS = { competition: 28, none: 56 }; // re-check now and then anyway: deadlines pass, statuses change

function loadState(): Record<string, RepoState> {
  try { return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf-8")) : {}; } catch { return {}; }
}
function saveState(state: Record<string, RepoState>, updates: Map<string, RepoState>, blocked: Set<string>): void {
  const next = { ...state };
  for (const [k, v] of updates) next[k] = v;
  for (const k of blocked) delete next[k];
  writeFileSync(STATE_PATH, JSON.stringify(Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");
}

export function canSkip(st: RepoState | undefined, repo: DiscoveredRepo, now = Date.now(), force = process.env.FORCE === "1"): RepoState["verdict"] | null {
  if (force || !st || !repo.pushedAt || st.pushedAt !== repo.pushedAt || st.fingerprint !== EXTRACTION_FINGERPRINT) return null;
  const age = now - Date.parse(st.checkedAt);
  return Number.isFinite(age) && age < MAX_AGE_DAYS[st.verdict] * DAY ? st.verdict : null;
}

export type Extraction =
  | { kind: "empty" }                                                              // nothing to read
  | { kind: "none"; head?: string; sources: string[] }                             // read, not a competition
  | { kind: "competition"; competition: Competition; head?: string; sources: string[] };

// One repository through the LLM, shared by the weekly crawl and the live re-extraction: pages → extraction →
// PROBLEM.md / SUBMISSION.md overlay → dates from pinned commits → attribution pass → derived stats. Throws on failure.
export async function extractRepo(repo: DiscoveredRepo, prevEntry: Competition | undefined, dates: CommitDates): Promise<Extraction> {
  // the commit the files are read at, taken first: a push during the read only costs one extra re-read later
  const head = await branchHead(repo.owner, repo.name, repo.defaultBranch).catch(() => undefined);
  const pages = await fetchRepoPages(repo.owner, repo.name, repo.defaultBranch);
  if (pages.pages.length === 0) return { kind: "empty" };
  console.log(`    fetched ${pages.pages.length} pages, ${pages.totalChars} chars`);
  const watch = { ...(head ? { head } : {}), sources: pages.sources };

  // Process with LLM, then overlay the facts declared in PROBLEM.md / SUBMISSION.md
  const extracted = await processRepoWithLLM(pages, undefined, (prevEntry?.problems ?? []).map((p) => ({ id: p.id, name: p.name })));
  const { competition: overlaid, info: standardInfo } = applyStandard(extracted, pages.standardDocs, { ...repo, branch: repo.defaultBranch });
  const llmResult = overlaid === null ? null : validateCompetition({ ...overlaid, ...(standardInfo ? { standard: standardInfo } : {}) }, repo);
  if (standardInfo) console.log(`    standard: PROBLEM.md ${standardInfo.problem ? "✓" : "—"} · ${standardInfo.submissions} SUBMISSION.md row(s)${standardInfo.warnings.length ? ` · ${standardInfo.warnings.length} warning(s)` : ""}`);
  if (llmResult === null) return { kind: "none", ...watch };

  // before the attribution pass (it matches evidence by date) and the carry-over below (keyed by date)
  const dated = await datePinnedRecords(llmResult.problems ?? [], repo, dates);
  if (dated) console.log(`    ${dated} record(s) dated from pinned commits`);

  // Second pass: focused agent attribution using commits/PRs/reports as evidence
  const evidencePages = pages.pages.filter((p) => p.path === "__attribution__" || /submissions?\/.*\.md$/i.test(p.path) || /report|writeup/i.test(p.path));
  const evidence = evidencePages.map((p) => `=== ${p.path} ===\n${p.content}`).join("\n\n");
  const flat: { key: string; problem: string; contributor?: string; date?: string; value: number; description?: string; files?: string[] }[] = [];
  (llmResult.problems ?? []).forEach((p, pi) => (p.records ?? []).forEach((r, ri) => {
    if (!r.agent || r.agent.confidence !== "high") flat.push({ key: `${pi}.${ri}`, problem: p.id, contributor: r.contributor, date: r.date, value: r.value, description: r.description, files: r.submissionUrls });
  }));
  if (flat.length && evidence.length > 200) {
    try {
      const attrs = await attributeRecordsWithLLM(llmResult.id, flat, evidence);
      let n = 0;
      for (const [key, a] of Object.entries(attrs)) {
        const [pi, ri] = key.split(".").map(Number);
        const rec = llmResult.problems?.[pi]?.records?.[ri];
        if (rec && a && a.family) { rec.agent = a; n++; }
      }
      console.log(`    attribution pass: ${n}/${flat.length} records attributed (${evidencePages.length} evidence pages)`);
    } catch { console.log("    attribution pass failed"); }
  }

  // Safety net for attribution: an evidenced agent found by an earlier crawl is not lost because this pass missed it
  if (prevEntry) {
    const prevAgents = new Map(prevEntry.problems.flatMap((p) => p.records.filter((r) => r.agent).map((r) => [`${p.id}|${r.date}|${r.value}|${r.contributor}`, r.agent!] as const)));
    let kept = 0;
    for (const p of llmResult.problems ?? []) for (const r of p.records ?? []) {
      const a = prevAgents.get(`${p.id}|${r.date}|${r.value}|${r.contributor}`);
      if (!r.agent && a) { r.agent = a; kept++; }
    }
    if (kept) console.log(`    attribution carried over from the previous crawl: ${kept}`);
  }

  const competition = postprocess(llmResult, repo, prevEntry);
  const { totalRecords, uniqueParticipants } = competition.stats;
  const fams = competition.agentStats.map((a) => `${a.family}:${a.records}`).join(" ");
  console.log(`    ✓ ${competition.name} [${competition.status}] ${competition.problems.length} problems, ${totalRecords} records, ${uniqueParticipants} participants, compute=${competition.participation.compute}${fams ? ` · agents ${fams}` : ""}`);
  return { kind: "competition", competition, ...watch };
}

// Saved entries: an undated record that links a pinned commit of its own repo gets that commit's date, and the entry's stats
// are derived again. LLM-extracted boards only: structured builders and sites date their records themselves.
export async function datePinned(comps: Competition[], dates: CommitDates): Promise<Competition[]> {
  const out: Competition[] = [];
  for (const c of comps) {
    const n = c.repo && !STRUCTURED[repoKey(c.repo)] ? await datePinnedRecords(c.problems, c.repo, dates) : 0;
    if (!n) { out.push(c); continue; }
    const { owner, name, branch } = c.repo!;
    out.push(postprocess(c, { owner, name, url: `https://github.com/${owner}/${name}`, defaultBranch: branch ?? "main", stars: 0, topics: [] }, c));
    console.log(`  ${c.name}: ${n} record(s) dated from pinned commits`);
  }
  if (dates.deferred.size) console.log(`  ${dates.deferred.size} pinned commit(s) over the lookup cap, dated on the next run`);
  return out;
}

export interface LiveDeps {
  probe: SourceProbe;
  extract: (repo: DiscoveredRepo, prev: Competition) => Promise<Extraction>;
  max: number;              // LLM re-extractions per run
  hasKey: boolean;          // OPENROUTER_API_KEY present
  now?: number;
  deadline?: number;        // no re-extraction starts after this (ms): the job's timeout must not eat the refresh
}

// Live: re-extract the LLM-crawled boards whose sources changed since their extraction, most recently pushed first, at most
// deps.max per run; the rest wait for the next run (their state is untouched). Merged like ONLY=… process mode: a failure,
// "not a competition" or a shrunk board keeps the previous entry.
export async function liveRecrawl(known: DiscoveredRepo[], state: Record<string, RepoState>, prevByKey: Map<string, Competition>, deps: LiveDeps) {
  const now = deps.now ?? Date.now();
  // never boards with a deterministic builder (sites have no repository, so they are not in `known`)
  const repos = known.filter((r) => !STRUCTURED[repoKey(r)] && !MERGED_INTO[repoKey(r)] && prevByKey.has(repoKey(r)));
  const report = await detectChanges(repos, state, deps.probe, now);
  const updates = new Map<string, RepoState>([...report.baselines].map(([k, head]) => [k, { ...state[k], head }]));
  const fresh: Competition[] = [];
  console.log(`  LLM boards: ${report.checked} checked · ${report.quiet} unchanged · ${report.codeOnly.length} pushed without touching a source${report.codeOnly.length ? ` (${report.codeOnly.join(", ")})` : ""} · ${report.changed.length} changed${report.backoff.length ? ` · ${report.backoff.length} backing off after a failure` : ""}${report.failed.length ? ` · ${report.failed.length} check(s) failed` : ""}`);
  for (const c of report.changed) console.log(`    ${repoKey(c.repo)}: ${c.files.slice(0, 4).join(", ")}${c.files.length > 4 ? ` +${c.files.length - 4}` : ""}`);
  if (report.changed.length && !deps.hasKey) {
    console.log(`  OPENROUTER_API_KEY not set: ${report.changed.length} changed board(s) not re-extracted`);
    return { fresh, updates, ran: 0, deferred: report.changed.map((c) => repoKey(c.repo)) };
  }
  const run = report.changed.slice(0, Math.max(0, deps.max));
  const deferred = report.changed.slice(run.length).map((c) => repoKey(c.repo));
  if (deferred.length) console.log(`  LIVE_RECRAWL_MAX=${deps.max}: ${deferred.length} changed board(s) left for the next run: ${deferred.join(", ")}`);
  let ran = 0;
  for (const c of run) {
    const key = repoKey(c.repo), prev = prevByKey.get(key)!;
    if (Date.now() > (deps.deadline ?? Infinity)) { deferred.push(key); console.log(`  ${key}: out of time, left for the next run`); continue; }
    const keep = (why: string) => {
      console.log(`  ! ${key}: ${why}, keeping the previous entry`);
      updates.set(key, { ...state[key], liveFailedAt: new Date(now).toISOString() });
    };
    console.log(`  [live] ${key}`);
    ran++;
    try {
      const x = await deps.extract(c.repo, prev);
      if (x.kind !== "competition") { keep(x.kind === "none" ? "came back as not a competition" : "no pages found"); continue; }
      if (shrunk(x.competition, prev)) { keep(`records ${prev.stats.totalRecords} → ${x.competition.stats.totalRecords}`); continue; }
      fresh.push(x.competition);
      updates.set(key, { pushedAt: c.pushedAt ?? state[key].pushedAt, fingerprint: EXTRACTION_FINGERPRINT, verdict: "competition", checkedAt: new Date().toISOString(), ...(x.head ? { head: x.head } : {}), sources: x.sources, live: true });
    } catch { keep("re-extraction failed"); }
  }
  return { fresh, updates, ran, deferred };
}

async function main() {
  const mode = process.argv[2] ?? "full"; // "discover" | "process" | "full" | "priority" | "repost" | "live"
  if (!["full", "discover", "process", "priority", "repost", "live"].includes(mode)) throw new Error("Invalid mode");

  console.log("=== Open Challenge List Crawler ===");
  console.log(`Mode: ${mode}\n`);

  let repos: DiscoveredRepo[] = [];

  // repost: recompute derived fields (participants, stats, agentStats, roles, dates from pinned commits) from saved data, no LLM calls
  if (mode === "repost") {
    const entries = savedEntries(JSON.parse(readFileSync(RESULT_PATH, "utf-8")));
    const dates = loadCommitDates();
    const comps = await publicCompetitions(await datePinned(entries.map(({ value, source, id }) => {
      const validated = validateCompetition(value, source);
      for (const p of validated.problems) for (const r of p.records) if (r.agent) Reflect.deleteProperty(r.agent, "role");
      const c = postprocess(validated, source);
      c.id = id;
      return c;
    }), dates));
    assertUniqueCompetitions(comps);
    writeFileSync(RESULT_PATH, JSON.stringify({ crawledAt: new Date().toISOString(), competitions: comps, errors: [] }, null, 2));
    saveCommitDates(dates);
    console.log(`Recomputed ${comps.length} competitions`);
    return;
  }

  // live: re-read the official results APIs (structured repos and sites), then re-extract with the LLM only the boards whose
  // leaderboard files changed since their last extraction (at most LIVE_RECRAWL_MAX), and merge into the dataset.
  // No discovery: new entries reach the site within hours, not at the weekly crawl. Also re-reads Palomar's registry for
  // "Fresh discoveries" (data/discoveries.json), on its own: a failure there keeps the previous file and nothing else.
  if (mode === "live") {
    const prevComps = loadPrevious();
    const prevByKey = new Map(prevComps.map((c) => [entryKey(c), c]));
    const known: DiscoveredRepo[] = existsSync(DISCOVERED_PATH) ? JSON.parse(readFileSync(DISCOVERED_PATH, "utf-8")) : [];
    const fresh: Competition[] = [];
    const blocked = new Set<string>();
    const sources: [string, () => Promise<Competition>][] = [
      ...known.filter((r) => STRUCTURED[repoKey(r)] && prevByKey.has(repoKey(r))).map((r): [string, () => Promise<Competition>] => [repoKey(r), async () => {
        await assertPublicRepo(r.owner, r.name).catch((e) => { if (isNotPublic(e)) blocked.add(repoKey(r)); throw e; });
        return buildStructured(r, prevByKey.get(repoKey(r)));
      }]),
      ...Object.keys(SITES).filter((id) => prevByKey.has(`site:${id}`)).map((id): [string, () => Promise<Competition>] => [`site:${id}`, () => buildSite(id, prevByKey.get(`site:${id}`))]),
    ];
    for (const [key, build] of sources) {
      try {
        const c = await build(), prev = prevByKey.get(key)!;
        if (shrunk(c, prev)) { console.log(`  ! ${c.name}: records ${prev.stats.totalRecords} → ${c.stats.totalRecords}, keeping the previous version`); continue; }
        console.log(`  ✓ ${c.name}: ${c.stats.totalRecords} records (${c.stats.totalRecords - prev.stats.totalRecords >= 0 ? "+" : ""}${c.stats.totalRecords - prev.stats.totalRecords})${agentSummary(c) ? ` · agents ${agentSummary(c)}` : ""}`);
        fresh.push(c);
      } catch { console.log(`  ${key}: refresh failed, keeping the previous entry`); }
    }
    const refreshed = fresh.length;
    const state = loadState(), dates = loadCommitDates(), probed = { calls: 0 };
    const cap = Number(process.env.LIVE_RECRAWL_MAX ?? 4);
    const live = await liveRecrawl(known, state, prevByKey, {
      probe: githubProbe(probed),
      // a fresh checkout has no fetch cache; a local one may hold files from before the change
      extract: (repo, prev) => { clearRepoCache(repo.owner, repo.name); return extractRepo(repo, prev, dates); },
      max: Number.isInteger(cap) && cap >= 0 ? cap : 4,
      hasKey: !!process.env.OPENROUTER_API_KEY,
      deadline: Date.now() + 30 * 60_000,
    });
    fresh.push(...live.fresh);
    const comps = await publicCompetitions(await datePinned(mergeCompetitions(prevComps, fresh, blocked), dates), blocked);
    assertUniqueCompetitions(comps);
    writeFileSync(RESULT_PATH, JSON.stringify({ crawledAt: new Date().toISOString(), competitions: comps, errors: [] }, null, 2));
    saveState(state, live.updates, blocked);
    saveCommitDates(dates);
    await refreshDiscoveries(process.cwd());
    console.log(`Refreshed ${refreshed}/${sources.length} live sources; re-extracted ${live.fresh.length}/${live.ran} changed LLM boards (${live.deferred.length} left for the next run, ${probed.calls} GitHub calls to check); ${comps.length} competitions saved`);
    if (llmUsage.calls) console.log(`LLM: ${llmUsage.calls} calls, ${llmUsage.promptTokens} in / ${llmUsage.completionTokens} out tokens, $${llmUsage.cost.toFixed(4)}`);
    return;
  }

  // Step 1: Discovery
  if (mode === "priority") {
    // Fast lane: only repos that ship PROBLEM.md / SUBMISSION.md (code search, the open-challenge-list topic, listing issues,
    // seeds), merged into the existing data. NEW_ONLY=1 (every live refresh): only repos not on the list yet, at most
    // PRIORITY_MAX; listed boards are the live re-extraction's job, so no board is re-read here and nothing else is rewritten.
    // Nothing new: nothing is written at all.
    console.log("[1] Priority lane: discovering repos that follow the standard...\n");
    const { discoverStandardRepos } = await import("./discovery.js");
    const known: DiscoveredRepo[] = existsSync(DISCOVERED_PATH) ? JSON.parse(readFileSync(DISCOVERED_PATH, "utf-8")) : [];
    const listed = loadPrevious();
    const newOnly = process.env.NEW_ONLY === "1";
    const already = new Set(listed.filter((c) => c.standard).map((c) => repoKey(c.repo!)));
    const found = await discoverStandardRepos(newOnly ? listed.flatMap((c) => (c.repo ? [c.repo] : [])) : [], { seeds: true });
    const byKey = new Map(found.map((r) => [`${r.owner}/${r.name}`.toLowerCase(), r]));
    if (!newOnly) for (const k of known) if (already.has(`${k.owner}/${k.name}`.toLowerCase()) && !byKey.has(`${k.owner}/${k.name}`.toLowerCase())) byKey.set(`${k.owner}/${k.name}`.toLowerCase(), { ...k, priority: true });
    // never-read repos first, so one that keeps coming back "not a competition" cannot hold a slot under the cap
    const cap = Number(process.env.PRIORITY_MAX ?? 3), seen = loadState();
    repos = [...byKey.values()].sort((a, b) => Number(!!seen[repoKey(a)]) - Number(!!seen[repoKey(b)])).slice(0, newOnly && Number.isInteger(cap) && cap >= 0 ? cap : undefined);
    if (!repos.length) { console.log("  nothing in the priority lane, nothing written"); return; }
    // remember them for the regular crawl too
    const merged = new Map(known.map((r) => [`${r.owner}/${r.name}`.toLowerCase(), r]));
    for (const r of repos) merged.set(`${r.owner}/${r.name}`.toLowerCase(), { ...(merged.get(`${r.owner}/${r.name}`.toLowerCase()) ?? r), priority: true });
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DISCOVERED_PATH, JSON.stringify([...merged.values()], null, 2));
    console.log(`  ${repos.length} repos in the priority lane\n`);
  } else if (mode === "discover" || mode === "full") {
    console.log("[1] Discovering repos...\n");
    repos = await discoverRepos(Number(process.env.MAX_REPOS ?? 120), loadPrevious().flatMap((c) => (c.repo ? [{ owner: c.repo.owner, name: c.repo.name }] : [])));
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

  // ONLY accepts a comma-separated list of substrings of "owner/name"
  // the standard earns a place at the front of the queue
  repos.sort((a, b) => Number(!!b.priority) - Number(!!a.priority));
  const only = process.env.ONLY?.toLowerCase();
  const onlyList = only ? only.split(",").map((x) => x.trim()).filter(Boolean) : [];
  if (only) repos = repos.filter((r) => onlyList.some((o) => `${r.owner}/${r.name}`.toLowerCase().includes(o)));
  // Previous crawl: the safety net. An LLM pass is noisy, so a known competition is never dropped or gutted by a single bad answer.
  const prevComps = loadPrevious();
  const blocked = new Set<string>();
  const prevByRepo = new Map(prevComps.map((c) => [entryKey(c), c]));
  const state = loadState();
  const stateUpdates = new Map<string, RepoState>();
  const dates = loadCommitDates();
  let skipped = 0;
  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    const key = repoKey(repo);
    const repoName = `${repo.owner}/${repo.name}`;
    console.log(`  [${i + 1}/${repos.length}] ${repoName}`);

    if (MERGED_INTO[key]) {
      console.log("    merged into another competition, skipping");
      errors.push({ repo: key, error: "merged into another competition" });
      continue;
    }
    try { await assertPublicRepo(repo.owner, repo.name); }
    catch (e) {
      if (isNotPublic(e)) blocked.add(key); // otherwise the previous entry is carried over below
      errors.push({ repo: key, error: "Public repository verification failed" });
      console.log("    public repository verification failed, excluding entry");
      continue;
    }
    if (STRUCTURED[key]) {
      try {
        const competition = await buildStructured(repo, prevByRepo.get(key));
        const fams = agentSummary(competition);
        console.log(`    ✓ ${competition.name} [structured] ${competition.problems.length} tracks, ${competition.stats.totalRecords} records, ${competition.stats.uniqueParticipants} participants${fams ? ` · agents ${fams}` : ""}`);
        competitions.push(competition);
      } catch {
        console.log("    structured build failed");
        errors.push({ repo: key, error: "Structured build failed" });
      }
      continue;
    }
    const prevEntry = prevByRepo.get(key);
    const skip = canSkip(state[key], repo);
    if (skip === "competition" && prevEntry) {
      console.log(`    unchanged since ${repo.pushedAt}, reusing the previous entry (no LLM call)`);
      competitions.push(prevEntry);
      skipped++;
      continue;
    }
    if (skip === "none" && !prevEntry) {
      console.log(`    unchanged since ${repo.pushedAt}, still not a competition (no LLM call)`);
      errors.push({ repo: key, error: "not a competition" });
      skipped++;
      continue;
    }
    // new push (or first time), or re-read by a live run since this cache was filled: the cached README/leaderboard text is stale
    if ((repo.pushedAt && state[key]?.pushedAt !== repo.pushedAt) || state[key]?.live) {
      const n = clearRepoCache(repo.owner, repo.name);
      if (n) console.log(`    ${state[key]?.live ? "re-read by a live run" : "new push"}, dropped ${n} cached file(s)`);
    }
    const remember = (verdict: RepoState["verdict"], watch: Pick<RepoState, "head" | "sources"> = {}) => {
      if (repo.pushedAt) stateUpdates.set(key, { pushedAt: repo.pushedAt, fingerprint: EXTRACTION_FINGERPRINT, verdict, checkedAt: new Date().toISOString(), ...watch });
    };
    try {
      const x = await extractRepo(repo, prevEntry, dates);
      if (x.kind === "empty") {
        console.log(`    no pages found, skipping`);
        errors.push({ repo: key, error: "no pages found" });
        continue;
      }
      if (x.kind === "none") {
        console.log(`    not a competition, skipping`);
        errors.push({ repo: key, error: "not a competition" });
        if (!prevEntry) remember("none"); // a known competition that came back empty is retried next time
        continue;
      }
      competitions.push(x.competition);
      remember("competition", { ...(x.head ? { head: x.head } : {}), sources: x.sources });
    } catch {
      console.log("    repository processing failed");
      errors.push({ repo: key, error: "Repository processing failed" });
    }
  }
  // the lane read nothing new: the saved data stays byte for byte as it was (no re-merge, no visibility checks)
  if (mode === "priority" && !competitions.length && !stateUpdates.size && !blocked.size) { console.log("  nothing new from the priority lane, nothing written"); return; }

  // Sites: built from their public APIs on every crawl (not in the priority lane, which is about PROBLEM.md repos); ONLY matches their id
  const sites = mode === "priority" ? [] : Object.keys(SITES).filter((id) => !only || onlyList.some((o) => id.includes(o)));
  for (const id of sites) {
    const key = `site:${id}`;
    console.log(`  [site] ${id}`);
    try {
      const competition = await buildSite(id, prevByRepo.get(key));
      const fams = agentSummary(competition);
      console.log(`    ✓ ${competition.name} [site] ${competition.problems.length} tracks, ${competition.stats.totalRecords} records, ${competition.stats.uniqueParticipants} participants${fams ? ` · agents ${fams}` : ""}`);
      competitions.push(competition);
    } catch {
      console.log("    site build failed");
      errors.push({ repo: key, error: "Site build failed" }); // the safety net below carries the previous entry over
    }
  }

  // Safety net, part 1: a suspicious shrink (LLM truncation) keeps the previous, richer version
  for (let i = 0; i < competitions.length; i++) {
    const c = competitions[i], prev = prevByRepo.get(entryKey(c));
    if (prev && shrunk(c, prev)) {
      console.log(`  ! ${c.name}: records ${prev.stats.totalRecords} → ${c.stats.totalRecords}, keeping the previous version`);
      competitions[i] = prev;
      stateUpdates.delete(entryKey(c)); // retry next crawl
    }
  }
  // Safety net, part 2: a known competition that came back "not a competition" or failed this time is carried over, not deleted
  const produced = new Set(competitions.map(entryKey));
  for (const e of errors) {
    const k = e.repo.toLowerCase(), prev = prevByRepo.get(k);
    if (prev && !blocked.has(k) && !produced.has(k) && !MERGED_INTO[k]) { console.log(`  ! ${e.repo}: carrying over the previous entry`); competitions.push(prev); produced.add(k); e.error += " (previous entry kept)"; }
  }

  // Step 3: Save results
  console.log(`\n[3] Saving results...`);
  let finalComps = competitions;
  if (mode === "priority" && existsSync(RESULT_PATH)) finalComps = await mergeLane((JSON.parse(readFileSync(RESULT_PATH, "utf-8")) as CrawlResult).competitions, competitions, blocked, dates);
  else {
    if (only && existsSync(RESULT_PATH)) finalComps = mergeCompetitions(prevComps, competitions, blocked);
    finalComps = await publicCompetitions(await datePinned(finalComps, dates), blocked);
  }
  assertUniqueCompetitions(finalComps);
  for (const key of blocked) {
    const error = errors.find((e) => e.repo.toLowerCase() === key);
    if (error) error.error = "Public repository verification failed";
    else errors.push({ repo: key, error: "Public repository verification failed" });
  }
  const result: CrawlResult = {
    crawledAt: new Date().toISOString(),
    competitions: finalComps,
    errors,
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  saveState(state, stateUpdates, blocked);
  saveCommitDates(dates);

  console.log(`  ${finalComps.length} competitions saved`);
  console.log(`  ${errors.length} repos skipped/failed`);
  console.log(`  Saved to ${RESULT_PATH}`);
  console.log(`  ${skipped} repo(s) unchanged, skipped without an LLM call`);
  console.log(`  LLM: ${llmUsage.calls} calls, ${llmUsage.promptTokens} in / ${llmUsage.completionTokens} out tokens, $${llmUsage.cost.toFixed(4)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("Crawler failed; no results were saved.");
  process.exit(1);
});
