// Deterministic builder for Big O Speedrun (bigospeedrun.com): the race to improve the complexity bounds of classic problems
// (integer and matrix multiplication, 3SUM, APSP, 3-SAT, …). Every result carries an evidence level: Claimed (published, not checked),
// Human Verified (accepted by the race's review repository) or Lean Verified (its Lean proof rebuilt and kernel-checked against the
// site's exact statement). bigospeedrun/verifier, the repository the crawler finds, is where Lean proofs are sent; the records live on
// the site. Source (public, no login):
//   https://bigospeedrun.com/chat-knowledge.json — refreshed hourly: each page's text (with its scoring rule), the evidence definitions,
//   the submission routes, every race's current leader at each evidence level, and the current leader of each "Other bounds" row
// No LLM involved. The file holds the leaders only, not the full history, so a track lists those leaders. Agent attribution comes only
// from the site's own text naming the AI ("OpenAI Codex assisted", "Vals AI with Claude Opus 5.5"); a company name is not an agent.

import type { LLMCompetition } from "../llm.js";
import type { AgentAttribution, Participation, Problem, RecordEntry } from "../types.js";
import { boundedFetch } from "../github.js";
import { familyFromName } from "../postprocess.js";

export const SITE = "https://bigospeedrun.com";
export const DATA_URL = `${SITE}/chat-knowledge.json`;
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const MAX_BYTES = 4 * 1024 * 1024; // ~170 KB today

export interface BosAuthor { name?: string; login?: string; url?: string }
export interface BosResult {
  id: string; bound?: string; exactScore?: string; scoreRelation?: string; evidence?: string; authors?: (BosAuthor | string)[];
  date?: string; dateMeaning?: string; method?: string; credit?: string; refiledBy?: string; sources?: { name?: string; url?: string }[];
  assumptions?: { statement?: string; status?: string }[];
}
export interface BosRace {
  path: string; name?: string; title?: string; scope?: string; closed?: string; note?: string; carriesNote?: string; baseline?: string;
  current?: BosResult[]; currentByEvidence?: Record<string, BosResult[]>;
}
export interface BosOtherRow {
  path: string; title?: string; rankedQuantity?: string; better?: string; statement?: string; closed?: string; claimCount?: number;
  baseline?: { kind?: string; bound?: string } | null; reviewRepository?: { name?: string; rule?: string };
  current?: { bound?: string; exactValue?: string; conditions?: string; proofScope?: string; evidence?: string; authors?: (BosAuthor | string)[]; refiledBy?: string; date?: string; source?: string };
}
export interface BosContribute {
  newResult?: string; reviewRepositories?: string;
  leanProof?: { problems?: string[]; repository?: string; instructions?: string; text?: string };
  prove2me?: { problems?: string[]; campaigns?: { problem?: string; url?: string }[]; text?: string };
}
export interface BosKnowledge {
  updatedAt?: string; pages?: Record<string, string>; evidence?: { name?: string; definition?: string }[];
  otherBounds?: { rows?: BosOtherRow[] }; contribute?: BosContribute; problems?: BosRace[];
}

