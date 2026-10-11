import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { boundedFetch, fetchFile, fetchRaw, getOctokit, getRepoInfo, isPublicRepo, listDir } from "../src/github.js";
import { fetchRepoPages, parseIngestedDoc } from "../src/fetcher.js";
import { discoverRepos, discoverStandardRepos } from "../src/discovery.js";

test("public checks fail closed, including internal visibility", () => {
  assert.equal(isPublicRepo({ private: false }), true);
  assert.equal(isPublicRepo({ private: false, visibility: "public" }), true);
  for (const metadata of [{}, { private: true }, { private: false, visibility: "internal" }, { private: false, visibility: "private" }]) {
    assert.equal(isPublicRepo(metadata), false);
  }
});

test("download limits reject advertised and streamed oversize bodies", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(boundedFetch("https://example.test", undefined, 10), /byte limit/);
  assert.equal(cancelled, true);
  t.mock.method(globalThis, "fetch", async () => new Response("small", { headers: { "content-length": "100" } }));
  await assert.rejects(boundedFetch("https://example.test", undefined, 10), /byte limit/);
});

test("download deadline covers headers and stalled bodies", async (t) => {
  t.mock.method(globalThis, "fetch", () => new Promise(() => {}));
  await assert.rejects(boundedFetch("https://example.test", undefined, 10, 20), /timed out/);
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await assert.rejects(boundedFetch("https://example.test", undefined, 10, 20), /timed out/);
  assert.equal(cancelled, true);
});

test("raw downloads stay unauthenticated and preserve text", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(new Headers(init.headers).has("authorization"), false);
    assert.equal(init.redirect, "manual");
    return new Response("# Results\nUnicode: \u00e9");
  });
  assert.equal(await fetchRaw("owner", "repo", "README.md"), "# Results\nUnicode: \u00e9");
});

test("authenticated downloads follow at most three same-origin HTTPS redirects", async (t) => {
  const urls: string[] = [];
  let cancelled = 0;
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.redirect, "manual");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-token");
    if (signal) assert.equal(init.signal, signal);
    signal = init.signal;
    assert.equal(cancelled, urls.length);
    urls.push(String(url));
    if (urls.length === 4) return new Response("ok");
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), {
      status: [301, 302, 307][urls.length - 1],
      headers: { location: urls.length === 2 ? "https://api.github.com/repos/new/repo" : `/repositories/${urls.length}` },
    });
  });
  const result = await boundedFetch("https://api.github.com/repos/old/repo", { headers: { Authorization: "Bearer test-token" } });
  assert.equal(await result.text(), "ok");
  assert.equal(urls.length, 4);
  assert.equal(cancelled, 3);
  assert.ok(urls.every((url) => new URL(url).origin === "https://api.github.com"));
});

test("unsafe redirects are cancelled and never receive credentials", async (t) => {
  for (const location of ["https://elsewhere.test/private", "//elsewhere.test/private", "http://api.github.com/private", "https://api.github.com:444/private", "https://user:password@api.github.com/private", "http://[", ""]) {
    let cancelled = false;
    const calls = t.mock.method(globalThis, "fetch", async (_url, init) => {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-token");
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 308, headers: { location } });
    });
    await assert.rejects(boundedFetch("https://api.github.com/repos/old/repo", { headers: { Authorization: "Bearer test-token" } }), /redirect is not allowed/);
    assert.equal(calls.mock.callCount(), 1);
    assert.equal(cancelled, true);
  }
  const calls = t.mock.method(globalThis, "fetch", async () => new Response("unexpected"));
  await assert.rejects(boundedFetch("https://elsewhere.test", { headers: { Authorization: "Bearer test-token" } }), /origin is not allowed/);
  assert.equal(calls.mock.callCount(), 0);
});

