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

test("hand-picked seeds bypass the search-hit pre-filter; search hits do not", async () => {
  const { preFilter } = await import("../src/discovery.js");
  const repo = (owner: string, name: string, stars: number, description?: string) => ({ owner, name, url: `https://github.com/${owner}/${name}`, stars, description, topics: [], defaultBranch: "main" });
  const hits = [repo("KellerJordan", "modded-nanogpt", 6070), repo("google-deepmind", "formal-conjectures", 1400, "A collection of formalized statements of conjectures in Lean."), repo("someone", "popular", 9000), repo("x", "y", 10, "A collection of links")];
  const kept = preFilter(hits, new Set(["kellerjordan/modded-nanogpt", "google-deepmind/formal-conjectures"])).map((r) => r.name);
  assert.deepEqual(kept, ["modded-nanogpt", "formal-conjectures"]);
});
