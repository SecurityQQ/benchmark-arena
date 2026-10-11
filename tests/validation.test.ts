import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { postprocess } from "../src/postprocess.js";
import { competitionId, validateCompetition, validateAttributions, safeId, savedEntries, assertUniqueCompetitions } from "../src/validation.js";
import { mergeCompetitions, publicCompetitions } from "../src/main.js";
import { processRepoWithLLM, attributeRecordsWithLLM } from "../src/llm.js";
import { applyStandard } from "../src/standard.js";
import { getOctokit } from "../src/github.js";
import { discoverRepos } from "../src/discovery.js";
import { buildLeanEval } from "../src/structured/leanEval.js";

const repo = { owner: "owner", name: "repo", url: "https://github.com/owner/repo", defaultBranch: "main", stars: 0, topics: [] };
const input = () => ({ name: "Example", problems: [{ id: "track-2.0", name: "Track", metricName: "score", metricDirection: "maximize", records: [{ value: 2 }] }] });

test("minimal shape receives defaults and derived fields are rebuilt", () => {
  const c = postprocess({ ...input(), stats: { totalRecords: -9 }, participants: ["bad"], extra: "discard" }, repo);
  assert.equal(c.participation.compute, "unknown");
  assert.deepEqual(c.tags, []);
  assert.equal(c.stats.totalRecords, 1);
  assert.equal(c.problems[0].records[0].isCurrentBest, true);
  assert.equal("extra" in c, false);
});

test("invalid shapes, enums, dates and numeric values fail closed", () => {
  for (const value of [null, [], "text", { ...input(), problems: {} }, { ...input(), status: "open" }, { ...input(), participation: { compute: "gpu" } }, { ...input(), domain: "invented" }]) {
    assert.throws(() => validateCompetition(value, repo), /^Error: Invalid competition data$/);
  }
  for (const value of ["2", null, NaN, Infinity, {}, false]) {
    const c: any = input(); c.problems[0].records[0].value = value;
    assert.throws(() => postprocess(c, repo));
  }
  for (const date of ["2026-02-30", "yesterday", 123]) {
    const c: any = input(); c.problems[0].records[0].date = date;
    assert.throws(() => postprocess(c, repo));
  }
  const c = input(); c.problems.push(c.problems[0]);
  assert.throws(() => postprocess(c, repo));
});

test("URL fields reject executable schemes, credentials, and protocol-relative URLs", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "//evil.test/x", "https://user:secret@example.com", "https://example.com/\nsecret", "\\evil.test"]) {
    for (const patch of [{ url }, { images: [url] }, { links: [{ label: "test", url }] }, { organizer: { name: "test", url } }]) {
      assert.throws(() => postprocess({ ...input(), ...patch }, repo));
    }
    const c: any = input(); c.problems[0].records[0].submissionUrls = [url];
    assert.throws(() => postprocess(c, repo));
  }
  assert.equal(postprocess({ ...input(), images: ["./docs/task.png"] }, repo).images[0], "https://raw.githubusercontent.com/owner/repo/main/docs/task.png");
});

test("IDs are repo-bound, preserve only same-repo legacy IDs, and collisions never evict", () => {
  const old = postprocess(input(), repo); old.id = "published-link";
  assert.equal(postprocess({ ...input(), id: "llm-changed" }, repo, old).id, old.id);
  assert.equal(postprocess({ ...input(), id: "llm-changed" }, repo).id, competitionId(repo));
  const other = { ...repo, owner: "another" };
  assert.notEqual(competitionId(repo), competitionId(other));
  assert.throws(() => postprocess(input(), other, old));
  for (const id of ["../secret", "a/b", "a%2fb", "a?b", "__proto__", "constructor", "CON", "lpt1", ""]) assert.throws(() => safeId(id));
  const newEntry = postprocess(input(), other); newEntry.id = old.id;
  assert.throws(() => mergeCompetitions([old], [newEntry]));
  newEntry.id = old.id.toUpperCase();
  assert.throws(() => mergeCompetitions([old], [newEntry]));
  assert.throws(() => assertUniqueCompetitions([old, old]));
});

test("attribution validates all entries and only accepts requested record keys", () => {
  const valid = { family: "openai", confidence: "high", role: "author" };
  assert.deepEqual(validateAttributions({ "0.0": valid }, new Set(["0.0"])), { "0.0": valid });
  for (const value of [[], null, { "0.1": valid }, { "0.0": { ...valid, family: "fake" } }, { "0.0": { ...valid, confidence: 5 } }, { "0.0": { ...valid, model: {} } }, { "0.0": { ...valid, role: "assisted" } }]) {
    assert.throws(() => validateAttributions(value, new Set(["0.0"])));
  }
});

