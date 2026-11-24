import assert from "node:assert/strict";
import { test } from "node:test";
import { agentOfPull, agentUsedLine, buildPequalnp, frontToProblem, hardLinkToProblem, rowAgent, stepAgents, stepIds, stepTitle } from "../src/structured/pequalnp.js";
import { postprocess } from "../src/postprocess.js";

const repo = { owner: "open-goat", name: "pequalnp-proofs", url: "https://github.com/open-goat/pequalnp-proofs", stars: 141, topics: [], defaultBranch: "main" };
const TEMPLATE = "**Agent used** (keep exactly one line):\n- Claude Code\n- Cursor\n- Codex\n- Gemini CLI\n- other\n\n**X handle** (optional):";
const pull = (number: number, login: string, title: string, extra: Record<string, unknown> = {}) => ({ number, author: { login }, headRefName: title, title, body: "", mergedAt: "2026-11-24T10:00:00Z", commits: { nodes: [{ commit: { message: title } }] }, ...extra });
const commit = (message: string) => ({ commits: { nodes: [{ commit: { message } }] } });

const head = {
  layout: "pnp-export/2", started_at: "2026-11-22T12:32:28.476Z",
  counters: { checked: 1744, refuted: 172, conjecture: 1891, lemmas: 4097 },
  outside: { count: 4, steps: 9 },
  files: { map: "data/map/overview.682eac5d3e49.json", plan: "data/plan.f867ad958938.json", contributors: "data/contributors.6a644ea17520.json" },
};
const map = { programs: [
  { id: "library", key: "lib", title: "Library of known results", aims_at: "neutral", goal: "Formalize known results.", counts: { checked: 308, conjecture: 8, refuted: 1 } },
  { id: "meta_complexity", key: "meta", title: "Meta-complexity", aims_at: "neutral", goal: "Study the hardness of problems about complexity.", counts: { checked: 1183, conjecture: 1776, refuted: 167 } },
  { id: "circuit_lower_bounds", key: "clb", title: "Circuit lower bounds via algorithms", aims_at: "p_neq_np", goal: "Turn faster algorithms into lower bounds.", counts: { checked: 29 } },
  { id: "p_eq_np_search", key: "alg", title: "P = NP algorithm search", aims_at: "p_eq_np", goal: "Search for a polynomial time algorithm.", counts: {} },
  { id: "../escape", key: "x", title: "Bad" },
] };
const plan = { programs: {
  library: { hard_link: { title: "None of its own", why_hard: "The library's target is checked." } },
  meta_complexity: { hard_link: { lemma_id: "L-meta-060", title: "Grid criterion: rare tables give a reduction", status: "conjecture", why_hard: "Finer than any known method." } },
  circuit_lower_bounds: { hard_link: { lemma_id: "L-clb-036", title: "OPEN: SAT has no fan-in two circuits of size O(n^1.01)", status: "in_work", why_hard: "No known method." } },
  p_eq_np_search: { hard_link: { lemma_id: "L-alg-005", title: "HARD LINK (restated): bit PHP", status: "retired" } },
} };
const contributors = { count: 5, steps: 10, by_tool: { other: 10 }, contributors: [
  { github: "willakone", steps: 3, lemmas: [
    { id: "L-meta-1495", title: "No duplicate gates", at: "2026-11-24T01:36:49.375Z" },
    { id: "L-meta-1496", title: "A step toward: A step toward: OR cone cut", at: "2026-11-24T01:37:14.293Z" },
    { id: "L-lib-031", title: "SAT is NP-complete", at: "2026-11-23T09:00:00.000Z" },
  ] },
  { github: "fededevi", steps: 3, lemmas: [
    { id: "L-meta-3245", title: "Heawood search", at: "2026-11-24T14:05:50.000Z" },
    { id: "L-meta-3012", title: "Another", at: "2026-11-24T12:00:00.000Z" },
    { id: "L-meta-3039", title: "Reduced", at: "2026-11-24T13:00:00.000Z" },
  ] },
  { github: "nicohabets", steps: 2, lemmas: [
    { id: "L-meta-948", title: "Plane", at: "2026-11-23T20:00:00.000Z" },
    { id: "L-meta-949", title: "Plane 2", at: "2026-11-24T02:00:00.000Z" },
  ] },
  { github: "nickmanning214", steps: 1, lemmas: [{ id: "L-clb-036", title: "SAT circuits", at: "2026-11-24T15:00:00.000Z" }] },
  { github: "<script>", steps: 1, lemmas: [{ id: "L-meta-1", at: "2026-11-24T00:00:00.000Z" }] },
  { github: "badsteps", steps: 1, lemmas: [{ id: "../../etc", at: "2026-11-24T00:00:00.000Z" }, { id: "L-META-2" }] },
] };
const pulls = [
  // page 1 (newest first)
  pull(6155, "fededevi", "L-meta-3245", { body: "L-meta-3245\n\n**Agent used** (keep exactly one line):\n- other (Devin)\n" }),
  pull(6100, "fededevi", "Reduce L-meta-3012 using a hyperoval", { headRefName: "codex/l-meta-3012" }),
  pull(6000, "fededevi", "R-meta-3039-317", { body: "One file: lean/PEqualNP/Outside/R_meta_3039_317.lean", ...commit("R-meta-3039-317\n\nCo-authored-by: Codex <codex@openai.com>") }),
  pull(5000, "someoneelse", "L-meta-1495", { ...commit("L-meta-1495\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>") }),
  // page 2
  pull(948, "nicohabets", "L-meta-948", { body: "🤖 Generated with [Claude Code](https://claude.com/claude-code)", ...commit("L-meta-948\n\nCo-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>") }),
  pull(949, "nicohabets", "Proof", { headRefName: "fix", body: "Closes the step L_meta_949 (file lean/PEqualNP/Outside/L_meta_949.lean).\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" }),
  pull(500, "willakone", "L-meta-1495", { body: TEMPLATE, ...commit("L-meta-1495\n\nCo-authored-by: Alberto Megías <alberto@example.com>") }),
];

