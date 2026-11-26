// Deterministic builder for the Riemann Hypothesis Lean 4 Community Collaboration Hub (Osgood001/riemann-hypothesis), the community
// fork of the Lean 4 formalization that claims a proof of the Riemann Hypothesis (Levent Alpöge, announced 2026-11-20). The proof is
// split into pillars; entrants shorten a pillar's proof without breaking it, Bohrium's Agentic Science Playground builds, checks and
// scores every submission, and the hub's live board mirrors the results. Source (public, no login; the JSON the board's own page
// reads, ~1.1 MB, gzip):
//   https://riemann.verifytask.cn/api/board
//     challenges[]                   — every pillar the board lists (Core 1…53 and the Grand Challenge): key, title, statement, its
//                                      Bohrium page, the original proof's size (t0 normalized tokens, l0 chars), counts, the leader
//                                      and the top submissions (one per author)
//     autoresearch.overall_core.runs — every verified run on the core pillars, oldest first (run_idx 1 is 2026-11-21): time, pillar,
//                                      author, score, size, `kept` (the board's "breakthrough": the run beat the pillar's best score
//                                      when it was verified), and the model and harness the author's CLI reported
//     summary, progress              — the board's own totals
// No LLM involved. The board ranks by its score, higher is better: it rises as the proof gets shorter in anti-golf normalized Lean
// tokens (characters for the full proof), and every run must check with 0 sorry and the standard axioms. One track per pillar. Its
// records are each author's best verified run there, dated by when it was verified: the board's own standings, one row per author
// as in its top submissions. The other runs are attempts the pulse counts (src/pulse.ts); every run of every author would be ~350 rows
// a day here. A run that verifies the baseline (exactly the original's size, or labelled "Baseline verified (L₀)" by the board) is
// a reference, not an entry: each pillar gets one baseline row. The board scores every run of exactly an unmodified proof the same
// (50 today, on 35 pillars), and that score is the baseline of a pillar it has not run that way; were they to disagree, a pillar
// would fall back to what its own baseline-verification runs scored, or have no baseline.
// Models and harnesses are self-reported telemetry: a row carries attribution only where the model text names a known model (or
// at least its family); a name like "The Council", a product with no family ("Composer") or a blank names none, whatever the harness.

import type { LLMCompetition } from "../llm.js";
import type { AgentAttribution, AgentFamily, Problem, RecordEntry } from "../types.js";
import { boundedFetch } from "../github.js";
import { familyFromName } from "../postprocess.js";

export const BOARD = "https://riemann.verifytask.cn/";
export const BOARD_API = "https://riemann.verifytask.cn/api/board";
export const HUB = "https://github.com/Osgood001/riemann-hypothesis";
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const MAX_BYTES = 16 * 1024 * 1024; // ~1.1 MB today; the runs list grows with every verified run
const MAX_PILLARS = 200, MAX_RUNS = 100_000, MAX_TOP = 20;
const AUTHORS_PER_PILLAR = 100;     // each author's best, highest first; the busiest pillar has ~70 authors
const SKEW_MS = 10 * 60_000;        // a board clock a few minutes ahead is tolerated; a later time is not a date
const DAY = 86_400_000;

export interface RhRun {
  run_idx?: number; id?: number; ts?: string; challenge_key?: string; authorName?: string; score?: number; compression_pct?: number;
  kept?: boolean; model_display?: string | null; harness_display?: string | null; chars?: number; tokens?: number; chart_method_en?: string;
}
export interface RhSubmission {
  rank?: number; id?: number; authorName?: string; score?: number; char_saved_pct?: number; token_saved_pct?: number;
  model_display?: string | null; harness_display?: string | null; chars?: number; tokens?: number; core_en?: string;
}
export interface RhChallenge {
  id?: string; key?: string; code?: string; badge_en?: string; tier?: string; metric?: string; is_main?: boolean; title_en?: string;
  short_en?: string; desc_en?: string; url?: string; l0?: number; t0?: number | null; subs?: number; scored_subs?: number;
  participants_count?: number; leader?: RhSubmission | null; top_submissions?: RhSubmission[];
}

