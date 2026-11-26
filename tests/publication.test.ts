import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { request } from "node:http";
import { build, containedPath, publicDataset, INDEXNOW_KEY } from "../src/build.js";
import type { Competition } from "../src/types.js";

function competition(id = "Valid_ID-1"): Competition {
  return {
    id, name: "Test", tagline: "Test", description: "Test", url: "https://example.com",
    host: "website", status: "active", tags: [], domain: "test", images: [],
    participation: { requirements: [], compute: "cpu" }, links: [], problems: [], participants: [],
    stats: { totalRecords: 0, uniqueParticipants: 0, recordsLast30d: 0, recordsLast90d: 0 },
    agentStats: [], lastUpdated: "2026-09-18",
  };
}

// The markers the pre-renderer fills, as in site/index.html
const SHELL = `<!DOCTYPE html><html><head><title>Default</title>
<meta name="description" content="Default description">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://openchallengelist.com/">
<meta property="og:url" content="https://openchallengelist.com/">
<meta property="og:title" content="Default">
<meta property="og:description" content="Default description">
<meta property="og:image" content="https://openchallengelist.com/og.jpg">
<meta property="og:image:secure_url" content="https://openchallengelist.com/og.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Default">
<meta name="twitter:title" content="Default">
<meta name="twitter:description" content="Default description">
<meta name="twitter:image" content="https://openchallengelist.com/og.jpg">
<meta name="twitter:image:alt" content="Default">
<link href="/style.css"></head><body><main id="app"></main><script src="/app.js"></script></body></html>`;

function sandbox(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "publication-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, body: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  };
  const dataset = (competitions = [competition()]) => ({
    crawledAt: "2026-09-18T12:00:00Z", competitions,
    errors: [{ repo: "private", error: "SECRET_CRAWLER_ERROR" }], privateMetadata: "SECRET_METADATA",
  });
  put("data/competitions.json", JSON.stringify(dataset()));
  put("site/index.html", SHELL);
  put("site/app.js", "console.log('test')");
  put("site/style.css", "body{}");
  put("site/standard/PROBLEM.md", "# Problem");
  put("site/standard/SUBMISSION.md", "# Submission");
  put("site/favicon-32.png", "image");
  put("site/art/dawn.jpg", "image");
  put("site/.env", "SECRET");
  put("site/.git/config", "SECRET");
  put("site/secrets.json", "SECRET");
  put("site/debug.log", "SECRET");
  put("site/private.key", "SECRET");
  put("site/env.js", "SECRET");
  put("site/art/secret.jpg", "SECRET");
  put("public/keep.txt", "previous build");
  return { root, put, dataset };
}

test("build publishes complete data with only public envelope fields and inventoried assets", async (t) => {
  const { root, put, dataset } = sandbox(t);
  const data = dataset([competition(), competition("second")]);
  put("data/competitions.json", JSON.stringify(data));
  await build(root);
  for (const path of ["competitions.json", "api/competitions.json"]) {
    assert.deepEqual(JSON.parse(readFileSync(join(root, "public", path), "utf8")), publicDataset(data));
  }
  assert.deepEqual(JSON.parse(readFileSync(join(root, "public/api/summary.json"), "utf8")).competitions, data.competitions);
  assert.equal(JSON.parse(readFileSync(join(root, "public/api/competitions/Valid_ID-1.json"), "utf8")).id, "Valid_ID-1");
  assert.match(readFileSync(join(root, "public/join/Valid_ID-1.txt"), "utf8"), /^ENTER TEST\n[\s\S]*Found via https:\/\/openchallengelist\.com\/c\/Valid_ID-1\n/);
  assert.match(readFileSync(join(root, "public/index.html"), "utf8"), /app\.js\?v=[a-f0-9]{10}/);
  assert.ok(existsSync(join(root, "public/art/dawn.jpg")));
  assert.ok(existsSync(join(root, "public/standard/templates.json")));
  for (const path of [".env", ".git", "secrets.json", "debug.log", "private.key", "env.js", "art/secret.jpg", "keep.txt"]) {
    assert.equal(existsSync(join(root, "public", path)), false, path);
  }
});