function mockSite(t: any, override?: (url: string, init?: RequestInit) => Response | undefined) {
  const calls: { url: string; ua: string | null; after?: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const o = override?.(url, init); if (o) { calls.push({ url, ua: null }); return o; }
    if (url === "https://api.github.com/graphql") {
      const { variables } = JSON.parse(String(init?.body));
      calls.push({ url, ua: null, after: variables.after });
      const page = variables.after === "c1" ? pulls.slice(4) : pulls.slice(0, 4);
      return Response.json({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: variables.after !== "c1", endCursor: variables.after === "c1" ? null : "c1" }, nodes: page } } } });
    }
    calls.push({ url, ua: new Headers(init?.headers).get("user-agent") });
    const files: Record<string, unknown> = {
      "https://data.pequalnp.com/head.json": head,
      "https://data.pequalnp.com/data/map/overview.682eac5d3e49.json": map,
      "https://data.pequalnp.com/data/plan.f867ad958938.json": plan,
      "https://data.pequalnp.com/data/contributors.6a644ea17520.json": contributors,
    };
    return files[url] ? Response.json(files[url]) : new Response("not found", { status: 404 });
  });
  return calls;
}

test("step ids are read in every form a pull request names them", () => {
  assert.deepEqual([...stepIds("L-meta-2972")], ["L-meta-2972"]);
  assert.deepEqual([...stepIds("lean/PEqualNP/Outside/L_meta_2972.lean")], ["L-meta-2972"]);
  assert.deepEqual([...stepIds("R-meta-3241-917 · R_meta_3039_317")], ["L-meta-3241", "L-meta-3039"], "a reduction names its parent step");
  assert.deepEqual([...stepIds("codex-racing-L-meta-234")], ["L-meta-234"]);
  assert.deepEqual([...stepIds("XL-meta-1 L-meta-12345678 L-META-3")], []);
  assert.equal(stepTitle("A step toward: A step toward: Search"), "A step toward: Search");
  assert.equal(stepTitle("A step toward: Search"), "A step toward: Search");
});

test("the template's Agent used line counts only when one line is kept", () => {
  assert.equal(agentUsedLine(TEMPLATE), undefined, "an untouched list says nothing");
  assert.equal(agentUsedLine("**Agent used** (keep exactly one line):\n- Claude Code\n\n**X handle**"), "Claude Code");
  assert.equal(agentUsedLine("**Agent used**\n\n- other (Devin)\n"), "Devin");
  assert.equal(agentUsedLine("**Agent used**\n- other\n"), undefined);
  assert.equal(agentUsedLine("no template here"), undefined);
});

