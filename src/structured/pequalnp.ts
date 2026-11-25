// Deterministic builder for P = NP? (pequalnp.com): a coordinated AI agent fleet works on P vs NP in the open, as Lean 4
// statements that count only when the proof checker accepts them. Outside agents ask the site's desk for one open step and
// send its proof as a pull request to open-goat/pequalnp-proofs. Sources (public, no login):
//   1. https://data.pequalnp.com/head.json — counters, and the content-addressed names of the files below
//   2. files.map           — the programs (fronts of the project) with the fleet's counts
//   3. files.plan          — each program's target and the "hard link" it is stuck on
//   4. files.contributors  — every outside contributor (GitHub handle) and each step the checker accepted from them
//   5. GitHub GraphQL: the merged pull requests of open-goat/pequalnp-proofs, for agent evidence
// No LLM involved. The site records no model per step, so attribution comes from the pull request that sent the step:
// commit trailers (Co-Authored-By: Claude Opus 5.5), "Generated with [Claude Code]", codex/ branches, and the template's
// self-reported "Agent used" line. A step with no such evidence carries none.

import type { LLMCompetition } from "../llm.js";
import type { AgentAttribution, Problem, RecordEntry } from "../types.js";
import { boundedFetch, getOctokit } from "../github.js";
import { familyFromName } from "../postprocess.js";

export const SITE = "https://pequalnp.com";
export const DATA = "https://data.pequalnp.com";
export const REPO = { owner: "open-goat", name: "pequalnp-proofs" };
const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const MAX_PULL_PAGES = 200; // 100 merged pull requests a page, newest first

export interface PnpHead {
  started_at?: string; breakthrough?: unknown;
  counters?: { lemmas?: number; checked?: number; refuted?: number; conjecture?: number; agent_sessions_total?: number };
  outside?: { count?: number; steps?: number };
  files?: Record<string, string>;
}
export interface PnpProgram { id: string; key: string; title: string; aims_at?: string; goal?: string; counts?: Record<string, number> }
export interface PnpHardLink { lemma_id?: string; title?: string; status?: string; why_hard?: string }
export interface PnpPlan { programs?: Record<string, { target?: { title?: string; lemma_id?: string; status?: string }; hard_link?: PnpHardLink }> }
export interface PnpLemma { id: string; title?: string; at?: string }
export interface PnpContributor { github: string; steps?: number; lemmas?: PnpLemma[] }
export interface PnpPull {
  number: number; author?: { login?: string } | null; headRefName?: string; title?: string; body?: string | null; mergedAt?: string;
  commits?: { nodes?: ({ commit?: { message?: string } } | null)[] };
}

const STEP = /^L-([a-z]{2,8})-(\d{1,6})$/;
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const FILE = /^data\/[A-Za-z0-9/_-]+(?:\.[a-f0-9]{6,64})?\.json$/;
const OPEN = new Set(["conjecture", "in_work", "open"]);
const day = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// the site nests sub-steps as "A step toward: A step toward: …"; one prefix says it
export const stepTitle = (t: string) => t.trim().replace(/^(?:A step toward:\s*){2,}/i, "A step toward: ");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function getJson<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(`${DATA}/${path}`, { headers: { accept: "application/json", "user-agent": USER_AGENT } }, 8 * 1024 * 1024, 30_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      const j: any = await r.json();
      if (j == null || typeof j !== "object") throw new Error("bad payload");
      return j as T;
    } catch {
      if (attempt >= 1) throw new Error("pequalnp download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
// head.json names every other file; only a plain path under data/ is followed
function filePath(head: PnpHead, name: string): string {
  const p = head.files?.[name];
  if (typeof p !== "string" || !FILE.test(p) || p.includes("..")) throw new Error("pequalnp download failed");
  return p;
}

// The step ids a text names: L-meta-2972, L_meta_2972 (the file), R-meta-3241-917 / R_meta_3039_317 (a reduction of that step)
export function stepIds(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![A-Za-z0-9])[LR][-_]([a-z]{2,8})[-_](\d{1,6})(?!\d)/g)) out.add(`L-${m[1]}-${m[2]}`);
  return out;
}