test("build CLI runs successfully in a temporary sandbox", async (t) => {
  const { root } = sandbox(t);
  const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/build.ts", import.meta.url))], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, SITE_ORIGIN: "https://example.com" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(root, "public/sitemap.xml")));
});

test("unsafe IDs and duplicates fail before any output is changed", async (t) => {
  const { root, put, dataset } = sandbox(t);
  for (const id of ["", ".hidden", "..", "../escape", "/absolute", "a/b", "a\\b", "a%2fb", "a\0b", "a?b", "a#b", "a.b", "CON", "x".repeat(200 + 1)]) {
    put("data/competitions.json", JSON.stringify(dataset([competition(id)])));
    await assert.rejects(build(root), /Unsafe competition ID/, id);
    assert.equal(readFileSync(join(root, "public/keep.txt"), "utf8"), "previous build");
  }
  for (const ids of [["same", "same"], ["Same", "same"]]) {
    put("data/competitions.json", JSON.stringify(dataset(ids.map(competition))));
    await assert.rejects(build(root), /Duplicate competition ID/);
    assert.ok(existsSync(join(root, "public/keep.txt")));
  }
  assert.throws(() => containedPath(join(root, "public"), "../escape"));
  assert.throws(() => containedPath(join(root, "public"), "../public-other/escape"));
});

test("symlinked output and inventoried assets cannot escape the sandbox", async (t) => {
  const { root } = sandbox(t);
  mkdirSync(join(root, "outside"));
  writeFileSync(join(root, "outside/keep.txt"), "private");
  rmSync(join(root, "public"), { recursive: true });
  symlinkSync(join(root, "outside"), join(root, "public"));
  await assert.rejects(build(root), /Unsafe public output/);
  assert.equal(readFileSync(join(root, "outside/keep.txt"), "utf8"), "private");
  rmSync(join(root, "public"));
  symlinkSync(join(root, "outside/keep.txt"), join(root, "site/hero.jpg"));
  await assert.rejects(build(root), /Symlinks/);
  rmSync(join(root, "site/hero.jpg"));
  rmSync(join(root, "site/art"), { recursive: true });
  symlinkSync(join(root, "outside"), join(root, "site/art"));
  await assert.rejects(build(root), /Symlinks/);
  assert.equal(existsSync(join(root, "public")), false);
});

