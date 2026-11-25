// Live refresh for LLM-extracted boards: did anything the extractor read change since it ran?
// One repos.get per board; a compare against the commit the extraction read only when the repo got a push since.
// A push that touches only code changes none of the sources, so it never reaches the LLM.

import type { DiscoveredRepo, RepoState } from "./types.js";
import { getOctokit, isPublicRepo } from "./github.js";
import { LEADERBOARD_FILENAMES } from "./fetcher.js";
import { PROBLEM_FILES } from "./standard.js";
import { repoKey } from "./validation.js";

export interface SourceProbe {
  repo(owner: string, name: string): Promise<{ pushedAt?: string; branch: string }>;          // throws unless public
  head(owner: string, name: string, branch: string): Promise<string>;
  before(owner: string, name: string, branch: string, until: string): Promise<string | undefined>; // last commit at a time
  diff(owner: string, name: string, base: string, head: string): Promise<{ status: string; files: string[]; truncated?: boolean } | null>; // null: base unknown
}

// State written before sources were recorded: the fixed leaderboard files every extraction reads first
export const DEFAULT_SOURCES = [...LEADERBOARD_FILENAMES, ...PROBLEM_FILES];
const RETRY_MS = 24 * 3_600_000;      // after a failed or shrunk live re-extraction

export interface Changed { repo: DiscoveredRepo; pushedAt?: string; files: string[] }
export interface ChangeReport {
  changed: Changed[];
  baselines: Map<string, string>;     // repo key → head adopted for state written before heads were recorded
  checked: number; quiet: number; codeOnly: string[]; backoff: string[]; failed: string[];
}

/** The changed files the extractor read: an exact path, or anything under a "dir/" source. */
export function touched(files: string[], sources: string[]): string[] {
  return files.filter((f) => sources.some((s) => (s.endsWith("/") ? f.startsWith(s) : f === s)));
}

export async function detectChanges(repos: DiscoveredRepo[], state: Record<string, RepoState>, probe: SourceProbe, now = Date.now()): Promise<ChangeReport> {
  const report: ChangeReport = { changed: [], baselines: new Map(), checked: 0, quiet: 0, codeOnly: [], backoff: [], failed: [] };
  for (const repo of repos) {
    const key = repoKey(repo), st = state[key];
    if (st?.verdict !== "competition") continue;
    if (st.liveFailedAt && now - Date.parse(st.liveFailedAt) < RETRY_MS) { report.backoff.push(key); continue; }
    report.checked++;
    try {
      const { pushedAt, branch } = await probe.repo(repo.owner, repo.name);
      if (pushedAt && pushedAt === st.pushedAt) {
        // no push since the extraction: today's head is the commit it read, an exact base for the next push
        if (!st.head) report.baselines.set(key, await probe.head(repo.owner, repo.name, branch));
        report.quiet++;
        continue;
      }
      const base = st.head ?? await probe.before(repo.owner, repo.name, branch, st.checkedAt);
      const d = base ? await probe.diff(repo.owner, repo.name, base, branch) : null;
      if (d?.status === "identical") { report.quiet++; continue; }
      // a rewound or rewritten branch, an unknown base or a list too long to trust: re-read rather than miss a record
      const hits = d?.status === "ahead" && !d.truncated ? touched(d.files, st.sources ?? DEFAULT_SOURCES) : ["(history not comparable)"];
      if (!hits.length) { report.codeOnly.push(key); continue; }
      report.changed.push({ repo: { ...repo, defaultBranch: branch, ...(pushedAt ? { pushedAt } : {}) }, pushedAt, files: hits });
    } catch { report.failed.push(key); }
  }
  // most recently pushed first: under the cap, the newest records reach the site first
  report.changed.sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
  return report;
}

/** The commit a branch points at now. */
export async function branchHead(owner: string, repo: string, branch: string): Promise<string> {
  return (await getOctokit().rest.git.getRef({ owner, repo, ref: `heads/${branch}` })).data.object.sha;
}

/** The GitHub API behind detectChanges, counting its calls. */
export function githubProbe(counter = { calls: 0 }): SourceProbe {
  const octokit = getOctokit();
  return {
    async repo(owner, repo) {
      counter.calls++;
      const { data } = await octokit.rest.repos.get({ owner, repo });
      if (!isPublicRepo(data)) throw new Error("Repository must be public");
      return { pushedAt: data.pushed_at ?? undefined, branch: data.default_branch };
    },
    async head(owner, repo, branch) {
      counter.calls++;
      return branchHead(owner, repo, branch);
    },
    async before(owner, repo, branch, until) {
      counter.calls++;
      return (await octokit.rest.repos.listCommits({ owner, repo, sha: branch, until, per_page: 1 })).data[0]?.sha;
    },
    async diff(owner, repo, base, head) {
      counter.calls++;
      try {
        // per_page=1 keeps the commit list short; the file list always covers the whole range
        const { data } = await octokit.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${base}...${head}`, per_page: 1 });
        const files = data.files ?? [];
        // GitHub lists at most 300 changed files: a full list may hide a source
        return { status: data.status, files: files.flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]), truncated: files.length >= 300 };
      } catch (e) {
        if ([404, 422].includes((e as { status?: number }).status ?? 0)) return null;
        throw e;
      }
    },
  };
}
