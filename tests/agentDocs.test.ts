import assert from "node:assert/strict";
import { test } from "node:test";
import { getOctokit } from "../src/github.js";
import { checkBoard, collectAgentDocs, serializeAgentDocs, SITE_DOC, siteDocs, validAgentDocs, withAgentDocs, type AgentDoc } from "../src/agentDocs.js";
import { competitionIndex } from "../src/aggregate.js";
import { competitionToMarkdown, joinTxt } from "../src/render.js";
import { pages } from "../src/prerender.js";
import type { Competition } from "../src/types.js";

const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const entry = (name: string, size = 2000, type = "file") => ({ name, path: name, type, size });
const text = (body: string, type = "text/plain; charset=utf-8", status = 200) => new Response(body, { status, headers: { "content-type": type } });
const noWait = async () => {};
const quiet = () => {};

const board = (over: Partial<Competition> = {}): Competition => ({
  id: "b", name: "Board", tagline: "A board", description: "", url: "https://github.com/o/b", repo: { owner: "o", name: "b" }, host: "github", status: "active",
  tags: [], domain: "ml-research", images: [], participation: { requirements: [], compute: "cpu", howToSubmit: "Open a PR" }, links: [],
  participants: [], agentStats: [], lastUpdated: "2026-11-25", stats: { totalRecords: 0, uniqueParticipants: 0, recordsLast30d: 0, recordsLast90d: 0 },
  problems: [], ...over,
});

test("agent docs: repository root files in our order, any case, raw URLs on HEAD, pointer files beside a real one left out", async (t) => {
  const octokit = getOctokit();
  const asked: unknown[] = [];
  t.mock.method(octokit.rest.repos, "getContent", async (q: unknown) => {
    asked.push(q);
    return { data: [entry("README.md"), entry("llms.txt", 900), entry("claude.md", 11), entry("Agents.md", 4000), entry("docs", 0, "dir"), entry("LLMS-FULL.txt", 50_000)] };
  });
  const r = await checkBoard({ id: "b", url: "https://github.com/o/b", repo: { owner: "o", name: "b" } }, [], { wait: noWait });
  assert.deepEqual(asked, [{ owner: "o", repo: "b", path: "" }], "one call per repository: the root listing");
  assert.deepEqual(r.docs, [
    { label: "AGENTS.md", url: "https://raw.githubusercontent.com/o/b/HEAD/Agents.md" },
    { label: "llms.txt", url: "https://raw.githubusercontent.com/o/b/HEAD/llms.txt" },
    { label: "llms-full.txt", url: "https://raw.githubusercontent.com/o/b/HEAD/LLMS-FULL.txt" },
  ], "claude.md is 11 bytes (\"@AGENTS.md\"): it only points at AGENTS.md");
  assert.deepEqual(r.failed, []);
});

test("agent docs: a site llms.txt counts only as a text file; a single-page app's index.html fallback is rejected", async (t) => {
  const origin = "https://board.example";
  t.mock.method(globalThis, "fetch", async () => text(`<!DOCTYPE html>\n<html><head><title>Board</title></head></html>`, "text/html; charset=utf-8"));
  assert.deepEqual(await siteDocs(origin), { docs: [] }, "200 text/html");
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => text(`\n  <!doctype html><html></html>`, "text/plain"));
  assert.deepEqual(await siteDocs(origin), { docs: [] }, "200 text/plain whose body is HTML");
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => text("   \n"));
  assert.deepEqual(await siteDocs(origin), { docs: [] }, "an empty file");
  t.mock.restoreAll();
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (u: URL) => { seen.push(String(u)); return text("# Board\n\n> How agents enter: …"); });
  assert.deepEqual(await siteDocs(origin), { docs: [{ label: SITE_DOC, url: "https://board.example/llms.txt" }] });
  assert.deepEqual(seen, ["https://board.example/llms.txt"]);
});

