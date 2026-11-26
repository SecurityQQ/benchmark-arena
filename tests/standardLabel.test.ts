import assert from "node:assert/strict";
import { test } from "node:test";
import { competitionToMarkdown, specLabel } from "../src/render.js";
import { pages } from "../src/prerender.js";
import type { Competition } from "../src/types.js";

const board = (over: Partial<Competition> = {}): Competition => ({
  id: "b", name: "Board", tagline: "A board", description: "", url: "https://github.com/o/b", repo: { owner: "o", name: "b" }, host: "github", status: "active",
  tags: [], domain: "ml-research", images: [], participation: { requirements: [], compute: "cpu", howToSubmit: "Open a PR" }, links: [],
  participants: [], agentStats: [], lastUpdated: "2026-11-25", stats: { totalRecords: 0, uniqueParticipants: 0, recordsLast30d: 0, recordsLast90d: 0 },
  problems: [], ...over,
});
const std = (over: Partial<NonNullable<Competition["standard"]>> = {}) => ({ problem: true, submission: false, submissions: 0, version: 1, warnings: [], ...over });

test("standard: the spec and its version, as organizers write it", () => {
  assert.equal(specLabel(std()), "problem.md/v1");
  assert.equal(specLabel(std({ version: 2 })), "problem.md/v2");
  assert.equal(specLabel(std({ problem: false, submission: true, submissions: 3 })), "submission.md/v1");
  assert.equal(specLabel(std({ version: 0 })), "problem.md/v1", "a missing version reads as v1");
});

test("standard: the digest and the board page show problem.md/v1; boards without the files show nothing", () => {
  const listed = board({ id: "with", standard: std({ submission: true, submissions: 1 }) }), plain = board({ id: "without" });
  assert.ok(competitionToMarkdown(listed).includes("- Standard: problem.md/v1 (tracks and how to submit from the repository's PROBLEM.md; 1 entry from SUBMISSION.md files; https://openchallengelist.com/standard)"), competitionToMarkdown(listed));
  assert.ok(!competitionToMarkdown(plain).includes("- Standard:"));

  const data = { crawledAt: "2026-11-26T03:00:00Z", competitions: [listed, plain] };
  const html = (id: string) => pages(data).find((p) => p.path === `/c/${id}`)!.body;
  assert.ok(html("with").includes(`<p class="dim">Follows <a href="/standard"><code>problem.md/v1</code></a>: tracks and how to submit come from the repository's PROBLEM.md</p>`), html("with"));
  assert.ok(!html("without").includes("problem.md/v"));
});
