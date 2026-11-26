// The frontier: how much each listed challenge matters, and why. A judgment, written down with its reasons in
// data/frontier.json and validated like crawl output: every board gets three scores (RUBRIC: stakes 0–4, open 0–3,
// verified 0–3) and one line on why it matters. A board is on the frontier when its stakes are at least 3, its total at
// least 8, and it still takes entries; the catalog lists the frontier first and everything else below it.
// The build attaches the rating to each board (Competition.importance); site/app.js orders by it (byImportance has a twin
// there), so the rule lives here only. Unrated boards (newly crawled) sort last until someone rates them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Competition, Importance } from "./types.js";

export const RUBRIC = {
  stakes: { max: 4, name: "Stakes", ask: "What changes for people if this is solved?", levels: [
    "Nothing beyond the board.",
    "A better number on a familiar benchmark.",
    "A real advance for one discipline.",
    "A field's central open problem, or a capability frontier.",
    "Humanity-scale: a Millennium Prize problem, a cure, AI we can trust.",
  ] },
  open: { max: 3, name: "Open", ask: "Can an entry be something nobody knew?", levels: [
    "Closed to new entries.",
    "A fixed benchmark with a known or nearby ceiling.",
    "A live record race: today's best can still fall.",
    "Nobody knows the answer: an entry can be new knowledge.",
  ] },
  verified: { max: 3, name: "Verified", ask: "Who decides that an entry counts?", levels: [
    "Nobody checks.",
    "The entrant's own numbers.",
    "The organizers re-run it, or experts review it.",
    "A machine or reality: a proof kernel, hidden tests on the organizer's hardware, lab results, resolved events.",
  ] },
} as const;
export const FRONTIER_MIN = { stakes: 3, score: 8 };

export interface Rating { stakes: number; open: number; verified: number; why: string; checked: string }
export type Ratings = Record<string, Rating>;

const int = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : undefined);
const BOARD_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/;

export function validRatings(raw: unknown): Ratings {
  const src = (raw as { ratings?: unknown })?.ratings;
  const out: Ratings = {};
  for (const [id, v] of Object.entries(src && typeof src === "object" ? src : {}) as [string, Record<string, unknown>][]) {
    const stakes = int(v?.stakes, RUBRIC.stakes.max), open = int(v?.open, RUBRIC.open.max), verified = int(v?.verified, RUBRIC.verified.max);
    const why = typeof v?.why === "string" && v.why.trim() && v.why.trim().length <= 200 ? v.why.trim() : undefined;
    const checked = typeof v?.checked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.checked) ? v.checked : undefined;
    if (!BOARD_ID.test(id) || stakes === undefined || open === undefined || verified === undefined || !why || !checked) continue;
    out[id] = { stakes, open, verified, why, checked };
  }
  return out;
}

export function loadRatings(root: string): Ratings {
  const path = join(root, "data", "frontier.json");
  return existsSync(path) ? validRatings(JSON.parse(readFileSync(path, "utf-8"))) : {};
}

export const scoreOf = (r: Pick<Rating, "stakes" | "open" | "verified">) => r.stakes + r.open + r.verified;
// The frontier rule, in one place: high stakes, a high total, a board that still takes entries
export const isFrontier = (r: Pick<Rating, "stakes" | "open" | "verified">, status: Competition["status"]) =>
  status !== "ended" && r.stakes >= FRONTIER_MIN.stakes && scoreOf(r) >= FRONTIER_MIN.score;

/** Each rated board with its rating (after corrections, so an ended board drops off the frontier); unrated ones unchanged. */
export function withImportance(comps: Competition[], ratings: Ratings): Competition[] {
  return comps.map((c) => {
    const r = ratings[c.id];
    if (!r) return c;
    const importance: Importance = { tier: isFrontier(r, c.status) ? "frontier" : "other", score: scoreOf(r), stakes: r.stakes, open: r.open, verified: r.verified, why: r.why };
    return { ...c, importance };
  });
}

/** Frontier first, then by score (unrated last), boards that still take entries first, then who entered lately.
 *  site/app.js has the twin (byImportance). */
export function byImportance(a: Competition, b: Competition): number {
  const tier = (c: Competition) => (c.importance?.tier === "frontier" ? 0 : 1);
  return tier(a) - tier(b) || (b.importance?.score ?? -1) - (a.importance?.score ?? -1)
    || Number(a.status === "ended") - Number(b.status === "ended")
    || b.stats.recordsLast30d - a.stats.recordsLast30d || b.stats.totalRecords - a.stats.totalRecords || a.name.localeCompare(b.name);
}

export const frontierBoards = (comps: Competition[]) => comps.filter((c) => c.importance?.tier === "frontier").sort(byImportance);
