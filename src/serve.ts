// Static site + JSON API for humans and agents
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { Readable } from "node:stream";
import { publicDataset, readSiteAsset } from "./build.js";
import { aggregatePeople, aggregateAgents, competitionIndex, openProblems, withEntryCounts } from "./aggregate.js";
import { competitionBadge, listedBadge } from "./badge.js";
import { claimTxt, competitionToMarkdown, feedAtom, feedJson, joinTxt, llmsTxt } from "./render.js";
import { pages, profilePage, renderPage, topicMarkdown } from "./prerender.js";
import { buildProfiles, peopleWithProfiles, profileIndex, withProfiles } from "./profiles.js";
import { createAccountsHandler, memoryStore } from "./accounts.js";
import { connectAccounts, pgStore } from "./accountsDb.js";
import { databaseUrl } from "./db.js";
import { TOPICS } from "./topics.js";
import { applyCorrections, loadCorrections } from "./corrections.js";
import { markdownFor } from "./agentTraffic.js";
import { createMcpHandler } from "./mcp.js";
import { createPulseHandler } from "./pulse.js";
import { loadSocial } from "./social.js";
import { loadEvents } from "./events.js";
import { NO_DISCOVERIES, loadDiscoveries } from "./discoveries.js";
import { loadAgentDocs, withAgentDocs } from "./agentDocs.js";
import { boardJoinTxt } from "./boardJoin.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const SITE_DIR = join(process.cwd(), "site");
const DATA_PATH = join(process.cwd(), "data", "competitions.json");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json",
};

async function loadData() {
  const crawled = publicDataset(JSON.parse(await readFile(DATA_PATH, "utf-8")));
  const comps = withAgentDocs(applyCorrections(crawled.competitions, loadCorrections(process.cwd(), new Set(crawled.competitions.map((c) => c.id)))), loadAgentDocs(process.cwd()));
  return { ...crawled, competitions: withProfiles(comps, buildProfiles(comps)) };
}

function send(res: any, status: number, body: string | Buffer, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

// /mcp as on Vercel (api/mcp.ts), reading this server's own files: the Host header never picks what is fetched
let mcp: ((request: Request) => Promise<Response>) | undefined;
async function serveMcp(req: IncomingMessage, res: ServerResponse) {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  const host = ["0.0.0.0", "::", ""].includes(HOST) ? "127.0.0.1" : HOST.includes(":") ? `[${HOST}]` : HOST;
  mcp ??= createMcpHandler({ origin: `http://${host}:${port}`, ttlMs: 0 });
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) for (const v of [value ?? []].flat()) headers.append(name, v);
  const body = req.method === "GET" || req.method === "HEAD" ? {} : { body: Readable.toWeb(req), duplex: "half" };
  const response = await mcp(new Request(`http://${host}:${port}/mcp`, { method: req.method, headers, ...body } as RequestInit));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

// /api/v1 as on Vercel (api/v1.ts): the database in SUPABASE_DB_URL when set (ACCOUNTS_DB=memory keeps it in memory), profiles
// read from this server. Sign-in needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET with a callback on this origin.
let accounts: ((request: Request) => Promise<Response>) | undefined;
async function serveAccounts(req: IncomingMessage, res: ServerResponse) {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  const host = ["0.0.0.0", "::", ""].includes(HOST) ? "127.0.0.1" : HOST.includes(":") ? `[${HOST}]` : HOST;
  const db = process.env.ACCOUNTS_DB === "memory" ? undefined : databaseUrl();
  const id = process.env.GITHUB_CLIENT_ID, secret = process.env.GITHUB_CLIENT_SECRET;
  accounts ??= createAccountsHandler({ store: db ? pgStore(connectAccounts(db)) : memoryStore(), origin: `http://${host}:${port}`, github: id && secret ? { clientId: id, clientSecret: secret } : null, log: (l) => console.log(l) });
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) for (const v of [value ?? []].flat()) headers.append(name, v);
  const body = req.method === "GET" || req.method === "HEAD" ? {} : { body: Readable.toWeb(req), duplex: "half" };
  const response = await accounts(new Request(`http://${host}:${port}${req.url}`, { method: req.method, headers, ...body } as RequestInit));
  const out: Record<string, string | string[]> = Object.fromEntries(response.headers);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) out["set-cookie"] = cookies;
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}

