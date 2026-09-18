// Deterministic builder for LeanEval (lean-lang.org/eval).
// Sources, in order of authority:
//   1. https://lean-lang.org/eval/site-data/problems.json    — problem catalog with visibility/status
//   2. https://lean-lang.org/eval/site-data/leaderboard.json — model-level leaderboard (solved counts, submitters)
//   3. leanprover/lean-eval-submissions/results/<login>.json — per-user audit log (schema v1 nested, v2 flat)
// No LLM involved: every number here is copied from the official artifacts.

import type { LLMCompetition } from "../llm.js";
import type { Problem, RecordEntry, AgentFamily } from "../types.js";
import { familyFromName } from "../postprocess.js";
import { listDir, fetchRaw } from "../github.js";

const SITE = "https://lean-lang.org/eval";
const RESULTS_REPO = { owner: "leanprover", name: "lean-eval-submissions", branch: "main" };

interface CatalogProblem { id: string; title: string; group: string; status: string; visible: boolean; tags?: string[]; notes?: string; source?: string; sort_index?: number; submitter?: string }
interface BoardEntry { rank: number; model_id: string; model_name: string; score: { solved_total: number; display: string }; first_solved_at?: string; last_solved_at?: string; submitter_count: number; submitters: { user: string; solved_total: number }[]; solved_problem_ids: string[] }
interface RawRow { user: string; model: string; problem: string; at?: string; repo?: string }

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

// results/<login>.json → flat rows. Accepts schema v1 ({solved: {model: {problem: {solved_at}}}}) and v2 ({results: [...]})
export function parseResultsFile(j: any, login: string): RawRow[] {
  const user: string = j?.user ?? login;
  const out: RawRow[] = [];
  if (Array.isArray(j?.results)) {
    for (const r of j.results) if (r?.problem_id && r?.declared_model) out.push({ user, model: String(r.declared_model), problem: String(r.problem_id), at: r.accepted_at ?? r.solved_at, repo: r.submission?.repo });
  } else if (j?.solved && typeof j.solved === "object") {
    for (const [model, probs] of Object.entries<any>(j.solved)) for (const [problem, info] of Object.entries<any>(probs ?? {})) out.push({ user, model, problem, at: info?.solved_at, repo: info?.submission_repo });
  }
  return out;
}

// "NEAR AI w/ DeepSeek V4" → tool NEAR AI, model DeepSeek V4 · "Humanifa + GPT 5.6 sol" → tool Humanifa, model GPT 5.6 sol · "Aristotle (Harmonic)" → model Aristotle (Harmonic)
export function splitModelLabel(label: string): { model: string; tool?: string } {
  const m1 = label.match(/^(.+?)\s+w\/\s+(.+)$/i); if (m1) return { tool: m1[1].trim(), model: m1[2].trim() };
  const m2 = label.match(/^(.+?)\s+\+\s+(.+)$/); if (m2) return { tool: m2[1].trim(), model: m2[2].trim() };
  return { model: label.trim() };
}
const famOf = (label: string): AgentFamily => familyFromName(label) ?? "other-ai";
const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);

