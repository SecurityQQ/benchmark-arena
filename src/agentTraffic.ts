// Agent traffic: who fetches the agent-facing files, and Markdown for agents that ask for it.
// Used by the Routing Middleware (middleware.ts). Counting sends no IP address and sets no cookie: the event carries
// the path, the agent's name from its User-Agent, and the referring host.

export type AgentKind = "ai-user" | "ai-crawler" | "search" | "tool" | "browser" | "other";

// First match wins: user-initiated fetchers before the same vendor's crawler, named agents before generic tools
const AGENTS: [RegExp, string, AgentKind][] = [
  [/Claude-User/i, "Claude-User", "ai-user"],
  [/claude-code|claude-cli/i, "Claude Code", "ai-user"],
  [/Claude-SearchBot/i, "Claude-SearchBot", "search"],
  [/ClaudeBot|anthropic-ai/i, "ClaudeBot", "ai-crawler"],
  [/ChatGPT-User/i, "ChatGPT-User", "ai-user"],
  [/\bCodex\b/i, "Codex", "ai-user"],
  [/OAI-SearchBot/i, "OAI-SearchBot", "search"],
  [/GPTBot/i, "GPTBot", "ai-crawler"],
  [/Perplexity-User/i, "Perplexity-User", "ai-user"],
  [/PerplexityBot/i, "PerplexityBot", "search"],
  [/Google-Agent|GoogleAgent|Gemini/i, "Google agent", "ai-user"],
  [/Google-CloudVertexBot/i, "Google-CloudVertexBot", "ai-crawler"],
  [/MistralAI-User/i, "MistralAI-User", "ai-user"],
  [/DuckAssistBot/i, "DuckAssistBot", "ai-user"],
  [/\bCursor\b/i, "Cursor", "ai-user"],
  [/\bDevin\b/i, "Devin", "ai-user"],
  [/meta-externalagent|meta-externalfetcher/i, "Meta", "ai-crawler"],
  [/Bytespider/i, "Bytespider", "ai-crawler"],
  [/Amazonbot/i, "Amazonbot", "ai-crawler"],
  [/CCBot/i, "CCBot", "ai-crawler"],
  [/cohere-ai/i, "Cohere", "ai-crawler"],
  [/Googlebot/i, "Googlebot", "search"],
  [/bingbot/i, "Bingbot", "search"],
  [/Applebot/i, "Applebot", "search"],
  [/DuckDuckBot|YandexBot|Baiduspider|Slurp|YouBot/i, "Search engine", "search"],
  [/^curl\//i, "curl", "tool"],
  [/Wget/i, "wget", "tool"],
  [/python-requests|python-httpx|aiohttp|python-urllib/i, "python", "tool"],
  [/node-fetch|undici|axios\/|^node$/i, "node", "tool"],
  [/Go-http-client/i, "go", "tool"],
  [/okhttp|^Java\//i, "java", "tool"],
  [/bot\b|crawler|spider/i, "Other bot", "other"],
];

export function classifyAgent(ua: string | null): { agent: string; kind: AgentKind } {
  const s = (ua ?? "").slice(0, 512);
  for (const [re, agent, kind] of AGENTS) if (re.test(s)) return { agent, kind };
  return /Mozilla\/5\.0/.test(s) ? { agent: "browser", kind: "browser" } : { agent: s ? "unknown" : "none", kind: "other" };
}

export function pageType(path: string): string {
  if (path === "/join.txt" || /^\/c\/[^/]+\/join\.txt$/.test(path)) return "join";
  if (path === "/claim.txt") return "claim";
  if (path.startsWith("/api/v1")) return "accounts";
  if (path === "/llms.txt") return "llms";
  if (path === "/mcp" || path === "/api/mcp") return "mcp";
  if (path === "/feed.xml" || /^\/api\/feed(\.json)?$/.test(path)) return "feed";
  if (/^\/api\/competitions\/[^/]+\.md$/.test(path)) return "digest";
  if (path.startsWith("/api/")) return "api";
  if (path.startsWith("/c/")) return "competition";
  if (path.startsWith("/topics/")) return "topic";
  if (path.startsWith("/u/")) return "profile";
  if (path === "/") return "home";
  if (path === "/robots.txt" || path === "/sitemap.xml") return "crawl";
  return "page";
}

const competitionOf = (path: string) => /^\/(?:c\/([A-Za-z0-9_-]{1,200})(?:\/join\.txt)?|api\/competitions\/([A-Za-z0-9_-]{1,200})(?:\.md|\.json)?)$/.exec(path)?.slice(1).find(Boolean);

// FNV-1a: a stable, non-reversible id per agent per day, so GA4 groups an agent's fetches without identifying anyone
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

// The User-Agent of the MCP server's own reads of the static files (src/mcp.ts): the /mcp call was counted already
export const INTERNAL_UA = "openchallengelist-mcp";

// GA4 Measurement Protocol body for a non-browser fetch, or null. People in browsers are counted by the page's
// own analytics, and the app's own /api/summary fetch must not count as an agent.
export function agentEvent(path: string, ua: string | null, referer: string | null, now = new Date()) {
  if (ua === INTERNAL_UA) return null;
  const { agent, kind } = classifyAgent(ua);
  if (kind === "browser") return null;
  const day = now.toISOString().slice(0, 10);
  let ref = "";
  try { ref = referer ? new URL(referer).hostname : ""; } catch {}
  const competition = competitionOf(path);
  return {
    client_id: `${fnv(`${agent}|${ua ?? ""}`)}.${fnv(day)}`,
    non_personalized_ads: true,
    events: [{ name: "agent_fetch", params: {
      agent, agent_kind: kind, page_type: pageType(path), page_path: path.slice(0, 100),
      ...(competition ? { competition } : {}), ...(ref ? { referrer_host: ref.slice(0, 100) } : {}),
      engagement_time_msec: 1,
    } }],
  };
}

// One runtime-log line per agent fetch: the GA4 event's fields, plus the raw User-Agent only when it matched no known
// agent (that is how new agents get names). No IP, no query string, nothing else from the request.
export function agentLogLine(event: NonNullable<ReturnType<typeof agentEvent>>, ua: string | null): string {
  const p = event.events[0].params;
  const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, "").slice(0, 160);
  return JSON.stringify({
    t: "agent_fetch", agent: p.agent, kind: p.agent_kind, page: p.page_type, path: p.page_path,
    ...(p.competition ? { competition: p.competition } : {}), ...(p.referrer_host ? { ref: p.referrer_host } : {}),
    ...(p.agent === "unknown" || p.agent === "Other bot" ? { ua: clean(ua ?? "") } : {}),
  });
}

// Accept: text/markdown on a page that has a Markdown twin → that twin's path
export function markdownFor(path: string, accept: string | null): string | null {
  if (!accept || !/\btext\/markdown\b/i.test(accept)) return null;
  if (path === "/") return "/llms.txt";
  const topic = /^\/topics\/([a-z0-9-]{1,40})$/.exec(path)?.[1];
  if (topic) return `/topics/${topic}.md`;
  const id = /^\/c\/([A-Za-z0-9_-]{1,200})$/.exec(path)?.[1];
  return id ? `/api/competitions/${id}.md` : null;
}
