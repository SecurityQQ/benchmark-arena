import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { llmsTxt, LISTING_LINE } from "../src/render.js";
import { pages } from "../src/prerender.js";
import { getOctokit, NotPublicError } from "../src/github.js";
import { discoverStandardRepos, verifyStandardRepo } from "../src/discovery.js";
import { answerFor, answerListingIssues, isListingIssue, listingRequests, MARK, MAX_LISTING_ISSUES, reposInIssue, type AnswerDeps, type ListingRequest } from "../src/listing.js";
import { mergeLane } from "../src/main.js";
import { postprocess } from "../src/postprocess.js";
import { loadCommitDates } from "../src/commitDates.js";

const names = (rs: { owner: string; name: string }[]) => rs.map((r) => `${r.owner}/${r.name}`);

test("listing: only real github.com/<owner>/<repo> URLs come out of issue text", () => {
  assert.deepEqual(names(reposInIssue("List my challenge", "Repo: https://github.com/rtl-ai/silicon-arena — please list.")), ["rtl-ai/silicon-arena"]);
  // the forms people paste: markdown links, angle brackets, .git, a deep link, a trailing full stop, no scheme
  assert.deepEqual(names(reposInIssue("", "[x](https://github.com/a/one) <https://github.com/b/two.git> https://github.com/c/three/blob/main/PROBLEM.md see https://www.github.com/d/four. github.com/e/five")), ["a/one", "b/two", "c/three", "d/four", "e/five"]);
  // lookalikes: another host that starts or ends with github.com, gists, the API, raw files, a URL nested in another, an email
  for (const body of [
    "https://github.com.evil.com/owner/repo", "https://evilgithub.com/owner/repo", "https://gist.github.com/owner/0123abcd",
    "https://api.github.com/repos/owner/repo", "https://raw.githubusercontent.com/owner/repo/main/PROBLEM.md",
    "https://evil.example/https://github.com/owner/repo", "https://evil.example/?u=github.com/owner/repo", "git@github.com/owner/repo",
    "https://github.com/topics/open-challenge-list", "https://github.com/orgs/rtl-ai/people", "https://github.com/-bad/repo",
    "https://github.com/bad--owner/repo", "https://github.com/under_score/repo", `https://github.com/owner/${"x".repeat(101)}`,
    "https://github.com/owner/..",
  ]) assert.deepEqual(reposInIssue("List it", body), [], body);
  // never this repository, never the template's placeholder
  assert.deepEqual(reposInIssue("List owner/repo", "https://github.com/SecurityQQ/open-challenge-list/issues/new?title=List+owner/repo"), []);
  assert.deepEqual(reposInIssue("List owner/repo", "https://github.com/securityqq/OPEN-CHALLENGE-LIST"), []);
  assert.deepEqual(reposInIssue("List owner/repo", "https://github.com/SecurityQQ/benchmark-arena"), []); // the former name still redirects here
});

test("listing: at most five repositories per issue, deduplicated, the bare title form included", () => {
  const body = Array.from({ length: 9 }, (_, i) => `https://github.com/o${i}/r${i}`).join("\n");
  assert.deepEqual(names(reposInIssue("Listing: x", body)), ["o0/r0", "o1/r1", "o2/r2", "o3/r3", "o4/r4"]);
  assert.deepEqual(names(reposInIssue("List rtl-ai/silicon-arena", "https://github.com/RTL-AI/silicon-arena and https://github.com/rtl-ai/silicon-arena/")), ["rtl-ai/silicon-arena"]);
  assert.deepEqual(names(reposInIssue("List: rtl-ai/silicon-arena", null)), ["rtl-ai/silicon-arena"]);
  assert.deepEqual(reposInIssue("List rtl-ai/silicon-arena and also evil/thing", null), [], "the bare form is the whole title or nothing");
});

test("listing: a listing issue is labeled `listing` or titled List …/Listing: …", () => {
  assert.ok(isListingIssue({ title: "Please add us", labels: [{ name: "listing" }] }));
  assert.ok(isListingIssue({ title: "Please add us", labels: ["Listing"] }));
  assert.ok(isListingIssue({ title: "List rtl-ai/silicon-arena", labels: [] }));
  assert.ok(isListingIssue({ title: "listing: SiliconArena" }));
  assert.ok(!isListingIssue({ title: "Listed entries are stale", labels: [{ name: "bug" }] }));
  assert.ok(!isListingIssue({ title: "Add competition: owner/repo", labels: [] }));
});

