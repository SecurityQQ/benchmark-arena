// Deterministic builder for the Looped Lens Challenge (ndif-team/looped-lens-challenge): NDIF's competition for lenses that read
// what the looped model Inkling 2 Mini computes but never writes. The repository holds the starter lens, submit.py and the
// leaderboard's own code (space/board.py); the leaderboard runs on a Hugging Face Space. Source (public, no login; the JSON the
// leaderboard page reads, ~290 KB):
//   https://ndif-looped-lens-challenge.hf.space/api/leaderboard[?phase=N]
//     {phase, phases, rows[]}: one phase's board, the current one unless an earlier one is asked for. Rows are every scored
//     submission its team has not withdrawn, best first: team (the name an NDIF account chose; one account is one team),
//     submitted_at, pass_rate (the mean of the hidden datasets' shares of questions passed) and each dataset's, `best` on each
//     team's top row, `rank` on the best rows of competing teams, `baseline` on the organizers' reference lens (shown, not ranked),
//     `flagged` on a submission under review ("Potentially invalid: flagged for review"), and a message with the questions passed
//     and the layer visits read
// No LLM involved. One track per phase, ranked by pass rate. Records: each team's best submission not under review, dated by when it
// was made: the board's own standings ("the leaderboard shows each team's best submission"). The other submissions are attempts the
// pulse counts (src/pulse.ts); at ~300 a day they would swamp the dataset. A flagged submission keeps its place on the board while
// the organizers check it; here it is left out, and its team stands on its best submission that is not under review. The reference
// lens is the track's baseline row. The board records no model or agent, so no row carries attribution.

import type { LLMCompetition } from "../llm.js";
import type { Problem, RecordEntry } from "../types.js";
import { boundedFetch } from "../github.js";

export const SPACE = "https://ndif-looped-lens-challenge.hf.space";
export const LEADERBOARD = `${SPACE}/`;
export const REPO = "https://github.com/ndif-team/looped-lens-challenge";
export const PAGE = "https://ndif.us/looped-lens-challenge/";
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const MAX_BYTES = 16 * 1024 * 1024; // ~290 KB today; every submission stays on its phase's board
const MAX_PHASES = 12, MAX_ROWS = 100_000;
const TEAMS_PER_PHASE = 300;        // each team's best, highest first: the board's own order
const SKEW_MS = 10 * 60_000;
const DAY = 86_400_000;

export interface LensRow {
  id?: string; team?: string; submitted_at?: string; seconds?: number; baseline?: boolean; best?: boolean; flagged?: boolean; rank?: number | null;
  metrics?: { pass_rate?: number }; breakdown?: { name?: string; metrics?: { pass_rate?: number } }[]; message?: string;
}
export interface LensBoard { phase?: number; phases?: number; rows?: LensRow[] }

