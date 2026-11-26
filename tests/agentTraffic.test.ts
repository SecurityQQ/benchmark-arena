import assert from "node:assert/strict";
import { test } from "node:test";
import { INTERNAL_UA, agentEvent, agentLogLine, classifyAgent, markdownFor, pageType } from "../src/agentTraffic.js";

test("user agents are classified, user-initiated fetchers before their vendor's crawler", () => {
  const cases: [string, string, string][] = [
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)", "Claude-User", "ai-user"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "ClaudeBot", "ai-crawler"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "ChatGPT-User", "ai-user"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot", "GPTBot", "ai-crawler"],
    ["Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", "PerplexityBot", "search"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Googlebot", "search"],
    ["curl/8.7.1", "curl", "tool"],
    ["python-requests/2.32.3", "python", "tool"],
    ["axios/1.7.7", "node", "tool"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", "browser", "browser"],
    ["", "none", "other"],
  ];
  for (const [ua, agent, kind] of cases) assert.deepEqual(classifyAgent(ua), { agent, kind }, ua);
});

test("browsers are not counted as agents; agent events carry no IP and only short, typed fields", () => {
  assert.equal(agentEvent("/api/summary", "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131.0 Safari/537.36", "https://openchallengelist.com/"), null);
  const e = agentEvent("/api/competitions/lean-eval.md", "Claude-User/1.0", "https://github.com/o/r/pull/1", new Date("2026-11-24T10:00:00Z"))!;
  assert.equal(e.events[0].name, "agent_fetch");
  assert.deepEqual(e.events[0].params, { agent: "Claude-User", agent_kind: "ai-user", page_type: "digest", page_path: "/api/competitions/lean-eval.md", competition: "lean-eval", referrer_host: "github.com", engagement_time_msec: 1 });
  assert.match(e.client_id, /^\d+\.\d+$/);
  assert.equal(agentEvent("/join.txt", "curl/8", "not a url")!.events[0].params.page_type, "join");
  assert.equal(pageType("/c/x"), "competition");
  assert.equal(pageType("/topics/math"), "topic");
  assert.equal(pageType("/challenges/p-vs-np"), "grand-challenge");
  assert.equal(pageType("/feed.xml"), "feed");
  // MCP calls count like any agent fetch; the MCP server's own reads of the static files do not count again
  assert.equal(pageType("/mcp"), "mcp");
  assert.equal(agentEvent("/mcp", "claude-code/2.1.0", null)!.events[0].params.page_type, "mcp");
  assert.equal(agentEvent("/api/index.json", INTERNAL_UA, null), null);
});

test("Markdown is served only for pages with a Markdown twin, and only when asked for", () => {
  assert.equal(markdownFor("/", "text/markdown"), "/llms.txt");
  assert.equal(markdownFor("/c/lean-eval", "text/markdown, text/html;q=0.9"), "/api/competitions/lean-eval.md");
  assert.equal(markdownFor("/c/lean-eval", "text/html,application/xhtml+xml,*/*;q=0.8"), null);
  assert.equal(markdownFor("/c/../../etc", "text/markdown"), null);
  assert.equal(markdownFor("/agents", "text/markdown"), null);
  assert.equal(markdownFor("/topics/math", "text/markdown"), "/topics/math.md");
  assert.equal(markdownFor("/topics/../x", "text/markdown"), null);
  assert.equal(markdownFor("/challenges/p-vs-np", "text/markdown"), "/challenges/p-vs-np.md");
  assert.equal(markdownFor("/challenges/../x", "text/markdown"), null);
  assert.equal(markdownFor("/challenges/p-vs-np", "text/html"), null);
  assert.equal(markdownFor("/topics/math.md", "text/markdown"), null);
  assert.equal(markdownFor("/c/x", null), null);
});

test("agent traffic: one log line per agent fetch; the raw User-Agent only when no known agent matched", () => {
  const known = agentEvent("/api/competitions/lean-eval.md", "Claude-User/1.0", "https://github.com/o/r/pull/1")!;
  assert.deepEqual(JSON.parse(agentLogLine(known, "Claude-User/1.0")), { t: "agent_fetch", agent: JSON.parse(agentLogLine(known, "Claude-User/1.0")).agent, kind: known.events[0].params.agent_kind, page: "digest", path: "/api/competitions/lean-eval.md", competition: "lean-eval", ref: "github.com" });
  assert.ok(!("ua" in JSON.parse(agentLogLine(known, "Claude-User/1.0"))));
  const odd = "SomeNewAgent/0.1 (+https://example.com)\n\u0000x".repeat(10);
  const line = JSON.parse(agentLogLine(agentEvent("/join.txt", odd, null)!, odd));
  assert.equal(line.agent, "unknown");
  assert.equal(line.page, "join");
  assert.ok(line.ua.length <= 160 && /^[\x20-\x7e]*$/.test(line.ua));
});
