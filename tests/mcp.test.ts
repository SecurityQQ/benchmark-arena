import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { competitionIndex } from "../src/aggregate.js";
import { INTERNAL_UA } from "../src/agentTraffic.js";
import { SITE, challengeJoinLine, competitionToMarkdown, feedJson, joinTxt, llmsTxt } from "../src/render.js";
import { INSTRUCTIONS, MAX_BODY, MCP_VERSION, PROTOCOL_VERSIONS, createMcpHandler, schemaErrors, toolList, type McpOptions } from "../src/mcp.js";
import type { Competition, CompetitionStatus, ComputeTier, Problem, RecordEntry } from "../src/types.js";

type CompOpts = Partial<{ name: string; tags: string[]; domain: string; compute: ComputeTier; status: CompetitionStatus; d30: number; d90: number; open: number; records: RecordEntry[] }>;
function comp(id: string, o: CompOpts = {}): Competition {
  const records = o.records ?? [];
  const problems: Problem[] = [
    { id: "main", name: "Main", metricName: "score", metricDirection: "maximize", baseline: 1, isOpen: false, records },
    ...Array.from({ length: o.open ?? 0 }, (_, i): Problem => ({ id: `open-${i}`, name: `Open ${i}`, metricName: "score", metricDirection: "maximize", baseline: 1, isOpen: true, records: [] })),
  ];
  return {
    id, name: o.name ?? id, tagline: `Tagline of ${id}`, description: "Description", url: `https://github.com/o/${id}`,
    host: "github", status: o.status ?? "active", tags: o.tags ?? [], domain: o.domain ?? "llm-eval", images: [],
    participation: { requirements: [], compute: o.compute ?? "cpu", howToSubmit: "Open a pull request" }, links: [], problems, participants: [],
    stats: { totalRecords: records.length, uniqueParticipants: records.length, recordsLast30d: o.d30 ?? 0, recordsLast90d: o.d90 ?? o.d30 ?? 0, lastSubmission: records[0]?.date },
    agentStats: [], lastUpdated: "2026-11-25",
  };
}

const COMPS = [
  comp("quiet", { compute: "none", tags: ["agents"] }),
  comp("lean-open", { name: "Lean Proofs", domain: "formal-methods", tags: ["lean", "proofs"], open: 1, d90: 3, records: [{ value: 0, date: "2026-11-01", contributor: "eve" }] }),
  comp("busy-gpu", { name: "NanoGPT Speedrun", compute: "datacenter-gpu", domain: "ml-research", tags: ["speedrun"], d30: 12, d90: 20, records: [
    { value: 3.28, date: "2026-11-24", contributor: "ann", isCurrentBest: true, agent: { family: "anthropic", tool: "Claude Code", confidence: "high", role: "author" }, submissionUrls: ["https://github.com/o/busy-gpu/pull/1"] }] }),
  comp("kernels", { name: "Kernel Golf", compute: "consumer-gpu", domain: "chip-design", tags: ["gpu kernels", "cuda"], open: 2, d30: 2, d90: 5, records: [{ value: 10, date: "2026-11-20", contributor: "bob" }] }),
  comp("mystery", { compute: "unknown", open: 1, d30: 1 }),
  comp("done", { name: "Lean Ended", status: "ended", domain: "formal-methods", tags: ["lean"], d30: 5 }),
  comp("Mixed_Case-1", { name: "Mixed Case", domain: "coding-agents" }),
];
const DATA = { crawledAt: "2026-11-25T07:00:00Z", competitions: COMPS };
const ORIGIN = "https://data.test";
const FILES = new Map<string, string>([
  ["/api/index.json", JSON.stringify({ crawledAt: DATA.crawledAt, competitions: competitionIndex(COMPS) })],
  ["/api/feed.json", JSON.stringify(feedJson(DATA))],
  ["/join.txt", joinTxt(DATA)],
  ...COMPS.map((c): [string, string] => [`/api/competitions/${c.id}.md`, competitionToMarkdown(c)]),
]);

