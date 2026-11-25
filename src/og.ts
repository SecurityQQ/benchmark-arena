// Social preview cards (og:image / twitter:image): a 1200×630 PNG for the home page, each topic and each competition, with the
// numbers that page shows. Rendered at build time (satori lays the card out as SVG with the glyphs as paths, resvg rasterizes it),
// so every data commit redeploys them with the live counts; the URL carries a hash of the image, so a re-scrape sees a new one.
// Fonts are the site's own (Source Serif 4, Inter, JetBrains Mono; SIL OFL 1.1) read from @fontsource in node_modules: no network.
// Card text is crawled third-party data: the builders in src/prerender.ts pass it through plain() (control and bidi characters
// dropped, clipped), satori takes it as text, never markup, and drawable() keeps only characters the fonts can draw.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { text } from "./discoveries.js";

export const OG_WIDTH = 1200, OG_HEIGHT = 630;

export interface Card {
  file: string;                               // where the PNG is published: og/home.png, og/topics/{slug}.png, og/c/{id}.png
  eyebrow: string;
  title: string;
  subtitle?: string;
  stats: { value: number; label: string }[];  // at most four
  notes: string[];                            // one line of facts under the numbers
  action: string;                             // the footer's right side
  alt: string;                                // og:image:alt: the card in words
}

/** Third-party text as one plain line: control and bidi characters dropped, whitespace collapsed, clipped to n code points. */
export const plain = (s: unknown, n: number) => text(s, n) ?? "";

/** The card in words, for og:image:alt and twitter:image:alt */
export function cardAlt(c: Pick<Card, "title" | "stats" | "notes">): string {
  const stats = c.stats.map((s) => `${s.value.toLocaleString("en-US")} ${s.label}`).join(", ");
  return [c.title, stats, ...c.notes, "openchallengelist.com"].filter(Boolean).map((s) => (/[.!?…]$/.test(s) ? s : `${s}.`)).join(" ").slice(0, 420);
}

// The subsets loaded below (fontsource unicode.json: latin, latin-ext, greek, cyrillic). A character outside them would draw as a
// box, so a few math symbols get their ASCII spelling and anything else (CJK, emoji, arrows) is left out.
const DRAWABLE = /[ -~ -˿Ͱ-ϿЀ-џḀ-ỿ‐-‧‰-⁞€™−]/u;
const ASCII: Record<string, string> = { "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~", "→": "->", "←": "<-", "⇒": "=>", "∞": "inf" };
export const drawable = (s: string) => Array.from(s, (ch) => (DRAWABLE.test(ch) ? ch : ASCII[ch] ?? " ")).join("").replace(/\s+/g, " ").trim();

// ─── Layout ─────────────────────────────────────────────────────────────
// The site's palette and type (site/style.css): cream canvas, ink text, serif headlines, mono eyebrows, an ink band at the foot.
const INK = "#141413", INK_SOFT = "#3D3D3A", MUTED = "#5E5D59", CANVAS = "#FAF9F5", CLAY = "#D97757", LINE = "rgba(20,20,19,.14)";
// Each subset is its own family: satori falls back from one family to the next for a glyph the first one lacks
const SANS = `"Sans", "Sans Ext", "Sans Greek", "Sans Cyrillic"`;
const SERIF = `"Serif", "Serif Ext", "Serif Greek", "Serif Cyrillic", ${SANS}`;
const MONO = `"Mono", ${SANS}`;

type Child = Node | string;
type Node = { type: "div"; props: { style: Record<string, unknown>; children?: Child | Child[] } };
const el = (style: Record<string, unknown>, children?: Child | Child[]): Node => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
const clamp = (lines: number, style: Record<string, unknown>, s: string) => el({ ...style, display: "block", lineClamp: lines }, s);

// Two lines at most: a short name large, a long one smaller and cut with an ellipsis. The sizes leave room for a two-line
// title, a two-line subtitle, the numbers and the notes above the footer band.
const titleSize = (t: string) => (t.length <= 24 ? 80 : t.length <= 44 ? 66 : 56);