test("raw redirects stay on the original origin and remain unauthenticated", async (t) => {
  let calls = 0;
  let cancelled = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(new URL(String(url)).origin, "https://raw.githubusercontent.com");
    assert.equal(new Headers(init.headers).has("authorization"), false);
    assert.equal(cancelled, calls);
    if (++calls === 2) return new Response("renamed README");
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 303, headers: { location: "/new/repo/main/README.md" } });
  });
  assert.equal(await fetchRaw("old", "repo", "README.md"), "renamed README");
  const rejected = t.mock.method(globalThis, "fetch", async () => new Response("", { status: 301, headers: { location: "https://api.github.com/repos/new/repo" } }));
  await assert.rejects(fetchRaw("old", "repo", "README.md"), /redirect is not allowed/);
  assert.equal(rejected.mock.callCount(), 1);
});

test("redirect loops stop after three hops and cancel the final redirect body", async (t) => {
  let cancelled = 0;
  const calls = t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), {
    status: 302, headers: { location: "/loop" },
  }));
  await assert.rejects(boundedFetch("https://api.github.com/loop"), /redirect limit exceeded/);
  assert.equal(calls.mock.callCount(), 4);
  assert.equal(cancelled, 4);
});

test("redirects and body cancellation share the overall deadline", async (t) => {
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    signals.push(init.signal);
    if (signals.length === 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response("", { status: 301, headers: { location: "/renamed" } });
    }
    return new Response(new ReadableStream());
  });
  await assert.rejects(boundedFetch("https://api.github.com/old", undefined, 10, 40), /timed out/);
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
  assert.equal(signals[0].aborted, true);
  const calls = t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { return new Promise(() => {}); } }), {
    status: 301, headers: { location: "/renamed" },
  }));
  await assert.rejects(boundedFetch("https://api.github.com/old", undefined, 10, 20), /timed out/);
  assert.equal(calls.mock.callCount(), 1);
});

test("Octokit diagnostics do not expose provider messages, paths, IDs, or tokens", async (t) => {
  const logs: unknown[][] = [];
  for (const method of ["debug", "info", "warn", "error"] as const) t.mock.method(console, method, (...args) => { logs.push(args); });
  const octokit = getOctokit();
  for (const method of ["debug", "info", "warn", "error"] as const) octokit.log[method]("sensitive-provider-message /private/path request-id test-token");
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ message: "sensitive-provider-message" }), {
    status: 404, headers: { "content-type": "application/json", "x-github-request-id": "sensitive-request-id" },
  }));
  await assert.rejects(getRepoInfo("private-owner", "private-path"));
  assert.ok(logs.length > 0);
  assert.ok(logs.every((args) => args.length === 1 && ["GitHub API warning", "GitHub API request failed"].includes(String(args[0]))));
});

test("private repositories cannot reach content, evidence, or cache reads", async (t) => {
  const octokit = getOctokit();
  t.mock.method(octokit.rest.repos, "get", async () => ({ data: { private: true } }));
  const content = t.mock.method(octokit.rest.repos, "getContent", async () => { throw new Error("unexpected content request"); });
  const paginate = t.mock.method(octokit, "paginate", async () => { throw new Error("unexpected evidence request"); });
  const raw = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected download"); });
  await assert.rejects(fetchFile("owner", "private", "README.md"), /must be public/);
  await assert.rejects(listDir("owner", "private", ""), /must be public/);
  await assert.rejects(fetchRepoPages("owner", "private", "main"), /must be public/);
  assert.equal(content.mock.callCount(), 0);
  assert.equal(paginate.mock.callCount(), 0);
  assert.equal(raw.mock.callCount(), 0);
});

test("Octokit uses bounded transport before decoding JSON", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    private: false, visibility: "public", stargazers_count: 5, html_url: "https://github.com/owner/repo",
  }), { headers: { "content-type": "application/json" } }));
  assert.equal((await getRepoInfo("owner", "repo")).stars, 5);
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { headers: { "content-length": String(9 * 1024 * 1024) } }));
  await assert.rejects(getRepoInfo("owner", "repo"), /byte limit/);
});

