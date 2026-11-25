// Answers listing issues on this repository after a live refresh has pushed its data (.github/workflows/live.yml): a repository
// now on the list gets its link once its page is deployed, and the issue is closed; one that failed the PROBLEM.md check gets the
// reason once, and the issue stays open until it passes. Issue text only ever goes through listing.ts's owner/name extraction.
//
//   GITHUB_TOKEN=$(gh auth token) DRY_RUN=1 npx tsx scripts/answer-listing-issues.ts     (DRY_RUN prints instead of commenting)

import { loadEnv } from "../src/env.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { boundedFetch, getOctokit } from "../src/github.js";
import { verifyStandardRepo } from "../src/discovery.js";
import { answerListingIssues, listingPage, listingRequests, SITE_REPO } from "../src/listing.js";
import type { CrawlResult } from "../src/types.js";

loadEnv();
const dry = process.env.DRY_RUN === "1";
const gh = getOctokit(), repo = { owner: SITE_REPO.owner, repo: SITE_REPO.name };
const data: CrawlResult = JSON.parse(readFileSync(join(process.cwd(), "data", "competitions.json"), "utf-8"));
const listed = new Map(data.competitions.filter((c) => c.repo).map((c) => [`${c.repo!.owner}/${c.repo!.name}`.toLowerCase(), c.id]));

// the push redeploys the site in a few minutes: a "listed" answer waits for the page, up to 8 minutes per run in all
const until = Date.now() + 8 * 60_000;
const up = (id: string) => boundedFetch(listingPage(id), { method: "HEAD" }).then((r) => r.ok, () => false);
async function live(id: string): Promise<boolean> {
  for (;;) {
    if (await up(id)) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

const done = await answerListingIssues(listed, {
  requests: () => listingRequests(gh),
  // only answers from the bot or a maintainer count: an author cannot silence the answer by pasting the marker
  earlier: async (issue) => (await gh.paginate(gh.rest.issues.listComments, { ...repo, issue_number: issue, per_page: 100 }))
    .filter((c) => c.user?.type === "Bot" || ["OWNER", "MEMBER", "COLLABORATOR"].includes(c.author_association)).map((c) => c.body ?? ""),
  live,
  verify: (r) => verifyStandardRepo(r.owner, r.name),
  comment: async (issue, body) => { if (dry) console.log(`--- would comment on #${issue}:\n${body}\n---`); else await gh.rest.issues.createComment({ ...repo, issue_number: issue, body }); },
  close: async (issue) => { if (!dry) await gh.rest.issues.update({ ...repo, issue_number: issue, state: "closed", state_reason: "completed" }); },
});
console.log(`Listing issues: ${done.commented.length} answered, ${done.closed.length} closed${dry ? " (dry run)" : ""}`);