// /api/pulse and /api/pulse.md as on Vercel (api/pulse.ts): live sources read from the network, the index from this server
let pulse: ((request: Request) => Promise<Response>) | undefined;
async function servePulse(req: IncomingMessage, res: ServerResponse) {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  const host = ["0.0.0.0", "::", ""].includes(HOST) ? "127.0.0.1" : HOST.includes(":") ? `[${HOST}]` : HOST;
  pulse ??= createPulseHandler({ origin: `http://${host}:${port}`, log: (l) => console.log(l) });
  const response = await pulse(new Request(`http://${host}:${port}${req.url}`, { method: req.method }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' https://www.googletagmanager.com; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if ((req.url ?? "").split("?")[0] === "/mcp") return serveMcp(req, res).catch(() => send(res, 500, "Internal error"));
  if (/^\/api\/v1(\/|\?|$)/.test(req.url ?? "")) return serveAccounts(req, res).catch(() => send(res, 500, "Internal error"));
  if (/^\/api\/pulse(?:\.md)?(?:\?|$)/.test(req.url ?? "")) return servePulse(req, res).catch(() => send(res, 500, "Internal error"));
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return send(res, 405, "Method not allowed");
  }

  try {
    let url: URL;
    let path: string;
    try {
      const raw = req.url ?? "/";
      if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\x00-\x20\x7f#]/.test(raw)) throw new Error("Invalid URL");
      // Check before URL normalization can erase dot segments, including encoded ones.
      path = decodeURIComponent(raw.split("?")[0]);
      if (/[\\\x00-\x1f\x7f%]/.test(path) || path.split("/").some((part) => part.startsWith("."))) throw new Error("Unsafe path");
      decodeURIComponent(raw); // Reject malformed escapes in the query as well.
      url = new URL(raw, "http://localhost");
    } catch {
      return send(res, 400, "Bad request");
    }
    // Accept: text/markdown → the Markdown twin, as middleware.ts does in production
    const twin = markdownFor(path, req.headers.accept ?? null);
    if (twin) path = twin;

    // ── API ──
    if (path === "/api/index" || path === "/api/index.json") {
      const data = await loadData();
      return send(res, 200, JSON.stringify({ crawledAt: data.crawledAt, competitions: competitionIndex(data.competitions) }), MIME[".json"]);
    }
    if (path === "/api/feed" || path === "/api/feed.json") {
      const data = await loadData();
      return send(res, 200, JSON.stringify(feedJson(data, `http://${req.headers.host}`)), MIME[".json"]);
    }
    if (path === "/feed.xml") {
      const data = await loadData();
      return send(res, 200, feedAtom(data, `http://${req.headers.host}`), "application/atom+xml; charset=utf-8");
    }
    if (path === "/join.txt") {
      const data = await loadData();
      return send(res, 200, joinTxt(data, `http://${req.headers.host}`), MIME[".txt"]);
    }
    if (path === "/api/competitions" || path === "/api/competitions.json") {
      const data = await loadData();
      return send(res, 200, JSON.stringify(data), MIME[".json"]);
    }
    if (path === "/claim.txt") return send(res, 200, claimTxt(`http://${req.headers.host}`), MIME[".txt"]);
    if (path === "/api/people") {
      const data = await loadData();
      return send(res, 200, JSON.stringify(peopleWithProfiles(aggregatePeople(data.competitions), data.competitions)), MIME[".json"]);
    }
    if (path === "/api/profiles" || path === "/api/profiles.json") {
      const data = await loadData();
      return send(res, 200, JSON.stringify(profileIndex(buildProfiles(data.competitions).profiles)), MIME[".json"]);
    }
    const profileMatch = path.match(/^\/(api\/profiles|u)\/([a-z0-9-]{1,100}?)(\.json)?$/);
    if (profileMatch && (profileMatch[1] === "u") === !profileMatch[3]) {
      const p = buildProfiles((await loadData()).competitions).profiles.find((x) => x.slug === profileMatch[2]);
      if (profileMatch[1] === "u") {
        const shell = readSiteAsset(SITE_DIR, "index.html").toString();
        return p ? send(res, 200, renderPage(shell, profilePage(p)), MIME[".html"]) : send(res, 404, renderPage(shell, pages({ crawledAt: new Date().toISOString(), competitions: [] }, [], null, [], []).find((x) => x.path === "/404")!), MIME[".html"]);
      }
      return p ? send(res, 200, JSON.stringify(p), MIME[".json"]) : send(res, 404, JSON.stringify({ error: "not found" }), MIME[".json"]);
    }
    if (path === "/api/agents") {
      const data = await loadData();
      const role = url.searchParams.get("role") === "subject" ? "subject" : "author";
      return send(res, 200, JSON.stringify(aggregateAgents(data.competitions, role)), MIME[".json"]);
    }
    if (path === "/api/open-problems") {
      const data = await loadData();
      return send(res, 200, JSON.stringify(openProblems(data.competitions)), MIME[".json"]);
    }
    if (path === "/api/discoveries" || path === "/api/discoveries.json") {
      return send(res, 200, JSON.stringify(loadDiscoveries(process.cwd()) ?? NO_DISCOVERIES), MIME[".json"]);
    }
    if (path === "/api/summary") {
      const data = await loadData();
      return send(res, 200, JSON.stringify({
        crawledAt: data.crawledAt,
        competitions: data.competitions,
        people: peopleWithProfiles(aggregatePeople(data.competitions), data.competitions),
        profileCount: buildProfiles(data.competitions).profiles.length,
        agents: aggregateAgents(data.competitions, "author"),
        evaluated: aggregateAgents(data.competitions, "subject"),
        openProblems: openProblems(data.competitions),
        social: loadSocial(process.cwd(), new Set(data.competitions.map((c) => c.id))),
        events: loadEvents(process.cwd()),
        discoveries: loadDiscoveries(process.cwd()) ?? NO_DISCOVERIES,
        topics: TOPICS,
      }), MIME[".json"]);
    }
    const apiMatch = path.match(/^\/api\/competitions\/([^/]+?)(\.json|\.md)?$/);
    if (apiMatch) {
      const data = await loadData();
      const c = data.competitions.find((x) => x.id === apiMatch[1]);
      if (!c) return send(res, 404, JSON.stringify({ error: "not found" }), MIME[".json"]);
      if (apiMatch[2] === ".md") return send(res, 200, competitionToMarkdown(c), MIME[".md"]);
      return send(res, 200, JSON.stringify(c, null, 2), MIME[".json"]);
    }
    // one board's instructions for an agent (src/boardJoin.ts), at the URL vercel.json rewrites to the built file
    const joinMatch = path.match(/^\/c\/([A-Za-z0-9_-]{1,200})\/join\.txt$/);
    if (joinMatch) {
      const data = await loadData();
      const c = withEntryCounts(data.competitions, data.crawledAt).find((x) => x.id === joinMatch[1]);
      return c ? send(res, 200, boardJoinTxt(c, data.crawledAt, `http://${req.headers.host}`), MIME[".txt"]) : send(res, 404, "Not found");
    }
    const topicMatch = path.match(/^\/topics\/([a-z0-9-]{1,40})\.md$/);
    if (topicMatch) {
      const t = TOPICS.find((x) => x.slug === topicMatch[1]);
      if (!t) return send(res, 404, "Not found");
      return send(res, 200, topicMarkdown(t, await loadData(), `http://${req.headers.host}`, loadDiscoveries(process.cwd())), MIME[".md"]);
    }
    if (path === "/llms.txt") {
      const data = await loadData();
      return send(res, 200, llmsTxt({ ...data, errors: [] }), MIME[".txt"]);
    }
    if (path === "/competitions.json") {
      const data = await loadData();
      return send(res, 200, JSON.stringify(data), MIME[".json"]);
    }

    // README badges (src/badge.ts), with the entry counts the build publishes
    if (path === "/badge/listed.svg") return send(res, 200, listedBadge(), MIME[".svg"]);
    const badgeMatch = path.match(/^\/badge\/c\/([A-Za-z0-9_-]{1,200})\.svg$/);
    if (badgeMatch) {
      const data = await loadData();
      const c = withEntryCounts(data.competitions, data.crawledAt).find((x) => x.id === badgeMatch[1]);
      return c ? send(res, 200, competitionBadge(c), MIME[".svg"]) : send(res, 404, "Not found");
    }

    // ── Pages: every route rendered with its content, as the build does; unknown routes get the 404 page ──
    if (!extname(path)) {
      const data = await loadData();
      const all = pages(data, loadSocial(process.cwd(), new Set(data.competitions.map((c) => c.id))), loadDiscoveries(process.cwd()));
      const route = path === "/landing" ? "/" : /^\/a\/[^/]+$/.test(path) ? "/a" : path;
      const p = all.find((x) => x.path === route) ?? all.find((x) => x.path === "/404")!;
      return send(res, p.path === "/404" ? 404 : 200, renderPage(readSiteAsset(SITE_DIR, "index.html").toString(), p), MIME[".html"]);
    }

    // ── Static ──
    const asset = path.slice(1);
    const filePath = join(SITE_DIR, asset);
    const content = readSiteAsset(SITE_DIR, asset);
    return send(res, 200, content, MIME[extname(filePath)] ?? "application/octet-stream");
  } catch {
    return send(res, 404, "Not found");
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  console.log(`Site:  http://${HOST}:${port}`);
  console.log(`API:   http://${HOST}:${port}/api/competitions`);
  console.log(`LLMs:  http://${HOST}:${port}/llms.txt`);
});
