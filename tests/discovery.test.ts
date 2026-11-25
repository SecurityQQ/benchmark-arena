import assert from "node:assert/strict";
import { test } from "node:test";
import { getOctokit } from "../src/github.js";
import { discoverRepos } from "../src/discovery.js";

const meta = (owner: string, repo: string) => ({
  private: false, visibility: "public", html_url: `https://github.com/${owner}/${repo}`, description: "", stargazers_count: 0,
  topics: [], default_branch: "main", pushed_at: "2026-11-01T00:00:00Z", owner: { login: owner }, name: repo, full_name: `${owner}/${repo}`,
});

test("discovery: a listed competition the searches missed is looked up and kept past the pre-filter", async (t) => {
  const octokit = getOctokit();
  const looked: string[] = [];
  t.mock.method(octokit.rest.repos, "get", async ({ owner, repo }: { owner: string; repo: string }) => { looked.push(`${owner}/${repo}`); return { data: meta(owner, repo) }; });
  t.mock.method(octokit.rest.search, "code", async () => ({ data: { items: [] } }));
  t.mock.method(octokit.rest.search, "repos", async () => ({ data: { items: [] } }));
  t.mock.method(console, "log", () => {});
  const repos = await discoverRepos(5, [{ owner: "someone", name: "quiet-board" }, { owner: "cybertronai", name: "sutro-problems" }]);
  assert.ok(repos.some((r) => r.owner === "someone" && r.name === "quiet-board"), "listed repo kept");
  assert.equal(looked.filter((k) => k.toLowerCase() === "cybertronai/sutro-problems").length, 1, "a listed repo that is also a seed is looked up once");
  const without = await discoverRepos(5);
  assert.ok(!without.some((r) => r.name === "quiet-board"));
});
