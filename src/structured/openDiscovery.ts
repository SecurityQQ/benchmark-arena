// Deterministic builder for the Open Discovery Challenge (FINAL-Bench, on Hugging Face Spaces): design a molecule with any AI
// model, submit it as SMILES, and the organizers score it on their GPUs against approved drugs for a neglected disease.
// It has no GitHub repository, so it is a site source (main.ts SITES). Sources (public, no login):
//   1. https://final-bench-open-discovery-challenge.hf.space/api/seasons          — every season: disease, target, counter-target, closing date, prize, rubric weights, size caps, whether it still takes entries
//   2. https://final-bench-open-discovery-challenge.hf.space/api/leaderboard?season=N — every scored entry of one season (~10 MB, thousands of rows) plus the reference compounds
//   3. https://final-bench-open-discovery-challenge.hf.space/api/totals           — submissions and participants across all seasons
// No LLM involved. One track per season that still takes entries (when none does, the season that closed last, marked closed).
// A track lists each account's best ranked entry, plus the season's reference compounds (approved drugs and inert controls) as
// baselines. Structures are never published here: the API masks them for private entries, and this builder reads no structure
// field at all. The AI behind a row is what the entrant typed in the submission's "model" box: self-reported, so a row carries
// attribution only where that text names a known model or agent, and never when it is blank or "미기재 / unspecified".

import type { LLMCompetition } from "../llm.js";
import type { AgentAttribution, Problem, RecordEntry } from "../types.js";
import { boundedFetch } from "../github.js";
import { familyFromName } from "../postprocess.js";

export const API = "https://final-bench-open-discovery-challenge.hf.space";
export const SPACE = "https://huggingface.co/spaces/FINAL-Bench/open-discovery-challenge";
export const BLOG = "https://huggingface.co/blog/FINAL-Bench/open-discovery-challenge";
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const MAX_SEASONS_BYTES = 256 * 1024;
const MAX_BOARD_BYTES = 32 * 1024 * 1024; // season 3 is ~9 MB and grows with every entry; a bigger answer is not read
const MAX_TOTALS_BYTES = 64 * 1024;
const RECORDS_PER_SEASON = 50; // accounts, best entry each: the board's own order, not a sample
const DAILY_CAP = 5;           // entries per account per day, stated by the Space's FAQ

export interface OdcSeason {
  number: number; name?: string; topic?: string; organism?: string; target?: string; counter_target?: string;
  closes?: string; prize_usd?: number; weights?: Record<string, number>; open?: boolean; accepting?: boolean;
  limits?: { mw_max?: number; heavy_max?: number };
}
export interface OdcEntry {
  candidate_id?: string; hf_user?: string | null; display_name?: string; model_name?: string; total?: number; rank?: number | null;
  tier?: number; submitted_at?: number | null; scored_at?: number | null; visibility?: string | null;
  axes?: Record<string, number>; is_anchor?: boolean; note_en?: string; relegate_reason?: unknown[];
}
export interface OdcTotals { submissions?: number; participants?: number; days?: number }

