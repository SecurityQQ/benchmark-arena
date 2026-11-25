// Getting listed without waiting for search. GitHub code search does not index new or unstarred repositories (it returns
// nothing for "problem.md/v1", not even this repository), so an organizer who adopted PROBLEM.md was never found. Two doors
// that work within hours: the GitHub topic open-challenge-list (repository search sees it within minutes) and a listing issue
// on this repository naming the repository. Every live refresh verifies the candidates and lists them (main.ts priority with
// NEW_ONLY=1), then scripts/answer-listing-issues.ts answers each issue with the link, or once with why it was not listed.
//
// Issue text is untrusted. It goes through reposInIssue() and nothing else: only an owner/name pair in GitHub's own charset
// ever leaves this module, never a title, a body or a comment.

import type { Octokit } from "@octokit/rest";
import { getOctokit } from "./github.js";
import { LISTING_TOPIC, SITE } from "./render.js";

export { LISTING_TOPIC };
export const LISTING_LABEL = "listing";
export const SITE_REPO = { owner: "SecurityQQ", name: "benchmark-arena" };
export const MAX_LISTING_ISSUES = 30, MAX_REPOS_PER_ISSUE = 5;

export interface RepoRef { owner: string; name: string }
export interface ListingRequest { issue: number; repos: RepoRef[] }

// github.com/<owner>/<name> and nothing that only looks like it: the host is github.com itself (not github.com.evil.com,
// gist.github.com or a URL nested inside another URL), the owner a valid login, the name GitHub's repository charset
const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}", NAME = "[A-Za-z0-9._-]{1,100}";
const REPO_URL = new RegExp(`(?<![\\w.@/:%=?&#+~-])(?:https?://)?(?:www\\.)?github\\.com/(${OWNER})/(${NAME})(?![A-Za-z0-9._-])`, "gi");
// the title the /standard link pre-fills: "List owner/repo"
const TITLE_REPO = new RegExp(`^\\s*list(?:ing)?\\s*:?\\s+(${OWNER})/(${NAME})\\s*$`, "i");
// first path segments that are GitHub pages, not accounts: "github.com/topics/open-challenge-list" names no repository
const RESERVED = new Set(["about", "account", "apps", "collections", "contact", "customer-stories", "enterprise", "events", "explore", "features", "issues", "login", "marketplace", "new", "notifications", "orgs", "organizations", "pricing", "pulls", "readme", "search", "security", "settings", "site", "sponsors", "team", "topics", "trending", "users"]);
const PLACEHOLDERS = new Set(["owner/repo", "owner/name", "you/your-repo"]);

/** The repositories an issue names, at most MAX_REPOS_PER_ISSUE, in order, never this repository. */
export function reposInIssue(title: string, body?: string | null): RepoRef[] {
  const out: RepoRef[] = [], seen = new Set<string>();
  const add = (owner: string, raw: string) => {
    const name = raw.replace(/\.git$/i, "").replace(/\.+$/, "");
    const key = `${owner}/${name}`.toLowerCase();
    if (!name || name === "." || name === ".." || RESERVED.has(owner.toLowerCase()) || PLACEHOLDERS.has(key) || seen.has(key)) return;
    if (key === `${SITE_REPO.owner}/${SITE_REPO.name}`.toLowerCase()) return;
    seen.add(key); out.push({ owner, name });
  };
  const t = String(title ?? "").slice(0, 300), b = String(body ?? "").slice(0, 20_000);
  const bare = TITLE_REPO.exec(t);
  if (bare) add(bare[1], bare[2]);
  for (const m of `${t}\n${b}`.matchAll(REPO_URL)) add(m[1], m[2]);
  return out.slice(0, MAX_REPOS_PER_ISSUE);
}

/** A listing request: the `listing` label, or a title that starts with "List " or "Listing:". */
export function isListingIssue(issue: { title?: string | null; labels?: (string | { name?: string | null })[] }): boolean {
  const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l?.name ?? "").toLowerCase());
  return labels.includes(LISTING_LABEL) || /^\s*(list\s|listing:)/i.test(issue.title ?? "");
}

/** Open listing issues on this repository, newest first, and the repositories each one names. */
export async function listingRequests(octokit: Pick<Octokit, "rest"> = getOctokit()): Promise<ListingRequest[]> {
  const { data } = await octokit.rest.issues.listForRepo({ owner: SITE_REPO.owner, repo: SITE_REPO.name, state: "open", sort: "created", direction: "desc", per_page: 100 });
  return data.filter((i) => !i.pull_request && isListingIssue(i)).slice(0, MAX_LISTING_ISSUES)
    .map((i) => ({ issue: i.number, repos: reposInIssue(i.title, i.body) })).filter((r) => r.repos.length);
}