test("a pull request's agent comes from its trailers, footer, branch and template line; human co-authors are not agents", () => {
  const claude = agentOfPull(pulls[4] as any)!;
  assert.deepEqual({ ...claude, evidence: undefined }, { family: "anthropic", model: "Claude Fable 5.2", tool: "Claude Code", evidence: undefined, confidence: "high", role: "author" });
  assert.match(claude.evidence!, /open-goat\/pequalnp-proofs PR #948: Co-Authored-By: Claude Fable 5\.2, "Generated with Claude Code"/);
  const codex = agentOfPull(pulls[2] as any)!;
  assert.equal(codex.family, "openai"); assert.equal(codex.tool, "Codex"); assert.equal(codex.model, undefined); assert.equal(codex.confidence, "high");
  const branch = agentOfPull(pulls[1] as any)!;
  assert.equal(branch.tool, "Codex"); assert.equal(branch.confidence, "medium", "a branch name alone is weaker evidence");
  const devin = agentOfPull(pulls[0] as any)!;
  assert.deepEqual([devin.family, devin.tool, devin.confidence], ["other-ai", "Devin", "medium"]);
  assert.equal(agentOfPull(pulls[6] as any), undefined, "a human co-author and an untouched template");
  const bare = agentOfPull(pull(1, "a", "L-meta-1", commit("x\n\nCo-Authored-By: Claude <noreply@anthropic.com>")) as any)!;
  assert.deepEqual([bare.family, bare.model, bare.tool], ["anthropic", undefined, undefined]);
  assert.equal(agentOfPull(pull(2, "a", "L-meta-1", commit("x\n\nCo-authored-by: Kimi Code <k@example.com>")) as any)!.family, "moonshot");
  assert.equal(agentOfPull(pull(3, "a", "L-meta-1", { body: "**Agent used**\n- Gemini CLI\n" }) as any)!.family, "google");
});

test("each credited step takes the agent of the merged pull request its own author sent it in", () => {
  const agents = stepAgents(contributors.contributors as any, pulls as any);
  assert.equal(agents.get("fededevi|L-meta-3039")!.tool, "Codex", "a reduction's branch and file name its parent step");
  assert.equal(agents.get("nicohabets|L-meta-949")!.family, "anthropic", "named only in the body: the fallback");
  assert.equal(agents.get("willakone|L-meta-1495"), undefined, "the same step id in someone else's pull request is not evidence");
  // majority family; evidence for fewer than half the steps lowers the confidence
  const mixed = rowAgent("fededevi", ["L-meta-3245", "L-meta-3012", "L-meta-3039"], agents)!;
  assert.equal(mixed.family, "openai");
  assert.equal(mixed.tool, "Codex");
  assert.equal(mixed.confidence, "high");
  assert.match(mixed.evidence!, /^2 of 3 steps with agent evidence \(also other-ai on 1\); e\.g\. open-goat\/pequalnp-proofs PR #6000: Co-Authored-By: Codex$/);
  const thin = rowAgent("fededevi", ["L-meta-3039", "a", "b", "c"], agents)!;
  assert.equal(thin.confidence, "medium");
  assert.equal(rowAgent("willakone", ["L-meta-1495"], agents), undefined);
});

test("a front ranks outside contributors by checked steps; an open hard link waits for one accepted proof", () => {
  const clean = contributors.contributors.filter((c) => /^[\w-]+$/.test(c.github)) as any; // buildPequalnp drops invalid handles first
  const agents = stepAgents(clean, pulls as any);
  const meta = frontToProblem(map.programs[1] as any, clean, agents);
  assert.equal(meta.id, "front-meta");
  assert.equal(meta.group, "Fronts");
  assert.equal(meta.metricDirection, "maximize");
  assert.match(meta.description!, /Neutral on the answer\. .*the fleet's own work is not ranked\. The fleet's record here: 1183 checked, 1776 open conjectures, 167 refuted\./);
  assert.deepEqual(meta.records.map((r) => [r.contributor, r.value]), [["fededevi", 3], ["nicohabets", 2], ["willakone", 2]], "a tie goes to whoever proved a step on this front first");
  const [top, nico, will] = meta.records;
  assert.deepEqual(meta.records.map((r) => r.isCurrentBest), [true, false, false]);
  assert.equal(top.date, "2026-11-24");
  assert.equal(top.contributorUrl, "https://github.com/fededevi");
  assert.deepEqual(top.submissionUrls, ["https://pequalnp.com/a/fededevi"]);
  assert.equal(will.description, "2 checked steps · latest L-meta-1496: A step toward: OR cone cut");
  assert.equal(nico.agent!.model, "Claude Fable 5.2");
  assert.equal(will.agent, undefined);
  const alg = frontToProblem(map.programs[3] as any, clean, agents);
  assert.equal(alg.records.length, 0);

  const clb = hardLinkToProblem("Circuit lower bounds via algorithms", plan.programs.circuit_lower_bounds.hard_link, clean, agents)!;
  assert.equal(clb.id, "l-clb-036");
  assert.equal(clb.name, "SAT has no fan-in two circuits of size O(n^1.01)");
  assert.equal(clb.passMark, 1);
  assert.match(clb.description!, /stuck on \(L-clb-036, in work\)\. No known method\. The desk hands these out to agents that ask with &hard=1\./);
  assert.deepEqual(clb.records.map((r) => [r.contributor, r.value, r.submissionUrls?.[0]]), [["nickmanning214", 1, "https://pequalnp.com/lemma#L-clb-036"]]);
  assert.equal(hardLinkToProblem("Library", plan.programs.library.hard_link, [], agents), undefined, "no lemma of its own");
  assert.equal(hardLinkToProblem("P = NP algorithm search", plan.programs.p_eq_np_search.hard_link, [], agents), undefined, "retired is not open");
});

test("buildPequalnp reads the site's files and every page of merged pull requests, and survives postprocess", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = mockSite(t);
  const built = await buildPequalnp();
  assert.deepEqual(built.problems.map((p) => p.id), ["p-vs-np", "l-meta-060", "l-clb-036", "front-lib", "front-meta", "front-clb", "front-alg"], "a program with an unsafe id is skipped");
  const data = calls.filter((c) => c.url.startsWith("https://data.pequalnp.com/"));
  assert.equal(data.length, 4);
  assert.ok(data.every((c) => c.ua === "openchallengelist-crawler (+https://openchallengelist.com)"));
  assert.deepEqual(calls.filter((c) => c.url === "https://api.github.com/graphql").map((c) => c.after), [null, "c1"]);
  assert.match(built.description, /4097 statements posted, 1744 checked, 172 refuted; 4 outside contributors have had 9 steps accepted\./);

  const c = postprocess(built, repo);
  assert.equal(c.host, "website");
  assert.equal(c.domain, "formal-methods");
  assert.deepEqual(c.repo, { owner: "open-goat", name: "pequalnp-proofs", branch: "main" });
  const open = c.problems.filter((p) => p.isOpen).map((p) => p.id).sort();
  assert.deepEqual(open, ["front-alg", "l-meta-060", "p-vs-np"], "P vs NP and the unproved hard link stay open; a hard link with an accepted proof closes");
  assert.equal(c.problems.find((p) => p.id === "front-meta")!.contested, true);
  assert.deepEqual(c.participants.map((p) => p.name).sort(), ["fededevi", "nickmanning214", "nicohabets", "willakone"], "invalid handles and step ids are dropped");
  assert.deepEqual(c.agentStats.map((a) => a.family).sort(), ["anthropic", "openai"]);
  assert.equal(c.status, "active");
});

test("without GitHub the board is still built, with no attribution; without the site the build fails", async (t) => {
  t.mock.method(console, "log", () => {});
  mockSite(t, (url) => (url === "https://api.github.com/graphql" ? new Response("SECRET down", { status: 502 }) : undefined));
  const built = await buildPequalnp();
  assert.equal(built.problems.find((p) => p.id === "front-meta")!.records.length, 3);
  assert.ok(built.problems.every((p) => p.records.every((r) => !r.agent)));

  mockSite(t, (url) => (url.endsWith("/head.json") ? Response.json({ ...head, files: { ...head.files, map: "../../evil.json" } }) : undefined));
  await assert.rejects(buildPequalnp(), (e: Error) => e.message === "pequalnp download failed", "head.json only points inside data/");
  mockSite(t, (url) => (url.includes("contributors") ? new Response("SECRET busy", { status: 503 }) : undefined));
  await assert.rejects(buildPequalnp(), (e: Error) => e.message === "pequalnp download failed");
});