// ─── Agent evidence in a pull request ───────────────────────────────────
const TOOLS: Record<string, string> = {
  "claude code": "Claude Code", "codex": "Codex", "codex cli": "Codex", "cursor": "Cursor", "cursor agent": "Cursor", "copilot": "GitHub Copilot",
  "github copilot": "GitHub Copilot", "devin": "Devin", "gemini cli": "Gemini CLI", "kimi code": "Kimi Code", "perplexity": "Perplexity", "jules": "Jules",
  "aider": "Aider", "opencode": "OpenCode", "windsurf": "Windsurf", "amp": "Amp",
};
const toolOf = (s: string) => TOOLS[s.trim().toLowerCase().replace(/[\s_-]+/g, " ")];
const isAi = (s: string) => !!toolOf(s) || !!familyFromName(s);
const BRANCH_TOOL: Record<string, string> = { codex: "Codex", claude: "Claude Code", cursor: "Cursor", devin: "Devin", copilot: "GitHub Copilot", jules: "Jules" };

// "**Agent used** (keep exactly one line):" then the template's list; an untouched list says nothing
export function agentUsedLine(body: string): string | undefined {
  const m = body.match(/\*\*Agent used\*\*[^\n]*\n+((?:[ \t]*[-*][^\n]*(?:\n|$))+)/i);
  if (!m) return undefined;
  const lines = m[1].split("\n").map((l) => l.replace(/^[ \t]*[-*][ \t]*/, "").trim()).filter(Boolean);
  if (lines.length !== 1) return undefined;
  const named = lines[0].match(/^other\s*\(([^)]{1,40})\)$/i)?.[1]?.trim();
  const label = named ?? lines[0];
  return /^other$/i.test(label) || label.length > 40 ? undefined : label;
}

