// Events: in-person meetups for people entering the listed challenges, curated in data/events.json. Each links to its public
// RSVP page; the file is data, so it is validated like crawl output, and only the neighbourhood and city are shown, never an address.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TOPICS } from "./topics.js";

export interface CommunityEvent {
  url: string;        // the public RSVP page
  title: string;
  start: string;      // ISO 8601 instant
  end?: string;
  timezone: string;   // IANA zone the times are shown in
  place: string;      // neighbourhood and city
  about: string;      // from the organizer's page, at most 300 characters
  topics: string[];   // slugs of related topic hubs
}

const RSVP_URL = /^https:\/\/(partiful\.com\/e|lu\.ma|luma\.com|www\.eventbrite\.com\/e|www\.meetup\.com)\/[A-Za-z0-9_/-]{1,200}$/;
export const RSVP_SITES: Record<string, string> = { "partiful.com": "Partiful", "lu.ma": "Luma", "luma.com": "Luma", "www.eventbrite.com": "Eventbrite", "www.meetup.com": "Meetup" };
const instant = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const line = (v: unknown, max: number) => typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : undefined;
function zone(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(v)) return undefined;
  try { new Intl.DateTimeFormat("en-US", { timeZone: v }); return v; } catch { return undefined; }
}

export function validEvents(raw: unknown): CommunityEvent[] {
  const list = Array.isArray((raw as { events?: unknown })?.events) ? (raw as { events: unknown[] }).events : [];
  const slugs = new Set(TOPICS.map((t) => t.slug)), out: CommunityEvent[] = [];
  for (const e of list as Record<string, unknown>[]) {
    const url = typeof e?.url === "string" && RSVP_URL.test(e.url) ? e.url : undefined;
    const title = line(e?.title, 120), place = line(e?.place, 80), about = line(e?.about, 300), timezone = zone(e?.timezone);
    if (!url || !title || !place || !about || !timezone || !instant(e.start)) continue;
    if (e.end !== undefined && (!instant(e.end) || Date.parse(e.end as string) < Date.parse(e.start as string))) continue;
    out.push({
      url, title, start: e.start as string, ...(e.end === undefined ? {} : { end: e.end as string }), timezone, place, about,
      topics: Array.isArray(e.topics) ? e.topics.filter((t): t is string => typeof t === "string" && slugs.has(t)) : [],
    });
  }
  return out;
}

/** Upcoming first (soonest first), then past ones (latest first), as of `now`. */
export function orderedEvents(events: CommunityEvent[], now: number): (CommunityEvent & { past: boolean })[] {
  const ends = (e: CommunityEvent) => Date.parse(e.end ?? e.start);
  const marked = events.map((e) => ({ ...e, past: ends(e) < now }));
  return [...marked.filter((e) => !e.past).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    ...marked.filter((e) => e.past).sort((a, b) => Date.parse(b.start) - Date.parse(a.start))];
}

/** "Sat, Nov 7, 2026 · 1:30 PM–3:00 PM PST" in the event's own time zone. site/app.js has the twin. */
export function eventWhen(e: CommunityEvent): string {
  const day = (t: string) => new Intl.DateTimeFormat("en-US", { timeZone: e.timezone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
  const time = (t: string, zoneName: boolean) => new Intl.DateTimeFormat("en-US", { timeZone: e.timezone, hour: "numeric", minute: "2-digit", ...(zoneName ? { timeZoneName: "short" as const } : {}) }).format(new Date(t));
  return `${day(e.start)} · ${e.end && day(e.end) === day(e.start) ? `${time(e.start, false)}–${time(e.end, true)}` : time(e.start, true)}`;
}

export function loadEvents(root: string): CommunityEvent[] {
  const path = join(root, "data", "events.json");
  return existsSync(path) ? validEvents(JSON.parse(readFileSync(path, "utf-8"))) : [];
}
