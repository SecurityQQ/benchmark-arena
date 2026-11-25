// "Fresh discoveries": Lean-verified results just registered on Palomar (https://palomar-registry.org), the public registry of
// Lean 4 formalizations machine-checked at one pinned GitHub commit. The live refresh reads its JSON API (CC0, CORS *; its
// llms.txt asks machines to read JSON, never the pages) into data/discoveries.json; the home page and the math topic show it,
// /api/discoveries.json publishes it. Everything from the registry is third-party text: control characters dropped, lengths
// capped, no abstracts, and the only links are permalinks built here from a validated id and version.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boundedFetch } from "./github.js";

export const REGISTRY = "https://palomar-registry.org";
export const SUBMIT_PROTOCOL = "https://submit.palomar-registry.org/llms.txt";
const API = "https://data.palomar-registry.org/api/v1/results";
const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
export const WINDOW_DAYS = 7;          // today and the six UTC days before it
export const MAX_ITEMS = 60;           // newest first; the counts cover the whole window
// 25 entries a page. The registry takes 20–40 registrations a day, so a week is 6–10 pages; past the cap the oldest day is
// counted short and the file says so (partial).
const MAX_PAGES = 10;
const MAX_PAGE_BYTES = 1024 * 1024;    // the API promises at most 512 KiB
const DAY = 86_400_000;

export interface Discovery {
  source: "palomar";
  id: string;           // PALOMAR-YYYY-MM-DD-NNNNNN
  version: number;
  title: string;        // at most 200 characters
  authors: string[];    // at most 5, each at most 80 characters
  date: string;         // the registration day (UTC), from the id
  at: string;           // when the listed version was published (for version 1, the registration)
  url: string;          // the registry's permalink for this version
  repo?: string;        // owner/name of the Lean source on GitHub
  subjects: string[];   // arXiv categories
}

export interface Discoveries {
  fetchedAt: string;
  totals: { results: number; projects: number };  // the whole registry
  days: Record<string, number>;                     // registrations per UTC day in the window, newest day first
  partial?: true;                                   // the page cap stopped the walk inside the window: the oldest day is counted short
  items: Discovery[];                               // newest first, at most MAX_ITEMS
}

// ─── Third-party text ───────────────────────────────────────────────────
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** A plain string with control and bidi characters dropped, whitespace collapsed, clipped to n code points; anything else is nothing. */
export function text(v: unknown, n: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  const cp = Array.from(s);
  return cp.length > n ? `${cp.slice(0, n - 1).join("").trimEnd()}…` : s;
}
const ID = /^PALOMAR-(\d{4}-\d{2}-\d{2})-\d{6}$/;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const SUBJECT = /^[a-z][a-z-]{0,15}(?:\.[A-Za-z][A-Za-z-]{0,15})?$/;   // math.CO, math-ph, cond-mat.mes-hall
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && utcDay(Date.parse(d)) === d;
const count = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
export const permalink = (id: string, version: number) => `${REGISTRY}/entry?id=${id}&version=${version}`;

/** One result as this site keeps it, from the API's fields or from a stored item: whatever fails a rule is dropped or omitted. */
function discovery(x: { id: unknown; version: unknown; title: unknown; authors: unknown[]; at: unknown; repo: unknown; subjects: unknown[] }): Discovery | undefined {
  const m = typeof x.id === "string" ? ID.exec(x.id) : null;
  if (!m || !isDay(m[1]) || !Number.isSafeInteger(x.version) || (x.version as number) < 1 || (x.version as number) > 9999) return undefined;
  const id = x.id as string, version = x.version as number, title = text(x.title, 200);
  if (!title) return undefined;
  const t = typeof x.at === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(x.at) ? Date.parse(x.at) : NaN;
  const repo = typeof x.repo === "string" && REPO.test(x.repo) ? x.repo : undefined;
  return {
    source: "palomar", id, version, title,
    authors: x.authors.map((a) => text(a, 80)).filter((a): a is string => !!a).slice(0, 5),
    date: m[1],
    at: Number.isFinite(t) ? new Date(t).toISOString().replace(".000Z", "Z") : `${m[1]}T00:00:00Z`,
    url: permalink(id, version),
    ...(repo ? { repo } : {}),
    subjects: [...new Set(x.subjects.filter((s): s is string => typeof s === "string" && SUBJECT.test(s)))].slice(0, 6),
  };
}

