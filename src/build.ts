// Static build for Vercel: site/ + pre-rendered API → public/
import { lstatSync, mkdirSync, rmSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { CrawlResult } from "./types.js";
import { aggregateAgents, aggregatePeople, competitionIndex, openProblems, withEntryCounts } from "./aggregate.js";
import { claimTxt, competitionToMarkdown, feedAtom, feedJson, joinTxt, llmsTxt } from "./render.js";
import { buildProfiles, peopleWithProfiles, profileIndex, withProfiles } from "./profiles.js";
import { pages, renderPage, topicMarkdown } from "./prerender.js";
import { TOPICS } from "./topics.js";
import { applyCorrections, loadCorrections } from "./corrections.js";
import { loadSocial } from "./social.js";
import { loadEvents } from "./events.js";
import { NO_DISCOVERIES, loadDiscoveries } from "./discoveries.js";
import { cardRenderer, type CardRenderer } from "./og.js";
import { loadAgentDocs, withAgentDocs } from "./agentDocs.js";
import { badgeFile, competitionBadge, listedBadge } from "./badge.js";
import { boardJoinFile, boardJoinTxt } from "./boardJoin.js";

// IndexNow (Bing, Yandex, Seznam…): the key is public by design; the file at /{key}.txt proves the site owns it
export const INDEXNOW_KEY = "ad98448484b5c15a593b4febe60a83bc";

// Inventory, not a recursive copy: new assets must be deliberately published.
export const SITE_ASSETS = new Set([
  "index.html", "app.js", "analytics.js", "style.css", "favicon.svg", "favicon-32.png",
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

// What the site publishes: the crawled dataset with the checked corrections applied, the 30/90-day entry counts as of the crawl,
// links to the organizers' own instructions for agents (data/agent-docs.json, when present) and each entry's people's
// profiles (src/profiles.ts)
export function loadPublished(root: string) {
  const crawled = publicDataset(JSON.parse(readFileSync(join(root, "data", "competitions.json"), "utf-8")));
  const corrected = applyCorrections(crawled.competitions, loadCorrections(root, new Set(crawled.competitions.map((c) => c.id))));
  const comps = withAgentDocs(withEntryCounts(corrected, crawled.crawledAt), loadAgentDocs(root));
  return { ...crawled, competitions: withProfiles(comps, buildProfiles(comps)) };
}

export async function build(root = process.cwd()) {
  const ROOT = realpathSync(root);
  const OUT = join(ROOT, "public");
  const data = loadPublished(ROOT);
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
  files.set("index.html", files.has("analytics.js") ? stamped.replace('src="/analytics.js"', `src="/analytics.js?v=${ver("analytics.js")}"`) : stamped);

  const origin = new URL(process.env.SITE_ORIGIN ?? "https://openchallengelist.com");
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("SITE_ORIGIN must be an HTTP(S) origin");
  const ORIGIN = origin.origin;

  const social = loadSocial(ROOT, new Set(data.competitions.map((c) => c.id)));
  const discoveries = loadDiscoveries(ROOT);
  const events = loadEvents(ROOT);

  // Every route as a real page (agents and crawlers that do not run JavaScript), index.html included, with its social card
  // (src/og.ts) when it has one. A card that cannot be drawn leaves that page on /og.jpg rather than block a data deploy.
  const shell = files.get("index.html")!.toString();
  const { profiles } = buildProfiles(data.competitions);
  const all = pages(data, social, discoveries, events, profiles);
  let draw: CardRenderer | null = null;
  try { if (all.some((p) => p.card)) draw = await cardRenderer(); }
  catch (error) { console.warn(`og: cards unavailable, pages keep /og.jpg (${(error as Error).message})`); }
  const started = Date.now();
  let cards = 0, bytes = 0;
  for (const p of all) {
    let png: Buffer | undefined, image: { path: string; alt: string } | undefined;
    if (p.card && draw) {
      try { png = await draw(p.card); }
      catch (error) { console.warn(`og: no card for ${p.path} (${(error as Error).message})`); }
    }
    if (p.card && png) {
      w(p.card.file, png);
      // the hash in the URL: X and others cache a card by its image URL, so new numbers get a new URL
      image = { path: `/${p.card.file}?v=${createHash("sha256").update(png).digest("hex").slice(0, 10)}`, alt: p.card.alt };
      cards++; bytes += png.length;
    }
    const html = renderPage(shell, p, ORIGIN, image);
    if (p.file === "index.html") files.set("index.html", html); else w(p.file, html);
  }
  if (draw) console.log(`og: ${cards} cards, ${Math.round(bytes / 1024)} KB, ${Date.now() - started} ms`);

  const j = (v: unknown) => JSON.stringify(v);
  w("api/competitions.json", j(data));
  w("api/index.json", j({ crawledAt: data.crawledAt, competitions: competitionIndex(data.competitions) }));
  w("api/social.json", j(social));
  w("api/events.json", j(events));
  w("api/discoveries.json", j(discoveries ?? NO_DISCOVERIES));
  w("api/feed.json", j(feedJson(data, ORIGIN)));
  w("feed.xml", feedAtom(data, ORIGIN));
  w("join.txt", joinTxt(data, ORIGIN));
  w("claim.txt", claimTxt(ORIGIN));
  w(`${INDEXNOW_KEY}.txt`, INDEXNOW_KEY);
  const people = peopleWithProfiles(aggregatePeople(data.competitions), data.competitions);
  w("api/people.json", j(people));
  // Profiles: the index for the people page and searches, one file per person for their page and the accounts API
  w("api/profiles.json", j(profileIndex(profiles)));
  for (const p of profiles) w(`api/profiles/${p.slug}.json`, j(p));
  w("api/agents.json", j(aggregateAgents(data.competitions, "author")));
  w("api/agents-subject.json", j(aggregateAgents(data.competitions, "subject")));
  w("api/open-problems.json", j(openProblems(data.competitions)));
  w("api/summary.json", j({
    crawledAt: data.crawledAt,
    competitions: data.competitions,
    people,
    profileCount: profiles.length,
    agents: aggregateAgents(data.competitions, "author"),
    evaluated: aggregateAgents(data.competitions, "subject"),
    openProblems: openProblems(data.competitions),
    social,
    events,
    discoveries: discoveries ?? NO_DISCOVERIES,
    topics: TOPICS,
  }));
  for (const c of data.competitions) {
    w(`api/competitions/${c.id}.json`, JSON.stringify(c, null, 2));
    w(`api/competitions/${c.id}.md`, competitionToMarkdown(c));
    // README badge with the board's live number (src/badge.ts); vercel.json caches /badge/ for an hour
    w(badgeFile(c.id), competitionBadge(c));
    // its own instructions for an agent, served at /c/{id}/join.txt (vercel.json)
    w(boardJoinFile(c.id), boardJoinTxt(c, data.crawledAt, ORIGIN));
  }
  w("badge/listed.svg", listedBadge());
  w("llms.txt", llmsTxt({ ...data, errors: [] }));
  for (const t of TOPICS) w(`topics/${t.slug}.md`, topicMarkdown(t, data, ORIGIN, discoveries));
  // Neutral filename avoids blockers that stall requests for *SUBMISSION*.md.
  w("standard/templates.json", j({ "PROBLEM.md": readSiteAsset(join(ROOT, "site"), "standard/PROBLEM.md").toString(), "SUBMISSION.md": readSiteAsset(join(ROOT, "site"), "standard/SUBMISSION.md").toString() }));

  // Sitemap: static routes, every competition (dated by its latest entry), every model family with records.
  const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
  const day = new Date(data.crawledAt).toISOString().slice(0, 10);
  const families = [...new Set(data.competitions.flatMap((c) => c.problems.flatMap((p) => p.records.map((r) => r.agent?.family).filter((f): f is NonNullable<typeof f> => !!f && f !== "unknown"))))];
  const lastmod = (c: (typeof data.competitions)[number]) => { const d = c.stats.lastSubmission ?? c.lastUpdated; return d && /^\d{4}-\d{2}-\d{2}/.test(d) && d.slice(0, 10) <= day ? d.slice(0, 10) : day; };
  const urls: [string, string, string, string][] = [["/", "daily", "1.0", day], ["/standard", "weekly", "0.9", day], ["/submit", "monthly", "0.6", day], ["/agents", "weekly", "0.8", day], ["/people", "weekly", "0.7", day],
    ...data.competitions.map((c): [string, string, string, string] => [`/c/${encodeURIComponent(c.id)}`, c.stats.recordsLast30d ? "daily" : "weekly", "0.8", lastmod(c)]),
    ...TOPICS.map((t): [string, string, string, string] => [`/topics/${t.slug}`, "daily", "0.9", day]),
    ...families.map((f): [string, string, string, string] => [`/agents/${encodeURIComponent(f)}`, "weekly", "0.5", day]),
    // profiles worth a search result: the ones prerender.ts does not mark noindex
    ...profiles.filter((p) => p.records >= 2 || p.currentBests).map((p): [string, string, string, string] => [`/u/${p.slug}`, "weekly", "0.4", p.lastActive && p.lastActive <= day ? p.lastActive : day])];
  w("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, f, pr, m]) => `  <url><loc>${xml(ORIGIN + p)}</loc><lastmod>${xml(m)}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join("\n")}\n</urlset>\n`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  build().catch((error) => { console.error(error); process.exit(1); });
}
