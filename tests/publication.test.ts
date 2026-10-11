import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { request } from "node:http";
import { build, containedPath, publicDataset } from "../src/build.js";
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
  put("site/index.html", '<link href="/style.css"><script src="/app.js"></script>');
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

test("build publishes complete data with only public envelope fields and inventoried assets", (t) => {
  const { root, put, dataset } = sandbox(t);
  const data = dataset([competition(), competition("second")]);
  put("data/competitions.json", JSON.stringify(data));
  build(root);
  for (const path of ["competitions.json", "api/competitions.json"]) {
    assert.deepEqual(JSON.parse(readFileSync(join(root, "public", path), "utf8")), publicDataset(data));
  }
  assert.deepEqual(JSON.parse(readFileSync(join(root, "public/api/summary.json"), "utf8")).competitions, data.competitions);
  assert.equal(JSON.parse(readFileSync(join(root, "public/api/competitions/Valid_ID-1.json"), "utf8")).id, "Valid_ID-1");
  assert.match(readFileSync(join(root, "public/index.html"), "utf8"), /app\.js\?v=[a-f0-9]{10}/);
  assert.ok(existsSync(join(root, "public/art/dawn.jpg")));
  assert.ok(existsSync(join(root, "public/standard/templates.json")));
  for (const path of [".env", ".git", "secrets.json", "debug.log", "private.key", "env.js", "art/secret.jpg", "keep.txt"]) {
    assert.equal(existsSync(join(root, "public", path)), false, path);
  }
});

test("build CLI runs successfully in a temporary sandbox", (t) => {
  const { root } = sandbox(t);
  const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/build.ts", import.meta.url))], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, SITE_ORIGIN: "https://example.com" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(root, "public/sitemap.xml")));
});

test("unsafe IDs and duplicates fail before any output is changed", (t) => {
  const { root, put, dataset } = sandbox(t);
  for (const id of ["", ".hidden", "..", "../escape", "/absolute", "a/b", "a\\b", "a%2fb", "a\0b", "a?b", "a#b", "a.b", "CON", "x".repeat(200 + 1)]) {
    put("data/competitions.json", JSON.stringify(dataset([competition(id)])));
    assert.throws(() => build(root), /Unsafe competition ID/, id);
    assert.equal(readFileSync(join(root, "public/keep.txt"), "utf8"), "previous build");
  }
  for (const ids of [["same", "same"], ["Same", "same"]]) {
    put("data/competitions.json", JSON.stringify(dataset(ids.map(competition))));
    assert.throws(() => build(root), /Duplicate competition ID/);
    assert.ok(existsSync(join(root, "public/keep.txt")));
  }
  assert.throws(() => containedPath(join(root, "public"), "../escape"));
  assert.throws(() => containedPath(join(root, "public"), "../public-other/escape"));
});

test("symlinked output and inventoried assets cannot escape the sandbox", (t) => {
  const { root } = sandbox(t);
  mkdirSync(join(root, "outside"));
  writeFileSync(join(root, "outside/keep.txt"), "private");
  rmSync(join(root, "public"), { recursive: true });
  symlinkSync(join(root, "outside"), join(root, "public"));
  assert.throws(() => build(root), /Unsafe public output/);
  assert.equal(readFileSync(join(root, "outside/keep.txt"), "utf8"), "private");
  rmSync(join(root, "public"));
  symlinkSync(join(root, "outside/keep.txt"), join(root, "site/hero.jpg"));
  assert.throws(() => build(root), /Symlinks/);
  rmSync(join(root, "site/hero.jpg"));
  rmSync(join(root, "site/art"), { recursive: true });
  symlinkSync(join(root, "outside"), join(root, "site/art"));
  assert.throws(() => build(root), /Symlinks/);
  assert.equal(existsSync(join(root, "public")), false);
});

test("sitemap rejects non-origins before deleting output and escapes generated URLs", (t) => {
  const { root, put, dataset } = sandbox(t);
  const previous = process.env.SITE_ORIGIN;
  t.after(() => { if (previous === undefined) delete process.env.SITE_ORIGIN; else process.env.SITE_ORIGIN = previous; });
  for (const origin of ["not a URL", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?x=1", "https://example.com/#fragment"]) {
    process.env.SITE_ORIGIN = origin;
    assert.throws(() => build(root));
    assert.ok(existsSync(join(root, "public/keep.txt")));
  }
  process.env.SITE_ORIGIN = "https://example.com/";
  const c = competition();
  c.problems = [{ id: "p", name: "P", metricName: "score", metricDirection: "maximize", isOpen: false,
    records: [{ value: 1, agent: { family: "a&<'/b" as any, confidence: "high", role: "author" } }] }];
  put("data/competitions.json", JSON.stringify(dataset([c])));
  build(root);
  const sitemap = readFileSync(join(root, "public/sitemap.xml"), "utf8");
  assert.ok(sitemap.includes("https://example.com/agents/a%26%3C&apos;%2Fb"));
  assert.ok(!sitemap.includes("example.com//"));
});

test("dev server enforces publication, safe paths, methods, and security headers", async (t) => {
  const { root } = sandbox(t);
  symlinkSync(join(root, "data/competitions.json"), join(root, "site/hero.jpg"));
  const env = { ...process.env, PORT: "0" };
  delete env.HOST;
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
  for (const path of ["/", "/c/Valid_ID-1", "/app.js", "/favicon-32.png", "/api/summary", "/llms.txt"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.match(response.headers["content-security-policy"], /script-src 'self' https:\/\/www\.googletagmanager\.com;/);
    assert.ok(!response.body.includes("SECRET"));
  }
});