test("sitemap rejects non-origins before deleting output and escapes generated URLs", async (t) => {
  const { root, put, dataset } = sandbox(t);
  const previous = process.env.SITE_ORIGIN;
  t.after(() => { if (previous === undefined) delete process.env.SITE_ORIGIN; else process.env.SITE_ORIGIN = previous; });
  for (const origin of ["not a URL", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?x=1", "https://example.com/#fragment"]) {
    process.env.SITE_ORIGIN = origin;
    await assert.rejects(build(root));
    assert.ok(existsSync(join(root, "public/keep.txt")));
  }
  process.env.SITE_ORIGIN = "https://example.com/";
  const c = competition();
  c.problems = [{ id: "p", name: "P", metricName: "score", metricDirection: "maximize", isOpen: false,
    records: [{ value: 1, agent: { family: "a&<'/b" as any, confidence: "high", role: "author" } }] }];
  put("data/competitions.json", JSON.stringify(dataset([c])));
  await build(root);
  const sitemap = readFileSync(join(root, "public/sitemap.xml"), "utf8");
  assert.ok(sitemap.includes("https://example.com/agents/a%26%3C&apos;%2Fb"));
  assert.ok(!sitemap.includes("example.com//"));
});

test("dev server enforces publication, safe paths, methods, and security headers", async (t) => {
  const { root } = sandbox(t);
  symlinkSync(join(root, "data/competitions.json"), join(root, "site/hero.jpg"));
  const env = { ...process.env, PORT: "0" };
  for (const k of ["HOST", "LIVE_DB_URL", "GITHUB_TOKEN"]) delete env[k];
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/serve.ts", import.meta.url))], { cwd: root, env });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  });
  const port = await new Promise<number>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Server startup timed out")), 10000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited: ${code}: ${output}`)); });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/Site:  http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  const get = (path: string, method = "GET") => new Promise<{ status: number; body: string; headers: any }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
  for (const path of ["/api/competitions", "/api/competitions.json", "/competitions.json"]) {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(JSON.parse(response.body)).sort(), ["competitions", "crawledAt"]);
    assert.ok(!response.body.includes("SECRET"));
  }
  for (const path of ["/../app.js", "/%2e%2e/app.js", "/a/../app.js", "/.env", "/%2egit/config", "/a%2f..%2fapp.js", "/%252eenv", "/%00", "/%FF", "/%", "/app.js?bad=%", "//evil.example/", "http://[bad", "/a%5cb"]) {
    assert.equal((await get(path)).status, 400, path);
  }
  for (const path of ["/secrets.json", "/private.key", "/env.js", "/debug.log", "/art/secret.jpg", "/hero.jpg"]) {
    assert.equal((await get(path)).status, 404, path);
  }
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await get("/", method);
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, "GET, HEAD");
  }
  assert.equal((await get("/api/competitions", "HEAD")).body, "");
  const md = await new Promise<{ status: number; body: string; headers: any }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/c/Valid_ID-1", headers: { accept: "text/markdown, text/html;q=0.9" } }, (res) => {
      let body = ""; res.on("data", (chunk) => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on("error", reject); req.end();
  });
  assert.equal(md.status, 200);
  assert.match(md.headers["content-type"], /^text\/markdown/);
  assert.match(md.body, /^# Test/);
  assert.match((await get("/c/Valid_ID-1")).body, /<main id="app">[\s\S]*<h1>Test<\/h1>/);
  assert.equal((await get("/c/missing")).status, 404);
  // the board's own instructions for agents (src/boardJoin.ts), as the build writes them to public/join/
  const boardJoin = await get("/c/Valid_ID-1/join.txt");
  assert.equal(boardJoin.status, 200);
  assert.match(boardJoin.headers["content-type"], /^text\/plain/);
  assert.match(boardJoin.body, /^ENTER TEST\n/);
  assert.equal((await get("/c/missing/join.txt")).status, 404);
  // README badges, as the build writes them
  const badge = await get("/badge/c/Valid_ID-1.svg");
  assert.equal(badge.status, 200);
  assert.equal(badge.headers["content-type"], "image/svg+xml");
  assert.match(badge.body, /^<svg [^>]*aria-label="open challenge list: listed"/);
  assert.match((await get("/badge/listed.svg")).body, /^<svg [^>]*aria-label="open challenge list: listed"/);
  for (const path of ["/badge/c/missing.svg", "/badge/c/Valid_ID-1.png"]) assert.equal((await get(path)).status, 404, path);
  // /mcp as on Vercel, reading the dev server's own files
  const mcp = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_challenge", arguments: { id: "Valid_ID-1" } } }) });
  assert.equal(mcp.status, 200);
  assert.match((await mcp.json()).result.content[0].text, /^# Test/);
  assert.equal((await get("/mcp")).status, 405);
  // /api/live as on Vercel (api/live.ts): the board from the dev server's own files, check-ins in memory
  const live = await fetch(`http://127.0.0.1:${port}/api/live/Valid_ID-1`);
  assert.equal(live.status, 200);
  assert.equal((await live.json()).id, "Valid_ID-1");
  const checkin = await fetch(`http://127.0.0.1:${port}/api/live/Valid_ID-1/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: "Claude Code" }) });
  assert.equal(checkin.status, 201);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/live`)).json()).challenges[0].agentsNow, 1);
  assert.equal(JSON.parse((await get("/api/live-base.json")).body).challenges[0].id, "Valid_ID-1");
  for (const path of ["/", "/c/Valid_ID-1", "/app.js", "/favicon-32.png", "/api/summary", "/llms.txt", "/join.txt", "/feed.xml", "/api/feed", "/api/index"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.match(response.headers["content-security-policy"], /script-src 'self' https:\/\/www\.googletagmanager\.com;/);
    assert.ok(!response.body.includes("SECRET"));
  }
});

