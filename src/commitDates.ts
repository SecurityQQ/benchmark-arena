// Dates for undated records from the commit their links pin. Many READMEs link each record's script at a fixed commit
// (https://github.com/o/r/blob/<sha>/train/run.py) but give no date; that commit's date is the closest fact there is.
// Deterministic, no LLM: one GitHub call per commit, ever (data/commit-dates.json).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RecordEntry } from "./types.js";
import { getOctokit } from "./github.js";

export const COMMIT_DATES_PATH = join(process.cwd(), "data", "commit-dates.json");
const MAX_LOOKUPS = 200; // per run; the rest are dated on the next one

// sha → "YYYY-MM-DD", or null when GitHub does not know the commit (not asked again)
export type CommitDateCache = Record<string, string | null>;
// A date, null for "no such commit"; throws on anything transient (rate limit, network), which is retried next run
export type CommitLookup = (owner: string, name: string, sha: string) => Promise<string | null>;

export interface CommitDates { cache: CommitDateCache; lookup: CommitLookup; budget: number; lookups: number; deferred: Set<string>; dirty: boolean }

// a real calendar day, as validation requires of a record date
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

const PINNED = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/(?:blob|tree|commit)\/([0-9a-f]{40})(?=[/?#]|$)/i;

/** The full commit SHA a URL pins in the given repository, or null (another repo, a branch name, a short SHA). */
export function pinnedSha(url: string, repo: { owner: string; name: string }): string | null {
  const m = url.match(PINNED);
  if (!m || m[1].toLowerCase() !== repo.owner.toLowerCase() || m[2].toLowerCase() !== repo.name.toLowerCase()) return null;
  return m[3].toLowerCase();
}

/** Committer date (UTC day) of a commit: the git object, not the commit page, so no file list comes back. */
export const githubCommitDate: CommitLookup = async (owner, name, sha) => {
  try {
    const { data } = await getOctokit().rest.git.getCommit({ owner, repo: name, commit_sha: sha });
    const day = data.committer?.date?.slice(0, 10);
    return isDay(day) ? day : null;
  } catch (e) {
    if ([404, 409, 422].includes((e as { status?: number }).status ?? 0)) return null;
    throw e;
  }
};

export function loadCommitDates(path = COMMIT_DATES_PATH, lookup: CommitLookup = githubCommitDate, budget = MAX_LOOKUPS): CommitDates {
  let cache: CommitDateCache = {};
  try {
    // only well-formed rows: a hand-edited value must not reach a record
    const saved: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      cache = Object.fromEntries(Object.entries(saved).filter(([sha, day]) => /^[0-9a-f]{40}$/.test(sha) && (day === null || isDay(day))));
    }
  } catch { /* rebuilt */ }
  return { cache, lookup, budget, lookups: 0, deferred: new Set(), dirty: false };
}

export function saveCommitDates(dates: CommitDates, path = COMMIT_DATES_PATH): void {
  if (!dates.dirty) return;
  writeFileSync(path, JSON.stringify(Object.fromEntries(Object.entries(dates.cache).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");
}

async function dateOf(sha: string, repo: { owner: string; name: string }, dates: CommitDates): Promise<string | null> {
  if (Object.hasOwn(dates.cache, sha)) return dates.cache[sha];
  if (dates.lookups >= dates.budget) { dates.deferred.add(sha); return null; }
  dates.lookups++;
  try {
    const found = await dates.lookup(repo.owner, repo.name, sha), day = isDay(found) ? found : null;
    dates.cache[sha] = day;
    dates.dirty = true;
    return day;
  } catch { return null; }
}

/** Set `date` on undated records from the first link that pins a commit of this repo. Returns how many got one. */
export async function datePinnedRecords(problems: { records: RecordEntry[] }[], repo: { owner: string; name: string }, dates: CommitDates): Promise<number> {
  let n = 0;
  for (const p of problems) for (const r of p.records ?? []) {
    if (r.date) continue;
    for (const url of [...(r.submissionUrls ?? []), ...(r.contributorUrl ? [r.contributorUrl] : [])]) {
      const sha = pinnedSha(url, repo);
      const day = sha && await dateOf(sha, repo, dates);
      if (day) { r.date = day; n++; break; }
    }
  }
  return n;
}