test("listing: open issues → requests, pull requests and issues naming no repository skipped, at most 30", async () => {
  const issues = [
    { number: 1, title: "List a/one", body: null, labels: [] },
    { number: 2, title: "List b/two", body: "", labels: [], pull_request: {} },
    { number: 3, title: "Bug: list view", body: "https://github.com/c/three", labels: [] },
    { number: 4, title: "List my challenge", body: "no link here", labels: [] },
    { number: 5, title: "Please list us", body: "https://github.com/e/five", labels: [{ name: "listing" }] },
    ...Array.from({ length: 40 }, (_, i) => ({ number: 100 + i, title: `List x${i}/y`, body: null, labels: [] })),
  ];
  let asked: Record<string, unknown> = {};
  const octokit = { rest: { issues: { listForRepo: async (q: Record<string, unknown>) => { asked = q; return { data: issues }; } } } } as never;
  const reqs = await listingRequests(octokit);
  assert.equal(asked.owner, "SecurityQQ"); assert.equal(asked.repo, "open-challenge-list"); assert.equal(asked.state, "open");
  assert.deepEqual(reqs.slice(0, 2), [{ issue: 1, repos: [{ owner: "a", name: "one" }] }, { issue: 5, repos: [{ owner: "e", name: "five" }] }]);
  assert.ok(reqs.length <= MAX_LISTING_ISSUES && !reqs.some((r) => r.issue === 2 || r.issue === 3 || r.issue === 4));
});

// ─── Verification ────────────────────────────────────────────────────────
const meta = (owner: string, name: string, extra: object = {}) => ({
  private: false, visibility: "public", fork: false, html_url: `https://github.com/${owner}/${name}`, description: "d", stargazers_count: 0,
  topics: [], default_branch: "main", pushed_at: "2026-11-25T14:34:37Z", owner: { login: owner }, name, full_name: `${owner}/${name}`, ...extra,
});
const PROBLEM = "---\nspec: problem.md/v1\nname: SiliconArena\ntracks:\n  - id: t\n    name: T\n    metric: area\n    direction: minimize\n---\n# Body\n";

test("verify: public, not a fork, root PROBLEM.md with the marker; a reason only when GitHub answered", async (t) => {
  const octokit = getOctokit();
  const repos: Record<string, object | number> = { "a/ok": meta("a", "ok"), "a/fork": meta("a", "fork", { fork: true }), "a/private": meta("a", "private", { private: true }), "a/gone": 404, "a/flaky": 502, "a/none": meta("a", "none"), "a/plain": meta("a", "plain"), "a/yaml": meta("a", "yaml"), "a/branch": meta("a", "branch", { default_branch: "we`ird" }) };
  t.mock.method(octokit.rest.repos, "get", async ({ owner, repo }: { owner: string; repo: string }) => {
    const r = repos[`${owner}/${repo}`];
    if (typeof r === "number") throw Object.assign(new Error("SECRET"), { status: r });
    return { data: r };
  });
  const files: Record<string, string | null> = { ok: PROBLEM, none: null, plain: "# Problem\nno front matter", yaml: "---\nspec: [unclosed\n---\n", branch: null };
  const raw = async (_o: string, name: string) => files[name] ?? null;
  const ok = await verifyStandardRepo("a", "ok", undefined, raw);
  assert.ok(ok.ok && ok.repo.priority === true && ok.repo.defaultBranch === "main" && ok.repo.pushedAt === "2026-11-25T14:34:37Z");
  const reason = async (name: string) => { const v = await verifyStandardRepo("a", name, undefined, raw); assert.ok(!v.ok, name); return v.reason; };
  assert.match(await reason("fork"), /fork/);
  assert.match(await reason("private"), /not public/);
  assert.match(await reason("gone"), /no public repository at github\.com\/a\/gone/);
  assert.equal(await reason("none"), "no PROBLEM.md with `spec: problem.md/v1` at the root of `main`");
  assert.match(await reason("plain"), /does not start with front matter carrying `spec: problem\.md\/v1`/);
  assert.match(await reason("yaml"), /not valid YAML/);
  assert.match(await reason("branch"), /root of the default branch$/, "an odd branch name is not echoed into the answer");
  await assert.rejects(verifyStandardRepo("a", "flaky", undefined, raw), "a 5xx is not an answer");
  await assert.rejects(verifyStandardRepo("a", "ok", undefined, async () => { throw new Error("raw 503"); }));
});