async function getBoard(phase?: number): Promise<unknown> {
  const url = `${SPACE}/api/leaderboard${phase === undefined ? "" : `?phase=${phase}`}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } }, MAX_BYTES, 60_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      return await r.json();
    } catch {
      if (attempt >= 1) throw new Error("Looped Lens leaderboard download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ─── Third-party text and numbers ───────────────────────────────────────
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : undefined);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
/** A plain string with control and bidi characters dropped, a "<" that could open a tag dropped, whitespace collapsed, clipped; anything else is nothing. */
export function str(v: unknown, n: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(CONTROL, " ").replace(/<(?=[A-Za-z/!?])/g, "").replace(/\s+/g, " ").trim();
  return s ? clip(s, n) : undefined;
}
const rate = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined);
const count = (v: unknown, max = 1e9): number | undefined => (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max ? v as number : undefined);
const percent = (r: number) => Math.round(r * 10000) / 100; // 0.9559 → 95.59, as the board's four decimals allow
const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
/** The UTC day of a time the board writes with its offset ("2026-11-26T06:35:37+00:00"); a future time is no date. */
export function utcDay(v: unknown, now = Date.now()): string | undefined {
  if (typeof v !== "string" || !ISO.test(v)) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) && t <= now + SKEW_MS ? new Date(t).toISOString().slice(0, 10) : undefined;
}
// A team name is what its account typed, and one is an email address: shown up to the @, never republished whole
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
export const teamName = (v: unknown) => str(v, 60)?.replace(EMAIL, (m) => `${m.slice(0, m.indexOf("@"))}@…`);
const DATASET = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,23}$/; // "Dataset A": the codename the board shows, never the dataset's name
// The evaluator's own sentence, read for its numbers only; any other message is not published
const MESSAGE = /^Passed (\d{1,6}) of (\d{1,6}) questions\.(?:\s+Layers read: (\d{1,2}(?:, \d{1,2}){0,47})\.)?$/;

export interface Row {
  team: string; rate: number; ts?: string; best: boolean; rank?: number; baseline: boolean; flagged: boolean;
  sets: { name: string; rate: number }[]; passed?: number; questions?: number; layers?: number[];
}
/** A row as the board lists it; one with no team or no pass rate in [0, 1] is dropped, and its other fields are read only where they check out. */
export function rowOf(v: unknown): Row | undefined {
  const r = obj(v) as LensRow | undefined;
  const team = teamName(r?.team), pr = rate(obj(r?.metrics)?.pass_rate);
  if (!r || !team || pr === undefined) return undefined;
  const m = typeof r.message === "string" ? r.message.trim().match(MESSAGE) : null;
  const passed = m ? Number(m[1]) : undefined, questions = m ? Number(m[2]) : undefined;
  const sound = passed !== undefined && questions !== undefined && questions > 0 && passed <= questions;
  return {
    team, rate: pr, best: r.best === true, baseline: r.baseline === true, flagged: r.flagged === true,
    ...(typeof r.submitted_at === "string" && ISO.test(r.submitted_at) ? { ts: r.submitted_at } : {}),
    ...(r.best === true && count(r.rank, 1e6) ? { rank: count(r.rank, 1e6) } : {}),
    sets: list<unknown>(r.breakdown).slice(0, 8).flatMap((d) => {
      const o = obj(d), name = typeof o?.name === "string" && DATASET.test(o.name) ? o.name : undefined, x = rate(obj(o?.metrics)?.pass_rate);
      return name && x !== undefined ? [{ name, rate: x }] : [];
    }),
    ...(sound ? { passed, questions } : {}),
    ...(sound && m![3] ? { layers: m![3].split(", ").map(Number).filter((n) => n <= 47) } : {}),
  };
}

const detail = (r: Row) => [
  r.sets.length ? r.sets.map((d) => `${d.name} ${percent(d.rate)}%`).join(", ") : "",
  r.passed !== undefined ? `passed ${fmt(r.passed)} of ${fmt(r.questions!)} questions` : "",
  r.layers?.length ? `reads layer visits ${r.layers.join(", ")}` : "",
];
const earlier = (a: Row, b: Row) => (a.ts && b.ts ? Date.parse(a.ts) - Date.parse(b.ts) : Number(!a.ts) - Number(!b.ts));
// the board's order: pass rate, then who got there first
const byBoard = (a: Row, b: Row) => b.rate - a.rate || earlier(a, b);

// ─── Tracks ─────────────────────────────────────────────────────────────
/** One phase's board → one track: each team's best submission not under review, over the reference lens. */
export function phaseToTrack(phase: number, current: number, raw: unknown, now = Date.now()): Problem {
  const rows = list<unknown>(obj(raw)?.rows).slice(0, MAX_ROWS).map(rowOf).filter((r): r is Row => !!r);
  const kept = rows.filter((r) => !r.flagged);
  const flagged = rows.length - kept.length;

  const teams = new Map<string, { row: Row; n: number }>();
  for (const r of kept.filter((x) => !x.baseline)) {
    const cur = teams.get(r.team);
    if (!cur) { teams.set(r.team, { row: r, n: 1 }); continue; }
    cur.n++;
    if (byBoard(r, cur.row) < 0) cur.row = r;
  }
  const review = new Map<string, number>();
  for (const r of rows) if (r.flagged && !r.baseline) review.set(r.team, (review.get(r.team) ?? 0) + 1);
  const best = [...teams.values()].sort((a, b) => byBoard(a.row, b.row)).slice(0, TEAMS_PER_PHASE);
  const records: RecordEntry[] = best.map(({ row, n }, i) => ({
    value: percent(row.rate),
    ...(utcDay(row.ts, now) ? { date: utcDay(row.ts, now) } : {}),
    contributor: row.team,
    contributorKind: "team",
    // a team name an NDIF account chose, not a GitHub login: the leaderboard, never a guessed profile
    contributorUrl: LEADERBOARD,
    description: [
      row.rank ? `rank ${row.rank} on the board` : "",
      ...detail(row),
      `${n > 1 ? `best of the team's ${n} scored submissions` : "the team's only scored submission"}${review.get(row.team) ? ` not under review (${review.get(row.team)} under review left out)` : ""}`,
    ].filter(Boolean).join(" · "),
    isBaseline: false,
    isCurrentBest: i === 0,
  }));

  // the organizers' reference lenses: each one's best row, shown on the board but never ranked
  const refs = new Map<string, Row>();
  for (const r of kept.filter((x) => x.baseline)) { const cur = refs.get(r.team); if (!cur || byBoard(r, cur) < 0) refs.set(r.team, r); }
  const baselines = [...refs.values()].sort(byBoard);
  for (const r of baselines) records.push({
    value: percent(r.rate),
    contributor: r.team, // "Starter logit lens"
    contributorKind: "method",
    description: ["the organizers' reference lens, shown on the board but not ranked", ...detail(r)].filter(Boolean).join(" · "),
    isBaseline: true,
  });

  const questions = [...new Set(rows.map((r) => r.questions).filter((q): q is number => q !== undefined))];
  const sets = [...new Set(rows.flatMap((r) => r.sets.map((d) => d.name)))];
  const open = phase === current;
  return {
    id: `phase-${phase}`,
    name: `Phase ${phase}${open ? "" : " (closed)"}`,
    description: [
      open ? `The current phase.` : `An earlier phase: submissions made since are ranked on a newer board.`,
      `A lens answers ${questions.length === 1 ? fmt(questions[0]) : "the"} hidden questions${sets.length ? ` in ${sets.length} datasets (${sets.join(", ")})` : ""}; a question passes when the judge model finds the intermediate named on more of the lens's layer readouts than any of the four distractors, and a tie fails.`,
      "Pass rate is the mean of the datasets' shares of questions passed, higher is better.",
      `${plural(teams.size, "team")}, ${plural(kept.filter((x) => !x.baseline).length, "scored submission")}${flagged ? `; ${plural(flagged, "submission")} under review left out` : ""}.`,
    ].join(" "),
    metricName: "pass rate",
    metricUnit: "%",
    metricDirection: "maximize",
    ...(baselines.length ? { baseline: percent(baselines[0].rate) } : {}),
    isOpen: true, // postprocess decides: open until a team is on the board
    records,
  };
}