async function getJson<T>(path: string, maxBytes: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(`${API}${path}`, { headers: { accept: "application/json", "user-agent": USER_AGENT } }, maxBytes, 60_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      const j: any = await r.json();
      if (j == null || typeof j !== "object") throw new Error("bad payload");
      return j as T;
    } catch {
      if (attempt >= 1) throw new Error("Open Discovery Challenge download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ─── Third-party text and numbers ───────────────────────────────────────
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
/** A plain string with control and bidi characters dropped, whitespace collapsed, clipped; anything else is nothing. */
export function str(v: unknown, n: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return s ? clip(s, n) : undefined;
}
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const round = (v: number) => Math.round(v * 1000) / 1000;
const one = (v: number) => Math.round(v * 10) / 10;
const day = (unix: unknown): string | undefined => {
  const t = num(unix);
  if (t === undefined || t < 1_000_000_000 || t > 4_000_000_000) return undefined;
  return new Date(t * 1000).toISOString().slice(0, 10);
};
const HF_USER = /^[A-Za-z0-9][\w-]{0,38}$/;              // a Hugging Face login, as the profile URL needs it
const CANDIDATE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,60}$/;  // "ODC-F83F19"; a reference row carries the compound's name
const AXES = ["activity", "binding", "selectivity", "admet", "novelty", "synthesis"] as const;
const AXIS_LABEL: Record<string, string> = { activity: "activity", binding: "binding", selectivity: "selectivity", admet: "ADMET", novelty: "novelty", synthesis: "synthesis" };

// ─── The AI the entrant declared ────────────────────────────────────────
// Free text typed into the submission form, so it is often not a model at all: an account handle ("1Dmeds"), a pipeline
// ("SAR factorial (no docking)"), a local fine-tune ("mary 8b"). Those carry no attribution.
const UNSPECIFIED = /^(?:-+|\?+|n\/?a|none|no|unspecified|unknown|미기재(?:\s*\/\s*unspecified)?|기재\s*없음|해당\s*없음|사람|human|manual|by hand)$/i;
const TOOLS: [RegExp, string][] = [
  [/\bclaude[\s\-_]?code\b/i, "Claude Code"],
  [/\b(?:openai[\s\-_/]*)?codex(?:[\s\-_]?cli)?\b/i, "Codex"],
  [/\bgemini[\s\-_]?cli\b/i, "Gemini CLI"],
  [/\bgithub[\s\-_]?copilot\b/i, "GitHub Copilot"],
  [/\bcursor\b/i, "Cursor"],
  [/\baider\b/i, "Aider"],
];
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const ver = (v?: string) => (v ? ` ${v.replace(/-/g, ".")}` : "");
// Each pattern reads one declared model name and writes it the way the rest of the dataset does:
// "claude opus5" / "anthropic/claude-opus-5" → "Claude Opus 5", "gpt-6-astra" → "GPT-6 Astra", "Qwen3:30B" → "Qwen3".
// A number glued to letters ("gpt41mini") is not a version this builder can read: the family still stands, the model does not.
const MODELS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/\b(?:claude[\s\-_/]*)?(opus|sonnet|haiku|fable)[\s\-_]?(\d{1,2}(?:[.\-]\d{1,2})?)?(?![\w.])/i, (m) => `Claude ${cap(m[1])}${ver(m[2])}`],
  [/\bclaude(?![\s\-_]?code)(?![\s\-_/]*(?:opus|sonnet|haiku|fable))(?![\w])/i, () => "Claude"],
  [/\bgpt[\s\-_]?(\d{1,2}(?:\.\d{1,2})?)(?![\w.])(?:[\s\-_]?(mini|pro|high|ultra|turbo|codex|sol|astra|luna|terra|nova))?/i, (m) => `GPT-${m[1]}${m[2] ? ` ${cap(m[2])}` : ""}`],
  [/\bchatgpt\b/i, () => "ChatGPT"],
  [/\bgemini(?![\s\-_]?cli)[\s\-_]?(\d{1,2}(?:\.\d{1,2})?)?(?![\w.])/i, (m) => `Gemini${ver(m[1])}`],
  [/\bglm[\s\-_]?(\d{1,2}(?:\.\d{1,2})?)(?![\w.])/i, (m) => `GLM-${m[1]}`],
  [/\bqwen[\s\-_]?(\d{1,2}(?:\.\d{1,2})?)?(?![\w.])/i, (m) => `Qwen${m[1] ?? ""}`],
  [/\bdeepseek[\s\-_]?(v\d|r\d|prover|coder)?(?![\w.])/i, (m) => `DeepSeek${m[1] ? ` ${m[1].toUpperCase().replace(/^(PROVER|CODER)$/, (w) => cap(w))}` : ""}`],
  [/\bgrok[\s\-_]?(\d{1,2}(?:\.\d{1,2})?)?(?![\w.])/i, (m) => `Grok${ver(m[1])}`],
  [/\bkimi[\s\-_]?(k\d)?(?![\w.])/i, (m) => `Kimi${m[1] ? ` ${m[1].toUpperCase()}` : ""}`],
  [/\b(?:code[\s\-_]?)?llama[\s\-_]?(\d{1,2}(?:\.\d{1,2})?)?(?![\w.])/i, (m) => `Llama${ver(m[1])}`],
  [/\b(mistral|mixtral|codestral|devstral)\b/i, (m) => cap(m[1])],
];

const BARE = /^(?:Claude|Gemini|Qwen|DeepSeek|Grok|Kimi|Llama)$/; // a family, not a model: the family is recorded, the model is not
/** The model name the declared text states, written the dataset's way, or nothing when it states none. */
export function declaredModel(s: string): string | undefined {
  const hits = MODELS.map(([rx, label]) => { const m = s.match(rx); return m ? { at: m.index ?? 0, label: label(m) } : undefined; })
    .filter((h): h is { at: number; label: string } => !!h)
    .sort((a, b) => a.at - b.at);
  return hits.find((h) => !BARE.test(h.label))?.label;
}