test("overlay output is checked and diagnostic warning text is discarded", () => {
  const { competition } = applyStandard(validateCompetition(input(), repo), [{ path: "PROBLEM.md", meta: { spec: "problem.md/v1", website: "https://user:secret@example.com" }, body: "", errors: [] }], repo);
  assert.throws(() => postprocess(competition, repo));
  const c = postprocess({ ...input(), standard: { problem: true, submission: false, submissions: 0, version: 1, warnings: ["SECRET upstream error"] } }, repo);
  assert.deepEqual(c.standard?.warnings, ["Standard document warning"]);
});

test("public failures exclude carried entries, priority merges and structured repo entries", async () => {
  const old = postprocess(input(), repo);
  const structured = postprocess(input(), { ...repo, owner: "leanprover", name: "lean-eval-submissions" });
  const blocked = new Set<string>();
  const result = await publicCompetitions([old, structured], blocked, async () => { throw new Error("SECRET private response"); });
  assert.deepEqual(result, []);
  assert.deepEqual(mergeCompetitions([old, structured], [], blocked), []);
  let calls = 0;
  assert.deepEqual(await publicCompetitions([old], blocked, async () => { calls++; }), []);
  assert.equal(calls, 0);
});

test("persisted dataset validates for repost without migrating published IDs", () => {
  const entries = savedEntries(JSON.parse(readFileSync(new URL("../data/competitions.json", import.meta.url), "utf8")));
  const comps = entries.map(({ value, repo, id }) => { const c = postprocess(value, repo); c.id = id; return c; });
  assertUniqueCompetitions(comps);
  assert.equal(comps.length, entries.length);
  assert.throws(() => savedEntries({ competitions: [{ id: "../bad", repo }] }));
  assert.throws(() => savedEntries({}));
});

test("LLM HTTP, JSON, transport, truncation and schema failures expose no upstream text", async (t) => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; });
  const pages = { repo: { owner: repo.owner, name: repo.name, branch: "main" }, pages: [], totalChars: 0, standardDocs: [] };
  const outputs = [
    () => new Response("SECRET", { status: 500 }),
    () => new Response("SECRET"),
    () => Response.json({ choices: [{ message: { content: "SECRET" } }] }),
    () => Response.json({ choices: [{ finish_reason: "length", message: { content: "SECRET" } }] }),
    () => Response.json({ choices: [{ message: { content: JSON.stringify({ name: "SECRET", problems: "SECRET" }) } }] }),
    () => { throw new Error("SECRET"); },
  ];
  for (const output of outputs) {
    t.mock.method(globalThis, "fetch", async () => output());
    await assert.rejects(processRepoWithLLM(pages), (e: Error) => !e.message.includes("SECRET"));
    await assert.rejects(attributeRecordsWithLLM("test", [{ key: "0.0", problem: "track", value: 2 }], "evidence"), (e: Error) => !e.message.includes("SECRET"));
  }
});

test("CLI repost and structured processing exclude private previous entries without leaking exceptions", () => {
  const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const github = new URL("../src/github.ts", import.meta.url).href;
  const tsx = import.meta.resolve("tsx");
  for (const mode of ["repost", "process"]) {
    const cwd = mkdtempSync(join(tmpdir(), "competition-validation-"));
    try {
      mkdirSync(join(cwd, "data"));
      const structuredRepo = { ...repo, owner: "leanprover", name: "lean-eval-submissions" };
      const previous = postprocess(input(), structuredRepo);
      writeFileSync(join(cwd, "data/competitions.json"), JSON.stringify({ competitions: [previous], errors: [{ repo: "old", error: "SECRET persisted error" }] }));
      writeFileSync(join(cwd, "data/discovered.json"), JSON.stringify([structuredRepo]));
      const script = `import { getOctokit } from ${JSON.stringify(github)}; getOctokit().rest.repos.get = async () => { throw new Error("SECRET private response"); }; process.argv = [process.execPath, ${JSON.stringify(main)}, ${JSON.stringify(mode)}]; await import(${JSON.stringify(new URL("../src/main.ts", import.meta.url).href)});`;
      const result = spawnSync(process.execPath, ["--import", tsx, "--input-type=module", "-e", script], { cwd, encoding: "utf8", timeout: 15000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal((result.stdout + result.stderr).includes("SECRET"), false);
      const saved = readFileSync(join(cwd, "data/competitions.json"), "utf8");
      assert.deepEqual(JSON.parse(saved).competitions, []);
      assert.equal(saved.includes("SECRET"), false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test("both LLM passes enforce advertised and streamed 4 MiB response limits", async (t) => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; });
  const calls = [
    () => processRepoWithLLM({ repo: { owner: "owner", name: "repo", branch: "main" }, pages: [], totalChars: 0, standardDocs: [] }),
    () => attributeRecordsWithLLM("test", [{ key: "0.0", problem: "track", value: 2 }], "evidence"),
  ];
  for (const call of calls) for (const advertised of [true, false]) {
    let cancelled = false;
    let signal: AbortSignal | undefined;
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      signal = init.signal;
      assert.ok(["error", "manual"].includes(init.redirect));
      return new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
        cancel() { cancelled = true; },
      }), { headers: advertised ? { "content-length": String(4 * 1024 * 1024 + 1) } : {} });
    });
    await assert.rejects(call(), /^Error: LLM (attribution )?request failed$/);
    assert.equal(cancelled, true);
    assert.equal(signal?.aborted, true);
  }
});