test("discovery: the topic, listing issues and seeds feed the standard lane; listed repos are not looked at again", async (t) => {
  const octokit = getOctokit();
  const looked: string[] = [];
  t.mock.method(octokit.rest.search, "code", async () => ({ data: { items: [] } }));
  t.mock.method(octokit.rest.search, "repos", async ({ q }: { q: string }) => ({ data: { items: q === "topic:open-challenge-list" ? [meta("topic", "board"), meta("topic", "fork", { fork: true })] : [] } }));
  t.mock.method(octokit.rest.issues, "listForRepo", async () => ({ data: [{ number: 12, title: "List issue/board", body: "https://github.com/issue/plain", labels: [] }] }));
  t.mock.method(octokit.rest.repos, "get", async ({ owner, repo }: { owner: string; repo: string }) => { looked.push(`${owner}/${repo}`); return { data: meta(owner, repo) }; });
  t.mock.method(console, "log", () => {});
  const raw = async (owner: string, name: string) => (["topic/board", "issue/board"].includes(`${owner}/${name}`) ? PROBLEM : name === "plain" ? "# not ours" : null);
  const found = await discoverStandardRepos([{ owner: "rtl-ai", name: "silicon-arena" }], { seeds: true, raw });
  assert.deepEqual(names(found).sort(), ["issue/board", "topic/board"]);
  assert.ok(found.every((r) => r.priority));
  assert.ok(!looked.includes("topic/fork"), "a fork from search is not even looked up");
  assert.ok(!looked.includes("rtl-ai/silicon-arena"), "a listed seed is skipped");
  assert.ok(looked.includes("cybertronai/sutro-problems"), "seeds are checked in the priority lane");
  looked.length = 0;
  await discoverStandardRepos([], { raw });
  assert.ok(!looked.includes("cybertronai/sutro-problems"), "the full crawl looks seeds up on its own");
});

// ─── Answering ───────────────────────────────────────────────────────────
function harness(requests: ListingRequest[], opts: { earlier?: Record<number, string[]>; live?: boolean; verify?: AnswerDeps["verify"] } = {}) {
  const calls = { comment: [] as [number, string][], close: [] as number[], verify: [] as string[] };
  const deps: AnswerDeps = {
    requests: async () => requests,
    earlier: async (n) => opts.earlier?.[n] ?? [],
    live: async () => opts.live ?? true,
    verify: async (r) => { calls.verify.push(`${r.owner}/${r.name}`); return (opts.verify ?? (async () => ({ ok: false as const, reason: "no PROBLEM.md with `spec: problem.md/v1` at the root of `main`" })))(r); },
    comment: async (n, body) => { calls.comment.push([n, body]); },
    close: async (n) => { calls.close.push(n); },
  };
  return { deps, calls };
}
const listed = new Map([["rtl-ai/silicon-arena", "rtl-ai-silicon-arena-d20cfa656a05f7ad"]]);
const req = (issue: number, ...repos: string[]): ListingRequest => ({ issue, repos: repos.map((r) => ({ owner: r.split("/")[0], name: r.split("/")[1] })) });

test("answer: listed → one comment with the link, then the issue is closed", async (t) => {
  t.mock.method(console, "log", () => {});
  const { deps, calls } = harness([req(7, "RTL-AI/silicon-arena")]);
  assert.deepEqual(await answerListingIssues(listed, deps), { commented: [7], closed: [7] });
  const [[n, body]] = calls.comment;
  assert.equal(n, 7);
  assert.ok(body.startsWith(MARK.listed));
  assert.match(body, /Listed: https:\/\/openchallengelist\.com\/c\/rtl-ai-silicon-arena-d20cfa656a05f7ad \(`RTL-AI\/silicon-arena`\)\./);
  assert.deepEqual(calls.verify, [], "a listed repository is not verified again");
});

test("answer: not listed → the reason once, and the issue stays open", async (t) => {
  t.mock.method(console, "log", () => {});
  const first = harness([req(8, "someone/board")]);
  assert.deepEqual(await answerListingIssues(listed, first.deps), { commented: [8], closed: [] });
  const body = first.calls.comment[0][1];
  assert.ok(body.startsWith(MARK.unverified));
  assert.match(body, /`someone\/board`: no PROBLEM\.md with `spec: problem\.md\/v1` at the root of `main`\./);
  assert.match(body, /openchallengelist\.com\/standard/);
  // the next refresh: still failing, already said → nothing
  const again = harness([req(8, "someone/board")], { earlier: { 8: [body] } });
  assert.deepEqual(await answerListingIssues(listed, again.deps), { commented: [], closed: [] });
  // fixed and listed since → the link, and closed
  const fixed = harness([req(8, "someone/board")], { earlier: { 8: [body] } });
  assert.deepEqual(await answerListingIssues(new Map([["someone/board", "board-id"]]), fixed.deps), { commented: [8], closed: [8] });
});