/** An entry of GET /api/v1/results. The abstract and the rest of the record are not read. */
export function fromEntry(raw: unknown): Discovery | undefined {
  const e = obj(raw);
  if (!e || (e.status !== undefined && e.status !== "registered")) return undefined;
  return discovery({
    id: e.id, version: e.version, title: e.title, at: e.published_at,
    authors: list(e.authors).map((a) => obj(a)?.name),
    repo: obj(e.source)?.repository,
    subjects: list(obj(e.classification)?.arxiv),
  });
}

function totalsOf(raw: unknown): Discoveries["totals"] | undefined {
  const t = obj(raw);
  return t && count(t.results, 1e8) && count(t.projects, 1e8) ? { results: t.results, projects: t.projects } : undefined;
}

// ─── Fetch ──────────────────────────────────────────────────────────────
export type GetJson = (url: string) => Promise<{ status: number; body?: unknown }>;

async function httpGet(url: string): Promise<{ status: number; body?: unknown }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } }, MAX_PAGE_BYTES, 20_000);
      if (r.status === 409) { await r.body?.cancel().catch(() => {}); return { status: 409 }; }
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      return { status: r.status, body: await r.json() };
    } catch {
      if (attempt >= 1) throw new Error("Palomar download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Results registered in the last WINDOW_DAYS UTC days, newest first: the listing in registration order, cursor by cursor
 * with the same filters, until an entry is older than the window or MAX_PAGES pages. HTTP 409 means the registry changed
 * under the cursor: the walk restarts from the first page, once.
 */
export async function fetchDiscoveries({ get = httpGet, now = Date.now() }: { get?: GetJson; now?: number } = {}): Promise<Discoveries> {
  const from = utcDay(now - (WINDOW_DAYS - 1) * DAY);
  const first = `${API}?order=registered&from=${from}`;
  for (let restart = 0; ; restart++) {
    const items: Discovery[] = [], days: Record<string, number> = {}, seen = new Set<string>();
    let totals: Discoveries["totals"] | undefined, url: string | undefined = first, pages = 0, partial = false, changed = false;
    while (url) {
      if (pages >= MAX_PAGES) { partial = true; break; }
      const res = await get(url);
      pages++;
      if (res.status === 409) { changed = true; break; }
      const page = obj(res.body);
      if (res.status !== 200 || !page || page.schema_version !== 1 || !Array.isArray(page.entries)) throw new Error("Palomar answered in an unexpected shape");
      totals ??= totalsOf(page.totals);
      if (!totals) throw new Error("Palomar answered without totals");
      let older = false;
      for (const e of page.entries.slice(0, 100)) {
        const d = fromEntry(e);
        if (!d || seen.has(d.id)) continue;
        if (d.date < from) { older = true; continue; }
        seen.add(d.id);
        days[d.date] = (days[d.date] ?? 0) + 1;
        if (items.length < MAX_ITEMS) items.push(d);
      }
      const next = page.next;
      url = !older && typeof next === "string" && next.length > 0 && next.length <= 4096 ? `${first}&cursor=${encodeURIComponent(next)}` : undefined;
    }
    if (changed) {
      if (restart >= 1) throw new Error("Palomar registry kept changing");
      continue;
    }
    if (!totals) throw new Error("Palomar answered without totals");
    return {
      fetchedAt: new Date(now).toISOString(), totals,
      days: Object.fromEntries(Object.entries(days).sort(([a], [b]) => b.localeCompare(a))),
      ...(partial ? { partial: true as const } : {}),
      items: items.sort((a, b) => b.id.localeCompare(a.id)),
    };
  }
}

// ─── The stored file ────────────────────────────────────────────────────
/** data/discoveries.json is data like the crawl output: every field is checked again, and the links are rebuilt. */
export function validDiscoveries(raw: unknown): Discoveries | null {
  const d = obj(raw), totals = totalsOf(d?.totals);
  if (!d || !totals || typeof d.fetchedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(d.fetchedAt) || !Number.isFinite(Date.parse(d.fetchedAt))) return null;
  const days = Object.entries(obj(d.days) ?? {}).filter(([k, n]) => isDay(k) && count(n, 100_000)).sort(([a], [b]) => b.localeCompare(a)).slice(0, 31);
  const seen = new Set<string>();
  const items = list(d.items).slice(0, MAX_ITEMS).map((raw) => {
    const i = obj(raw);
    return i && discovery({ id: i.id, version: i.version, title: i.title, authors: list(i.authors), at: i.at, repo: i.repo, subjects: list(i.subjects) });
  }).filter((i): i is Discovery => !!i && !seen.has(i.id) && !!seen.add(i.id)).sort((a, b) => b.id.localeCompare(a.id));
  return { fetchedAt: d.fetchedAt, totals, days: Object.fromEntries(days) as Record<string, number>, ...(d.partial === true ? { partial: true as const } : {}), items };
}

const fileOf = (root: string) => join(root, "data", "discoveries.json");

export function loadDiscoveries(root: string): Discoveries | null {
  const path = fileOf(root);
  return existsSync(path) ? validDiscoveries(JSON.parse(readFileSync(path, "utf-8"))) : null;
}

/** What /api/discoveries.json serves before the first refresh */
export const NO_DISCOVERIES = { fetchedAt: null, totals: null, days: {}, items: [] };

/**
 * The live refresh: fetch, check, and write data/discoveries.json only when what it shows changed (a new registration, a day
 * leaving the window), so a quiet registry does not commit and redeploy every run. Any failure keeps the previous file.
 */
export async function refreshDiscoveries(root: string, fetchIt: () => Promise<Discoveries> = () => fetchDiscoveries()): Promise<"updated" | "unchanged" | "failed"> {
  const path = fileOf(root);
  let next: Discoveries | null;
  try {
    next = validDiscoveries(await fetchIt());
    if (!next) throw new Error("invalid");
  } catch {
    console.log("  Palomar: refresh failed, keeping the previous discoveries");
    return "failed";
  }
  let prev: Discoveries | null = null;
  try { prev = existsSync(path) ? validDiscoveries(JSON.parse(readFileSync(path, "utf-8"))) : null; } catch { /* rewritten below */ }
  const shown = (d: Discoveries) => JSON.stringify({ ...d, fetchedAt: "" });
  const week = Object.values(next.days).reduce((s, n) => s + n, 0);
  if (prev && shown(prev) === shown(next)) {
    console.log(`  ✓ Palomar: ${week}${next.partial ? "+" : ""} results in ${WINDOW_DAYS} days, nothing new`);
    return "unchanged";
  }
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  console.log(`  ✓ Palomar: ${week}${next.partial ? "+" : ""} results in ${WINDOW_DAYS} days, ${next.items.length} kept`);
  return "updated";
}

// ─── What the pages show ────────────────────────────────────────────────
/** The window as of `now`: how many registrations, how many today (UTC), and the items still inside it. */
export function discoveryView(d: Discoveries, now: number) {
  const today = utcDay(now), from = utcDay(now - (WINDOW_DAYS - 1) * DAY);
  const items = d.items.filter((i) => i.date >= from);
  const counted = Object.entries(d.days).reduce((s, [k, n]) => s + (k >= from ? n : 0), 0);
  const week = Math.max(counted, items.length);
  return { week, today: d.days[today] ?? 0, plus: !!d.partial, items };
}

export const authorLine = (authors: string[]) => (authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", "));
export const discoveryHeadline = (v: ReturnType<typeof discoveryView>) =>
  `${v.week.toLocaleString("en-US")}${v.plus ? "+" : ""} Lean-verified ${v.week === 1 && !v.plus ? "result" : "results"} registered in the last ${WINDOW_DAYS} days${v.today ? `, ${v.today.toLocaleString("en-US")} today` : ""}.`;
