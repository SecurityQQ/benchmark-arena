import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepo, liveRecrawl, type Extraction, type LiveDeps, type RepoState } from "../src/main.js";
import { clearRepoCache } from "../src/fetcher.js";
import { getOctokit } from "../src/github.js";
import { loadCommitDates } from "../src/commitDates.js";
import { DEFAULT_SOURCES, detectChanges, touched, type SourceProbe } from "../src/freshness.js";
import { postprocess } from "../src/postprocess.js";
import { EXTRACTION_FINGERPRINT } from "../src/llm.js";
import type { Competition, DiscoveredRepo } from "../src/types.js";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const repo = (owner: string, name: string): DiscoveredRepo => ({ owner, name, url: `https://github.com/${owner}/${name}`, stars: 1, topics: [], defaultBranch: "main", pushedAt: "2026-11-20T00:00:00Z" });
const st = (over: Partial<RepoState> = {}): RepoState => ({ pushedAt: "2026-11-20T00:00:00Z", fingerprint: EXTRACTION_FINGERPRINT, verdict: "competition", checkedAt: "2026-11-20T01:00:00Z", head: "a".repeat(40), sources: ["README.md", "results/"], ...over });
const board = (r: DiscoveredRepo, records = 3): Competition => postprocess({
  name: r.name, url: r.url, participation: { requirements: [], compute: "cpu" }, links: [],
  problems: [{ id: "t", name: "T", metricName: "time", metricDirection: "minimize", records: Array.from({ length: records }, (_, i) => ({ value: 10 - i, contributor: `user-${i}` })) }],
}, r);

// A fake GitHub: per repo the current push time and the files changed since the stored head
function probe(repos: Record<string, { pushedAt: string; files?: string[]; status?: string; truncated?: boolean; unknownBase?: boolean }>) {
  const calls: string[] = [];
  const p: SourceProbe = {
    async repo(owner, name) { calls.push(`repo ${owner}/${name}`); return { pushedAt: repos[`${owner}/${name}`].pushedAt, branch: "main" }; },
    async head(owner, name) { calls.push(`head ${owner}/${name}`); return "b".repeat(40); },
    async before(owner, name, _b, until) { calls.push(`before ${owner}/${name} ${until}`); return "c".repeat(40); },
    async diff(owner, name, base) {
      calls.push(`diff ${owner}/${name} ${base.slice(0, 1)}`);
      const r = repos[`${owner}/${name}`];
      return r.unknownBase ? null : { status: r.status ?? "ahead", files: r.files ?? [], truncated: r.truncated };
    },
  };
  return { p, calls };
}

function deps(p: SourceProbe, over: Partial<LiveDeps> = {}) {
  const extracted: string[] = [];
  const d: LiveDeps = {
    probe: p, max: 4, hasKey: true, now: NOW,
    extract: async (r, prev): Promise<Extraction> => {
      extracted.push(`${r.owner}/${r.name}`);
      return { kind: "competition", competition: board(r, prev.stats.totalRecords + 1), head: "d".repeat(40), sources: ["README.md"] };
    },
    ...over,
  };
  return { d, extracted };
}

test("only a change to a file the extractor read counts", () => {
  assert.deepEqual(touched(["README.md", "train/run.py", "results/new.json", "resultsx/a.json"], ["README.md", "results/"]), ["README.md", "results/new.json"]);
  assert.deepEqual(touched(["readme.md", "docs/README.md"], ["README.md"]), []);
});

test("a push that touches only code makes no LLM call", async () => {
  const r = repo("o", "code");
  const { p, calls } = probe({ "o/code": { pushedAt: "2026-11-24T00:00:00Z", files: ["train/run.py", "kernels/a.cu"] } });
  const { d, extracted } = deps(p);
  const out = await liveRecrawl([r], { "o/code": st() }, new Map([["o/code", board(r)]]), d);
  assert.deepEqual(extracted, []);
  assert.deepEqual(out.fresh, []);
  assert.equal(out.updates.size, 0);
  assert.deepEqual(calls, ["repo o/code", `diff o/code a`]);
});

test("a README change re-extracts the board and records what it read", async () => {
  const r = repo("o", "board");
  const { p } = probe({ "o/board": { pushedAt: "2026-11-24T00:00:00Z", files: ["train/run.py", "README.md"] } });
  const { d, extracted } = deps(p);
  const out = await liveRecrawl([r], { "o/board": st() }, new Map([["o/board", board(r)]]), d);
  assert.deepEqual(extracted, ["o/board"]);
  assert.equal(out.fresh.length, 1);
  const s = out.updates.get("o/board")!;
  assert.equal(s.pushedAt, "2026-11-24T00:00:00Z");
  assert.equal(s.head, "d".repeat(40));
  assert.deepEqual(s.sources, ["README.md"]);
  assert.equal(s.live, true);
  assert.equal(s.fingerprint, EXTRACTION_FINGERPRINT);
});