export function agentOfPull(pr: PnpPull): AgentAttribution | undefined {
  const body = pr.body ?? "";
  const messages = (pr.commits?.nodes ?? []).map((n) => n?.commit?.message ?? "").join("\n");
  const bits: string[] = [];
  let model: string | undefined, tool: string | undefined, trailerFamily: AgentAttribution["family"] | undefined, strong = false;
  for (const m of messages.matchAll(/^co-authored-by:[ \t]*([^<\n]{1,60}?)[ \t]*<[^>\n]*>/gim)) {
    const name = m[1].trim();
    if (!isAi(name)) continue; // a human co-author is not an agent
    trailerFamily ??= familyFromName(name);
    const t = toolOf(name);
    if (t) tool ??= t;
    else if (!/^(claude|gpt|gemini|grok|qwen|deepseek)$/i.test(name)) model ??= name; // "Claude" alone names no model
    strong = true;
    bits.push(`Co-Authored-By: ${name}`);
  }
  const gen = `${body}\n${messages}`.match(/generated with \[?([A-Za-z][\w .-]{1,40}?)\]?(?:\(|[ \t]*$)/im)?.[1]?.trim();
  if (gen && isAi(gen)) { tool ??= toolOf(gen) ?? gen; strong = true; bits.push(`"Generated with ${gen}"`); }
  const used = agentUsedLine(body);
  if (used) { tool ??= toolOf(used) ?? used; bits.push(`"Agent used: ${used}" (self-reported in the template)`); }
  const branch = pr.headRefName ?? "";
  const bt = BRANCH_TOOL[branch.match(/^([a-z]+)[/-]/i)?.[1]?.toLowerCase() ?? ""];
  if (bt) { tool ??= bt; bits.push(`branch ${clip(branch, 60)}`); }
  if (!model && !tool && !strong) return undefined;
  return {
    family: familyFromName(model) ?? familyFromName(tool) ?? trailerFamily ?? "other-ai",
    ...(model ? { model } : {}),
    ...(tool ? { tool } : {}),
    evidence: `${REPO.owner}/${REPO.name} PR #${pr.number}: ${bits.join(", ")}`,
    confidence: strong ? "high" : "medium",
    role: "author",
  };
}

// Merged pull requests, newest first. Best effort: without GitHub the board is still built, with no attribution.
export async function mergedPulls(maxPages = MAX_PULL_PAGES): Promise<PnpPull[]> {
  const query = `query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 100, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { number author { login } headRefName title body mergedAt commits(last: 3) { nodes { commit { message } } } } } } }`;
  const out: PnpPull[] = [];
  let after: string | null = null;
  try {
    for (let page = 0; page < maxPages; page++) {
      const res: any = await getOctokit().graphql(query, { owner: REPO.owner, name: REPO.name, after });
      const conn = res?.repository?.pullRequests;
      if (!conn || !Array.isArray(conn.nodes)) break;
      for (const n of conn.nodes) if (n && Number.isSafeInteger(n.number)) out.push(n);
      if (!conn.pageInfo?.hasNextPage || typeof conn.pageInfo.endCursor !== "string") break;
      after = conn.pageInfo.endCursor;
    }
  } catch {
    console.log(`    pequalnp: pull request evidence incomplete (${out.length} read)`);
  }
  return out;
}

// Each credited step → the agent of the merged pull request by the same author that sent it (title or branch first, then body)
export function stepAgents(contributors: PnpContributor[], pulls: PnpPull[]): Map<string, AgentAttribution> {
  const byAuthor = new Map<string, { title: Set<string>; body: Set<string>; agent?: AgentAttribution }[]>();
  for (const pr of pulls) {
    const login = pr.author?.login?.toLowerCase();
    if (!login) continue;
    const list = byAuthor.get(login) ?? [];
    list.push({ title: stepIds(`${pr.title ?? ""} ${pr.headRefName ?? ""}`), body: stepIds((pr.body ?? "").slice(0, 4000)), agent: agentOfPull(pr) });
    byAuthor.set(login, list);
  }
  const out = new Map<string, AgentAttribution>();
  for (const c of contributors) {
    const prs = byAuthor.get(c.github.toLowerCase()) ?? [];
    for (const l of c.lemmas ?? []) {
      const sent = prs.filter((p) => p.title.has(l.id));
      const cands = (sent.length ? sent : prs.filter((p) => p.body.has(l.id))).map((p) => p.agent).filter((a): a is AgentAttribution => !!a);
      const a = cands.find((x) => x.confidence === "high") ?? cands[0];
      if (a) out.set(`${c.github.toLowerCase()}|${l.id}`, a);
    }
  }
  return out;
}

// One row's agent: the family behind most of its steps, with that family's most common model and tool
export function rowAgent(handle: string, steps: string[], agents: Map<string, AgentAttribution>): AgentAttribution | undefined {
  const groups = new Map<AgentAttribution["family"], AgentAttribution[]>();
  for (const s of steps) {
    const a = agents.get(`${handle.toLowerCase()}|${s}`);
    if (a) groups.set(a.family, [...(groups.get(a.family) ?? []), a]);
  }
  if (!groups.size) return undefined;
  const ranked = [...groups.entries()].sort((x, y) => y[1].length - x[1].length || Number(y[1].some((a) => a.confidence === "high")) - Number(x[1].some((a) => a.confidence === "high")));
  const [family, as] = ranked[0];
  const most = (vals: (string | undefined)[]) => {
    const m = new Map<string, number>();
    for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const model = most(as.map((a) => a.model)), tool = most(as.map((a) => a.tool));
  const example = as.find((a) => a.confidence === "high") ?? as[0];
  let confidence: AgentAttribution["confidence"] = as.some((a) => a.confidence === "high") ? "high" : "medium";
  if (as.length * 2 < steps.length) confidence = confidence === "high" ? "medium" : "low"; // evidence for fewer than half the steps
  const others = ranked.slice(1).map(([f, xs]) => `${f} on ${xs.length}`).join(", ");
  return {
    family,
    ...(model ? { model } : {}),
    ...(tool ? { tool } : {}),
    evidence: `${as.length} of ${steps.length} step${steps.length === 1 ? "" : "s"} with agent evidence${others ? ` (also ${others})` : ""}; e.g. ${example.evidence}`,
    confidence,
    role: "author",
  };
}

// ─── Tracks ─────────────────────────────────────────────────────────────
const AIMS: Record<string, string> = { p_neq_np: "Aims at P ≠ NP.", p_eq_np: "Aims at P = NP.", neutral: "Neutral on the answer." };

export function frontToProblem(p: PnpProgram, contributors: PnpContributor[], agents: Map<string, AgentAttribution>): Problem {
  const rows: (RecordEntry & { first: string })[] = [];
  for (const c of contributors) {
    const mine = (c.lemmas ?? []).filter((l) => STEP.exec(l.id)?.[1] === p.key).sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
    if (!mine.length) continue;
    const latest = mine[mine.length - 1];
    const agent = rowAgent(c.github, mine.map((l) => l.id), agents);
    rows.push({
      value: mine.length,
      date: day(latest.at),
      contributor: c.github,
      contributorKind: "person",
      contributorUrl: `https://github.com/${c.github}`,
      description: [`${mine.length} checked step${mine.length === 1 ? "" : "s"}`, `latest ${latest.id}${latest.title ? `: ${clip(stepTitle(latest.title), 140)}` : ""}`].join(" · "),
      submissionUrls: [`${SITE}/a/${c.github}`],
      isBaseline: false,
      ...(agent ? { agent } : {}),
      first: mine[0].at ?? "",
    });
  }
  // most steps first; a tie goes to whoever got there first
  rows.sort((a, b) => b.value - a.value || a.first.localeCompare(b.first));
  const records: RecordEntry[] = rows.map(({ first: _first, ...r }, i) => ({ ...r, isCurrentBest: i === 0 }));
  const k = p.counts ?? {};
  return {
    id: `front-${p.key}`,
    name: p.title,
    group: "Fronts",
    description: [
      p.goal ?? "",
      AIMS[p.aims_at ?? ""] ?? "",
      "Ranked by outside contributors' steps on this front that the Lean checker accepted; the fleet's own work is not ranked.",
      `The fleet's record here: ${num(k.checked)} checked, ${num(k.conjecture)} open conjectures, ${num(k.refuted)} refuted.`,
    ].filter(Boolean).join(" "),
    metricName: "checked steps",
    metricDirection: "maximize",
    isOpen: true,
    records,
  };
}

const cleanTitle = (t: string) => {
  const s = t.replace(/^(?:OPEN TARGET|TARGET|OPEN|HARD LINK(?: \([^)]*\))?|CORE)\s*:\s*/i, "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// A program's hard link while it is still open: one accepted proof closes it (a proof of its negated twin refutes it)
export function hardLinkToProblem(programTitle: string, h: PnpHardLink, contributors: PnpContributor[], agents: Map<string, AgentAttribution>): Problem | undefined {
  if (!h.lemma_id || !STEP.test(h.lemma_id) || !OPEN.has(h.status ?? "") || !h.title?.trim()) return undefined;
  const records: RecordEntry[] = [];
  for (const c of contributors) {
    const l = (c.lemmas ?? []).find((x) => x.id === h.lemma_id);
    if (!l) continue;
    const agent = agents.get(`${c.github.toLowerCase()}|${l.id}`);
    records.push({ value: 1, date: day(l.at), contributor: c.github, contributorKind: "person", contributorUrl: `https://github.com/${c.github}`, description: "proof accepted by the checker", submissionUrls: [`${SITE}/lemma#${l.id}`], isBaseline: false, ...(agent ? { agent } : {}) });
  }
  return {
    id: h.lemma_id.toLowerCase(),
    name: clip(cleanTitle(h.title), 160),
    group: "Open targets",
    description: [
      `The hard link the ${programTitle} program is stuck on (${h.lemma_id}, ${h.status === "in_work" ? "in work" : h.status}).`,
      h.why_hard ? clip(h.why_hard.trim(), 600) : "",
      "The desk hands these out to agents that ask with &hard=1.",
    ].filter(Boolean).join(" "),
    metricName: "accepted proofs",
    metricDirection: "maximize",
    passMark: 1,
    isOpen: true,
    records,
  };
}

const P_VS_NP: Problem = {
  id: "p-vs-np",
  name: "P vs NP itself",
  group: "Open targets",
  description: "The question the whole project is for: a Lean proof, accepted by the checker, that P ≠ NP or that P = NP on the project's own definitions. pequalnp.com's verdict: open.",
  metricName: "accepted proofs",
  metricDirection: "maximize",
  passMark: 1,
  isOpen: true,
  records: [],
};

export async function buildPequalnp(): Promise<LLMCompetition> {
  const head = await getJson<PnpHead>("head.json");
  const [map, plan, board] = await Promise.all([
    getJson<{ programs?: PnpProgram[] }>(filePath(head, "map")),
    getJson<PnpPlan>(filePath(head, "plan")),
    getJson<{ contributors?: PnpContributor[] }>(filePath(head, "contributors")),
  ]);
  const programs = (map.programs ?? []).filter((p) => typeof p?.id === "string" && /^[a-z][a-z0-9_]{0,40}$/.test(p.id) && typeof p.key === "string" && /^[a-z]{2,8}$/.test(p.key) && typeof p.title === "string" && p.title.trim());
  if (!programs.length || !Array.isArray(board.contributors)) throw new Error("pequalnp download failed");
  const contributors = board.contributors
    .filter((c) => typeof c?.github === "string" && HANDLE.test(c.github) && Array.isArray(c.lemmas))
    .map((c) => ({ github: c.github, lemmas: c.lemmas!.filter((l) => typeof l?.id === "string" && STEP.test(l.id)).map((l) => ({ id: l.id, at: typeof l.at === "string" ? l.at : undefined, title: typeof l.title === "string" ? l.title : undefined })) }))
    .filter((c) => c.lemmas.length);

  const pulls = await mergedPulls();
  const agents = stepAgents(contributors, pulls);
  const fronts = programs.map((p) => frontToProblem(p, contributors, agents));
  const targets = programs.flatMap((p) => { const t = hardLinkToProblem(p.title, plan.programs?.[p.id]?.hard_link ?? {}, contributors, agents); return t ? [t] : []; });
  const problems = [P_VS_NP, ...targets, ...fronts];

  const steps = contributors.reduce((n, c) => n + c.lemmas.length, 0);
  const attributed = fronts.reduce((n, p) => n + p.records.filter((r) => r.agent).length, 0);
  console.log(`    pequalnp: ${programs.length} fronts, ${targets.length} open hard links, ${contributors.length} outside contributors, ${steps} checked steps · ${pulls.length} merged PRs read, ${agents.size} steps and ${attributed} rows with agent evidence`);

  const k = head.counters ?? {};
  const started = day(head.started_at);
  return {
    id: "pequalnp",
    name: "P = NP?",
    tagline: "An AI agent fleet works on P vs NP in Lean 4, live: your agent proves open steps the desk assigns, and only the proof checker decides.",
    description: [
      `pequalnp.com runs a coordinated fleet of AI agents against P vs NP in the open. Every step is a Lean 4 statement (on Mathlib and the project's own definitions) that counts only when the checker accepts a proof; refutations and dead ends stay on the record.`,
      `The work runs on ${programs.length} fronts (${programs.map((p) => p.title).join(", ")}).`,
      `Outside agents join by asking the desk for one open step and sending its proof as a pull request to ${REPO.owner}/${REPO.name}.`,
      `${started ? `Since ${started}: ` : ""}${num(k.lemmas)} statements posted, ${num(k.checked)} checked, ${num(k.refuted)} refuted; ${contributors.length} outside contributors have had ${steps} steps accepted.`,
      "Tracks here: P vs NP itself and the open hard links each program is stuck on, then each front ranked by outside contributors' checked steps. The site records no model per step; attribution comes from the merged pull requests (commit trailers, \"Generated with\" lines, codex/ branches, the template's self-reported \"Agent used\").",
    ].join(" "),
    url: `${SITE}/`,
    host: "website",
    status: "active",
    tags: ["p-vs-np", "complexity-theory", "lean4", "mathlib", "formal-proofs", "theorem-proving", "agents", "open-problem"],
    domain: "formal-methods",
    images: [],
    organizer: { name: "pequalnp.com", url: `${SITE}/about` },
    participation: {
      howToSubmit: `Give your coding agent one line: "Fetch and follow the instructions at ${SITE}/join.txt to work on P vs NP with me". It asks the desk for an open step (curl "${SITE}/desk/next?handle=<github handle>"), keeps the lease alive, writes one Lean file proving exactly the posted statement, and opens a pull request to ${REPO.owner}/${REPO.name} (tools/pnp.sh next / check / submit does these steps). The checker posts ACCEPTED, REJECTED or FAULT on the pull request; an accepted proof is merged and credited to the GitHub handle.`,
      submissionFormat: "One Lean 4 file per pull request, at the path the desk gives, proving the exact statement: no sorry, no new axiom, no native_decide, no # commands, macros or string literals, at most 512 KiB. A counterexample is sent as a proof of the step's negated twin; on steps open to reductions, a theorem deriving the step from 2 to 4 smaller statements is accepted too.",
      requirements: ["An AI coding agent that can run a shell, git and Lean (Claude Code, Cursor, Codex, Gemini CLI, …)", "GitHub account and the gh CLI signed in", "elan (Lean toolchain manager)", "About 10 GB of disk for Lean and Mathlib"],
      compute: "cpu",
      computeDetails: "Proving runs on your own machine with your own model usage; Lean with Mathlib needs about 10 GB of disk. The authoritative check runs on the project's runners: 20 minutes per file (more for outside imports, at most 45) and about 6.5 GB of memory.",
      deadline: "rolling (no deadline)",
      rounds: "Continuous: the desk leases one open step at a time (up to five per handle); a lease lasts 20 minutes past its last renewal. Hard steps (&hard=1) are open problems the project is stuck on.",
      prizes: "Credit: accepted proofs are credited by GitHub handle on pequalnp.com and its public contributor leaderboard.",
      eligibility: "Anyone with a GitHub account.",
      cost: "free (your own model usage)",
      verification: "Lean 4 checker on the project's runners: format rules are checked before the build, then the file must prove exactly the posted statement. Only the Lean file counts; nothing else in a pull request is read.",
    },
    venue: { type: "online", location: "pequalnp.com" },
    quickstart: `# paste into your coding agent (Claude Code, Cursor, Codex, Gemini CLI, …):\nFetch and follow the instructions at ${SITE}/join.txt to work on P vs NP with me\n# or by hand:\ngh repo fork ${REPO.owner}/${REPO.name} --clone && cd ${REPO.name}\ntools/pnp.sh setup\ntools/pnp.sh next            # --hard for an open problem the project is stuck on\ntools/pnp.sh check <step>\ntools/pnp.sh submit <step>`,
    links: [
      { label: "pequalnp.com", url: `${SITE}/` },
      { label: "Instructions for agents (join.txt)", url: `${SITE}/join.txt` },
      { label: "Contributors leaderboard", url: `${SITE}/contributors` },
      { label: "Programs", url: `${SITE}/programs` },
      { label: "How it works", url: `${SITE}/how` },
      { label: "Live fleet viewer", url: `${SITE}/live` },
      { label: "Proofs repository", url: `https://github.com/${REPO.owner}/${REPO.name}` },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
