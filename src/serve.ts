// Static site + JSON API for humans and agents
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import type { CrawlResult, Competition } from "./types.js";
import { aggregatePeople, aggregateAgents, openProblems } from "./aggregate.js";
import { competitionToMarkdown, llmsTxt } from "./render.js";

const PORT = Number(process.env.PORT ?? 3000);
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
};

async function loadData(): Promise<CrawlResult> {
  return JSON.parse(await readFile(DATA_PATH, "utf-8"));
}

function send(res: any, status: number, body: string | Buffer, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(body);
}


const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
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
      return send(res, 200, llmsTxt(data), MIME[".txt"]);
    }
    if (path === "/competitions.json") {
      const data = await loadData();
      return send(res, 200, JSON.stringify(data), MIME[".json"]);
    }

    // ── Static ──
    // SPA: any path without a file extension is a client-side route
    const filePath = join(SITE_DIR, extname(path) ? path : "index.html");
    await stat(filePath);
    const content = await readFile(filePath);
    return send(res, 200, content, MIME[extname(filePath)] ?? "application/octet-stream");
  } catch {
    return send(res, 404, "Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Site:  http://localhost:${PORT}`);
  console.log(`API:   http://localhost:${PORT}/api/competitions`);
  console.log(`LLMs:  http://localhost:${PORT}/llms.txt`);
});