test("a new file in a watched data folder counts as a change", async () => {
  const r = repo("o", "data");
  const { p } = probe({ "o/data": { pushedAt: "2026-11-24T00:00:00Z", files: ["results/2026-11-24.json"] } });
  const { d, extracted } = deps(p);
  await liveRecrawl([r], { "o/data": st() }, new Map([["o/data", board(r)]]), d);
  assert.deepEqual(extracted, ["o/data"]);
});

test("the cap re-extracts the most recently changed boards and leaves the rest for the next run", async () => {
  const rs = ["a", "b", "c"].map((n) => repo("o", n));
  const { p } = probe({
    "o/a": { pushedAt: "2026-11-22T00:00:00Z", files: ["README.md"] },
    "o/b": { pushedAt: "2026-11-24T00:00:00Z", files: ["README.md"] },
    "o/c": { pushedAt: "2026-11-23T00:00:00Z", files: ["README.md"] },
  });
  const { d, extracted } = deps(p, { max: 2 });
  const out = await liveRecrawl(rs, Object.fromEntries(rs.map((r) => [`o/${r.name}`, st()])), new Map(rs.map((r) => [`o/${r.name}`, board(r)])), d);
  assert.deepEqual(extracted, ["o/b", "o/c"]);
  assert.deepEqual(out.deferred, ["o/a"]);
  assert.equal(out.updates.has("o/a"), false); // untouched state: still changed next run
});

test("without OPENROUTER_API_KEY changes are found but the LLM is never called", async () => {
  const r = repo("o", "board");
  const { p } = probe({ "o/board": { pushedAt: "2026-11-24T00:00:00Z", files: ["README.md"] } });
  const { d, extracted } = deps(p, { hasKey: false });
  const out = await liveRecrawl([r], { "o/board": st() }, new Map([["o/board", board(r)]]), d);
  assert.deepEqual(extracted, []);
  assert.deepEqual(out.deferred, ["o/board"]);
  assert.equal(out.updates.size, 0);
});

test("boards with a deterministic builder, merged facets and unknown repos never reach the LLM", async () => {
  const rs = [repo("gpu-mode", "reference-kernels"), repo("leanprover", "lean-eval"), repo("o", "rejected"), repo("o", "new")];
  const all = Object.fromEntries(rs.map((r) => [`${r.owner}/${r.name}`.toLowerCase(), { pushedAt: "2026-11-24T00:00:00Z", files: ["README.md"] }]));
  const { p, calls } = probe(all);
  const { d, extracted } = deps(p);
  const state = { ...Object.fromEntries(rs.map((r) => [`${r.owner}/${r.name}`, st()])), "o/rejected": st({ verdict: "none" }) };
  const prev = new Map(rs.filter((r) => r.name !== "new").map((r) => [`${r.owner}/${r.name}`, board(r)]));
  await liveRecrawl(rs, state, prev, d);
  assert.deepEqual(extracted, []);
  assert.deepEqual(calls, []);
});

test("a failed or shrunk re-extraction keeps the previous entry and backs off for a day", async () => {
  const rs = [repo("o", "fails"), repo("o", "shrinks"), repo("o", "none")];
  const { p } = probe(Object.fromEntries(rs.map((r) => [`o/${r.name}`, { pushedAt: "2026-11-24T00:00:00Z", files: ["README.md"] }])));
  const { d } = deps(p, {
    extract: async (r): Promise<Extraction> => {
      if (r.name === "fails") throw new Error("LLM request failed");
      if (r.name === "none") return { kind: "none", sources: [] };
      return { kind: "competition", competition: board(r, 2), sources: ["README.md"] };
    },
  });
  const state = Object.fromEntries(rs.map((r) => [`o/${r.name}`, st()]));
  const out = await liveRecrawl(rs, state, new Map(rs.map((r) => [`o/${r.name}`, board(r, 20)])), d);
  assert.deepEqual(out.fresh, []);
  for (const r of rs) {
    const s = out.updates.get(`o/${r.name}`)!;
    assert.equal(s.liveFailedAt, new Date(NOW).toISOString());
    assert.equal(s.head, "a".repeat(40)); // still diffed against what the kept entry was read at
    assert.equal(s.pushedAt, "2026-11-20T00:00:00Z");
  }
  // the next run within a day does not even ask GitHub; a day later it tries again
  const next = probe({ "o/fails": { pushedAt: "2026-11-24T00:00:00Z", files: ["README.md"] } });
  const failed = { "o/fails": out.updates.get("o/fails")! };
  const soon = await detectChanges([rs[0]], failed, next.p, NOW + 3 * 3_600_000);
  assert.deepEqual(soon.backoff, ["o/fails"]);
  assert.deepEqual(next.calls, []);
  const later = await detectChanges([rs[0]], failed, next.p, NOW + 25 * 3_600_000);
  assert.equal(later.changed.length, 1);
});