// The site's static files behind an injected fetch: no network, and every request is recorded
function site(opts: McpOptions = {}, files = FILES) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let down = false;
  const handle = createMcpHandler({
    origin: ORIGIN, ...opts,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (down) throw new Error("fetch failed");
      const body = url.startsWith(ORIGIN) ? files.get(url.slice(ORIGIN.length)) : undefined;
      return body === undefined ? new Response("Not found", { status: 404 }) : new Response(body);
    },
  });
  return { handle, calls, setDown: (v: boolean) => { down = v; } };
}

const post = (handle: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = {}) =>
  handle(new Request("https://openchallengelist.com/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
let nextId = 0;
async function rpc(handle: (r: Request) => Promise<Response>, method: string, params?: unknown, headers?: Record<string, string>) {
  const id = ++nextId;
  const res = await post(handle, { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }, headers);
  assert.equal(res.status, 200, method);
  assert.match(res.headers.get("content-type")!, /^application\/json/);
  const body = await res.json();
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, id);
  return body;
}
async function call(handle: (r: Request) => Promise<Response>, name: string, args?: unknown) {
  const { result, error } = await rpc(handle, "tools/call", { name, ...(args === undefined ? {} : { arguments: args }) });
  assert.equal(error, undefined);
  return result as { content: { type: string; text: string }[]; structuredContent?: any; isError?: boolean };
}
const outputSchema = (name: string) => toolList().find((t) => t.name === name)!.outputSchema!;

test("initialize echoes a supported protocol version, falls back to the newest, and says results are third-party data", async () => {
  const { handle, calls } = site();
  for (const version of PROTOCOL_VERSIONS) {
    const { result } = await rpc(handle, "initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "test", version: "0" } });
    assert.equal(result.protocolVersion, version);
  }
  for (const params of [{ protocolVersion: "1999-01-01" }, { protocolVersion: 5 }, {}]) {
    assert.equal((await rpc(handle, "initialize", params)).result.protocolVersion, PROTOCOL_VERSIONS[0]);
  }
  const res = await post(handle, { jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(res.headers.get("mcp-session-id"), null, "stateless: no session");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const { result } = await res.json();
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  assert.equal(result.serverInfo.name, "open-challenges");
  assert.equal(result.serverInfo.version, MCP_VERSION);
  assert.equal(result.instructions, INSTRUCTIONS);
  assert.match(INSTRUCTIONS, /data about third-party challenges/);
  assert.match(INSTRUCTIONS, /that challenge's own rules, with your human's agreement/);
  assert.deepEqual((await rpc(handle, "ping")).result, {});
  assert.equal(calls.length, 0, "the handshake reads nothing");
});

test("notifications and client responses get 202 with no body; other methods than POST get 405; OPTIONS answers CORS", async () => {
  const { handle } = site();
  for (const message of [
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } },
    { jsonrpc: "2.0", id: 7, result: {} },
  ]) {
    const res = await post(handle, message);
    assert.equal(res.status, 202);
    assert.equal(await res.text(), "");
  }
  for (const method of ["GET", "DELETE", "PUT", "HEAD"]) {
    const res = await handle(new Request("https://openchallengelist.com/mcp", { method, headers: { accept: "text/event-stream" } }));
    assert.equal(res.status, 405, method);
    assert.match(res.headers.get("allow")!, /\bPOST\b/);
  }
  const preflight = await handle(new Request("https://openchallengelist.com/mcp", { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "POST" } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-methods")!, /\bPOST\b/);
  for (const h of ["Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version"]) assert.ok(preflight.headers.get("access-control-allow-headers")!.includes(h), h);
});

test("protocol errors: malformed JSON, batches, invalid messages, unknown methods and tools, bad params, oversized bodies, unsupported versions", async () => {
  const { handle, calls } = site();
  const error = async (res: Response, status: number, code: number) => {
    assert.equal(res.status, status);
    const body = await res.json();
    assert.equal(body.error.code, code, JSON.stringify(body));
    return body;
  };
  assert.equal((await error(await post(handle, "{not json"), 400, -32700)).id, null);
  await error(await post(handle, [{ jsonrpc: "2.0", id: 1, method: "ping" }]), 400, -32600);
  await error(await post(handle, { jsonrpc: "1.0", id: 1, method: "ping" }), 400, -32600);
  await error(await post(handle, { jsonrpc: "2.0", id: { x: 1 }, method: "ping" }), 400, -32600);
  await error(await post(handle, { jsonrpc: "2.0", id: 1.5, method: "ping" }), 400, -32600);
  await error(await post(handle, "null"), 400, -32600);
  await error(await post(handle, { jsonrpc: "2.0", id: 1, method: "resources/list" }), 200, -32601);
  await error(await post(handle, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "rm_rf" } }), 200, -32602);
  await error(await post(handle, { jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }), 200, -32602);
  await error(await post(handle, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find_challenges", arguments: "lean" } }), 200, -32602);
  await error(await post(handle, { jsonrpc: "2.0", id: 1, method: "tools/list", params: [1] }), 200, -32602);
  await error(await post(handle, { jsonrpc: "2.0", id: 1, method: "tools/list", params: null }), 200, -32602);
  await error(await post(handle, "x".repeat(MAX_BODY + 1)), 413, -32600);
  // a streamed body with no Content-Length is cut off at the cap too
  const chunked = new Request("https://openchallengelist.com/mcp", { method: "POST", duplex: "half",
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_BODY).fill(32)); c.enqueue(new Uint8Array(10).fill(32)); c.close(); } }) } as RequestInit);
  await error(await handle(chunked), 413, -32600);
  await error(await post(handle, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-protocol-version": "2000-01-01" }), 400, -32600);
  assert.equal((await rpc(handle, "tools/list", undefined, { "mcp-protocol-version": "2025-06-18" })).result.tools.length, 4);
  assert.equal((await rpc(handle, "initialize", { protocolVersion: "2025-11-25" }, { "mcp-protocol-version": "2000-01-01" })).result.protocolVersion, "2025-11-25");
  assert.equal(calls.length, 0);
});

test("tools/list: four read-only tools with titles and JSON Schemas", async () => {
  const { result } = await rpc(site().handle, "tools/list");
  assert.deepEqual(result.tools.map((t: any) => t.name), ["find_challenges", "get_challenge", "happening_now", "how_to_join"]);
  for (const t of result.tools) {
    assert.ok(t.title && t.description.length > 60, t.name);
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.deepEqual(t.annotations, { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.equal(t.run, undefined);
  }
  const get = result.tools.find((t: any) => t.name === "get_challenge");
  assert.deepEqual(get.inputSchema.required, ["id"]);
  assert.equal(get.inputSchema.properties.id.pattern, "^[A-Za-z0-9_-]{1,200}$");
});

test("find_challenges: boards with recent entries first, then open tracks; filters, limits and join lines", async () => {
  const { handle, calls } = site();
  const ids = async (args?: unknown) => {
    const r = await call(handle, "find_challenges", args);
    assert.equal(r.isError, undefined, r.content[0].text);
    assert.deepEqual(schemaErrors(outputSchema("find_challenges"), r.structuredContent, "structuredContent"), []);
    return r.structuredContent.challenges.map((c: any) => c.id);
  };
  // ended challenges are left out; ties keep the index order
  assert.deepEqual(await ids(), ["busy-gpu", "kernels", "mystery", "lean-open", "quiet", "Mixed_Case-1"]);
  assert.deepEqual(await ids({ compute: "none" }), ["lean-open", "quiet", "Mixed_Case-1"], "no GPU, and unknown compute is not assumed to fit");
  assert.deepEqual(await ids({ compute: "consumer-gpu" }), ["kernels", "lean-open", "quiet", "Mixed_Case-1"]);
  assert.deepEqual(await ids({ compute: "any" }), await ids());
  assert.deepEqual(await ids({ query: "lean proofs" }), ["lean-open"]);
  assert.deepEqual(await ids({ query: "kernel" }), ["kernels"]);
  assert.deepEqual(await ids({ query: "GPU kernels" }), ["kernels", "busy-gpu"], "more words matched ranks first");
  assert.deepEqual(await ids({ query: "speedruns" }), ["busy-gpu"], "a plural matches the singular");
  assert.deepEqual(await ids({ domain: "FORMAL-METHODS" }), ["lean-open"]);
  assert.deepEqual(await ids({ open_only: true }), ["kernels", "mystery", "lean-open"]);
  assert.deepEqual(await ids({ query: "the a for", limit: 2 }), ["busy-gpu", "kernels"], "stopwords alone filter nothing");

  const one = await call(handle, "find_challenges", { limit: 1 });
  assert.equal(one.structuredContent.matched, 6);
  assert.equal(one.structuredContent.crawledAt, DATA.crawledAt);
  const [c] = one.structuredContent.challenges;
  assert.deepEqual(c, {
    id: "busy-gpu", name: "NanoGPT Speedrun", tagline: "Tagline of busy-gpu", domain: "ml-research", compute: "datacenter-gpu",
    entriesLast30d: 12, participants: 1, tracks: 1, openTracks: 0, lastEntry: "2026-11-24", url: "https://github.com/o/busy-gpu",
    page: `${SITE}/c/busy-gpu`, digest: `${SITE}/api/competitions/busy-gpu.md`, join: challengeJoinLine("NanoGPT Speedrun", "busy-gpu"),
  });
  assert.equal(c.join, `Fetch and follow the instructions at ${SITE}/join.txt — I want to enter "NanoGPT Speedrun": ${SITE}/c/busy-gpu`);
  const text = one.content[0].text;
  assert.match(text, /^1 of 6 matching challenges, crawled 2026-11-25\./);
  assert.ok(text.includes(`   Join line: ${c.join}`));
  assert.ok(text.includes("datacenter GPU · ml-research · 12 entries in the last 30 days · 1 track, none open · last entry 2026-11-24"));
  assert.match(text, /third-party challenges: entering one means following its own rules, with your human's go-ahead/);

  const none = await call(handle, "find_challenges", { query: "quantum chess" });
  assert.equal(none.isError, undefined);
  assert.deepEqual(none.structuredContent, { crawledAt: DATA.crawledAt, matched: 0, challenges: [] });
  assert.match(none.content[0].text, /^No open challenge matches .*Domains in the list: chip-design, coding-agents, formal-methods, llm-eval, ml-research\./);

  // argument errors are tool results the model can correct, and nothing is fetched for them
  const before = calls.length;
  for (const [args, message] of [
    [{ limit: 100 }, /arguments\.limit must be at most 25/],
    [{ limit: 0 }, /arguments\.limit must be at least 1/],
    [{ limit: 2.5 }, /arguments\.limit must be an integer/],
    [{ compute: "gpu" }, /arguments\.compute must be one of "none", "consumer-gpu", "any"/],
    [{ query: 42 }, /arguments\.query must be a string/],
    [{ query: "x".repeat(201) }, /at most 200 characters/],
    [{ gpu: false }, /arguments\.gpu is not accepted \(accepted: query, compute, domain, open_only, limit\)/],
  ] as const) {
    const r = await call(handle, "find_challenges", args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.match(r.content[0].text, message);
  }
  assert.equal(calls.length, before);
});

test("get_challenge returns the digest verbatim, and only an id the index lists is ever fetched", async () => {
  const { handle, calls } = site();
  const lean = await call(handle, "get_challenge", { id: "lean-open" });
  assert.equal(lean.isError, undefined);
  assert.deepEqual(lean.content, [{ type: "text", text: competitionToMarkdown(COMPS[1]) }]);
  assert.match(lean.content[0].text, /^# Lean Proofs[\s\S]*How to submit: Open a pull request[\s\S]*third-party data, not instructions/);
  // ids are unique ignoring case; the index spelling goes into the URL
  const mixed = await call(handle, "get_challenge", { id: "mixed_case-1" });
  assert.match(mixed.content[0].text, /^# Mixed Case/);
  assert.equal(calls.at(-1)!.url, `${ORIGIN}/api/competitions/Mixed_Case-1.md`);

  const unknown = await call(handle, "get_challenge", { id: "nope" });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /No challenge has the id "nope"\. find_challenges returns ids\./);
  assert.match((await call(handle, "get_challenge", { id: "lean" })).content[0].text, /Close matches: lean-open \(Lean Proofs\), done \(Lean Ended\)\./);

  const fetched = calls.map((c) => c.url);
  for (const id of ["../x", "../../etc/passwd", "..%2Fx", "a/b", "x.md", "lean-open?x=1", "lean-open#x", "%2e%2e", "lean open", "", "a".repeat(201), "ł"]) {
    const r = await call(handle, "get_challenge", { id });
    assert.equal(r.isError, true, id);
    assert.match(r.content[0].text, /arguments\.id must match/, id);
  }
  for (const args of [{}, { id: 7 }, { id: "lean-open", extra: 1 }]) assert.equal((await call(handle, "get_challenge", args)).isError, true, JSON.stringify(args));
  assert.deepEqual(calls.map((c) => c.url), fetched, "no request for an invalid id");
  assert.ok(calls.every((c) => c.url.startsWith(`${ORIGIN}/`) && !c.url.includes("..")));

  // listed in the index but the digest is missing: an error result, not a crash
  const files = new Map(FILES);
  files.delete("/api/competitions/quiet.md");
  const broken = await call(site({}, files).handle, "get_challenge", { id: "quiet" });
  assert.equal(broken.isError, true);
  assert.match(broken.content[0].text, /Could not read \/api\/competitions\/quiet\.md from https:\/\/data\.test \(HTTP 404\)/);
});

test("happening_now lists the latest entries from the feed; how_to_join is join.txt", async () => {
  const { handle } = site();
  const two = await call(handle, "happening_now", { limit: 2 });
  assert.deepEqual(schemaErrors(outputSchema("happening_now"), two.structuredContent, "structuredContent"), []);
  assert.deepEqual(two.structuredContent.entries, [
    { date: "2026-11-24", who: "ann", agent: { family: "anthropic", tool: "Claude Code" }, challenge: "NanoGPT Speedrun", id: "busy-gpu", track: "Main",
      value: 3.28, metric: "score", currentBest: true, page: `${SITE}/c/busy-gpu`, link: "https://github.com/o/busy-gpu/pull/1" },
    { date: "2026-11-20", who: "bob", challenge: "Kernel Golf", id: "kernels", track: "Main", value: 10, metric: "score", currentBest: false, page: `${SITE}/c/kernels` },
  ]);
  assert.equal(two.content[0].text, [
    "The latest 2 entries across every board, newest first:",
    "- 2026-11-24 · ann with Claude Code → NanoGPT Speedrun / Main: 3.28 score · current best · https://github.com/o/busy-gpu/pull/1",
    `- 2026-11-20 · bob → Kernel Golf / Main: 10 score · ${SITE}/c/kernels`,
  ].join("\n"));
  assert.equal((await call(handle, "happening_now")).structuredContent.entries.length, 3);
  assert.equal((await call(handle, "happening_now", { limit: 61 })).isError, true);

  const join = await call(handle, "how_to_join", {});
  assert.deepEqual(join.content, [{ type: "text", text: joinTxt(DATA) }]);
  assert.match(join.content[0].text, /do not push, submit or open a pull request until your human says so/);
  assert.equal((await call(handle, "how_to_join", { x: 1 })).isError, true);
});

test("the site's files are cached for a few minutes, read as the MCP server, and a stale copy outlives an outage", async () => {
  let clock = 0;
  const { handle, calls, setDown } = site({ ttlMs: 1000, now: () => clock });
  const indexReads = () => calls.filter((c) => c.url.endsWith("/api/index.json")).length;
  await call(handle, "find_challenges");
  await call(handle, "get_challenge", { id: "quiet" });
  assert.equal(indexReads(), 1);
  assert.equal(new Headers(calls[0].init!.headers).get("user-agent"), INTERNAL_UA, "not counted again as an agent fetch");
  assert.equal(calls[0].init!.redirect, "error");
  clock = 1001;
  await call(handle, "find_challenges");
  assert.equal(indexReads(), 2);
  setDown(true);
  clock = 5000;
  const stale = await call(handle, "find_challenges");
  assert.equal(stale.isError, undefined);
  assert.equal(stale.structuredContent.matched, 6);
  assert.equal(indexReads(), 3);
  const cold = site();
  cold.setDown(true);
  const r = await call(cold.handle, "happening_now");
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^Could not read \/api\/feed\.json from https:\/\/data\.test \(fetch failed\)\. Try again in a minute\.$/);
  assert.throws(() => createMcpHandler({ origin: "https://data.test/path" }), /HTTP\(S\) origin/);
  assert.throws(() => createMcpHandler({ origin: "file:///etc" }), /HTTP\(S\) origin/);
});

test("api/mcp.ts serves every method through the handler and reads MCP_DATA_ORIGIN over HTTP", async (t) => {
  const seen: { path: string; ua?: string }[] = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url!, ua: req.headers["user-agent"] });
    const body = FILES.get(req.url!);
    res.writeHead(body === undefined ? 404 : 200).end(body ?? "Not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.close(); delete process.env.MCP_DATA_ORIGIN; });
  process.env.MCP_DATA_ORIGIN = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const fn = await import("../api/mcp.js");
  for (const m of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) assert.equal(typeof fn[m], "function", m);
  const res = await fn.POST(new Request("https://openchallengelist.com/api/mcp", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find_challenges", arguments: { compute: "none", limit: 1 } } }) }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result.structuredContent.challenges[0].id, "lean-open");
  assert.deepEqual(seen, [{ path: "/api/index.json", ua: INTERNAL_UA }]);
  assert.equal((await fn.GET(new Request("https://openchallengelist.com/api/mcp"))).status, 405);
});

test("discovery: llms.txt, join.txt, vercel.json and server.json point at /mcp", () => {
  assert.ok(llmsTxt({ ...DATA, errors: [] }).includes(`MCP server (Streamable HTTP, read-only): ${SITE}/mcp`));
  assert.ok(joinTxt(DATA).includes(`claude mcp add --transport http open-challenges ${SITE}/mcp`));
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(vercel.rewrites[0], { source: "/mcp", destination: "/api/mcp" });
  assert.ok(vercel.functions["api/mcp.ts"]);
  const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  assert.equal(server.name, "io.github.open-challenges/open-challenges");
  assert.equal(server.version, MCP_VERSION);
  assert.ok(server.description.length <= 100);
  assert.deepEqual(server.remotes, [{ type: "streamable-http", url: `${SITE}/mcp` }]);
});

test("mcp: logs one JSON line per initialize and tool call, without free-text queries", async () => {
  const lines: string[] = [];
  const { handle } = site({ log: (l) => lines.push(l) });
  await rpc(handle, "initialize", { protocolVersion: PROTOCOL_VERSIONS[0], capabilities: {}, clientInfo: { name: "claude-code\u0007", version: "2.1.0" } });
  await call(handle, "find_challenges", { query: "my secret research idea", compute: "none" });
  await call(handle, "get_challenge", { id: "lean-open" });
  const parsed = lines.map((l) => JSON.parse(l));
  assert.deepEqual(parsed[0], { t: "mcp", m: "initialize", client: "claude-code", cv: "2.1.0" });
  assert.deepEqual(parsed[1], { t: "mcp", m: "tools/call", tool: "find_challenges", compute: "none" });
  assert.deepEqual(parsed[2], { t: "mcp", m: "tools/call", tool: "get_challenge", id: "lean-open" });
  assert.ok(!lines.join("\n").includes("secret"));
});