async function getBoard(): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(BOARD_API, { headers: { accept: "application/json", "user-agent": USER_AGENT } }, MAX_BYTES, 60_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      return await r.json();
    } catch {
      if (attempt >= 1) throw new Error("Riemann board download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ─── Third-party text and numbers ───────────────────────────────────────
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : undefined);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
/**
 * A plain string with control and bidi characters dropped, whitespace collapsed, clipped; anything else is nothing. A "<" that
 * could open a tag (before a letter, "/", "!" or "?") is dropped, so the Markdown digests never carry markup; the statements'
 * own comparisons ("c > 0", "x < y") stay.
 */
export function str(v: unknown, n: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(CONTROL, " ").replace(/<(?=[A-Za-z/!?])/g, "").replace(/\s+/g, " ").trim();
  return s ? clip(s, n) : undefined;
}
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const count = (v: unknown, max = 1e9): number | undefined => (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max ? v as number : undefined);
const size = (v: unknown): number | undefined => { const n = count(v, 1e13); return n ? n : undefined; }; // a proof has a size above zero
const pct = (v: unknown): number | undefined => (finite(v) && v >= 0 && v <= 100 ? v : undefined);
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
/** The UTC day of a time the board writes with its offset ("2026-11-26T06:15:49+00:00", "…16:24:24+08:00"); a future time is no date. */
export function utcDay(v: unknown, now = Date.now()): string | undefined {
  if (typeof v !== "string" || !ISO.test(v)) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) && t <= now + SKEW_MS ? new Date(t).toISOString().slice(0, 10) : undefined;
}
// A display name is what the account typed; an email address in it is shown up to the @, never republished whole
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
export const authorName = (v: unknown) => str(v, 60)?.replace(EMAIL, (m) => `${m.slice(0, m.indexOf("@"))}@…`);
const KEY = /^[a-z][a-z0-9_-]{0,39}$/;                                     // "core35", "main": the track id, as the board keys it
const BOHRIUM = /^https:\/\/play\.bohrium\.com\/challenges\/[a-z0-9-]{1,120}$/; // a pillar's page on the Playground, as src/pulse.ts accepts it
const quote = (s: string) => s.replace(/[<>"'\\`]/g, " ").replace(/\s+/g, " ").trim(); // quoted back as data, never as markup

// ─── The model and harness a run reports ────────────────────────────────
// Free text from the author's CLI, often several models at once ("Neon + GPT-6.2 Astra + Opus 5.5"): the first one named decides,
// written the way the rest of the dataset writes it. "Neon" or "Astra" alone names no model this builder can tell apart.
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const ver = (v?: string) => (v ? ` ${v.replace(/-/g, ".")}` : "");
const MODELS: [RegExp, AgentFamily, (m: RegExpMatchArray) => string][] = [
  // "Claude Opus 5.5", "claude-opus-5-5", "Claude-Opus-5.5"; a tier with no "Claude" before it needs a version ("Opus5.5", "Fable 5.2")
  [/\bclaude[\s\-_/]*(opus|sonnet|haiku|fable)(?:[\s\-_]?(\d{1,2}(?:[.\-]\d{1,2})?))?(?![\w.])/gi, "anthropic", (m) => `Claude ${cap(m[1])}${ver(m[2])}`],
  [/\b(opus|sonnet|haiku|fable)[\s\-_]?(\d{1,2}(?:[.\-]\d{1,2})?)(?![\w.])/gi, "anthropic", (m) => `Claude ${cap(m[1])}${ver(m[2])}`],
  [/\bclaude\b/gi, "anthropic", () => "Claude"],
  // "GPT-6.2 Astra", "gpt-6.1-sol", "openai-codex/gpt-6.2-astra", "gpt-5.2-codex"
  [/\bgpt[\s\-_]?(\d{1,2}(?:\.\d{1,2})?)(?![\w.])(?:[\s\-_](mini|nano|pro|codex|sol|astra|luna|terra|nova))?(?![a-z])/gi, "openai", (m) => `GPT-${m[1]}${m[2] ? ` ${cap(m[2])}` : ""}`],
  // "Gemini 4 Neon", "gemini-4-neon-high", "Gemini 3.1 Pro"; not the Gemini CLI
  [/\bgemini(?![\s\-_]?cli\b)(?:[\s\-_]?(\d{1,2}(?:\.\d{1,2})?)(?![\d.]))?(?:[\s\-_](pro|flash|ultra|nano|lite|neon|argon|carbon|hydrogen))?(?![a-z])/gi, "google",
    (m) => `Gemini${m[1] ? ` ${m[1]}` : ""}${m[2] ? ` ${cap(m[2])}` : ""}`],
  // "DeepSeek V4.1 Flash", "deepseek-v4-flash-max", "Deepseek Flash"
  [/\bdeepseek(?:[\s\-_]?(v\d{1,2}(?:\.\d{1,2})?|r\d{1,2}))?(?:[\s\-_](flash|pro|chat|coder|prover|reasoner))?(?![a-z])/gi, "deepseek",
    (m) => `DeepSeek${m[1] ? ` ${m[1].toUpperCase()}` : ""}${m[2] ? ` ${cap(m[2])}` : ""}`],
  [/\bglm[\s\-_]?(\d{1,2}(?:\.\d{1,2})?)(?![\d.])(?:[\s\-_](flash|air|plus|turbo))?(?![a-z])/gi, "zhipu", (m) => `GLM-${m[1]}${m[2] ? ` ${cap(m[2])}` : ""}`],
  [/\bgrok(?:[\s\-_]?(\d{1,2}(?:\.\d{1,2})?))?(?![\w.])/gi, "xai", (m) => `Grok${m[1] ? ` ${m[1]}` : ""}`],
  // "Qwen3.8-Flash-Next", "qwen4-max-preview": postprocess's family table misses a version glued to the name, so the family comes from here
  [/\bqwen[\s\-_]?(\d{1,2}(?:\.\d{1,2})?)?(?![\d.])(?:[\s\-_](max|plus|flash|coder|turbo))?(?![a-z])/gi, "alibaba", (m) => `Qwen${m[1] ?? ""}${m[2] ? ` ${cap(m[2])}` : ""}`],
  [/\bkimi(?:[\s\-_]?(k\d(?:\.\d)?))?(?![\w.])/gi, "moonshot", (m) => `Kimi${m[1] ? ` ${m[1].toUpperCase()}` : ""}`],
];
const BARE = /^(?:Claude|Gemini|DeepSeek|Grok|Qwen|Kimi)$/; // a family, not a model: the family is recorded, the model is not

/** The first model the text names, written the dataset's way, and its family; a bare family name gives the family alone. */
export function declaredModel(s: string): { model?: string; family?: AgentFamily } {
  const hits: { at: number; label: string; family: AgentFamily }[] = [];
  for (const [rx, family, label] of MODELS) for (const m of s.matchAll(rx)) hits.push({ at: m.index ?? 0, label: label(m), family });
  hits.sort((a, b) => a.at - b.at);
  const named = hits.find((h) => !BARE.test(h.label));
  if (named) return { model: named.label, family: named.family };
  return hits.length ? { family: hits[0].family } : {};
}

// Harnesses the board's telemetry names; anything else ("custom loop", "manual-lean4", "ci-lean4") is no tool
const TOOLS: [RegExp, string][] = [
  [/\bclaude[\s\-_]?code\b/i, "Claude Code"], [/\bclaude[\s\-_]?agent[\s\-_]?sdk\b/i, "Claude Agent SDK"], [/\bcodex\b/i, "Codex"],
  [/\bcursor\b/i, "Cursor"], [/\bantigravity\b/i, "Antigravity"], [/\bopencode\b/i, "OpenCode"], [/\bgemini[\s\-_]?cli\b/i, "Gemini CLI"],
  [/\bcopilot\b/i, "GitHub Copilot"], [/\bdevin\b/i, "Devin"], [/\bwindsurf\b/i, "Windsurf"], [/\baider\b/i, "Aider"],
  [/\bhermes\b/i, "Hermes Agent"], [/\bt3[\s\-_]?code\b/i, "T3 Code"], [/\bzcode\b/i, "ZCode"], [/^pi$/i, "pi"],
];
/** The first harness the text names, by position ("Claude Code + Codex + Antigravity" → Claude Code). */
export function harnessTool(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return TOOLS.map(([rx, name]) => ({ at: s.search(rx), name })).filter((t) => t.at >= 0).sort((a, b) => a.at - b.at)[0]?.name;
}

/**
 * The agent behind a run, from the model and harness its author's CLI reported. Only the model text can attribute a run: a harness
 * alone names no model. Role is always "author": the row is the author's proof, not a model being benchmarked.
 */
export function agentOf(modelText: unknown, harnessText: unknown, where: string): AgentAttribution | undefined {
  const s = str(modelText, 120);
  if (!s) return undefined;
  const { model, family: named } = declaredModel(s);
  const family = named ?? familyFromName(s);
  if (!family || family === "human" || family === "unknown") return undefined;
  const h = str(harnessText, 80), tool = harnessTool(h);
  return {
    family,
    ...(model ? { model } : {}),
    ...(tool ? { tool } : {}),
    evidence: `riemann.verifytask.cn ${where}: model "${quote(s)}"${h ? `, harness "${quote(h)}"` : ""} (self-reported CLI telemetry)`,
    confidence: model ? "high" : "medium", // a family alone ("Gemini", "doubao-agent") is thinner evidence than a named model
    role: "author",
  };
}

// ─── Pillars and runs ───────────────────────────────────────────────────
export interface Pillar {
  key: string; name: string; isMain: boolean; tokens: boolean; // tokens: scored on normalized tokens; otherwise on characters
  url: string;                                                  // its Bohrium page, or the board
  t0?: number; l0?: number;                                     // the original proof's size
  desc?: string; subs?: number; scored?: number; people?: number;
  leader?: number;                                              // the board's leader, a run id
  top: Run[];                                                   // its top submissions, one per author (no time: the board gives none)
}
export interface Run {
  id: number; key: string; author: string; score: number; ts?: string; kept: boolean; pct?: number;
  tokens?: number; chars?: number; method?: string; model?: unknown; harness?: unknown;
}

export function pillarOf(v: unknown): Pillar | undefined {
  const c = obj(v) as RhChallenge | undefined;
  const key = typeof c?.key === "string" && KEY.test(c.key) ? c.key : undefined;
  const short = str(c?.short_en, 80) ?? str(c?.title_en, 80);
  if (!c || !key || !short) return undefined;
  const isMain = c.is_main === true || c.tier === "main";
  const badge = str(c.badge_en, 30) ?? (isMain ? "Grand Challenge" : key);
  const t0 = size(c.t0), l0 = size(c.l0);
  const tokens = c.metric === "tokens" || (c.metric !== "chars" && t0 !== undefined);
  const leader = obj(c.leader);
  return {
    key, name: `${badge}: ${short}`, isMain, tokens,
    url: typeof c.url === "string" && BOHRIUM.test(c.url) ? c.url : BOARD,
    ...(t0 !== undefined ? { t0 } : {}), ...(l0 !== undefined ? { l0 } : {}),
    ...(str(c.desc_en, 320) ? { desc: str(c.desc_en, 320) } : {}),
    ...(count(c.subs) !== undefined ? { subs: count(c.subs) } : {}),
    ...(count(c.scored_subs) !== undefined ? { scored: count(c.scored_subs) } : {}),
    ...(count(c.participants_count) !== undefined ? { people: count(c.participants_count) } : {}),
    ...(count(leader?.id, 1e12) !== undefined ? { leader: count(leader?.id, 1e12) } : {}),
    top: list<unknown>(c.top_submissions).slice(0, MAX_TOP).map((t) => submissionOf(t, key, tokens)).filter((r): r is Run => !!r),
  };
}

// A run as the board lists it; one with no author, score or id is dropped, and its own fields are read only where they check out
export function runOf(v: unknown): Run | undefined {
  const r = obj(v) as RhRun | undefined;
  const id = count(r?.id, 1e12), author = authorName(r?.authorName);
  const key = typeof r?.challenge_key === "string" && KEY.test(r.challenge_key) ? r.challenge_key : undefined;
  if (!r || id === undefined || !author || !key || !finite(r.score)) return undefined;
  const method = str(typeof r.chart_method_en === "string" ? r.chart_method_en.replace(/^\s*Core \d{1,3}(?: · Fast)?\s*:\s*/i, "") : undefined, 140);
  return {
    id, key, author, score: r.score, kept: r.kept === true,
    ...(typeof r.ts === "string" && ISO.test(r.ts) ? { ts: r.ts } : {}),
    ...(pct(r.compression_pct) !== undefined ? { pct: pct(r.compression_pct) } : {}),
    ...(size(r.tokens) !== undefined ? { tokens: size(r.tokens) } : {}),
    ...(size(r.chars) !== undefined ? { chars: size(r.chars) } : {}),
    ...(method ? { method } : {}),
    model: r.model_display, harness: r.harness_display,
  };
}

// A top submission: the same fields as a run but no time; its saving is the one the pillar is scored on
function submissionOf(v: unknown, key: string, tokens: boolean): Run | undefined {
  const s = obj(v) as RhSubmission | undefined;
  const id = count(s?.id, 1e12), author = authorName(s?.authorName);
  if (!s || id === undefined || !author || !finite(s.score)) return undefined;
  const saved = pct(tokens ? s.token_saved_pct : s.char_saved_pct);
  return {
    id, key, author, score: s.score, kept: false,
    ...(saved !== undefined ? { pct: saved } : {}),
    ...(size(s.tokens) !== undefined ? { tokens: size(s.tokens) } : {}),
    ...(size(s.chars) !== undefined ? { chars: size(s.chars) } : {}),
    ...(str(s.core_en, 160) ? { method: str(s.core_en, 160) } : {}),
    model: s.model_display, harness: s.harness_display,
  };
}

/** The unmodified proof: a run exactly the original's size (tokens and characters both, where the board measures both). */
export const isOriginal = (r: Run, p: Pillar) => p.l0 !== undefined && r.chars === p.l0 && (p.t0 === undefined || r.tokens === p.t0);
/** A run that verifies the baseline: the unmodified proof, or one the board itself labels "Baseline verified (L₀)" (a reproduction a few tokens off). */
export const isReference = (r: Run, p: Pillar) => isOriginal(r, p) || /^baseline verified\b/i.test(r.method ?? "");

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sizeText = (r: Run, p: Pillar) => {
  const own = p.tokens ? r.tokens : r.chars, base = p.tokens ? p.t0 : p.l0, unit = p.tokens ? "normalized tokens" : "chars";
  if (own === undefined) return "";
  const saved = r.pct ?? (base ? round((1 - own / base) * 100) : undefined);
  const vs = base === undefined ? "" : saved !== undefined && saved > 0 ? ` (−${saved}% vs the original ${fmt(base)})` : ` (the original has ${fmt(base)})`;
  return `${fmt(own)} ${unit}${vs}${p.tokens && r.chars !== undefined ? ` · ${fmt(r.chars)} chars` : ""}`;
};

// ─── Tracks ─────────────────────────────────────────────────────────────
// anchor: the score every run of exactly an unmodified proof got on the board, when they all got the same one; references: how many
interface Ctx { anchor?: number; references?: number; breakthroughs?: number; now: number }

/** One pillar → one track: each author's best verified run (dated runs first, then what only its top submissions show), over a baseline row. */
export function pillarToTrack(p: Pillar, runs: Run[], ctx: Ctx): Problem {
  const mine = runs.filter((r) => r.key === p.key);
  const seen = new Set(mine.map((r) => r.id));
  // a top submission the runs list does not have (the Grand Challenge's are none of them) still counts, undated
  const all = [...mine, ...p.top.filter((t) => !seen.has(t.id))];
  const refs = all.filter((r) => isReference(r, p));
  const tried = all.filter((r) => !isReference(r, p));

  const best = new Map<string, { run: Run; n: number }>();
  for (const r of tried) {
    const who = r.author.toLowerCase(), cur = best.get(who);
    const dated = !!r.ts;
    if (!cur) { best.set(who, { run: r, n: dated ? 1 : 0 }); continue; }
    if (dated) cur.n++;
    // higher score wins; a tie keeps the earlier run (the time it was first reached), and a dated run over an undated one
    if (r.score > cur.run.score || (r.score === cur.run.score && !!r.ts && (!cur.run.ts || Date.parse(r.ts) < Date.parse(cur.run.ts)))) cur.run = r;
  }
  const rows = [...best.values()]
    .sort((a, b) => b.run.score - a.run.score || (a.run.ts && b.run.ts ? Date.parse(a.run.ts) - Date.parse(b.run.ts) : Number(!a.run.ts) - Number(!b.run.ts)) || a.run.id - b.run.id)
    .slice(0, AUTHORS_PER_PILLAR);
  const leaderRow = rows.find((x) => x.run.id === p.leader) ?? rows[0];
  const records: RecordEntry[] = rows.map(({ run, n }) => {
    const agent = agentOf(run.model, run.harness, `${run.ts ? "run" : "top submission"} #${run.id}`);
    return {
      value: round(run.score),
      ...(utcDay(run.ts, ctx.now) ? { date: utcDay(run.ts, ctx.now) } : {}),
      contributor: run.author,
      contributorKind: "person",
      // a Bohrium display name, not a GitHub login: the pillar's page, never a guessed profile
      contributorUrl: p.url,
      description: [
        run.method ?? "",
        sizeText(run, p),
        run.kept ? "a breakthrough: it beat the pillar's best score when verified" : "",
        // a run the board shows only among the top submissions has no time, and the runs it was the best of are not in the list
        !run.ts ? "listed among the pillar's top submissions" : n > 1 ? `best of ${n} verified runs by this author here` : "this author's only verified run here",
        `run #${run.id}`,
      ].filter(Boolean).join(" · "),
      isBaseline: false,
      isCurrentBest: leaderRow?.run === run,
      ...(agent ? { agent } : {}),
    };
  });

  // The baseline: what this pillar's own run of exactly the unmodified proof scored, else the board's scale for one, else what its
  // baseline-verification runs scored
  const exact = refs.filter((r) => isOriginal(r, p));
  const baseline = exact.length ? round(median(exact.map((r) => r.score))) : ctx.anchor ?? (refs.length ? round(median(refs.map((r) => r.score))) : undefined);
  if (baseline !== undefined) {
    const first = [...refs].sort((a, b) => (a.ts && b.ts ? Date.parse(a.ts) - Date.parse(b.ts) : Number(!a.ts) - Number(!b.ts)) || a.id - b.id)[0];
    const sizes = [p.t0 !== undefined ? `${fmt(p.t0)} normalized tokens` : "", p.l0 !== undefined ? `${fmt(p.l0)} chars` : ""].filter(Boolean).join(", ");
    records.push({
      value: baseline,
      contributor: "original proof (unmodified)",
      contributorKind: "method",
      description: [
        `the proof as published${sizes ? `: ${sizes}` : ""}`,
        !exact.length && ctx.anchor !== undefined ? `an unmodified proof scores ${ctx.anchor} on the board (${ctx.references ? plural(ctx.references, "reference run") : "its reference runs"} of exactly the original's size)` : "",
        first ? `baseline verified here by run #${first.id}${utcDay(first.ts, ctx.now) ? ` (${utcDay(first.ts, ctx.now)})` : ""}, score ${round(first.score)}${refs.length > 1 ? `, and ${refs.length - 1} more` : ""}` : "",
      ].filter(Boolean).join(" · "),
      isBaseline: true,
    });
  }

  const open = !records.some((r) => !r.isBaseline);
  const sizes = p.tokens
    ? `${p.t0 !== undefined ? `${fmt(p.t0)} normalized tokens` : "its normalized tokens"}${p.l0 !== undefined ? ` (${fmt(p.l0)} chars)` : ""}`
    : `${p.l0 !== undefined ? fmt(p.l0) : "its"} chars`;
  return {
    id: p.key,
    name: p.name,
    description: [
      p.desc ?? "",
      `The original proof: ${sizes}. Ranked by the board's score, higher is better: it rises as the proof gets shorter in ${p.tokens ? "normalized Lean tokens" : "characters"}${baseline !== undefined ? ` and the unmodified proof scores ${baseline}` : ""}; a run counts only with 0 sorry and the standard axioms.`,
      p.scored !== undefined
        ? `${plural(p.scored, "verified run")}${ctx.breakthroughs !== undefined ? ` (${plural(ctx.breakthroughs, "breakthrough")})` : ""}${p.people !== undefined ? ` by ${plural(p.people, "contributor")}` : ""}${p.subs !== undefined && p.subs > p.scored ? `, ${fmt(p.subs)} submitted` : ""} on the board.`
        : "",
      open ? "No verified run has shortened it yet." : "",
    ].filter(Boolean).join(" "),
    metricName: "score",
    metricDirection: "maximize",
    ...(baseline !== undefined ? { baseline } : {}),
    isOpen: true, // postprocess decides: open until a verified run is on it
    records,
  };
}

/** The board → the competition, without the network: every pillar it lists, in its order. Throws when the shape is not the board's. */
export function boardToCompetition(raw: unknown, now = Date.now()): LLMCompetition {
  const b = obj(raw), core = obj(obj(b?.autoresearch)?.overall_core);
  if (!b || !Array.isArray(b.challenges) || !Array.isArray(core?.runs)) throw new Error("Riemann board download failed");
  const seenKeys = new Set<string>();
  const pillars = list<unknown>(b.challenges).slice(0, MAX_PILLARS).map(pillarOf)
    .filter((p): p is Pillar => !!p && !seenKeys.has(p.key) && !!seenKeys.add(p.key));
  if (!pillars.length) throw new Error("Riemann board download failed");
  const byKey = new Map(pillars.map((p) => [p.key, p]));
  const seenRuns = new Set<number>();
  const runs = list<unknown>(core!.runs).slice(-MAX_RUNS).map(runOf).filter((r): r is Run => !!r && byKey.has(r.key) && !seenRuns.has(r.id) && !!seenRuns.add(r.id));

  // the board's scale: the score every run of exactly an unmodified proof got, when they all got the same one (50 today)
  const exactIds = new Set<number>();
  const exactRuns = [...runs.filter((r) => isOriginal(r, byKey.get(r.key)!)), ...pillars.flatMap((p) => p.top.filter((t) => isOriginal(t, p)))].filter((r) => !exactIds.has(r.id) && !!exactIds.add(r.id));
  const refScores = new Set(exactRuns.map((r) => r.score));
  const anchor = refScores.size === 1 ? round([...refScores][0]) : undefined;
  const byChallenge = obj(obj(b.autoresearch)?.by_challenge) ?? {};
  const problems = pillars.map((p) => pillarToTrack(p, runs, { anchor, references: exactRuns.length, now, breakthroughs: count(obj(byChallenge[p.key])?.kept_count) }));

  // the board's own totals, each only when it is a count
  const summary = obj(b.summary) ?? {};
  const verified = count(core!.total_runs) ?? runs.length, breakthroughs = count(core!.kept_count) ?? runs.filter((r) => r.kept).length;
  const people = count(summary.scored_participants), submitted = count(summary.total_submissions);
  const solved = count(summary.core_solved), coreTotal = count(summary.core_total);
  const saved = pct(obj(obj(b.progress)?.core)?.saved_tokens_pct);
  const entries = problems.flatMap((t) => t.records.filter((r) => !r.isBaseline));
  const authors = new Set(entries.map((r) => r.contributor!.toLowerCase()));
  const newest = runs.reduce((m, r) => Math.max(m, r.ts && Date.parse(r.ts) <= now + SKEW_MS ? Date.parse(r.ts) : 0), 0);
  const main = pillars.find((p) => p.isMain);
  console.log(`    riemann-hub: ${problems.length} pillars (${problems.filter((t) => !t.records.some((r) => !r.isBaseline)).length} with no verified run), ${runs.length} verified runs read, ${entries.length} author bests from ${authors.size} authors, ${entries.filter((r) => r.agent).length} with a reported model; unmodified proof scores ${anchor ?? "not uniform"}`);

  return {
    id: "riemann-hypothesis-hub",
    name: "Riemann Hypothesis Lean 4 Community Collaboration Hub",
    tagline: "Shorten the pillars of the Lean 4 formalization that claims a proof of the Riemann Hypothesis: every run is machine-checked (0 sorry, standard axioms) and scored on normalized Lean tokens.",
    description: [
      "A community hub for the Lean 4 formalization that claims a proof of the Riemann Hypothesis and of GRH for Dirichlet L-functions, announced by Levent Alpöge on 2026-11-20.",
      "The proof is split into pillars (sub-theorems with their own Lean entry point) plus the full proof as the Grand Challenge; entrants and their agents shorten a pillar's proof without breaking it.",
      "Bohrium's Agentic Science Playground builds and checks every submission (0 sorry, only the standard axioms) and scores it on its anti-golf normalized Lean token count; a run that beats the pillar's best score is kept as a breakthrough, and the hub's live board mirrors the results.",
      `${plural(verified, "verified run")} and ${plural(breakthroughs, "breakthrough")}${people !== undefined ? ` from ${plural(people, "contributor")}` : ""}${submitted !== undefined && submitted > verified ? ` (${fmt(submitted)} submissions in all)` : ""} so far${solved !== undefined && coreTotal ? `; ${solved} of ${coreTotal} core pillars have a verified run` : ""}${saved !== undefined ? `, and their best proofs are ${saved}% shorter in normalized tokens than the originals` : ""}.`,
      `Tracks here are the board's ${problems.length} pillars; each lists every author's best verified run, over a baseline row for the unmodified proof.`,
      "Models and harnesses are what each author's CLI reported (self-reported telemetry); a row carries a model only where that text names one.",
    ].join(" "),
    // the hub's repository: where the board is listed, and how src/pulse.ts finds this board for its live card
    url: HUB,
    host: "website",
    status: newest && now - newest < 30 * DAY ? "active" : "unknown",
    tags: ["lean4", "formal-methods", "riemann-hypothesis", "theorem-proving", "proof-simplification", "mathlib", "leaderboard"],
    domain: "formal-methods",
    images: [],
    organizer: { name: "Osgood001", url: "https://github.com/Osgood001", type: "community" },
    participation: {
      howToSubmit: "Scored on the board: install the Bohrium Playground CLI (curl -fsSL https://play.bohrium.com/install.sh | bash) and submit a shorter proof against any pillar's challenge on play.bohrium.com; it is built, checked and scored automatically, and frontier breakthroughs are staged in the hub as attributed draft pull requests. Directly on GitHub: fork Osgood001/riemann-hypothesis, simplify a module under src/, run scripts/pr_lightweight_checks.py and open a pull request against main; maintainers run the full Bohrium sandbox verification.",
      submissionFormat: "Lean 4 source for one pillar (a standalone file importing Mathlib, on the Lean version the pillar's Playground page names) that proves the pillar's statement with 0 sorry and only the standard axioms (propext, Classical.choice, Quot.sound).",
      requirements: ["Lean 4 and Mathlib", "Bohrium Playground account and CLI", "Python 3 (lightweight checks for pull requests)"],
      compute: "cpu",
      computeDetails: "No GPU: proofs are built with Lean and Mathlib on your own machine and verified on Bohrium's sandbox, where the fast pillars check in minutes; building the full proof (the Grand Challenge) takes hours on a large machine and about 100 GB of disk.",
      deadline: "rolling (no deadline stated)",
      rounds: "Pillars are added in phases (Core 1–5, Core 6–13, then the Phase 3 pillars); the Grand Challenge is the full proof.",
      prizes: "None stated; breakthroughs are credited on the board and staged in the hub as attributed draft pull requests.",
      eligibility: "Anyone; scoring on the board needs a Bohrium Playground account.",
      cost: "free",
      verification: "Every run is built and checked on Bohrium (0 sorry, standard axioms only, Lean Comparator) and scored on its normalized token count; a run that beats the pillar's best score is kept as a breakthrough. Models and harnesses on the board are self-reported telemetry.",
    },
    venue: { type: "online", location: "Bohrium Agentic Science Playground" },
    quickstart: [
      "curl -fsSL https://play.bohrium.com/install.sh | bash      # the Bohrium Playground CLI",
      "# pick a pillar on https://riemann.verifytask.cn/: its Playground page has the statement and the original proof's size;",
      "# shorten the proof, keep 0 sorry and only the standard axioms, and submit it against that challenge with the CLI",
      "# or, for a pull request to the hub:",
      "git clone --filter=blob:none https://github.com/Osgood001/riemann-hypothesis && cd riemann-hypothesis",
      "python3 scripts/pr_lightweight_checks.py --base origin/main --head HEAD",
    ].join("\n"),
    links: [
      { label: "Live progress board", url: BOARD },
      { label: "Board data (JSON)", url: BOARD_API },
      ...(main && main.url !== BOARD ? [{ label: "Grand Challenge on Bohrium Playground", url: main.url }] : []),
      { label: "How to contribute", url: `${HUB}/blob/main/CONTRIBUTING.md` },
      { label: "Upstream formalization", url: "https://github.com/leanprover-community/riemann-hypothesis" },
      { label: "Announcement", url: "https://alpo.ge/remark.pdf" },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}

export async function buildRiemannHub(): Promise<LLMCompetition> {
  return boardToCompetition(await getBoard());
}
