// "From the community": public posts by people entering the listed challenges, curated in data/social.json.
// Each post is a short verbatim excerpt that links to the original; the file is data, so it is validated like crawl output.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SocialPost {
  url: string;          // https://x.com/{handle}/status/{id}
  author: string;       // handle, without @
  name?: string;        // display name
  date: string;         // YYYY-MM-DD
  text: string;         // verbatim excerpt, at most 280 characters
  competition: string;  // id of a listed competition the post is about
  likes?: number;
}

const POST_URL = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})$/;

export function validSocial(raw: unknown, competitionIds: Set<string>): SocialPost[] {
  const posts = Array.isArray((raw as { posts?: unknown })?.posts) ? (raw as { posts: unknown[] }).posts : [];
  const out: SocialPost[] = [];
  for (const p of posts as Record<string, unknown>[]) {
    const url = typeof p?.url === "string" ? p.url : "", m = POST_URL.exec(url);
    if (!m || typeof p.author !== "string" || p.author.toLowerCase() !== m[1].toLowerCase()) continue;
    if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) continue;
    if (typeof p.text !== "string" || !p.text.trim() || p.text.length > 280) continue;
    if (typeof p.competition !== "string" || !competitionIds.has(p.competition)) continue; // a post about something we don't list is not shown
    out.push({
      url, author: m[1], date: p.date, text: p.text.trim(), competition: p.competition,
      ...(typeof p.name === "string" && p.name.trim() ? { name: p.name.trim().slice(0, 50) } : {}),
      ...(Number.isSafeInteger(p.likes) && (p.likes as number) >= 0 ? { likes: p.likes as number } : {}),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function loadSocial(root: string, competitionIds: Set<string>): SocialPost[] {
  const path = join(root, "data", "social.json");
  return existsSync(path) ? validSocial(JSON.parse(readFileSync(path, "utf-8")), competitionIds) : [];
}