test("answer: already answered, still pending, page not deployed or GitHub down → nothing", async (t) => {
  t.mock.method(console, "log", () => {});
  const cases: [string, ReturnType<typeof harness>][] = [
    ["already answered", harness([req(9, "rtl-ai/silicon-arena")], { earlier: { 9: [`${MARK.listed}\nListed: …`] } })],
    ["verified, not listed yet", harness([req(9, "someone/board")], { verify: async () => ({ ok: true }) })],
    ["listed, page not deployed yet", harness([req(9, "rtl-ai/silicon-arena")], { live: false })],
    ["GitHub did not answer", harness([req(9, "someone/board")], { verify: async () => { throw new Error("502"); } })],
    ["one of two still pending", harness([req(9, "rtl-ai/silicon-arena", "someone/board")], { verify: async () => ({ ok: true }) })],
  ];
  for (const [why, { deps, calls }] of cases) {
    assert.deepEqual(await answerListingIssues(listed, deps), { commented: [], closed: [] }, why);
    assert.equal(calls.comment.length + calls.close.length, 0, why);
  }
});

test("answer: mixed issue, shared verdicts, and nothing from the issue text reaches the comment", async (t) => {
  t.mock.method(console, "log", () => {});
  const { deps, calls } = harness([req(10, "rtl-ai/silicon-arena", "someone/board"), req(11, "someone/board")]);
  await answerListingIssues(listed, deps);
  assert.deepEqual(calls.close, [10]);
  assert.match(calls.comment[0][1], /Listed: .*\n[\s\S]*Not listed:\n- `someone\/board`: no PROBLEM\.md/);
  assert.deepEqual(calls.verify, ["someone/board"], "one verification per repository per run");
  // the answer is built from owner/name and fixed text only
  const reqs = await listingRequests({ rest: { issues: { listForRepo: async () => ({ data: [{ number: 12, title: "List x", body: "@everyone <img src=x onerror=alert(1)> https://github.com/someone/board [click](https://evil.example)", labels: [] }] }) } } } as never);
  const a = answerFor(reqs[0].repos.map((r) => ({ ...r, verdict: { kind: "rejected" as const, reason: "r" } })), []);
  assert.ok(a && !/@everyone|<img|evil\.example/.test(a.body));
});

// ─── The lane's merge ────────────────────────────────────────────────────
test("priority lane merge: every other board stays the saved object, in place; only the lane's boards change", async () => {
  const board = (owner: string, name: string) => postprocess({ name, problems: [{ id: "t", name: "T", metricName: "score", metricDirection: "maximize", records: [{ value: 1 }] }] }, { owner, name, url: `https://github.com/${owner}/${name}`, defaultBranch: "main", stars: 0, topics: [] });
  // saved boards as they come off disk: plain JSON, not run through postprocess again
  const saved = JSON.parse(JSON.stringify([board("a", "one"), board("b", "two"), board("c", "three")]));
  const before = JSON.stringify(saved);
  const fresh = board("rtl-ai", "silicon-arena"), gone = board("x", "private");
  const dates = loadCommitDates("/nonexistent/commit-dates.json", async () => null);
  const out = await mergeLane(saved, [fresh, gone], new Set(), dates, async (owner) => { if (owner === "x") throw new NotPublicError("private"); });
  assert.deepEqual(out.map((c) => c.repo!.name), ["one", "two", "three", "silicon-arena"]);
  assert.ok(out.slice(0, 3).every((c, i) => c === saved[i]), "the saved objects themselves, so they serialize byte for byte");
  assert.equal(JSON.stringify(saved), before);
  // a lane re-read of a listed board replaces that board only
  const reread = { ...saved[1], tagline: "new" };
  const out2 = await mergeLane(saved, [reread], new Set(), dates, async () => {});
  assert.deepEqual(out2.map((c) => c.tagline === "new"), [false, false, true]);
  assert.ok(out2[0] === saved[0] && out2[1] === saved[2]);
});

// ─── What organizers and their agents are told ──────────────────────────
test("organizers are told the way in that works (topic or listing issue), not code search", () => {
  const data = { crawledAt: "2026-11-25T00:00:00Z", competitions: [], errors: [] };
  const txt = llmsTxt(data);
  assert.ok(txt.includes(LISTING_LINE) && !/code search|crawled first/i.test(txt));
  assert.match(LISTING_LINE, /topic `open-challenge-list`.*issues\/new\?title=List\+owner\/repo&labels=listing/);
  for (const path of ["/standard", "/submit"]) {
    const p = pages(data).find((x) => x.path === path)!;
    assert.match(p.body, /open-challenge-list/, path);
    assert.ok(!/code search|crawled first/i.test(p.body + p.description), path);
  }
  const app = readFileSync("site/app.js", "utf-8"), tpl = readFileSync("site/standard/PROBLEM.md", "utf-8");
  assert.ok(!/searches all of GitHub|crawled first|found by code search/i.test(app));
  assert.match(tpl.split("\n").slice(0, 4).join("\n"), /# Get listed within hours: add the GitHub topic open-challenge-list/);
});