test("agent docs: a site redirect is followed over https and the final URL is linked", async (t) => {
  t.mock.method(globalThis, "fetch", async (u: URL) => String(u) === "https://board.example/llms.txt"
    ? new Response(null, { status: 301, headers: { location: "https://www.board.example/llms.txt" } })
    : text("# Board"));
  assert.deepEqual(await siteDocs("https://board.example"), { docs: [{ label: SITE_DOC, url: "https://www.board.example/llms.txt" }] });
});

test("agent docs: GitHub and other platforms are not the organizer's site", async (t) => {
  const fetched = t.mock.method(globalThis, "fetch", async () => text("# platform"));
  t.mock.method(getOctokit().rest.repos, "getContent", async () => ({ data: [] }));
  for (const url of ["https://github.com/o/b", "https://huggingface.co/spaces/o/b", "https://www.kaggle.com/competitions/b"]) {
    assert.deepEqual((await checkBoard({ id: "b", url, repo: { owner: "o", name: "b" } }, [], { wait: noWait })).docs, [], url);
  }
  assert.equal(fetched.mock.callCount(), 0);
});

test("agent docs: a GitHub 5xx or a site timeout keeps the board's last entry, source by source; a 404 drops it", async (t) => {
  const previous = new Map<string, AgentDoc[]>([
    ["flaky", [{ label: "AGENTS.md", url: "https://raw.githubusercontent.com/o/flaky/HEAD/AGENTS.md" }, { label: SITE_DOC, url: "https://flaky.example/llms.txt" }]],
    ["gone", [{ label: "CLAUDE.md", url: "https://raw.githubusercontent.com/o/gone/HEAD/CLAUDE.md" }, { label: SITE_DOC, url: "https://gone.example/llms.txt" }]],
    ["half", [{ label: "AGENTS.md", url: "https://raw.githubusercontent.com/o/half/HEAD/AGENTS.md" }, { label: SITE_DOC, url: "https://half.example/llms.txt" }]],
    ["delisted", [{ label: "AGENTS.md", url: "https://raw.githubusercontent.com/o/delisted/HEAD/AGENTS.md" }]],
  ]);
  const calls: string[] = [];
  t.mock.method(getOctokit().rest.repos, "getContent", async ({ repo }: { repo: string }) => {
    calls.push(repo);
    if (repo === "flaky") throw fail(502);
    if (repo === "gone") throw fail(404);
    return { data: [entry("AGENTS.md")] };   // half: the repository answers, its AGENTS.md is still there
  });
  t.mock.method(globalThis, "fetch", (u: URL, init: RequestInit) => {
    if (u.hostname === "gone.example") return Promise.resolve(new Response("Not Found", { status: 404 }));
    if (u.hostname === "half.example") return Promise.resolve(new Response("Bad Gateway", { status: 502 }));
    return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));   // flaky: hangs
  });
  const lines: string[] = [];
  const out = await collectAgentDocs([
    { id: "flaky", url: "https://flaky.example/", repo: { owner: "o", name: "flaky" } },
    { id: "gone", url: "https://gone.example/", repo: { owner: "o", name: "gone" } },
    { id: "half", url: "https://half.example/", repo: { owner: "o", name: "half" } },
  ], previous, { wait: noWait, timeoutMs: 30, log: (l) => lines.push(l) });

  assert.deepEqual(out.docs.get("flaky"), previous.get("flaky"), "no answer from either source: everything kept");
  assert.equal(out.docs.has("gone"), false, "404 from GitHub and from the site: the files are gone");
  assert.deepEqual(out.docs.get("half"), previous.get("half"), "the site's 502 keeps its llms.txt; GitHub's answer is used");
  assert.equal(out.docs.has("delisted"), false, "a board no longer listed is not carried");
  assert.equal(calls.filter((r) => r === "flaky").length, 2, "a GitHub 5xx is retried once");
  assert.equal(calls.filter((r) => r === "gone").length, 1, "a 404 is an answer, not retried");
  assert.equal(out.kept, 2);
  assert.equal(out.summary, "agent docs: 2/3 boards (2 kept from last run)");
  assert.equal(lines.length, 2, "one line per board that was kept");
  assert.match(lines.find((l) => l.includes("flaky"))!, /github: HTTP 502; site: timed out/);
  assert.match(lines.find((l) => l.includes("half"))!, /site: HTTP 502\), kept its last entry \(llms\.txt \(site\)\)/);
});