export function cardTree(c: Card): Node {
  const title = drawable(c.title), subtitle = drawable(c.subtitle ?? ""), notes = c.notes.map(drawable).filter(Boolean).join("  ·  ");
  return el({ width: OG_WIDTH, height: OG_HEIGHT, flexDirection: "column", background: CANVAS, color: INK, fontFamily: SANS }, [
    el({ flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden", padding: "46px 72px 32px" }, [
      clamp(1, { fontFamily: MONO, fontSize: 22, letterSpacing: 2.5, textTransform: "uppercase", color: MUTED }, drawable(c.eyebrow)),
      clamp(2, { marginTop: 16, fontFamily: SERIF, fontSize: titleSize(title), lineHeight: 1.06, letterSpacing: -1 }, title),
      ...(subtitle ? [clamp(2, { marginTop: 12, fontSize: 27, lineHeight: 1.32, color: MUTED }, subtitle)] : []),
      el({ flexGrow: 1, minHeight: 22 }),
      ...(c.stats.length ? [el({ alignItems: "flex-start", flexShrink: 0 }, c.stats.slice(0, 4).map((s, i) =>
        el({ flexDirection: "column", paddingLeft: i ? 32 : 0, marginLeft: i ? 32 : 0, borderLeft: i ? `1px solid ${LINE}` : "none", maxWidth: 300 }, [
          el({ fontFamily: SERIF, fontSize: 68, lineHeight: 1, letterSpacing: -1 }, s.value.toLocaleString("en-US")),
          el({ marginTop: 8, fontSize: 26, lineHeight: 1.25, color: MUTED }, drawable(s.label)),
        ])))] : []),
      ...(notes ? [clamp(1, { marginTop: 16, flexShrink: 0, fontSize: 27, lineHeight: 1.3, color: INK_SOFT }, notes)] : []),
    ]),
    el({ height: 70, flexShrink: 0, alignItems: "center", justifyContent: "space-between", padding: "0 72px", background: INK, color: CANVAS, fontFamily: MONO, fontSize: 24 }, [
      el({ alignItems: "center" }, [el({ width: 14, height: 14, borderRadius: 3, background: CLAY, marginRight: 16 }), "openchallengelist.com"]),
      el({ color: "#E8E6DC" }, drawable(c.action)),
    ]),
  ]);
}

// ─── Rendering ──────────────────────────────────────────────────────────
const FONTS: [name: string, pkg: string, subset: string, weight: 400 | 500][] = [
  ["Serif", "source-serif-4", "latin", 500], ["Serif Ext", "source-serif-4", "latin-ext", 500],
  ["Serif Greek", "source-serif-4", "greek", 500], ["Serif Cyrillic", "source-serif-4", "cyrillic", 500],
  ["Sans", "inter", "latin", 400], ["Sans Ext", "inter", "latin-ext", 400], ["Sans Greek", "inter", "greek", 400], ["Sans Cyrillic", "inter", "cyrillic", 400],
  ["Mono", "jetbrains-mono", "latin", 500],
];

export type CardRenderer = (c: Card) => Promise<Buffer>;

/** satori + resvg with the fonts read once. Throws if either cannot load; the build then keeps /og.jpg on every page. */
export async function cardRenderer(): Promise<CardRenderer> {
  const [{ default: satori }, { Resvg }] = await Promise.all([import("satori"), import("@resvg/resvg-js")]);
  const require = createRequire(import.meta.url);
  const fonts = FONTS.map(([name, pkg, subset, weight]) => ({
    name, weight, style: "normal" as const,
    data: readFileSync(join(dirname(require.resolve(`@fontsource/${pkg}/LICENSE`)), "files", `${pkg}-${subset}-${weight}-normal.woff`)),
  }));
  return async (c) => {
    const svg = await satori(cardTree(c) as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts });
    return new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: "original" } }).render().asPng();
  };
}