test("public file and directory callers keep their existing return shapes", async (t) => {
  const octokit = getOctokit();
  t.mock.method(octokit.rest.repos, "get", async () => ({ data: { private: false } }));
  t.mock.method(octokit.rest.repos, "getContent", async () => ({ data: { type: "file", size: 5, content: "aGVsbG8=\n" } }));
  assert.equal(await fetchFile("owner", "repo", "README.md"), "hello");
  t.mock.method(octokit.rest.repos, "getContent", async () => ({ data: [{ name: "README.md", path: "README.md", type: "file" }] }));
  assert.deepEqual(await listDir("owner", "repo", ""), [{ name: "README.md", path: "README.md", type: "file" }]);
});

test("visibility is rechecked before attribution after fetching pages", async (t) => {
  const octokit = getOctokit();
  let checks = 0;
  t.mock.method(octokit.rest.repos, "get", async () => ({ data: { private: ++checks >= 3 } }));
  t.mock.method(octokit.rest.repos, "getContent", async () => ({ data: [] }));
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  const paginate = t.mock.method(octokit, "paginate", async () => { throw new Error("unexpected evidence request"); });
  await assert.rejects(fetchRepoPages("ingestion-security-test", "repo", "main"), /must be public/);
  assert.equal(checks, 3);
  assert.equal(paginate.mock.callCount(), 0);
});

test("discovery rejects private seeds, search results, and stale public code results", async (t) => {
  const octokit = getOctokit();
  const repo = { private: true, full_name: "owner/private", owner: { login: "owner" }, name: "private" };
  t.mock.method(octokit.rest.repos, "get", async () => ({ data: repo }));
  t.mock.method(octokit.rest.search, "repos", async () => ({ data: { items: [repo] } }));
  t.mock.method(octokit.rest.search, "code", async () => ({ data: { items: [{ path: "PROBLEM.md", repository: { ...repo, private: false } }] } }));
  const download = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected download"); });
  t.mock.method(console, "log", () => {});
  assert.deepEqual(await discoverStandardRepos(), []);
  assert.deepEqual(await discoverRepos(), []);
  assert.equal(download.mock.callCount(), 0);
});

test("standard document limits run before YAML parsing without truncation", () => {
  const valid = "---\nspec: problem.md/v1\nname: Example\n---\nDescription";
  assert.equal(parseIngestedDoc("PROBLEM.md", valid).meta.name, "Example");
  assert.throws(() => parseIngestedDoc("PROBLEM.md", "x".repeat(65537)), /byte limit/);
  assert.throws(() => parseIngestedDoc("PROBLEM.md", `---\nname: ${"x".repeat(16384)}\n---\n`), /parser limits/);
  assert.throws(() => parseIngestedDoc("PROBLEM.md", `---\nname: ${"x".repeat(16384)}\n---body`), /parser limits/);
  assert.throws(() => parseIngestedDoc("PROBLEM.md", `---\n${"# comment\n".repeat(501)}---\n`), /parser limits/);
  assert.ok(parseIngestedDoc("PROBLEM.md", "---\na: &a [1]\nb: *a\n---\n").errors.length);
});

