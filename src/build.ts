// Static build for Vercel: site/ + pre-rendered API → public/
import { lstatSync, mkdirSync, rmSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { CrawlResult } from "./types.js";
import { aggregateAgents, aggregatePeople, openProblems } from "./aggregate.js";
import { competitionToMarkdown, llmsTxt } from "./render.js";

// Inventory, not a recursive copy: new assets must be deliberately published.
export const SITE_ASSETS = new Set([
  "index.html", "app.js", "style.css", "favicon.svg", "favicon-32.png",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png", "hero.jpg", "og.jpg",
  "robots.txt", "site.webmanifest", "standard/PROBLEM.md", "standard/SUBMISSION.md",
  "standard/templates.json",
  ..."bytedance-color mistral-color kimi-color qwen-color other-ai axiom-color gemini-color openai claude-color xai meta-color deepseek-color github zhipu-color harmonic-color".split(" ").map((n) => `icons/${n}.svg`),
  ..."velodrome d-coding armillary pool indoor bend compass finish c-consumer dawn d-hardware datacenter d-formal blocks d-llm d-systems d-robotics d-ml c-cluster marathon d-other caesar c-none relay hurdles c-datacenter c-cpu horse".split(" ").flatMap((n) => [`art/${n}.jpg`, `art/${n}-sm.jpg`]),
]);

export function containedPath(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || rel.split(sep)[0] === ".." || isAbsolute(rel)) throw new Error("Path escapes publication root");
  return target;
}

export function readSiteAsset(root: string, path: string): Buffer {
  if (!SITE_ASSETS.has(path)) throw new Error("Asset is not public");
  const target = containedPath(root, path);
  let current = root;
  for (const part of ["", ...path.split("/")]) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("Symlinks are not public assets");
  }
  if (!lstatSync(target).isFile()) throw new Error("Asset is not a regular file");
  return readFileSync(target);
}

export function publicDataset(value: CrawlResult): Pick<CrawlResult, "crawledAt" | "competitions"> {
  if (!value || typeof value.crawledAt !== "string" || !Number.isFinite(Date.parse(value.crawledAt)) || !Array.isArray(value.competitions)) {
    throw new Error("Invalid competition dataset");
  }
  const ids = new Set<string>();
  for (const c of value.competitions) {
    // Preserve slug spelling; reject portable-filesystem collisions as well as duplicates.
    if (!c || typeof c.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(c.id) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(c.id)) {
      throw new Error("Unsafe competition ID");
    }
    const key = c.id.toLowerCase();
    if (ids.has(key)) throw new Error("Duplicate competition ID");
    ids.add(key);
  }
  return { crawledAt: value.crawledAt, competitions: value.competitions };
}

export function build(root = process.cwd()) {
  const ROOT = realpathSync(root);
  const OUT = join(ROOT, "public");
  const data = publicDataset(JSON.parse(readFileSync(join(ROOT, "data", "competitions.json"), "utf-8")));
  const files = new Map<string, string | Buffer>();
  const w = (p: string, body: string | Buffer) => {
    containedPath(OUT, p);
    if (files.has(p)) throw new Error(`Duplicate output path: ${p}`);
    files.set(p, body);
  };
  for (const asset of SITE_ASSETS) {
    if (asset === "standard/templates.json") continue;
    try { w(asset, readSiteAsset(join(ROOT, "site"), asset)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  // Content hashes bust the CDN's JS/CSS cache without caching index.html.
  const ver = (file: string) => createHash("sha256").update(files.get(file)!).digest("hex").slice(0, 10);
  const html = files.get("index.html")!.toString();
  const stamped = html
    .replace('href="/style.css"', `href="/style.css?v=${ver("style.css")}"`)
    .replace('src="/app.js"', `src="/app.js?v=${ver("app.js")}"`);
  if (stamped === html || !stamped.includes("/app.js?v=") || !stamped.includes("/style.css?v=")) throw new Error("build: could not version app.js / style.css in index.html");
  files.set("index.html", stamped);

  const j = (v: unknown) => JSON.stringify(v);
  w("api/competitions.json", j(data));
  w("api/people.json", j(aggregatePeople(data.competitions)));
  w("api/agents.json", j(aggregateAgents(data.competitions, "author")));
  w("api/agents-subject.json", j(aggregateAgents(data.competitions, "subject")));
  w("api/open-problems.json", j(openProblems(data.competitions)));
  w("api/summary.json", j({
    crawledAt: data.crawledAt,
    competitions: data.competitions,
    people: aggregatePeople(data.competitions),
    agents: aggregateAgents(data.competitions, "author"),
    evaluated: aggregateAgents(data.competitions, "subject"),
    openProblems: openProblems(data.competitions),
  }));
  for (const c of data.competitions) {
    w(`api/competitions/${c.id}.json`, JSON.stringify(c, null, 2));
    w(`api/competitions/${c.id}.md`, competitionToMarkdown(c));
  }
  w("llms.txt", llmsTxt({ ...data, errors: [] }));
  // Neutral filename avoids blockers that stall requests for *SUBMISSION*.md.
  w("standard/templates.json", j({ "PROBLEM.md": readSiteAsset(join(ROOT, "site"), "standard/PROBLEM.md").toString(), "SUBMISSION.md": readSiteAsset(join(ROOT, "site"), "standard/SUBMISSION.md").toString() }));

  // Sitemap: static routes, every competition, every model family with records.
  const origin = new URL(process.env.SITE_ORIGIN ?? "https://openchallengelist.com");
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("SITE_ORIGIN must be an HTTP(S) origin");
  const ORIGIN = origin.origin;
  const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
  const day = new Date(data.crawledAt).toISOString().slice(0, 10);
  const families = [...new Set(data.competitions.flatMap((c) => c.problems.flatMap((p) => p.records.map((r) => r.agent?.family).filter((f): f is NonNullable<typeof f> => !!f && f !== "unknown"))))];
  const urls: [string, string, string][] = [["/", "daily", "1.0"], ["/standard", "weekly", "0.9"], ["/submit", "monthly", "0.6"], ["/agents", "daily", "0.8"], ["/people", "daily", "0.7"],
    ...data.competitions.map((c): [string, string, string] => [`/c/${encodeURIComponent(c.id)}`, "daily", "0.8"]),
    ...families.map((f): [string, string, string] => [`/agents/${encodeURIComponent(f)}`, "weekly", "0.5"])];
  w("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, f, pr]) => `  <url><loc>${xml(ORIGIN + p)}</loc><lastmod>${xml(day)}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join("\n")}\n</urlset>\n`);
  w("competitions.json", j(data));

  // Validate all output paths and render everything before deleting the previous build.
  containedPath(ROOT, "public");
  try {
    if (lstatSync(OUT).isSymbolicLink() || !lstatSync(OUT).isDirectory()) throw new Error("Unsafe public output directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  rmSync(OUT, { recursive: true, force: true });
  for (const [path, body] of files) {
    const target = containedPath(OUT, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  console.log(`built public/ — ${data.competitions.length} competitions`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) build();