test("both LLM passes apply a 120-second full-download deadline and cancel stalled streams", async (t) => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; });
  const setTimer = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
    assert.equal(ms, 120_000);
    return setTimer(callback, 10, ...args);
  });
  for (const attribution of [false, true]) for (const stalledBody of [false, true]) {
    let cancelled = false;
    let signal: AbortSignal | undefined;
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      signal = init.signal;
      return stalledBody ? new Response(new ReadableStream({ cancel() { cancelled = true; } })) : new Promise<Response>(() => {});
    });
    const call = attribution
      ? attributeRecordsWithLLM("test", [{ key: "0.0", problem: "track", value: 2 }], "evidence")
      : processRepoWithLLM({ repo: { owner: "owner", name: "repo", branch: "main" }, pages: [], totalChars: 0, standardDocs: [] });
    await assert.rejects(call, /^Error: LLM (attribution )?request failed$/);
    assert.equal(signal?.aborted, true);
    assert.equal(cancelled, stalledBody);
  }
});

test("LLM HTTP error responses are cancelled without parsing or exposing bodies", async (t) => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; });
  const cancel = t.mock.method(ReadableStream.prototype, "cancel");
  t.mock.method(globalThis, "fetch", async () => new Response("SECRET error body", { status: 503 }));
  await assert.rejects(processRepoWithLLM({ repo: { owner: "owner", name: "repo", branch: "main" }, pages: [], totalChars: 0, standardDocs: [] }), /^Error: LLM request rejected$/);
  await assert.rejects(attributeRecordsWithLLM("test", [{ key: "0.0", problem: "track", value: 2 }], "evidence"), /^Error: LLM attribution request rejected$/);
  assert.equal(cancel.mock.callCount(), 2);
});

test("structured JSON downloads enforce 8 MiB and a 30-second deadline", async (t) => {
  let cancellations = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancellations++; },
  })));
  await assert.rejects(buildLeanEval(), /^Error: LeanEval download failed$/);
  assert.equal(cancellations, 2);
  const setTimer = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
    assert.equal(ms, 30_000);
    return setTimer(callback, 10, ...args);
  });
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancellations++; } })));
  await assert.rejects(buildLeanEval(), /^Error: LeanEval download failed$/);
  // The two independent downloads have separate deadlines.
  await new Promise((resolve) => setTimer(resolve, 20));
  assert.equal(cancellations, 4);
});

test("discovery and structured failure logs are sanitized while progress remains useful", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (...args) => logs.push(args.join(" ")));
  const octokit = getOctokit();
  const fail = async () => { throw new Error("SECRET upstream response"); };
  t.mock.method(octokit.rest.repos, "get", fail);
  t.mock.method(octokit.rest.search, "code", fail);
  t.mock.method(octokit.rest.search, "repos", fail);
  await discoverRepos(1);
  assert.ok(logs.includes("    standard search failed"));
  assert.ok(logs.includes("    seed repository lookup failed"));
  assert.ok(logs.includes("    repository text search failed"));
  assert.ok(logs.includes("    repository topic search failed"));
  assert.ok(logs.includes("  [seeds]"));
  t.mock.method(globalThis, "fetch", async (url) => Response.json(String(url).endsWith("problems.json") ? { problems: [], padding: "x".repeat(2 * 1024 * 1024) } : { entries: [] }));
  const result = await buildLeanEval();
  assert.equal(result.name, "LeanEval");
  assert.ok(logs.includes("    lean-eval: could not list results directory"));
  t.mock.method(octokit.rest.repos, "get", async () => ({ data: { private: false } }));
  t.mock.method(octokit.rest.repos, "getContent", async () => ({ data: [{ name: "SECRET.json", path: "results/SECRET.json", type: "file" }] }));
  t.mock.method(globalThis, "fetch", async (url) => String(url).includes("raw.githubusercontent.com") ? new Response("SECRET invalid JSON") : Response.json(String(url).endsWith("problems.json") ? { problems: [] } : { entries: [] }));
  await buildLeanEval();
  assert.ok(logs.includes("    lean-eval: result file unavailable or invalid, skipping"));
  assert.ok(logs.some((line) => line.includes("models on board")));
  assert.equal(logs.join("\n").includes("SECRET"), false);
});