test("every route is a pre-rendered page with its own metadata, and crawled text stays data", async (t) => {
  const { root, put, dataset } = sandbox(t);
  const c = competition("hostile");
  c.name = `</script><script>alert(1)</script>`;
  c.tagline = `<img src=x onerror=alert(1)> $& $1`;
  c.url = "javascript:alert(1)";
  c.links = [{ label: "Rules", url: "javascript:alert(2)" }, { label: "Repo", url: "https://github.com/o/r" }];
  c.stats = { totalRecords: 1, uniqueParticipants: 1, recordsLast30d: 1, recordsLast90d: 1, lastSubmission: "2026-09-17" };
  c.problems = [{ id: "p", name: "Track <b>", metricName: "score", metricDirection: "maximize", baseline: 1, isOpen: false,
    records: [{ value: 2, date: "2026-09-17", contributor: "<i>eve</i>", isCurrentBest: true, agent: { family: "anthropic", tool: "Claude Code", confidence: "high", role: "author" } }] }];
  put("data/competitions.json", JSON.stringify(dataset([competition(), c])));
  await build(root);
  const html = readFileSync(join(root, "public/c/hostile.html"), "utf8");
  assert.match(html, /<title>&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; — Open Challenge List<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/openchallengelist\.com\/c\/hostile">/);
  assert.match(html, /<link rel="alternate" type="text\/markdown" href="\/api\/competitions\/hostile\.md"/);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt; $&amp; $1"), "replacement patterns are not expanded");
  assert.ok(!/<script>alert|<img src=x|href="javascript:/i.test(html));
  assert.ok(html.includes("&lt;i&gt;eve&lt;/i&gt;") && html.includes("Claude Code"));
  // JSON-LD cannot close its own script element
  const ldBlocks = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) ?? [];
  assert.equal(ldBlocks.length, 1);
  assert.ok(!ldBlocks[0].slice(35, -9).includes("<"));
  assert.equal(JSON.parse(ldBlocks[0].slice(35, -9)).name, c.name);
  assert.equal((html.match(/<meta name="robots"/g) ?? []).length, 1);
  const home = readFileSync(join(root, "public/index.html"), "utf8");
  assert.match(home, /app\.js\?v=[a-f0-9]{10}/);
  assert.ok(home.includes('href="/c/hostile"') && home.includes("join.txt"));
  for (const file of ["agents.html", "agents/anthropic.html", "people.html", "standard.html", "submit.html"]) assert.ok(existsSync(join(root, "public", file)), file);
  put("data/social.json", JSON.stringify({ posts: [{ url: "https://x.com/eve/status/1", author: "eve", date: "2026-09-17", text: "<script>alert(1)</script> record!", competition: "hostile" }] }));
  await build(root);
  const withSocial = readFileSync(join(root, "public/index.html"), "utf8");
  assert.ok(withSocial.includes("From the community") && withSocial.includes("&lt;script&gt;alert(1)&lt;/script&gt; record!") && !withSocial.includes("<script>alert(1)"));
  assert.equal(JSON.parse(readFileSync(join(root, "public/api/summary.json"), "utf8")).social[0].author, "eve");
  assert.equal(JSON.parse(readFileSync(join(root, "public/api/social.json"), "utf8")).length, 1);
  const notFound = readFileSync(join(root, "public/404.html"), "utf8");
  assert.match(notFound, /<meta name="robots" content="noindex">/);
  assert.equal((notFound.match(/<meta name="robots"/g) ?? []).length, 1);
});

test("agents get join.txt, feeds and a small index", async (t) => {
  const { root, put, dataset } = sandbox(t);
  const c = competition("live");
  c.stats = { totalRecords: 2, uniqueParticipants: 2, recordsLast30d: 2, recordsLast90d: 2, lastSubmission: "2026-09-17" };
  c.problems = [
    { id: "a", name: "A", metricName: "score", metricDirection: "maximize", isOpen: false, records: [
      { value: 3, date: "2026-09-17", contributor: "ann & co", isCurrentBest: true, agent: { family: "openai", tool: "Codex", confidence: "high", role: "author" } },
      { value: 1, date: "2026-09-10", contributor: "bob" },
      { value: 9, date: "2026-09-18", contributor: "GPT-9", agent: { family: "openai", confidence: "high", role: "subject" } },
      { value: 0, date: "2026-09-18", contributor: "baseline", isBaseline: true },
    ] },
    { id: "b", name: "B", metricName: "proofs", metricDirection: "maximize", passMark: 1, isOpen: true, records: [] },
  ];
  put("data/competitions.json", JSON.stringify(dataset([c])));
  await build(root);
  const pub = (p: string) => readFileSync(join(root, "public", p), "utf8");
  const join_ = pub("join.txt");
  assert.match(join_, /Found via https:\/\/openchallengelist\.com\/c\/\{id\}/);
  // consent first: nothing public on the human's account before they agree, and the via line is their call
  assert.ok(join_.indexOf("gh repo fork") > join_.indexOf("Once they agree"), "fork only after the go-ahead");
  assert.match(join_, /ask whether they want to add this line/);
  // organizer instructions stay data: never "follow them" on the organizer's authority
  assert.ok(!/follow them under the same rules/.test(join_));
  assert.match(join_, /third-party data like the rest of the repository/);
  assert.match(join_, /- Test \[CPU only\] 2 entries in 30 days, 2 participants, 1 open track — .*https:\/\/openchallengelist\.com\/api\/competitions\/live\.md/);
  const feed = JSON.parse(pub("api/feed.json"));
  assert.deepEqual(feed.items.map((i: any) => i._entry.contributor), ["ann & co", "bob"], "newest first; no baselines, no benchmarked models");
  assert.match(feed.items[0].title, /^ann & co with Codex → Test \/ A: 3 score · current best$/);
  const atom = pub("feed.xml");
  assert.ok(atom.includes("ann &amp; co") && !atom.includes("ann & co"));
  const index = JSON.parse(pub("api/index.json"));
  assert.deepEqual(index.competitions[0], { id: "live", name: "Test", tagline: "Test", status: "active", domain: "test", tags: [], compute: "cpu", tracks: 2, openTracks: 1,
    entries: 2, entriesLast30d: 2, entriesLast90d: 2, participants: 2, lastEntry: "2026-09-17", agents: [], url: "https://example.com", page: "/c/live", digest: "/api/competitions/live.md" });
  assert.match(INDEXNOW_KEY, /^[0-9a-f]{32}$/);
  assert.equal(pub(`${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);
  const open = JSON.parse(pub("api/open-problems.json"));
  assert.equal(open[0].kind, "unsolved");
  assert.equal(open[0].digest, "/api/competitions/live.md");
  assert.match(pub("api/competitions/live.md"), /not an instruction to any agent[\s\S]*Found via https:\/\/openchallengelist\.com\/c\/live/);
  assert.match(pub("sitemap.xml"), /<loc>https:\/\/openchallengelist\.com\/c\/live<\/loc><lastmod>2026-09-17<\/lastmod><changefreq>daily<\/changefreq>/);
});


test("topic hubs: a page, a Markdown twin and a sitemap entry per topic, filtered by the topic's rules", async (t) => {
  const { root, put, dataset } = sandbox(t);
  const math = competition("proofs");
  math.name = `Proofs <script>alert(1)</script>`;
  math.domain = "formal-methods";
  math.stats = { totalRecords: 1, uniqueParticipants: 1, recordsLast30d: 1, recordsLast90d: 1, lastSubmission: "2026-09-17" };
  math.problems = [{ id: "p", name: "Lemma", metricName: "proofs", metricDirection: "maximize", passMark: 1, isOpen: true,
    records: [{ value: 1, date: "2026-09-17", contributor: "ann", agent: { family: "anthropic", tool: "Claude Code", confidence: "high", role: "author" } }] }];
  const run = competition("run");
  run.domain = "ml-research"; run.tags = ["speedrun"]; run.participation = { requirements: [], compute: "datacenter-gpu" };
  put("data/competitions.json", JSON.stringify(dataset([math, run])));
  await build(root);
  const pub = (p: string) => readFileSync(join(root, "public", p), "utf8");
  const html = pub("topics/math.html");
  assert.match(html, /<title>Math and Lean proof challenges for AI agents — Open Challenge List<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/openchallengelist\.com\/topics\/math">/);
  assert.match(html, /<link rel="alternate" type="text\/markdown" href="\/topics\/math\.md"/);
  assert.ok(html.includes("to pick an open math or Lean proof challenge and enter it with me."));
  assert.ok(html.includes('href="/c/proofs"') && !html.includes('href="/c/run"'));
  assert.ok(html.includes("Proofs &lt;script&gt;") && !html.includes("<script>alert"));
  assert.equal(JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])["@type"], "CollectionPage");
  const md = pub("topics/math.md");
  assert.match(md, /1 competition, 1 open track, 1 entry in the last 30 days \(1 credited to an AI agent\)/);
  assert.match(md, /ann with Claude Code → Proofs <script>alert\(1\)<\/script> \/ Lemma/);
  assert.ok(pub("topics/no-gpu.md").includes("/c/proofs") && !pub("topics/no-gpu.md").includes("/c/run"), "no-gpu leaves out datacenter-GPU boards");
  assert.ok(pub("topics/speedruns.md").includes("/c/run") && !pub("topics/speedruns.md").includes("/c/proofs"));
  assert.match(pub("sitemap.xml"), /<loc>https:\/\/openchallengelist\.com\/topics\/math<\/loc>/);
  assert.deepEqual(JSON.parse(pub("api/summary.json")).topics.map((x: { slug: string }) => x.slug), ["math", "no-gpu", "speedruns", "gpu-kernels"]);
  assert.match(pub("llms.txt"), /By topic: https:\/\/openchallengelist\.com\/topics\/math\.md/);
  assert.ok(pub("index.html").includes('href="/topics/math"'));
});

test("fresh discoveries: /api/discoveries.json, in the summary, on the home and math pages; not in the feeds or join.txt", async (t) => {
  const { root, put, dataset } = sandbox(t);
  const math = competition("proofs");
  math.domain = "formal-methods";
  put("data/competitions.json", JSON.stringify(dataset([math])));
  await build(root);
  const pub = (p: string) => readFileSync(join(root, "public", p), "utf8");
  assert.deepEqual(JSON.parse(pub("api/discoveries.json")).items, [], "before the first refresh: an empty list");
  assert.ok(!pub("index.html").includes("Fresh discoveries"));
  const item = { source: "palomar", id: "PALOMAR-2026-09-18-000001", version: 2, title: "Lemma <b>bold</b>", authors: ["Ann"], date: "2026-09-18", at: "2026-09-18T09:00:00Z",
    url: "javascript:alert(1)", repo: "ann/lemma", subjects: ["math.NT"], abstract: "not published" };
  put("data/discoveries.json", JSON.stringify({ fetchedAt: "2026-09-18T12:00:00Z", totals: { results: 5, projects: 4 }, days: { "2026-09-18": 1 }, items: [item] }));
  await build(root);
  const api = JSON.parse(pub("api/discoveries.json"));
  assert.equal(api.items[0].url, "https://palomar-registry.org/entry?id=PALOMAR-2026-09-18-000001&version=2");
  assert.equal(api.items[0].abstract, undefined);
  assert.deepEqual(JSON.parse(pub("api/summary.json")).discoveries, api);
  for (const page of ["index.html", "topics/math.html"]) {
    const html = pub(page);
    assert.ok(html.includes("1 Lean-verified result registered in the last 7 days, 1 today.") && html.includes("Lemma &lt;b&gt;bold&lt;/b&gt;"), page);
    assert.ok(html.includes('href="https://palomar-registry.org/entry?id=PALOMAR-2026-09-18-000001&amp;version=2"') && !html.includes("javascript:"), page);
  }
  assert.ok(!pub("topics/no-gpu.html").includes("Fresh discoveries"));
  assert.match(pub("topics/math.md"), /## Fresh discoveries[\s\S]*- 2026-09-18 · \[Lemma <b>bold<\/b>\]\(https:\/\/palomar-registry\.org\/entry\?id=PALOMAR-2026-09-18-000001&version=2\) — Ann/);
  assert.match(pub("llms.txt"), /GET \/api\/discoveries\.json/);
  for (const p of ["api/feed.json", "feed.xml", "join.txt"]) assert.ok(!/palomar/i.test(pub(p)), p);
});