test("submission ingestion accepts public metadata only and bounds responses", () => {
  const script = fileURLToPath(new URL("../scripts/ingest-submission.mjs", import.meta.url));
  const publicMeta = { private: false, visibility: "public", owner: { login: "owner" }, name: "repo" };
  for (const [metadata, expected] of [
    [publicMeta, "queued"],
    [{ ...publicMeta, private: true }, "rejected"],
    [{ ...publicMeta, visibility: "internal" }, "rejected"],
    [{ owner: publicMeta.owner, name: "repo" }, "rejected"],
    [{ ...publicMeta, padding: "x".repeat(1024 * 1024) }, "rejected"],
  ] as const) {
    const cwd = mkdtempSync(join(tmpdir(), "ingestion-test-"));
    try {
      mkdirSync(join(cwd, "data"));
      writeFileSync(join(cwd, "data/seeds.json"), "[]");
      writeFileSync(join(cwd, "metadata.json"), JSON.stringify(metadata));
      const preload = `import { readFileSync } from 'node:fs'; globalThis.fetch = async (_url, init) => { if (!init.signal || init.redirect !== 'manual') throw Error('missing limits'); return new Response(readFileSync('metadata.json')); };`;
      const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, script], {
        cwd, encoding: "utf8", timeout: 10000,
        env: { PATH: process.env.PATH, ISSUE_BODY: "### Repository\nhttps://github.com/owner/repo", GITHUB_TOKEN: "test-token" },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`status: ${expected}`));
      assert.equal(JSON.parse(readFileSync(join(cwd, "data/seeds.json"), "utf8")).length, expected === "queued" ? 1 : 0);
      assert.equal(result.stdout.includes("test-token"), false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test("submission redirects stay on the API origin, cancel bodies, and sanitize failures", () => {
  const script = fileURLToPath(new URL("../scripts/ingest-submission.mjs", import.meta.url));
  for (const scenario of ["allowed", "cross-origin", "downgrade", "loop", "provider-error", "network-error", "cancel-timeout"]) {
    const cwd = mkdtempSync(join(tmpdir(), "ingestion-redirect-test-"));
    try {
      mkdirSync(join(cwd, "data"));
      writeFileSync(join(cwd, "data/seeds.json"), "[]");
      const preload = `
        import { writeFileSync } from 'node:fs';
        const scenario = ${JSON.stringify(scenario)};
        const calls = []; let cancelled = 0; let signal;
        if (scenario === 'cancel-timeout') {
          const schedule = globalThis.setTimeout;
          globalThis.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 15000 ? 20 : delay, ...args);
        }
        process.on('exit', () => writeFileSync('trace.json', JSON.stringify({ calls, cancelled })));
        globalThis.fetch = async (url, init) => {
          calls.push({ origin: new URL(url).origin, token: init.headers.Authorization === 'Bearer test-token', manual: init.redirect === 'manual', sharedSignal: !signal || signal === init.signal, cancelled });
          signal = init.signal;
          if (scenario === 'network-error') throw Error('sensitive-provider-message test-token');
          if (scenario === 'provider-error') return new Response('sensitive-provider-message test-token', { status: 500 });
          if (scenario === 'allowed' && calls.length === 4) return new Response(JSON.stringify({ private: false, visibility: 'public', owner: { login: 'new-owner' }, name: 'renamed' }));
          const location = scenario === 'cross-origin' ? 'https://elsewhere.test/private' : scenario === 'downgrade' ? 'http://api.github.com/private' : '/repositories/123';
          return new Response(new ReadableStream({ cancel() { cancelled++; if (scenario === 'cancel-timeout') return new Promise(() => {}); } }), { status: 301, headers: { location } });
        };
      `;
      const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, script], {
        cwd, encoding: "utf8", timeout: 10000,
        env: { PATH: process.env.PATH, ISSUE_BODY: "### Repository\nhttps://github.com/old-owner/old-name", GITHUB_TOKEN: "test-token" },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`status: ${scenario === "allowed" ? "queued" : "rejected"}`));
      assert.doesNotMatch(result.stdout + result.stderr, /sensitive-provider-message|test-token|elsewhere/);
      const trace = JSON.parse(readFileSync(join(cwd, "trace.json"), "utf8"));
      assert.equal(trace.calls.length, ["allowed", "loop"].includes(scenario) ? 4 : 1);
      for (const [i, call] of trace.calls.entries()) {
        assert.equal(call.origin, "https://api.github.com");
        assert.equal(call.token, true);
        assert.equal(call.manual, true);
        assert.equal(call.sharedSignal, true);
        assert.equal(call.cancelled, i);
      }
      assert.equal(trace.cancelled, scenario === "allowed" ? 3 : scenario === "loop" ? 4 : ["cross-origin", "downgrade", "cancel-timeout"].includes(scenario) ? 1 : 0);
      const seeds = JSON.parse(readFileSync(join(cwd, "data/seeds.json"), "utf8"));
      assert.equal(seeds.length, scenario === "allowed" ? 1 : 0);
      if (seeds.length) assert.equal(seeds[0].name, "renamed");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});
