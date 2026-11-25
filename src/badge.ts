// README badges, shields.io style: /badge/c/{id}.svg with a board's live number, linking to its page. Organizers put them in
// their READMEs; that is a link to the board from the repository, the place where people and agents already look.
// Only fixed strings and numbers go into a badge, never a competition's name or any crawled text.
import type { Competition } from "./types.js";
import { SITE } from "./render.js";

export const BADGE_LABEL = "open challenge list";
// The board page's one sentence for the organizer (prerender.ts; app.js says the same)
export const BADGE_NOTE = "Add this badge to your README: it shows this listing's live numbers and links here.";
export const BADGE_COLORS = { entries: "#4c1", open: "#007ec6", upcoming: "#607d8b", listed: "#9f9f9f" } as const;
const DARK = "#555";

export const badgeFile = (id: string) => `badge/c/${id}.svg`;
export const badgeUrl = (id: string, origin = SITE) => `${origin}/badge/c/${encodeURIComponent(id)}.svg`;
/** The Markdown an organizer pastes into a README. */
export const badgeMarkdown = (id: string, origin = SITE) => `[![Open Challenge List](${badgeUrl(id, origin)})](${origin}/c/${encodeURIComponent(id)})`;
export const BADGE_PATTERN = `[![Open Challenge List](${SITE}/badge/c/{id}.svg)](${SITE}/c/{id})`;

export interface BadgeMessage { kind: keyof typeof BADGE_COLORS; text: string; color: string }

const count = (n: unknown) => (typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : 0);

/** Entries in the last 30 days (the board page's number), else open tracks on a board that has not ended, else its status. */
export function badgeMessage(c: Pick<Competition, "status" | "problems" | "stats">): BadgeMessage {
  const entries = count(c.stats?.recordsLast30d);
  if (entries) return { kind: "entries", text: `${entries} ${entries === 1 ? "entry" : "entries"} in 30 days`, color: BADGE_COLORS.entries };
  const open = c.status === "ended" ? 0 : (c.problems ?? []).filter((p) => p.isOpen).length;
  if (open) return { kind: "open", text: `${open} open ${open === 1 ? "track" : "tracks"}`, color: BADGE_COLORS.open };
  return c.status === "upcoming" ? { kind: "upcoming", text: "upcoming", color: BADGE_COLORS.upcoming } : { kind: "listed", text: "listed", color: BADGE_COLORS.listed };
}

// Advance widths of Verdana at 11px (shields' font), from the font's hmtx table (unitsPerEm 2048), rounded up to 0.01 px.
// Anything else counts as wider than any glyph here, so an estimate never falls short.
const VERDANA_11: Record<string, number> = {
  " ": 3.87, a: 6.61, b: 6.86, c: 5.74, d: 6.86, e: 6.56, f: 3.87, g: 6.86, h: 6.97, i: 3.02, j: 3.79, k: 6.51, l: 3.02, m: 10.7,
  n: 6.97, o: 6.68, p: 6.86, q: 6.86, r: 4.7, s: 5.74, t: 4.34, u: 6.97, v: 6.51, w: 9.01, x: 6.51, y: 6.51, z: 5.78,
  ...Object.fromEntries([..."0123456789"].map((d) => [d, 7])),
};
const WIDEST = 11;

/** Width of a text in Verdana 11px, whole pixels, rounded up. */
export function textWidth(s: string): number {
  return Math.ceil([...s].reduce((w, ch) => w + (VERDANA_11[ch] ?? WIDEST), 0) - 1e-9);
}

const xml = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const PAD = 5; // each side of a text, as shields does

export interface BadgeLayout { width: number; label: { width: number; text: number }; message: { width: number; text: number } }
export function badgeLayout(label: string, message: string): BadgeLayout {
  const l = textWidth(label), m = textWidth(message);
  return { width: l + m + 4 * PAD, label: { width: l + 2 * PAD, text: l }, message: { width: m + 2 * PAD, text: m } };
}

/** A flat shields-style badge: label on dark grey, message on a color. textLength holds each text to its box in any font. */
export function badgeSvg(label: string, message: string, color: string): string {
  const L = badgeLayout(label, message), title = `${label}: ${message}`;
  const fill = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color) ? color : BADGE_COLORS.listed;
  // text coordinates in tenths of a pixel (font-size 110, scale .1), as shields does for sub-pixel placement
  const text = (s: string, center: number, length: number) =>
    `<text aria-hidden="true" x="${center * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${length * 10}">${xml(s)}</text>` +
    `<text x="${center * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${length * 10}">${xml(s)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="20" role="img" aria-label="${xml(title)}"><title>${xml(title)}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${L.width}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${L.label.width}" height="20" fill="${DARK}"/><rect x="${L.label.width}" width="${L.message.width}" height="20" fill="${xml(fill)}"/><rect width="${L.width}" height="20" fill="url(#s)"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">` +
    text(label, L.label.width / 2, L.label.text) + text(message, L.label.width + L.message.width / 2, L.message.text) +
    `</g></svg>\n`;
}

export const competitionBadge = (c: Pick<Competition, "status" | "problems" | "stats">) => {
  const m = badgeMessage(c);
  return badgeSvg(BADGE_LABEL, m.text, m.color);
};
// For a README that wants the mark without a board's numbers
export const listedBadge = () => badgeSvg(BADGE_LABEL, "listed", BADGE_COLORS.listed);