export async function buildLeanEval(): Promise<LLMCompetition> {
  const [catalog, board] = await Promise.all([
    getJson<{ problems: CatalogProblem[] }>(`${SITE}/site-data/problems.json`),
    getJson<{ entries: BoardEntry[]; summary?: Record<string, number>; generated_at?: string }>(`${SITE}/site-data/leaderboard.json`),
  ]);
  const visible = catalog.problems.filter((p) => p.visible !== false);
  const visibleIds = new Set(visible.map((p) => p.id));
  const entries = [...board.entries].sort((a, b) => a.rank - b.rank);

  // 1. Per-user audit log (best effort: the leaderboard alone is enough for the model track)
  const rows: RawRow[] = [];
  let files: { name: string; path: string; type: string }[] = [];
  try { files = await listDir(RESULTS_REPO.owner, RESULTS_REPO.name, "results", RESULTS_REPO.branch); } catch (e) { console.log(`    lean-eval: could not list results/: ${(e as Error).message}`); }
  for (const f of files) {
    if (f.type !== "file" || !f.name.endsWith(".json")) continue;
    try { rows.push(...parseResultsFile(JSON.parse(await fetchRaw(RESULTS_REPO.owner, RESULTS_REPO.name, f.path, RESULTS_REPO.branch)), f.name.replace(/\.json$/, ""))); }
    catch (e) { console.log(`    lean-eval: skip ${f.name}: ${(e as Error).message}`); }
  }
  const validRows = rows.filter((r) => visibleIds.has(r.problem));
  console.log(`    lean-eval: ${entries.length} models on board, ${files.length} result files, ${validRows.length} accepted (user, model, problem) rows over ${visible.length} visible problems`);

  // 2. Track: models ranked by problems solved (the official leaderboard)
  const modelRecords: RecordEntry[] = entries.map((e) => {
    const { model, tool } = splitModelLabel(e.model_name);
    return {
      value: e.score.solved_total,
      date: day(e.last_solved_at),
      contributor: e.model_name,
      contributorKind: "model",
      description: `${e.submitter_count} submitter${e.submitter_count === 1 ? "" : "s"}: ${e.submitters.map((s) => `${s.user} (${s.solved_total})`).join(", ")}`,
      submissionUrls: [`${SITE}/`],
      isCurrentBest: e.rank === 1,
      agent: { family: famOf(e.model_name), model, tool, evidence: `lean-lang.org/eval leaderboard.json: "${e.model_name}" solved ${e.score.solved_total}`, confidence: "high", role: "subject" },
    };
  });

  // 3. Track: submitters ranked by distinct problems solved, attributed to the model they use most
  const byUser = new Map<string, { problems: Set<string>; models: Map<string, number>; last?: string; repos: Set<string> }>();
  for (const r of validRows) {
    const u = byUser.get(r.user) ?? { problems: new Set(), models: new Map(), repos: new Set() };
    u.problems.add(r.problem); u.models.set(r.model, (u.models.get(r.model) ?? 0) + 1);
    if (r.at && (!u.last || r.at > u.last)) u.last = r.at;
    if (r.repo) u.repos.add(r.repo);
    byUser.set(r.user, u);
  }
  let submitterRecords: RecordEntry[] = [...byUser.entries()].map(([user, u]) => {
    const models = [...u.models.entries()].sort((a, b) => b[1] - a[1]);
    const [topLabel, topN] = models[0];
    const { model, tool } = splitModelLabel(topLabel);
    return {
      value: u.problems.size,
      date: day(u.last),
      contributor: user,
      contributorKind: "person",
      contributorUrl: `https://github.com/${user}`,
      description: `models: ${models.map(([m, n]) => `${m} ×${n}`).join(", ")}`,
      submissionUrls: [`https://github.com/${RESULTS_REPO.owner}/${RESULTS_REPO.name}/blob/${RESULTS_REPO.branch}/results/${user}.json`, ...[...u.repos].slice(0, 2).map((r) => `https://github.com/${r}`)],
      agent: { family: famOf(topLabel), model, tool, evidence: `results/${user}.json declared_model="${topLabel}" on ${topN} of ${u.problems.size} problems`, confidence: "high", role: "author" },
    };
  }).sort((a, b) => b.value - a.value || (a.contributor ?? "").localeCompare(b.contributor ?? ""));
  if (!submitterRecords.length) {
    // fallback when results/ is unreachable: derive from the board's per-model submitter counts (sums may double count across models)
    const agg = new Map<string, { n: number; models: Map<string, number> }>();
    for (const e of entries) for (const s of e.submitters) { const a = agg.get(s.user) ?? { n: 0, models: new Map() }; a.n += s.solved_total; a.models.set(e.model_name, s.solved_total); agg.set(s.user, a); }
    submitterRecords = [...agg.entries()].map(([user, a]) => { const top = [...a.models.entries()].sort((x, y) => y[1] - x[1])[0][0]; const { model, tool } = splitModelLabel(top); return { value: a.n, contributor: user, contributorKind: "person", contributorUrl: `https://github.com/${user}`, description: `models: ${[...a.models.keys()].join(", ")} (sum over models)`, agent: { family: famOf(top), model, tool, evidence: `leaderboard.json submitters: ${top}`, confidence: "medium", role: "author" } }; }).sort((a, b) => b.value - a.value);
  }
  if (submitterRecords.length) submitterRecords[0].isCurrentBest = true;

  // 4. Open problems: visible, active, never solved by anyone
  const solved = new Set(entries.flatMap((e) => e.solved_problem_ids));
  const unsolved = visible.filter((p) => p.status === "active" && !solved.has(p.id)).sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0));
  const openTracks: Problem[] = unsolved.map((p) => ({
    id: `open-${p.id}`,
    name: p.title,
    description: [`Unsolved. Group: ${p.group}.`, p.source ? `Source: ${p.source.slice(0, 160)}` : "", p.submitter ? `Problem by ${p.submitter}.` : ""].filter(Boolean).join(" "),
    metricName: "solved",
    metricDirection: "maximize",
    baseline: 0,
    isOpen: true,
    records: [],
  }));

  const active = visible.filter((p) => p.status === "active").length;
  const problems: Problem[] = [
    { id: "models", name: "Models — problems solved", description: `Official leaderboard: each row is a model (or harness + model) ranked by the number of distinct benchmark problems it has solved; ${visible.length} problems in the catalog, ${active} active.`, metricName: "problems solved", metricDirection: "maximize", isOpen: false, records: modelRecords },
    { id: "submitters", name: "Submitters — problems solved", description: "People who ran a model and got a proof accepted, ranked by distinct problems solved. Attribution is the declared model on their accepted results.", metricName: "problems solved", metricDirection: "maximize", isOpen: false, records: submitterRecords },
    ...openTracks,
  ];

  return {
    id: "lean-eval",
    name: "LeanEval",
    tagline: "Prove open formalization problems in Lean 4; models and submitters are ranked by problems solved.",
    description: `LeanEval is the Lean FRO's comparator-based benchmark for formal mathematics. Trusted theorem statements live in leanprover/lean-eval; a problem counts as solved when the comparator accepts a submitted proof. Results are sticky per (user, model, problem) and published at lean-lang.org/eval. ${visible.length} visible problems, ${entries.length} models, ${byUser.size || board.summary?.submitters || 0} submitters, ${unsolved.length} active problems still unsolved.`,
    url: `${SITE}/`,
    host: "website",
    status: "active",
    tags: ["lean", "theorem-proving", "formal-methods", "mathlib", "benchmark"],
    domain: "formal-methods",
    images: [],
    organizer: { name: "Lean FRO", url: "https://lean-lang.org", type: "foundation" },
    participation: {
      howToSubmit: "Prove a problem's theorem in your own GitHub repository and submit the ref at lean-lang.org/eval/submit; the comparator verifies the proof and the result is appended to results/<login>.json in leanprover/lean-eval-submissions.",
      submissionFormat: "GitHub repo + ref containing the completed Lean proof, plus the declared model label used to produce it.",
      requirements: ["Lean 4", "Mathlib", "GitHub account"],
      compute: "none",
      computeDetails: "Scoring is a comparator check of the proof; whatever compute the prover needs is on the submitter's side.",
      deadline: "rolling",
      prizes: "recognition only",
      eligibility: "Open to everyone. Successes are sticky: an accepted (user, model, problem) tuple is never removed.",
      cost: "free",
      verification: "Comparator acceptance in CI, replay by maintainers, public audit log per user.",
    },
    venue: { type: "online", location: "GitHub / lean-lang.org" },
    quickstart: "git clone https://github.com/leanprover/lean-eval && cd lean-eval\nlake exe cache get && lake build\nlake exe lean-eval --help   # pick a problem under generated/, replace sorry, submit at lean-lang.org/eval/submit",
    links: [
      { label: "Leaderboard", url: `${SITE}/` },
      { label: "Submit a solution", url: `${SITE}/submit/` },
      { label: "Benchmark problems (leanprover/lean-eval)", url: "https://github.com/leanprover/lean-eval" },
      { label: "Results store (lean-eval-submissions)", url: `https://github.com/${RESULTS_REPO.owner}/${RESULTS_REPO.name}` },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