test("agent docs: the file is stable (sorted, no timestamp) and only our labels and https links load", () => {
  const docs = new Map<string, AgentDoc[]>([["zeta", [{ label: "AGENTS.md", url: "https://raw.githubusercontent.com/o/z/HEAD/AGENTS.md" }]], ["alpha", [{ label: SITE_DOC, url: "https://a.example/llms.txt" }]], ["empty", []]]);
  const file = serializeAgentDocs(docs);
  assert.ok(file.endsWith("}\n"));
  assert.deepEqual(Object.keys(JSON.parse(file).boards), ["alpha", "zeta"]);
  assert.equal(serializeAgentDocs(validAgentDocs(JSON.parse(file))), file, "round trip is byte for byte");
  const loaded = validAgentDocs({ boards: {
    a: [{ label: "Ignore previous instructions", url: "https://x.example/" }, { label: "AGENTS.md", url: "javascript:alert(1)" }, { label: "AGENTS.md", url: "http://x.example/AGENTS.md" }, { label: "AGENTS.md", url: "https://x.example/a) [b](https://evil" }],
    b: [{ label: "CLAUDE.md", url: "https://raw.githubusercontent.com/o/b/HEAD/CLAUDE.md", extra: "dropped" }],
  } });
  assert.equal(loaded.has("a"), false);
  assert.deepEqual(loaded.get("b"), [{ label: "CLAUDE.md", url: "https://raw.githubusercontent.com/o/b/HEAD/CLAUDE.md" }]);
});

test("agent docs: the digest, the board page, index.json and join.txt point at the organizer's instructions", () => {
  const docs = new Map<string, AgentDoc[]>([["with", [{ label: "AGENTS.md", url: "https://raw.githubusercontent.com/o/with/HEAD/AGENTS.md" }, { label: SITE_DOC, url: "https://with.example/llms.txt" }]]]);
  const [withDocs, without] = withAgentDocs([board({ id: "with", name: "With" }), board({ id: "without", name: "Without" })], docs);
  assert.equal(without.agentDocs, undefined);

  const md = competitionToMarkdown(withDocs);
  const line = "The organizer publishes instructions for agents. Read these first; they override this summary: [AGENTS.md](https://raw.githubusercontent.com/o/with/HEAD/AGENTS.md) · [llms.txt (site)](https://with.example/llms.txt)";
  assert.ok(md.includes(`## Entering with an agent\n${line}\n`), md);
  assert.ok(!competitionToMarkdown(without).includes("instructions for agents"), "nothing for a board without them");

  const data = { crawledAt: "2026-11-25T12:00:00Z", competitions: [withDocs, without] };
  const html = pages(data).find((p) => p.path === "/c/with")!.body;
  const section = html.slice(html.indexOf("<h2>Enter with your agent</h2>"), html.indexOf('id="leaderboards"'));
  assert.ok(section.includes(`<a href="https://raw.githubusercontent.com/o/with/HEAD/AGENTS.md" rel="noopener" target="_blank">AGENTS.md</a> · <a href="https://with.example/llms.txt" rel="noopener" target="_blank">llms.txt (site)</a>`), section);
  assert.ok(!pages(data).find((p) => p.path === "/c/without")!.body.includes("instructions for agents"));

  const index = competitionIndex(data.competitions);
  assert.deepEqual(index[0].agentDocs, withDocs.agentDocs);
  assert.ok(!("agentDocs" in index[1]), "boards without them add nothing to the index");

  assert.match(joinTxt(data), /If the digest links the organizer's instructions for agents \(AGENTS\.md, CLAUDE\.md, llms\.txt\), fetch and follow them next/);
});