/** The phase this board is (the current one, when no phase was asked for) and how many there are; anything that is not a sound count is one phase. */
export function phasesOf(raw: unknown): { current: number; phases: number } {
  const b = obj(raw) as LensBoard | undefined;
  const phases = count(b?.phases, 1000) || 1;
  const current = count(b?.phase, phases) || phases;
  return { current, phases };
}

/** The boards → the competition, without the network: one track per phase, the current one first. */
export function boardsToCompetition(boards: Map<number, unknown>, current: number, now = Date.now()): LLMCompetition {
  if (!boards.size || [...boards.values()].some((b) => !Array.isArray(obj(b)?.rows))) throw new Error("Looped Lens leaderboard download failed");
  const order = [...boards.keys()].sort((a, b) => Number(b === current) - Number(a === current) || b - a);
  const problems = order.map((k) => phaseToTrack(k, current, boards.get(k), now));
  const live = problems.find((t) => t.id === `phase-${current}`)!;
  const entries = live.records.filter((r) => !r.isBaseline);
  const rows = list<unknown>(obj(boards.get(current))?.rows).map(rowOf).filter((r): r is Row => !!r && !r.baseline);
  const clear = rows.filter((r) => !r.flagged), review = rows.length - clear.length;
  const newest = rows.reduce((m, r) => Math.max(m, r.ts && Date.parse(r.ts) <= now + SKEW_MS ? Date.parse(r.ts) : 0), 0);
  const ref = live.records.find((r) => r.isBaseline);
  console.log(`    looped-lens: ${problems.length} phase${problems.length === 1 ? "" : "s"} (phase ${current} current), ${rows.length} scored submissions in it (${review} under review), ${entries.length} team bests; reference lens ${ref ? `${ref.value}%` : "not on the board"}`);

  return {
    id: "looped-lens-challenge",
    name: "The Looped Lens Challenge",
    tagline: "Build an nnsight lens that reads what the looped model Inkling 2 Mini computes but never writes; NDIF runs it and a judge model scores it on hidden questions, ranked by pass rate.",
    description: [
      "NDIF's challenge for lenses on Inkling 2 Mini, a looped model: of its 24 layers, 6 to 17 run three times, so a token passes through 48 layer visits.",
      "A lens reads the model's internal state at up to 10 visits per question and returns up to 10 tokens per readout; a judge model checks which of five options (the intermediate the model works out but never writes, and four distractors) each layer names, and a question passes when the intermediate gets more layer votes than any other option.",
      "Lenses run on NDIF, which hosts the model, so entrants need no GPU; phases add harder questions, and the final ranking mixes early and later ones.",
      `Phase ${current}: ${plural(new Set(clear.map((r) => r.team)).size, "team")} and ${plural(clear.length, "scored submission")} so far${review ? ` (${fmt(review)} more under review)` : ""}${ref ? `; the organizers' reference lens (${ref.contributor}) passes ${ref.value}%` : ""}.`,
      "Tracks here are the leaderboard's phases; each lists every team's best submission not under review, over the organizers' reference lens. The leaderboard records no model or agent, so entries carry no attribution.",
    ].join(" "),
    // the repository: where the challenge is listed, and how src/pulse.ts finds this board for its live card
    url: REPO,
    host: "huggingface",
    status: newest && now - newest < 30 * DAY ? "active" : "unknown",
    tags: ["interpretability", "mechanistic-interpretability", "nnsight", "ndif", "logit-lens", "leaderboard"],
    domain: "ml-research",
    images: [],
    organizer: { name: "NDIF", url: "https://ndif.us/", type: "academic" },
    participation: {
      howToSubmit: "Get an NDIF API key (login.ndif.us) and register with the challenge's form using the same email (later registrations go on a waitlist; only admitted accounts can submit). Clone the repository, run uv sync, score submission/ on the practice questions with python submit.py --local, then submit with python submit.py --team \"My Team\" --wait (the team name the first time only); python submit.py --status lists your submissions. A team is one NDIF account and can submit once every 2 hours, with one submission queued or running at a time.",
      submissionFormat: "The submission/ directory (main.py, lenses.py, questions.py), at most 200 MB. The leaderboard runs main.py once per dataset; it writes $OUTPUT_DIR/readouts.jsonl with, per question, up to 10 readouts (one per layer visit, no layer twice) of up to 10 tokens each. Trained weights come from the Hugging Face Hub as safetensors, fetched at the top of the NDIF session.",
      requirements: ["Python", "uv", "nnsight (the version NDIF runs)", "NDIF API key from an admitted account", "Hugging Face account for trained weights (optional)"],
      compute: "none",
      computeDetails: "The lens runs on NDIF, which hosts Inkling 2 Mini, so no GPU is needed; a submission's run is limited to 45 minutes across all datasets.",
      deadline: `Phase ${current} is open; its closing date is to be announced on the challenge page`,
      rounds: "Phases: each phase is ranked on a new board; later phases add harder questions, and the final ranking mixes early and later questions.",
      prizes: "Prizes are mentioned in the challenge page's eligibility terms; amounts are not stated.",
      eligibility: "18 or older; each person on one team; organizers and anyone who knows how the questions were built may not take part; US government-restricted or sanctioned parties are ineligible; only registered, admitted NDIF accounts can submit.",
      cost: "free",
      verification: "Every submission runs on NDIF and is scored by a judge model on hidden questions; winning submissions are audited, and one under review is flagged on the board while it keeps its place (left out here until cleared). The organizers may change the scored questions, the judge's prompts and the scoring code while the competition runs.",
    },
    venue: { type: "online", location: "NDIF and Hugging Face Spaces" },
    quickstart: [
      "git clone https://github.com/ndif-team/looped-lens-challenge && cd looped-lens-challenge",
      "uv sync && source .venv/bin/activate",
      "export NDIF_API_KEY=...                   # from login.ndif.us; register with the challenge's form first",
      "python submit.py --local                  # score submission/ on the practice questions",
      "python submit.py --team \"My Team\" --wait  # submit; the team name is needed the first time only",
    ].join("\n"),
    links: [
      { label: "Challenge page", url: PAGE },
      { label: "Leaderboard", url: LEADERBOARD },
      { label: "Leaderboard data (JSON)", url: `${SPACE}/api/leaderboard` },
      { label: "Inkling 2 Mini", url: "https://huggingface.co/thinkingmachines/Inkling-2-Mini" },
      { label: "Practice dataset", url: "https://huggingface.co/datasets/NDIF/looped-lens-challenge-test" },
      { label: "NDIF agent skills", url: "https://github.com/ndif-team/skills" },
      { label: "Registration form", url: "https://forms.gle/enBNFNUBDj5SWvfC9" },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}

export async function buildLoopedLens(): Promise<LLMCompetition> {
  const first = await getBoard();
  const { current, phases } = phasesOf(first);
  const boards = new Map<number, unknown>([[current, first]]);
  // an earlier phase stays on its own board: each one is a track (the newest MAX_PHASES of them)
  for (let k = phases; k >= Math.max(1, phases - MAX_PHASES + 1); k--) if (k !== current) boards.set(k, await getBoard(k));
  return boardsToCompetition(boards, current);
}