// the declared text is quoted back as the evidence: angle brackets, quotes and backslashes are dropped, it is data, not markup
const quote = (s: string) => s.replace(/[<>"'\\`]/g, " ").replace(/\s+/g, " ").trim();

/**
 * The agent behind an entry, from the "model" box of the submission form.
 * Attribution only where that text names a model or a coding tool, or at least the company behind one; role is always
 * "author" (the entrant is the contributor, the model designed the molecule), never "subject" — the row is not a model's score.
 */
export function agentOf(modelName: unknown, where: string): AgentAttribution | undefined {
  const s = str(modelName, 120);
  if (!s || UNSPECIFIED.test(s)) return undefined;
  const model = declaredModel(s);
  const tool = TOOLS.find(([rx]) => rx.test(s))?.[1];
  const family = familyFromName(model) ?? familyFromName(tool) ?? familyFromName(s);
  if (!family || family === "human" || family === "unknown") return undefined;
  return {
    family,
    ...(model ? { model } : {}),
    ...(tool ? { tool } : {}),
    evidence: `open-discovery-challenge ${where}: model_name "${quote(s)}" (typed by the entrant, self-reported)`,
    // the family alone (a company name, no model and no tool) is thinner evidence than a named model
    confidence: model || tool ? "high" : "medium",
    role: "author",
  };
}

// ─── Seasons ────────────────────────────────────────────────────────────
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s: unknown): s is string => typeof s === "string" && DATE.test(s) && new Date(s).toISOString().slice(0, 10) === s;
export const validSeason = (s: unknown): s is OdcSeason =>
  !!s && typeof s === "object" && Number.isInteger((s as OdcSeason).number) &&
  (s as OdcSeason).number >= 1 && (s as OdcSeason).number <= 999;

/** The seasons a track is built for: those still taking entries, or, when none is, the one that closed last. */
export function seasonsToShow(list: unknown[]): { seasons: OdcSeason[]; accepting: boolean } {
  const all = (Array.isArray(list) ? list : []).filter(validSeason);
  const open = all.filter((s) => s.accepting === true);
  if (open.length) return { seasons: open.slice(0, 12), accepting: true };
  const closed = all.filter((s) => isDay(s.closes)).sort((a, b) => (a.closes! < b.closes! ? 1 : -1));
  return { seasons: closed.slice(0, 1), accepting: false };
}

const titleOf = (s: OdcSeason) => {
  const topic = str(s.topic, 60), target = str(s.target, 60);
  return `Season ${s.number}${topic ? ` — ${topic}` : ""}${target ? ` (${target})` : ""}`;
};
const prizeOf = (s: OdcSeason) => {
  const p = num(s.prize_usd);
  return p !== undefined && p > 0 && p < 100_000_000 ? `USD ${Math.round(p).toLocaleString("en-US")}` : undefined;
};
const limitsOf = (s: OdcSeason) => {
  const mw = num(s.limits?.mw_max), heavy = num(s.limits?.heavy_max);
  const bits = [mw !== undefined && mw > 0 && mw < 10_000 ? `molecular weight ≤ ${one(mw)}` : "", Number.isInteger(heavy) && heavy! > 0 && heavy! < 1000 ? `≤ ${heavy} heavy atoms` : ""].filter(Boolean);
  return bits.length ? bits.join(", ") : undefined;
};
const weightsOf = (s: OdcSeason) => {
  const w = s.weights && typeof s.weights === "object" ? s.weights : {};
  const bits = AXES.map((a) => { const v = num(w[a]); return v !== undefined && v >= 0 && v <= 100 ? `${AXIS_LABEL[a]} ${one(v)}` : ""; }).filter(Boolean);
  return bits.length ? bits.join(", ") : undefined;
};

// ─── Records ────────────────────────────────────────────────────────────
const axisText = (e: OdcEntry, s: OdcSeason) => {
  const w = s.weights && typeof s.weights === "object" ? s.weights : {};
  const a = e.axes && typeof e.axes === "object" ? e.axes : {};
  return AXES.map((k) => {
    const v = num(a[k]), max = num(w[k]);
    return v === undefined ? "" : `${AXIS_LABEL[k]} ${one(v)}${max !== undefined && max > 0 ? `/${one(max)}` : ""}`;
  }).filter(Boolean).join(", ");
};

/** An approved drug or inert control the organizers score alongside the entries: the scale the board is read against. */
function anchorRecord(e: OdcEntry, s: OdcSeason): RecordEntry | undefined {
  const name = str(e.candidate_id, 60), total = num(e.total);
  if (!name || !CANDIDATE.test(name) || total === undefined) return undefined;
  const note = str(e.note_en, 200);
  const axes = axisText(e, s);
  return {
    value: round(total),
    contributor: name,
    contributorKind: "method",
    isBaseline: true, // a reference compound scored by the organizers, not an entry
    description: ["Reference compound scored by the organizers", note, axes].filter(Boolean).join(" · "),
  };
}

/** The board gave this entry a place: not relegated for a reactive structure, not a duplicate of an earlier one. */
const isRanked = (e: OdcEntry) => Number.isInteger(e.rank) && (e.rank as number) > 0;

/** One account's best ranked entry in a season. */
function entryRecord(e: OdcEntry, s: OdcSeason, entries: number, ranked: number): RecordEntry | undefined {
  const user = str(e.hf_user, 60), total = num(e.total);
  if (!user || !HF_USER.test(user) || total === undefined) return undefined;
  const candidate = str(e.candidate_id, 60);
  const rank = isRanked(e) ? (e.rank as number) : undefined;
  const bits = [
    rank ? `rank ${rank} of ${ranked.toLocaleString("en-US")} ranked entries` : "",
    entries > 1 ? `best of this account's ${entries.toLocaleString("en-US")} scored entries` : "one scored entry",
    candidate && CANDIDATE.test(candidate) ? `candidate ${candidate}` : "",
    axisText(e, s),
    e.visibility === "public" ? "structure published on the leaderboard" : "structure kept private (the entrant's choice)",
  ].filter(Boolean);
  const agent = agentOf(e.model_name, `season ${s.number} leaderboard`);
  return {
    value: round(total),
    date: day(e.submitted_at),
    contributor: user,
    contributorKind: "person",
    contributorUrl: `https://huggingface.co/${user}`,
    description: bits.join(" · "),
    // no submission URL: an entry has no page of its own, and its structure is the entrant's to publish or keep
    isBaseline: false,
    isCurrentBest: rank === 1,
    ...(agent ? { agent } : {}),
  };
}

/** One season → one track: each account's best ranked entry (top RECORDS_PER_SEASON accounts) over the reference compounds. */
export function seasonToProblem(s: OdcSeason, entries: OdcEntry[], accepting: boolean): Problem {
  const rows = Array.isArray(entries) ? entries : [];
  const anchors = rows.filter((e) => e?.is_anchor === true).map((e) => anchorRecord(e, s)).filter((r): r is RecordEntry => !!r)
    .sort((a, b) => b.value - a.value).slice(0, 20);
  // the board ranks relegated and duplicate entries below every clean one and gives them no rank; those are not records here,
  // but they still count towards how many entries the account has had scored
  const best = new Map<string, { entry?: OdcEntry; count: number }>();
  for (const e of rows) {
    if (!e || e.is_anchor === true) continue;
    const user = str(e.hf_user, 60), total = num(e.total);
    if (!user || !HF_USER.test(user) || total === undefined) continue;
    const cur = best.get(user) ?? { count: 0 };
    cur.count++;
    const previous = cur.entry === undefined ? undefined : num(cur.entry.total);
    if (isRanked(e) && (previous === undefined || total > previous)) cur.entry = e;
    best.set(user, cur);
  }
  const rankedCount = rows.filter((e) => !!e && e.is_anchor !== true && isRanked(e)).length;
  const records = [...best.values()]
    .filter((b): b is { entry: OdcEntry; count: number } => !!b.entry)
    .sort((a, b) => num(b.entry.total)! - num(a.entry.total)!)
    .slice(0, RECORDS_PER_SEASON)
    .map((b) => entryRecord(b.entry, s, b.count, rankedCount))
    .filter((r): r is RecordEntry => !!r);

  const closes = isDay(s.closes) ? s.closes : undefined;
  const prize = prizeOf(s), limits = limitsOf(s), weights = weightsOf(s);
  const counter = str(s.counter_target, 60), organism = str(s.organism, 60), target = str(s.target, 60);
  return {
    id: `season-${s.number}`,
    name: titleOf(s),
    description: [
      target ? `Inhibit ${target}${organism ? ` (${organism})` : ""}${counter ? `, not ${counter}` : ""}.` : "",
      "Each entry is one molecule, scored 0–100 by the organizers' models on whole-cell activity, target binding, selectivity over the counter-target, ADMET, novelty and synthetic accessibility.",
      weights ? `Points: ${weights}.` : "",
      limits ? `Admission limits: ${limits}.` : "",
      accepting ? `${closes ? `Closes ${closes} (end of day UTC)` : "Open"}${prize ? `; ${prize} to the top-ranked entry` : ""}.` : `Closed${closes ? ` on ${closes}` : ""}: this season no longer takes entries${prize ? ` (${prize} went to its top-ranked entry)` : ""}.`,
      `Records: each account's best ranked entry (top ${RECORDS_PER_SEASON} accounts), over the reference compounds — approved drugs and inert controls the organizers score on the same rubric. Relegated and duplicate entries are not ranked by the board and are left out. Structures are not republished here.`,
    ].filter(Boolean).join(" "),
    metricName: "score",
    metricUnit: "pts",
    metricDirection: "maximize",
    ...(anchors.length ? { baseline: anchors[0].value } : {}),
    isOpen: true, // postprocess decides: with a reference compound as the baseline, a season with entries above it is not open
    records: [...records, ...anchors],
  };
}

export async function buildOpenDiscovery(): Promise<LLMCompetition> {
  const { seasons } = await getJson<{ seasons: unknown[] }>("/api/seasons", MAX_SEASONS_BYTES);
  if (!Array.isArray(seasons) || !seasons.length) throw new Error("Open Discovery Challenge download failed");
  const { seasons: show, accepting } = seasonsToShow(seasons);
  if (!show.length) throw new Error("Open Discovery Challenge download failed");

  const problems: Problem[] = [];
  for (const s of show) {
    const board = await getJson<{ entries?: OdcEntry[] }>(`/api/leaderboard?season=${s.number}`, MAX_BOARD_BYTES);
    problems.push(seasonToProblem(s, board.entries ?? [], accepting));
  }
  // the headline counts; a board that answers is enough to publish, so a failure here only costs the two numbers
  const totals = await getJson<OdcTotals>("/api/totals", MAX_TOTALS_BYTES).catch(() => ({} as OdcTotals));
  const submissions = Number.isInteger(totals.submissions) && totals.submissions! >= 0 ? totals.submissions! : undefined;
  const participants = Number.isInteger(totals.participants) && totals.participants! >= 0 ? totals.participants! : undefined;

  const entered = new Set(problems.flatMap((p) => p.records.filter((r) => !r.isBaseline).map((r) => r.contributor)));
  const rows = problems.reduce((n, p) => n + p.records.filter((r) => !r.isBaseline).length, 0);
  const withAgent = problems.reduce((n, p) => n + p.records.filter((r) => r.agent).length, 0);
  console.log(`    open-discovery-challenge: ${problems.length} season${problems.length === 1 ? "" : "s"} (${accepting ? "taking entries" : "closed"}), ${rows} account bests, ${entered.size} accounts, ${withAgent} with a declared model`);

  const deadlines = show.map((s) => `Season ${s.number}${isDay(s.closes) ? ` closes ${s.closes}` : ""}`).join("; ");
  const prizes = show.map((s) => `Season ${s.number}: ${prizeOf(s) ?? "announced on the Space"}`).join("; ");
  const caps = show.map((s) => `Season ${s.number}${limitsOf(s) ? ` ${limitsOf(s)}` : ""}`).join("; ");
  const topics = show.map((s) => `Season ${s.number} (${str(s.topic, 60) ?? "new target"}${str(s.target, 60) ? `, ${str(s.target, 60)}` : ""})`).join(", ");

  return {
    id: "open-discovery-challenge",
    name: "Open Discovery Challenge",
    tagline: "Design a drug candidate for a neglected disease with any AI model, submit it as SMILES, and the organizers' GPUs score it 0–100 against approved drugs; the top entry of each season takes the prize.",
    description: [
      "The Open Discovery Challenge (FINAL-Bench, on Hugging Face Spaces) asks one question about a molecule an AI just designed: is it any good?",
      "An entry is a single structure (SMILES or InChI) for the season's target. The organizers dock it against the target and the human counter-target, predict whole-cell activity and ADMET, and score it 0–100 on activity, binding, selectivity, ADMET, novelty and synthetic accessibility — minutes per entry, on their GPUs, so an entrant needs nothing but a browser.",
      "Approved drugs and inert controls are scored on the same rubric and sit on the board as the scale to read it against.",
      `Seasons run concurrently, each for a different disease: ${topics}.`,
      submissions !== undefined && participants !== undefined ? `${submissions.toLocaleString("en-US")} submissions from ${participants.toLocaleString("en-US")} accounts so far.` : "",
      `Tracks here list each account's best ranked entry (top ${RECORDS_PER_SEASON} accounts per season) from the public leaderboard API, over the reference compounds as baselines.`,
      "Structures are never republished here, and the model behind a row is only what the entrant typed in the submission form (self-reported).",
    ].filter(Boolean).join(" "),
    url: SPACE,
    host: "huggingface",
    status: accepting ? "active" : "ended",
    tags: ["drug-discovery", "chemistry", "cheminformatics", "admet", "molecular-docking", "neglected-tropical-diseases", "ai-for-science", "smiles", "leaderboard"],
    domain: "ml-research",
    images: [],
    organizer: { name: "FINAL-Bench (VIDRAFT)", url: "https://huggingface.co/FINAL-Bench", type: "company" },
    participation: {
      howToSubmit: `Open the Space, sign in with your Hugging Face account, and submit one structure per entry: the SMILES (or InChI), a display ID of your choice, and the model you used. Scoring is queued on the organizers' GPUs and the score appears on the leaderboard within minutes. Programmatically: POST ${API}/api/submit with {"season": N, "structure": "<SMILES>", "display_name": "...", "model_name": "...", "visibility": "private"} from a signed-in session.`,
      submissionFormat: `One molecule as SMILES or InChI — not a molecular formula, not a mixture or salt. ${caps ? `Size caps: ${caps}. ` : ""}You choose whether the structure is published or stays private (private is the default; publishing a structure can cost you patentability).`,
      requirements: ["A Hugging Face account (OAuth sign-in)", "A molecule as SMILES or InChI", "Any AI model, or none — the model is self-reported, not restricted"],
      compute: "cpu",
      computeDetails: "Nothing to run locally: designing a candidate is a model's answer you can get in a chat window, and all scoring (docking against the target and counter-target, whole-cell activity, ADMET) runs on the organizers' GPUs.",
      deadline: accepting ? `${deadlines} (end of day UTC)` : "closed",
      rounds: "Seasons run concurrently, each with its own disease, target, rubric weights and prize; a new season opens as earlier ones close.",
      prizes: `${prizes}, to the top-ranked entry at the close of the season; ties go to whoever submitted first.`,
      eligibility: `Anyone with a Hugging Face account. ${DAILY_CAP} entries per account per day across all seasons (resets at midnight KST), to keep the GPU queue fair.`,
      cost: "free",
      verification: "Every entry is scored automatically by the organizers' models, with no human judging: structures are gated on arrival (parse, reactive or covalent warheads, PAINS motifs, size caps, duplicates), and predicted mutagenicity or extreme insolubility relegates an entry below every clean one. Scores are computational predictions, not measurements of efficacy or safety. The declared model is self-reported.",
    },
    venue: { type: "online", location: "Hugging Face Spaces" },
    quickstart: `# paste into your coding agent or chat model:\nRead ${SPACE} (and its Entrant guide tab), then design 5 candidate molecules for the open season:\nhit the season's target, miss the human counter-target, stay inside the size caps, and keep them novel and makeable.\nGive me each as SMILES with a one-line rationale.\n# then sign in to the Space with your Hugging Face account and submit them yourself (${DAILY_CAP} per account per day)`,
    links: [
      { label: "Challenge (Hugging Face Space)", url: SPACE },
      { label: "How it works (blog post)", url: BLOG },
      { label: "Seasons, targets and deadlines (API)", url: `${API}/api/seasons` },
      { label: "Leaderboard (API)", url: `${API}/api/leaderboard?season=${show[0].number}` },
      { label: "Per-model standings (API)", url: `${API}/api/models` },
      { label: "Organizer on Hugging Face", url: "https://huggingface.co/FINAL-Bench" },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