test("state from before heads were recorded: a quiet repo adopts today's head, a pushed one diffs from the commit at extraction time", async () => {
  const quiet = repo("o", "quiet"), pushed = repo("o", "pushed");
  const { p, calls } = probe({
    "o/quiet": { pushedAt: "2026-11-20T00:00:00Z" },
    "o/pushed": { pushedAt: "2026-11-24T00:00:00Z", files: ["LEADERBOARD.md"] },
  });
  const legacy = st({ head: undefined, sources: undefined });
  const report = await detectChanges([quiet, pushed], { "o/quiet": legacy, "o/pushed": legacy }, p, NOW);
  assert.deepEqual([...report.baselines], [["o/quiet", "b".repeat(40)]]);
  assert.deepEqual(calls, ["repo o/quiet", "head o/quiet", "repo o/pushed", `before o/pushed ${legacy.checkedAt}`, "diff o/pushed c"]);
  assert.deepEqual(report.changed.map((c) => c.files), [["LEADERBOARD.md"]]);
  assert.ok(DEFAULT_SOURCES.includes("README.md"));
});

test("the shared extraction path records the commit and files it read, and dates pinned records before the stats", async (t) => {
  const owner = "extract-path-test", name = "board", HEAD = "e".repeat(40), PIN = "de9732b9882fdc21ff9be566f6f577f37be500a1";
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; clearRepoCache(owner, name); });
  clearRepoCache(owner, name);
  const octokit = getOctokit();
  t.mock.method(octokit.rest.repos, "get", async () => ({ data: { private: false } }));
  t.mock.method(octokit.rest.git, "getRef", async () => ({ data: { object: { sha: HEAD } } }));
  t.mock.method(octokit.rest.repos, "getContent", async () => ({ data: [] }));
  t.mock.method(octokit, "paginate", async () => []);
  const today = new Date().toISOString().slice(0, 10);
  const llm = {
    name: "Board", url: `https://github.com/${owner}/${name}`, participation: { requirements: [], compute: "cpu" }, links: [],
    problems: [{ id: "t", name: "T", metricName: "time", metricDirection: "minimize", records: [
      { value: 9.9, contributor: "someone-1", submissionUrls: [`https://github.com/${owner}/${name}/blob/${PIN}/run.py`] },
    ] }],
  };
  let llmCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    const u = String(url);
    if (u.startsWith("https://openrouter.ai/")) { llmCalls++; return Response.json({ choices: [{ message: { content: JSON.stringify(llm) } }] }); }
    if (u === `https://raw.githubusercontent.com/${owner}/${name}/main/README.md`) return new Response("# Board\n\n| time | who | script |\n|---|---|---|\n| 9.9 | @someone-1 | [run.py](...) |\n");
    return new Response("", { status: 404 });
  });
  const dates = loadCommitDates("/nonexistent/commit-dates.json", async (_o, _n, sha) => (sha === PIN ? today : null));
  const x = await extractRepo(repo(owner, name), undefined, dates);
  assert.equal(x.kind, "competition");
  if (x.kind !== "competition") return;
  assert.equal(llmCalls, 1);
  assert.equal(x.head, HEAD);
  assert.ok(x.sources.includes("README.md") && !x.sources.includes("__attribution__"));
  assert.equal(x.competition.problems[0].records[0].date, today);
  assert.equal(x.competition.stats.lastSubmission, today);
  assert.equal(x.competition.stats.recordsLast30d, 1);
});

test("no push since the extraction costs one call; an incomparable history is re-read", async () => {
  const rs = ["same", "branch", "gone", "huge", "forced", "rewound"].map((n) => repo("o", n));
  const { p, calls } = probe({
    "o/same": { pushedAt: "2026-11-20T00:00:00Z" },
    "o/branch": { pushedAt: "2026-11-24T00:00:00Z", status: "identical" }, // a push to another branch
    "o/gone": { pushedAt: "2026-11-24T00:00:00Z", unknownBase: true },
    "o/huge": { pushedAt: "2026-11-24T00:00:00Z", files: ["src/a.py"], truncated: true },
    "o/forced": { pushedAt: "2026-11-24T00:00:00Z", files: ["src/a.py"], status: "diverged" },
    "o/rewound": { pushedAt: "2026-11-24T00:00:00Z", status: "behind" },
  });
  const report = await detectChanges(rs, Object.fromEntries(rs.map((r) => [`o/${r.name}`, st()])), p, NOW);
  assert.equal(calls.filter((c) => c.endsWith("o/same") || c.includes("o/same ")).length, 1);
  assert.deepEqual(report.changed.map((c) => c.repo.name).sort(), ["forced", "gone", "huge", "rewound"]);
  assert.equal(report.quiet, 2);
});