// ─── Answering ───────────────────────────────────────────────────────────
// Each answer carries a marker; a marker already on the issue means that answer was given (a re-run never comments twice)
export const MARK = { listed: "<!-- openchallengelist:listed -->", unverified: "<!-- openchallengelist:unverified -->" };

export type Verdict =
  | { kind: "listed"; id: string }          // on the list and its page is deployed
  | { kind: "rejected"; reason: string }    // GitHub answered and the repository does not qualify
  | { kind: "pending" };                    // verified but not listed yet, page not deployed yet, or GitHub did not answer

const code = (r: RepoRef) => `\`${r.owner}/${r.name}\``;
export const listingPage = (id: string) => `${SITE}/c/${encodeURIComponent(id)}`;

/** What to say on one issue, if anything. Waits while any repository is pending, so an issue gets one complete answer. */
export function answerFor(repos: (RepoRef & { verdict: Verdict })[], earlier: string[]): { body: string; close: boolean } | null {
  const said = (m: string) => earlier.some((c) => c.includes(m));
  if (!repos.length || said(MARK.listed) || repos.some((r) => r.verdict.kind === "pending")) return null;
  const listed = repos.flatMap((r) => (r.verdict.kind === "listed" ? [{ ...r, id: r.verdict.id }] : []));
  const rejected = repos.flatMap((r) => (r.verdict.kind === "rejected" ? [{ ...r, reason: r.verdict.reason }] : []));
  const why = rejected.map((r) => `- ${code(r)}: ${r.reason}.`);
  if (listed.length) return { close: true, body: [MARK.listed,
    ...listed.map((r) => `Listed: ${listingPage(r.id)} (${code(r)}).`), ``,
    `The live refresh re-reads PROBLEM.md and the SUBMISSION.md entries every few hours; agents get the digest at ${SITE}/api/competitions/${encodeURIComponent(listed[0].id)}.md.`,
    ...(why.length ? [``, `Not listed:`, ...why] : []), ``, `Closing this issue.`].join("\n") };
  if (said(MARK.unverified)) return null;
  return { close: false, body: [MARK.unverified, `Not listed yet:`, ...why, ``,
    `What the file needs: ${SITE}/standard (template: ${SITE}/standard/PROBLEM.md). Once it is there, the next live refresh (every few hours) picks the repository up and this issue gets the link; no need to open a new one.`].join("\n") };
}

export interface AnswerDeps {
  requests: () => Promise<ListingRequest[]>;
  earlier: (issue: number) => Promise<string[]>;    // bodies of the answers already on the issue (ours, not the author's)
  live: (id: string) => Promise<boolean>;           // the listing page is deployed
  verify: (r: RepoRef) => Promise<{ ok: true } | { ok: false; reason: string }>; // throws when GitHub did not answer
  comment: (issue: number, body: string) => Promise<void>;
  close: (issue: number) => Promise<void>;
}

/** `listed`: owner/name (lower case) → competition id, from data/competitions.json. */
export async function answerListingIssues(listed: Map<string, string>, deps: AnswerDeps): Promise<{ commented: number[]; closed: number[] }> {
  const done = { commented: [] as number[], closed: [] as number[] };
  const verdicts = new Map<string, Promise<Verdict>>();
  const verdict = (r: RepoRef): Promise<Verdict> => {
    const key = `${r.owner}/${r.name}`.toLowerCase();
    if (!verdicts.has(key)) verdicts.set(key, (async (): Promise<Verdict> => {
      const id = listed.get(key);
      if (id) return (await deps.live(id)) ? { kind: "listed", id } : { kind: "pending" };
      try { const v = await deps.verify(r); return v.ok ? { kind: "pending" } : { kind: "rejected", reason: v.reason }; }
      catch { return { kind: "pending" }; }
    })());
    return verdicts.get(key)!;
  };
  for (const req of await deps.requests()) {
    try {
      const earlier = await deps.earlier(req.issue);
      if (earlier.some((c) => c.includes(MARK.listed))) continue;
      const repos: (RepoRef & { verdict: Verdict })[] = [];
      for (const r of req.repos) repos.push({ ...r, verdict: await verdict(r) });
      const a = answerFor(repos, earlier);
      console.log(`  #${req.issue} ${repos.map((r) => `${r.owner}/${r.name}: ${r.verdict.kind}`).join(", ")}${a ? (a.close ? " → listed, closing" : " → not listed, reason given") : ""}`);
      if (!a) continue;
      await deps.comment(req.issue, a.body); done.commented.push(req.issue);
      if (a.close) { await deps.close(req.issue); done.closed.push(req.issue); }
    } catch { console.log(`  #${req.issue}: answering failed, retried on the next refresh`); }
  }
  return done;
}
