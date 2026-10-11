// Static site + JSON API for humans and agents
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { publicDataset, readSiteAsset } from "./build.js";
import { aggregatePeople, aggregateAgents, openProblems } from "./aggregate.js";
import { competitionToMarkdown, llmsTxt } from "./render.js";

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
  return publicDataset(JSON.parse(await readFile(DATA_PATH, "utf-8")));
}

function send(res: any, status: number, body: string | Buffer, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(body);
}


const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' https://www.googletagmanager.com; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
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
    // ── API ──
    if (path === "/api/competitions" || path === "/api/competitions.json") {
      const data = await loadData();
      return send(res, 200, JSON.stringify(data), MIME[".json"]);
    }
    if (path === "/api/people") {
      const data = await loadData();
      return send(res, 200, JSON.stringify(aggregatePeople(data.competitions)), MIME[".json"]);
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
    if (path === "/api/summary") {
      const data = await loadData();
      return send(res, 200, JSON.stringify({
        crawledAt: data.crawledAt,
        competitions: data.competitions,
        people: aggregatePeople(data.competitions),
        agents: aggregateAgents(data.competitions, "author"),
        evaluated: aggregateAgents(data.competitions, "subject"),
        openProblems: openProblems(data.competitions),
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
    if (path === "/llms.txt") {
      const data = await loadData();
      return send(res, 200, llmsTxt({ ...data, errors: [] }), MIME[".txt"]);
    }
    if (path === "/competitions.json") {
      const data = await loadData();
      return send(res, 200, JSON.stringify(data), MIME[".json"]);
    }

    // ── Static ──
    // SPA: any path without a file extension is a client-side route
    const asset = extname(path) ? path.slice(1) : "index.html";
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
