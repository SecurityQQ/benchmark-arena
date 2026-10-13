import assert from "node:assert/strict";
import { test } from "node:test";
import { canSkip, type RepoState } from "../src/main.js";
import { EXTRACTION_FINGERPRINT } from "../src/llm.js";

const repo = { owner: "o", name: "r", url: "https://github.com/o/r", stars: 1, topics: [], defaultBranch: "main", pushedAt: "2026-10-01T00:00:00Z" };
const now = Date.parse("2026-10-13T00:00:00Z");
const st = (over: Partial<RepoState> = {}): RepoState => ({ pushedAt: repo.pushedAt, fingerprint: EXTRACTION_FINGERPRINT, verdict: "competition", checkedAt: "2026-10-06T00:00:00Z", ...over });

test("unchanged repo with the same prompts/model is skipped", () => {
  assert.equal(canSkip(st(), repo, now, false), "competition");
  assert.equal(canSkip(st({ verdict: "none" }), repo, now, false), "none");
});

test("a new push, a new model/prompt, FORCE, missing data or old state means re-processing", () => {
  assert.equal(canSkip(undefined, repo, now, false), null);
  assert.equal(canSkip(st({ pushedAt: "2026-09-01T00:00:00Z" }), repo, now, false), null);
  assert.equal(canSkip(st({ fingerprint: "other" }), repo, now, false), null);
  assert.equal(canSkip(st(), { ...repo, pushedAt: undefined }, now, false), null);
  assert.equal(canSkip(st(), repo, now, true), null);
  assert.equal(canSkip(st({ checkedAt: "2026-09-01T00:00:00Z" }), repo, now, false), null);          // competition: >28 days
  assert.equal(canSkip(st({ verdict: "none", checkedAt: "2026-09-01T00:00:00Z" }), repo, now, false), "none"); // reject: <56 days
  assert.equal(canSkip(st({ checkedAt: "garbage" }), repo, now, false), null);
});