async function getKnowledge(): Promise<BosKnowledge> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(DATA_URL, { headers: { accept: "application/json", "user-agent": USER_AGENT } }, MAX_BYTES, 30_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      const j: any = await r.json();
      if (j == null || typeof j !== "object" || !Array.isArray(j.problems)) throw new Error("bad payload");
      return j as BosKnowledge;
    } catch {
      if (attempt >= 1) throw new Error("Big O Speedrun download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ─── Third-party text and links ─────────────────────────────────────────
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : undefined);
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
// A plain string with control and bidi characters dropped, whitespace collapsed, clipped; anything else is nothing
export function str(v: unknown, n: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return s ? clip(s, n) : undefined;
}
// https only: no credentials, whitespace or backslashes, and a host list where the link's role needs one
export function httpsUrl(v: unknown, hosts?: string[]): string | undefined {
  if (typeof v !== "string" || v.length > 600 || /[\u0000- \u007f-\u009f\\]/.test(v)) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || (hosts && !hosts.includes(u.hostname))) return undefined;
    return u.href;
  } catch { return undefined; }
}
const day = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return undefined;
  const d = v.slice(0, 10), t = Date.parse(d);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : undefined; // the validator rejects a non-date, and with it the whole build
};
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const PATH = /^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/;
const RESULT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/;
const trackId = (path: string) => path.slice(1).replace(/\//g, "-");

// The site writes bounds in LaTeX; the list shows plain text: O(n \log^{1-\kappa} n) → O(n log^{1-κ} n)
const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", varepsilon: "ε", eta: "η", theta: "θ", kappa: "κ", lambda: "λ",
  mu: "μ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", omega: "ω", le: "≤", leq: "≤", ge: "≥", geq: "≥", cdot: "·", times: "×",
  infty: "∞", sqrt: "√", lfloor: "⌊", rfloor: "⌋", ldots: "…", to: "→", log: "log", ln: "ln", exp: "exp",
};
export function plainTex(s: string): string {
  return s
    .replace(/\\[td]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
    .replace(/\\(?:text|mathrm|mathbb|mathbf|mathcal|operatorname)\{([^{}]*)\}/g, "$1")
    .replace(/\\[()[\]]/g, "")
    .replace(/\\(?:scriptstyle|displaystyle|left|right)\b|\\[,;!: ]/g, " ")
    .replace(/\\([A-Za-z]+)/g, (_, w: string) => GREEK[w] ?? w)
    .replace(/\{,\}/g, ",")
    .replace(/\s*·\s*/g, "·").replace(/\{\s+/g, "{").replace(/\s+([.,;:])/g, "$1")
    .replace(/\s+/g, " ").trim();
}

// ─── Scores ─────────────────────────────────────────────────────────────
// "1/2", "363005817/100000000000", "-1/5", "2.13981", "\tfrac{19}{27}", "\ge5.11\cdot10^{-10}", "8\cdot4=32" → a number.
// A pair of density regimes ("n log^3/4 ; n log^11/12") or a formula ("80{,}000d^{17}") is not one number → undefined.
export function parseScore(v: unknown): number | undefined {
  if (typeof v !== "string" || v.length > 200) return undefined;
  let s = v.replace(/\s+/g, "").replace(/^\\(?:ge|geq|le|leq)(?![A-Za-z])/, "").replace(/\{,\}/g, "");
  if (s.includes("=")) s = s.slice(s.lastIndexOf("=") + 1);
  let x: number, m: RegExpMatchArray | null;
  if ((m = s.match(/^\\[td]?frac\{(-?\d{1,60})\}\{(\d{1,60})\}$/) ?? s.match(/^(-?\d{1,60})\/(\d{1,60})$/))) x = Number(m[1]) / Number(m[2]);
  else if ((m = s.match(/^(-?\d{1,30}(?:\.\d{1,40})?)(?:\\cdot10\^\{?(-?\d{1,3})\}?)?$/))) x = Number(m[1]) * 10 ** Number(m[2] ?? 0);
  else return undefined;
  return Number.isFinite(x) ? x : undefined;
}
const tidy = (x: number) => Number(x.toPrecision(15)); // the exact fraction stays in the record's description

// Each race page states its own score and direction: "\(\kappa\) is the saving in the logarithmic exponent; higher is better."
// Exactly one direction in the page text, or none is taken.
export interface ScoreRule { minimize: boolean; metricName: string; rule?: string }
export function scoreRule(page: unknown): ScoreRule | undefined {
  if (typeof page !== "string") return undefined;
  const dirs = new Set([...page.matchAll(/\b(higher|lower) is better\b/gi)].map((m) => m[1].toLowerCase()));
  if (dirs.size !== 1) return undefined;
  const line = page.split("\n").find((l) => /\b(?:higher|lower) is better\b/i.test(l)) ?? "";
  const named = line.match(/\\\(\s*([^()]{1,24}?)\s*\\\)\s*is the ([^;.]{3,60}?)\s*;\s*(?:higher|lower) is better/i);
  const score = line.match(/\bscore \\\(\s*([A-Za-z])\s*\\\)/i);
  const metricName = named ? `${plainTex(named[2])} ${plainTex(named[1])}` : score ? `score ${score[1]}` : "score";
  return { minimize: dirs.has("lower"), metricName: clip(metricName, 80), rule: str(plainTex(line), 320) };
}

// The classic bound each race starts from, as the site writes it, and its score; a changed bound drops the number rather than guess it
const CLASSIC: Record<string, [bound: string, score: number]> = {
  "/integer-multiplication": ["O(n \\log n)", 0],                 // κ = 0
  "/matrix-multiplication": ["O(n^{2.371177+\\varepsilon})", 2.371177],
  "/exact-dft": ["O(n \\log n)", 0],
  "/3sum": ["O(n^{2})", 2],
  "/apsp": ["O(n^{3})", 3],
  "/apsp/randomized-word-ram": ["O(n^{3})", 3],
  "/subset-sum": ["O^*(2^{n/2})", 0.5],
  "/3sat": ["O^*(1.307031578^n)", 0],                              // every c^n scores α = 0 (the page says so)
  "/integer-factoring": ["O(N^{1/5}\\log^{16/5}N/(\\log\\log N)^{3/5})", -0.2], // time N^{c+o(1)} scores −c
};

export const EVIDENCE = ["Claimed", "Human Verified", "Lean Verified"] as const;
const level = (e: unknown) => EVIDENCE.indexOf(e as (typeof EVIDENCE)[number]) + 1; // 0: not a level the site defines
const EVIDENCE_VALUE = "each record's value is its evidence level (1 Claimed, 2 Human Verified, 3 Lean Verified), not its bound, which is in the record's description";

// ─── Agent evidence in the site's text ──────────────────────────────────
const AI_TOOLS: [RegExp, string][] = [
  [/\bClaude Code\b/, "Claude Code"], [/\b(?:OpenAI )?Codex(?: CLI)?\b/, "Codex"], [/\bGemini CLI\b/, "Gemini CLI"],
  [/\bGitHub Copilot\b/, "GitHub Copilot"], [/\bKimi Code\b/, "Kimi Code"],
];
// Model names, never company names: "Anthropic's clique evaluator" or "OpenAI's companion paper" cite earlier work, they name no agent
const AI_MODELS: RegExp[] = [
  /\bClaude(?: (?:Opus|Sonnet|Haiku|Fable)(?: \d+(?:\.\d+)?)?)?\b(?! (?:Code|Shannon)\b)/,
  /\bGPT-\d+(?:\.\d+)?(?:[ -](?:[A-Z][a-z]{2,9}|mini|pro))?\b/, /\bChatGPT\b/,
  /\bGemini(?: \d+(?:\.\d+)?(?: (?:Pro|Flash|Ultra|Deep Think))?)?\b(?! CLI\b)/,
  /\bDeepSeek(?:[- ](?:V\d+(?:\.\d+)?|R\d|Prover(?:[- ]V\d+(?:\.\d+)?)?))?\b/, /\bGrok(?: \d+(?:\.\d+)?)?\b/,
  /\bKimi(?: K\d+(?:\.\d+)?)?\b(?! Code\b)/, /\bQwen ?\d*(?:\.\d+)?\b/, /\bHarmonic's Aristotle\b/,
];
const BARE = /^(?:Claude|ChatGPT|Gemini|Grok|Qwen|DeepSeek|Kimi)$/; // a family, not a model
const firstMatch = (text: string, rxs: RegExp[]) =>
  rxs.map((rx) => text.match(rx)).filter((m): m is RegExpMatchArray => !!m).sort((a, b) => a.index! - b.index!)[0];

// The first field that names an AI decides: its tool (high confidence) and model; the evidence quotes the words around it
export function agentFromText(fields: [label: string, text: string | undefined][]): AgentAttribution | undefined {
  for (const [label, text] of fields) {
    if (!text) continue;
    const t = firstMatch(text, AI_TOOLS.map(([rx]) => rx)), m = firstMatch(text, AI_MODELS);
    if (!t && !m) continue;
    const tool = t ? AI_TOOLS.find(([rx]) => rx.test(t[0]))![1] : undefined;
    const model = m && !BARE.test(m[0]) ? m[0].replace(/^Harmonic's /, "") : undefined;
    const family = familyFromName(model) ?? familyFromName(tool) ?? familyFromName(m?.[0]) ?? "other-ai";
    const hit = [t, m].filter((x): x is RegExpMatchArray => !!x).sort((a, b) => a.index! - b.index!)[0];
    const from = Math.max(0, hit.index! - 70), to = Math.min(text.length, hit.index! + hit[0].length + 50);
    const quote = `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
    return { family, ...(model ? { model } : {}), ...(tool ? { tool } : {}), evidence: `bigospeedrun.com ${label}: "${quote}"`, confidence: tool ? "high" : "medium", role: "author" };
  }
  return undefined;
}

// ─── Records ────────────────────────────────────────────────────────────
interface Who { contributor?: string; contributorUrl?: string; names: string[] }
// contributor: the first author's GitHub login when the site gives one, else their name; a profile link only to that login on github.com
export function authorsOf(v: unknown): Who {
  const all = list<unknown>(v).slice(0, 20).map((a) => (typeof a === "string" ? { name: a } : obj(a) ?? {}));
  const names = all.map((a) => str(a.name, 80) ?? (typeof a.login === "string" && HANDLE.test(a.login) ? a.login : undefined)).filter((n): n is string => !!n);
  const first = all[0];
  if (!first) return { names };
  const login = typeof first.login === "string" && HANDLE.test(first.login) ? first.login : undefined;
  const profile = httpsUrl(first.url, ["github.com"]);
  const own = login && profile && new URL(profile).pathname.replace(/\/$/, "").toLowerCase() === `/${login.toLowerCase()}`;
  return { contributor: login ?? names[0], ...(own ? { contributorUrl: `https://github.com/${login}` } : {}), names };
}
const coauthors = (w: Who) => (w.names.length > 1 ? `with ${w.names.slice(1).join(", ")}` : "");

function sourcesOf(r: BosResult, fallback: string): string[] {
  const urls = [...new Set(list<{ url?: unknown }>(r.sources).map((s) => httpsUrl(obj(s)?.url)).filter((u): u is string => !!u))].slice(0, 3);
  return urls.length ? urls : [fallback];
}

const validResult = (r: unknown): r is BosResult => !!obj(r) && typeof (r as BosResult).id === "string" && RESULT_ID.test((r as BosResult).id) && level((r as BosResult).evidence) > 0;

function resultRecord(r: BosResult, value: number, pageUrl: string, leader: boolean | undefined): RecordEntry {
  const who = authorsOf(r.authors);
  const credit = str(r.credit, 4000), method = str(r.method, 4000);
  const assumptions = list(r.assumptions).length;
  const agent = agentFromText([["authors", who.names.join("; ")], ["credit", credit], ["method", method]]);
  const description = [
    r.evidence,
    str(r.bound, 400) ? clip(plainTex(str(r.bound, 400)!), 160) : "",
    str(r.exactScore, 120) ? `exact score ${str(r.exactScore, 120)}${r.scoreRelation === "strict-upper-bound" ? " (strict endpoint: the bound holds for every ε > 0, not at the endpoint)" : ""}` : "",
    coauthors(who),
    str(r.refiledBy, 80) ?? "",
    assumptions ? `${assumptions} stated assumption${assumptions === 1 ? "" : "s"}` : "",
    credit ? clip(plainTex(credit), 240) : method ? clip(plainTex(method), 240) : "",
  ].filter(Boolean).join(" · ");
  return {
    value,
    date: day(r.date),
    contributor: who.contributor,
    contributorKind: "person",
    ...(who.contributorUrl ? { contributorUrl: who.contributorUrl } : {}),
    description,
    submissionUrls: sourcesOf(r, pageUrl),
    isBaseline: false,
    ...(leader === undefined ? {} : { isCurrentBest: leader }),
    ...(agent ? { agent } : {}),
  };
}

// ─── Tracks ─────────────────────────────────────────────────────────────
// One race → one track: the leader at each evidence level plus the overall leaders, one row per result id.
// The exact score ranks only when the page states one direction, every leader's score is a number, and the site's own leaders
// are the best by that direction; otherwise the value is the evidence level and the track says so.
export function raceToProblem(p: BosRace, pages: Record<string, unknown> = {}): Problem | undefined {
  const path = typeof p?.path === "string" && PATH.test(p.path) ? p.path : undefined;
  const name = str(p?.name, 120) ?? str(p?.title, 120);
  if (!path || !name) return undefined;
  const pageUrl = `${SITE}${path}`;
  const rows = new Map<string, BosResult>();
  const byEvidence = obj(p.currentByEvidence) ?? {};
  for (const ev of [...EVIDENCE].reverse()) for (const r of list(byEvidence[ev]).slice(0, 30)) if (validResult(r) && !rows.has(r.id)) rows.set(r.id, r);
  const current = list(p.current).slice(0, 30).filter(validResult);
  for (const r of current) if (!rows.has(r.id)) rows.set(r.id, r);
  const leaders = new Set(current.map((r) => r.id));

  const rule = scoreRule(Object.hasOwn(pages, path) ? pages[path] : undefined);
  const scores = new Map([...rows.values()].map((r) => [r.id, parseScore(r.exactScore)]));
  const nums = [...scores.values()].filter((x): x is number => x !== undefined);
  const best = rule && nums.length ? (rule.minimize ? Math.min(...nums) : Math.max(...nums)) : undefined;
  const numeric = !!rule && nums.length === rows.size && [...leaders].every((id) => scores.get(id) === best);

  const records = [...rows.values()]
    .map((r) => ({ r, rec: resultRecord(r, numeric ? tidy(scores.get(r.id)!) : level(r.evidence), pageUrl, leaders.size ? leaders.has(r.id) : undefined) }))
    .sort((a, b) => (numeric ? (rule!.minimize ? scores.get(a.r.id)! - scores.get(b.r.id)! : scores.get(b.r.id)! - scores.get(a.r.id)!) : Number(leaders.has(b.r.id)) - Number(leaders.has(a.r.id)))
      || level(b.r.evidence) - level(a.r.evidence) || (a.rec.date ?? "").localeCompare(b.rec.date ?? ""))
    .map((x) => x.rec);
  const baseline = typeof p.baseline === "string" ? p.baseline : undefined;
  const classic = numeric && baseline && CLASSIC[path]?.[0] === baseline ? CLASSIC[path][1] : undefined;
  const closed = str(p.closed, 600);
  return {
    id: trackId(path),
    name,
    group: "Races",
    description: [
      closed ? plainTex(closed) : "",
      str(p.scope, 600) ? plainTex(str(p.scope, 600)!) : "",
      baseline ? `Classic bound: ${clip(plainTex(baseline), 120)}.` : "",
      numeric ? `Ranked by the site's exact score: ${rule!.rule ?? `${rule!.minimize ? "lower" : "higher"} is better`}` : `No single number ranks this race here${rule?.rule ? ` (${rule.rule})` : ""}: ${EVIDENCE_VALUE}; the leaders are the site's.`,
      str(p.carriesNote, 300) ?? "",
      "Records: the current leader at each evidence level (Claimed, Human Verified, Lean Verified); the site's data holds no full history.",
    ].filter(Boolean).join(" "),
    metricName: numeric ? rule!.metricName : "evidence level",
    metricDirection: numeric && rule!.minimize ? "minimize" : "maximize",
    ...(classic !== undefined ? { baseline: classic } : {}),
    isOpen: !closed,
    records,
  };
}

// The bound a row starts from, when it is "<quantity> ≤ <number>" (a lower-is-better row) or "≥ / >" (higher is better)
export function baselineValue(bound: unknown, minimize: boolean): number | undefined {
  if (typeof bound !== "string" || bound.length > 200) return undefined;
  const rels = [...bound.matchAll(/\\(le|leq|ge|geq)(?![A-Za-z])|([<>])/g)];
  const last = rels[rels.length - 1];
  if (!last) return undefined;
  const upper = last[1] ? last[1].startsWith("l") : last[2] === "<";
  return upper === minimize ? parseScore(bound.slice(last.index! + last[0].length)) : undefined;
}

// One "Other bounds" row → one track with its current leader. The row states its own direction ("A lower value is better.").
export function otherBoundToProblem(row: BosOtherRow): Problem | undefined {
  const path = typeof row?.path === "string" && PATH.test(row.path) && row.path.startsWith("/other/") ? row.path : undefined;
  const name = str(row?.title, 120);
  if (!path || !name) return undefined;
  const pageUrl = `${SITE}${path}`;
  const better = str(row.better, 300);
  const dir = better && /^A (lower|higher) value is better\.?$/i.exec(better)?.[1].toLowerCase();
  const minimize = dir === "lower";
  const cur = obj(row.current) as BosOtherRow["current"] | undefined;
  const ev = level(cur?.evidence);
  const score = parseScore(cur?.exactValue);
  const numeric = !!dir && score !== undefined;
  const records: RecordEntry[] = [];
  if (cur && ev) {
    const who = authorsOf(cur.authors);
    const conditions = str(cur.conditions, 6000), proofScope = str(cur.proofScope, 6000);
    const agent = agentFromText([["authors", who.names.join("; ")], ["conditions", conditions], ["proof scope", proofScope]]);
    const source = httpsUrl(cur.source);
    records.push({
      value: numeric ? tidy(score!) : ev,
      date: day(cur.date),
      contributor: who.contributor,
      contributorKind: "person",
      ...(who.contributorUrl ? { contributorUrl: who.contributorUrl } : {}),
      description: [
        EVIDENCE[ev - 1],
        str(cur.bound, 400) ? clip(plainTex(str(cur.bound, 400)!), 160) : "",
        str(cur.exactValue, 120) ? `exact value ${str(cur.exactValue, 120)}` : "",
        coauthors(who),
        str(cur.refiledBy, 80) ?? "",
        conditions ? clip(plainTex(conditions), 240) : "",
      ].filter(Boolean).join(" · "),
      submissionUrls: [source ?? pageUrl],
      isBaseline: false,
      isCurrentBest: true,
      ...(agent ? { agent } : {}),
    });
  }
  const base = obj(row.baseline);
  // a baseline that beats the leader is a misread, not a baseline
  const b = numeric ? baselineValue(base?.bound, minimize) : undefined;
  const baseline = b !== undefined && (minimize ? b >= score! : b <= score!) ? tidy(b) : undefined;
  const closed = str(row.closed, 600);
  const claims = Number.isSafeInteger(row.claimCount) && row.claimCount! > 0 ? row.claimCount : undefined;
  return {
    id: trackId(path),
    name,
    group: "Other bounds",
    description: [
      closed ? plainTex(closed) : "",
      str(row.statement, 600) ? plainTex(str(row.statement, 600)!) : "",
      base && str(base.bound, 200) ? `${str(base.kind, 40) ?? "Baseline"}: ${clip(plainTex(str(base.bound, 200)!), 120)}.` : "",
      numeric ? better : `No single number ranks this row here${better ? ` (${clip(better, 200)})` : ""}: ${EVIDENCE_VALUE}.`,
      str(obj(row.reviewRepository)?.rule, 300) ?? "A result is Claimed unless the row names a review repository.",
      claims ? `${claims} claims tracked on the site; this track shows the current leader.` : "This track shows the current leader.",
    ].filter(Boolean).join(" "),
    metricName: numeric ? clip(plainTex(str(row.rankedQuantity, 160) ?? "value"), 80) || "value" : "evidence level",
    metricDirection: numeric && minimize ? "minimize" : "maximize",
    ...(baseline !== undefined ? { baseline } : {}),
    isOpen: !closed,
    records,
  };
}

// ─── Entering ───────────────────────────────────────────────────────────
export function participationOf(k: BosKnowledge, raceNames: Map<string, string>): { participation: Participation; links: { label: string; url: string }[] } {
  const c = (obj(k.contribute) ?? {}) as BosContribute;
  const lean = (obj(c.leanProof) ?? {}) as NonNullable<BosContribute["leanProof"]>;
  const p2m = (obj(c.prove2me) ?? {}) as NonNullable<BosContribute["prove2me"]>;
  const names = (paths: unknown) => list<unknown>(paths).map((x) => (typeof x === "string" ? raceNames.get(x) : undefined)).filter(Boolean).join(", ");
  const newResult = str(c.newResult, 400);
  const discord = httpsUrl(newResult?.match(/https:\/\/discord\.gg\/[A-Za-z0-9]{2,32}\b/)?.[0], ["discord.gg"]);
  const verifier = httpsUrl(lean.repository, ["github.com"]);
  const instructions = httpsUrl(lean.instructions, ["github.com"]);
  const campaigns = list<unknown>(p2m.campaigns).slice(0, 20).map((x) => obj(x)).flatMap((x) => {
    const url = httpsUrl(x?.url, ["prove2.me"]), race = typeof x?.problem === "string" ? raceNames.get(x.problem) : undefined;
    return url && race ? [{ label: `prove2.me campaign: ${race}`, url }] : [];
  });
  const howToSubmit = [
    newResult ? `New results: ${newResult}` : "",
    str(lean.text, 400) ? `Lean proofs${names(lean.problems) ? ` (${names(lean.problems)})` : ""}: ${instructions ? `${str(lean.text, 400)!.replace(/\.$/, "")} (instructions: ${instructions}).` : str(lean.text, 400)}` : "",
    str(p2m.text, 300) ? `prove2.me${names(p2m.problems) ? ` (${names(p2m.problems)})` : ""}: ${str(p2m.text, 300)}` : "",
    str(c.reviewRepositories, 250) ? `Review repositories: ${str(c.reviewRepositories, 250)}` : "",
  ].filter(Boolean).join(" ");
  const evidence = list<unknown>(k.evidence).map((e) => obj(e)).filter((e) => level(e?.name) > 0 && str(e?.definition, 400)).map((e) => `${e!.name}: ${str(e!.definition, 400)}`);
  return {
    participation: {
      howToSubmit: howToSubmit || `See ${SITE}/about#submit.`,
      submissionFormat: "A link to a public repository, commit or paper that states the bound for the race's exact problem; for Lean Verified, a Lean 4 proof of the verifier's statement (pull request or issue on bigospeedrun/verifier, or a proof in the race's prove2.me campaign).",
      requirements: ["GitHub account (verifier pull requests and issues)", "Discord account (#submit-a-result)", "Lean 4 and Mathlib (for a Lean Verified result)"],
      compute: "cpu",
      computeDetails: "Research and Lean proof building run on your own machine with your own model usage; the site rebuilds a Lean proof from source and checks it with the Lean kernel (Comparator) against its exact statement.",
      deadline: "rolling (no deadline)",
      rounds: "Continuous: the site's data is refreshed hourly; a race closes when a result is shown to be the best possible.",
      prizes: "Recognition: records are listed on bigospeedrun.com and announced on X and Discord.",
      eligibility: "Anyone.",
      cost: "free (your own model usage)",
      verification: evidence.length ? evidence.join(" ") : "Claimed, Human Verified or Lean Verified, as each problem page defines.",
    },
    links: [
      { label: "Big O Speedrun", url: `${SITE}/` },
      { label: "About, evidence levels and how to submit", url: `${SITE}/about` },
      { label: "Instructions for agents (llms.txt)", url: `${SITE}/llms.txt` },
      { label: "Structured data (chat-knowledge.json)", url: DATA_URL },
      ...(discord ? [{ label: "Discord (#submit-a-result)", url: discord }] : []),
      ...(verifier ? [{ label: "Lean verifier (bigospeedrun/verifier)", url: verifier }] : []),
      ...(instructions && instructions !== verifier ? [{ label: "How to submit a Lean proof", url: instructions }] : []),
      ...campaigns,
      { label: "Race boards for agents", url: "https://board.bigospeedrun.com/" },
    ],
  };
}

export async function buildBigOSpeedrun(): Promise<LLMCompetition> {
  const k = await getKnowledge();
  const pages = obj(k.pages) ?? {};
  const seen = new Set<string>();
  const unique = (t: Problem | undefined): t is Problem => !!t && !seen.has(t.id) && !!seen.add(t.id);
  const raceNames = new Map<string, string>(); // path → name of the race kept for it (a repeated path keeps the first)
  const races = list<BosRace>(k.problems).slice(0, 50).flatMap((p) => {
    const t = raceToProblem(p, pages);
    return unique(t) ? (raceNames.set(p.path, t.name), [t]) : [];
  });
  if (!races.length) throw new Error("Big O Speedrun download failed");
  const others = list<BosOtherRow>(obj(k.otherBounds)?.rows).slice(0, 100).map(otherBoundToProblem).filter(unique);
  const problems = [...races, ...others];
  const { participation, links } = participationOf(k, raceNames);

  const campaigns = links.filter((l) => l.label.startsWith("prove2.me campaign")).length;
  const records = problems.flatMap((p) => p.records);
  const scored = problems.filter((p) => p.metricName !== "evidence level").length;
  console.log(`    bigospeedrun: ${races.length} races, ${others.length} other bounds (${scored} ranked by score), ${records.length} leader rows, ${records.filter((r) => r.agent).length} with agent evidence`);
  const updated = day(k.updatedAt);
  return {
    id: "bigospeedrun",
    name: "Big O Speedrun",
    tagline: "A race to improve the complexity bounds of classic problems (integer and matrix multiplication, 3SUM, APSP, 3-SAT, …); every record is Claimed, Human Verified or Lean Verified.",
    description: [
      "Big O Speedrun (bigospeedrun.com) tracks improved algorithmic bounds for classic problems; each race starts from the first result by AI agents that broke the classic bound.",
      `${races.length} races (${races.map((p) => p.name).join(", ")}) and ${others.length} "Other bounds" rows.`,
      "Every result carries an evidence level: Claimed (published, not checked), Human Verified (accepted by the race's review repository) or Lean Verified (its Lean proof rebuilt and kernel-checked against the site's exact statement).",
      `New results are posted in #submit-a-result on Discord; Lean proofs go to bigospeedrun/verifier${campaigns ? `, and ${campaigns} race${campaigns === 1 ? " also takes" : "s also take"} proofs from prove2.me campaigns` : ""}.`,
      `Tracks here list the current leader at each evidence level from the site's hourly data${updated ? ` (updated ${updated})` : ""}; a track ranks by the site's exact score where its page states one direction, otherwise by evidence level (each track says which).`,
      "Agent attribution only where the site's text names the AI.",
    ].join(" "),
    url: `${SITE}/`,
    host: "website",
    status: "active",
    tags: ["algorithms", "complexity-theory", "lean4", "formal-proofs", "theorem-proving", "math", "agents", "open-problem"],
    domain: "formal-methods",
    images: [],
    organizer: { name: "Big O Speedrun", url: `${SITE}/about`, type: "community" },
    participation,
    venue: { type: "online", location: "bigospeedrun.com" },
    quickstart: `# point your coding agent at the site's guide (the problems, the evidence levels, how to submit):\nRead ${SITE}/about and ${SITE}/llms.txt, pick a race, and help me improve its bound.\n# Lean proofs go to the verifier: https://github.com/bigospeedrun/verifier#submit\n# new results: post the repository, commit or paper in #submit-a-result on the site's Discord`,
    links,
    problems,
    agentStats: [],
  } as LLMCompetition;
}
