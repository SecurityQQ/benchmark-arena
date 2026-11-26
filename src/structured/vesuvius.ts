// Deterministic builder for the Vesuvius Challenge (scrollprize.org): read the Herculaneum scrolls, carbonized by Vesuvius in
// 79 AD, from X-ray CT scans with machine learning and geometry. Its GitHub repositories are code (ScrollPrize/villa), not the
// competition, so it is a site source (main.ts SITES). Source (public, no login):
//   https://scrollprize.org/prizes — the open prize pool, the 2027 milestone prizes and their deadline, the next monthly deadline
// No LLM involved. One track per open prize; prizes are awarded by the Vesuvius Challenge team after review, and the page
// publishes no ranked scores, so the tracks carry no records.

import type { LLMCompetition } from "../llm.js";
import type { Problem } from "../types.js";
import { boundedFetch } from "../github.js";

export const SITE = "https://scrollprize.org";
export const PRIZES = `${SITE}/prizes`;
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const MAX_BYTES = 2 * 1024 * 1024;

async function page(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(url, { headers: { accept: "text/html", "user-agent": USER_AGENT } }, MAX_BYTES, 30_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      return await r.text();
    } catch {
      if (attempt >= 1) throw new Error("Vesuvius Challenge download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** The page as plain text: tags, scripts and entities out, whitespace collapsed */
export function plainText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|​/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;|’/g, "'").replace(/\s+/g, " ").trim();
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// "June 25th, 2027" → "2027-06-25"; anything else → undefined
export function isoDay(month: string, day: string, year: string): string | undefined {
  const m = MONTHS.indexOf(month.toLowerCase());
  const iso = `${year}-${String(m + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return m >= 0 && Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso ? iso : undefined;
}
const DATE = "([A-Z][a-z]{2,8})\\s+(\\d{1,2})(?:st|nd|rd|th)?,\\s*(20\\d\\d)";

export interface PrizeFacts { pool?: number; grandDeadline?: string; monthlyDeadline?: string; grandPrize?: number; firstLetters?: number; title?: number; monthly?: number }
export function prizeFacts(text: string): PrizeFacts {
  const money = (re: RegExp) => { const m = text.match(re); const n = m ? Number(m[1].replace(/,/g, "")) : NaN; return Number.isFinite(n) && n > 0 ? n : undefined; };
  const day = (re: RegExp) => { const m = text.match(re); return m ? isoDay(m[1], m[2], m[3]) : undefined; };
  return {
    pool: money(/Open prize pool\s*\$([\d,]+)/),
    grandDeadline: day(new RegExp(`Grand Prize deadline\\s+${DATE}`)),
    monthlyDeadline: day(new RegExp(`next deadline is[^,]{0,40},\\s*${DATE}`)),
    grandPrize: money(/\$([\d,]+)\s*in total\. Prizes are awarded/),
    firstLetters: money(/First Letters:\s*\$([\d,]+)\s*per scroll/),
    title: money(/Title:\s*\$([\d,]+)\s*to the first team to discover the title/),
    monthly: money(/Best Submission of the Month:\s*\$([\d,]+)/),
  };
}

export function statusOf(f: PrizeFacts, today = new Date().toISOString().slice(0, 10)): "active" | "ended" | "unknown" {
  if (!f.grandDeadline) return "unknown";
  return f.grandDeadline >= today ? "active" : "ended";
}

const usd = (n: number | undefined) => (n ? `$${n.toLocaleString("en-US")}` : undefined);

export async function buildVesuvius(today?: string): Promise<LLMCompetition> {
  const f = prizeFacts(plainText(await page(PRIZES)));
  if (!f.grandDeadline && !f.pool) throw new Error("Vesuvius Challenge download failed");
  const status = statusOf(f, today);
  console.log(`    vesuvius-challenge: ${status}, pool ${usd(f.pool) ?? "?"}, grand deadline ${f.grandDeadline ?? "unknown"}, next monthly ${f.monthlyDeadline ?? "unknown"}`);

  const track = (id: string, name: string, description: string, metricName: string): Problem => ({ id, name, description, metricName, metricDirection: "maximize", isOpen: true, records: [] });
  const problems: Problem[] = [
    track("grand-prize-2027", `2027 Grand Prize${f.grandPrize ? ` (${usd(f.grandPrize)} in total)` : ""}`,
      `Fully unroll one of the eligible scroll scans and make it readable. First place takes the largest share, with prizes for second to fourth.${f.grandDeadline ? ` Deadline ${f.grandDeadline}.` : ""}`, "scroll unrolled and readable"),
    track("first-letters", `First Letters${f.firstLetters ? ` (${usd(f.firstLetters)} per scroll)` : ""}`,
      "The first team to uncover 10 letters within a single 4 cm² area of an eligible scroll, and open source the code, data and weights, wins that scroll's prize.", "letters uncovered in 4 cm²"),
    track("title-pherc-paris-4", `The title of PHerc. Paris. 4${f.title ? ` (${usd(f.title)})` : ""}`,
      "The first team to discover this scroll's title tells scholars what, and whom, they have been reading.", "title recovered"),
    track("monthly-progress", `Monthly progress prizes${f.monthly ? ` (best of the month ${usd(f.monthly)})` : ""}`,
      `Open-source contributions that help read the scrolls, judged every month.${f.monthlyDeadline ? ` Next deadline ${f.monthlyDeadline}.` : ""}`, "significance of the contribution"),
  ];

  return {
    id: "vesuvius-challenge",
    name: "Vesuvius Challenge",
    tagline: "Read the Herculaneum scrolls, carbonized by Vesuvius in 79 AD, from X-ray CT scans: unroll them virtually and find the ink with machine learning.",
    description: [
      "Hundreds of papyrus scrolls from a Roman villa at Herculaneum were carbonized by the eruption of Mount Vesuvius in 79 AD; they cannot be opened without destroying them.",
      "The Vesuvius Challenge, founded by Nat Friedman, Daniel Gross and Brent Seales, publishes high-resolution X-ray CT scans of them and pays for every step toward reading them: virtually unrolling the papyrus surface, detecting ink that is almost invisible in the scans, and turning it into text scholars can read.",
      `${f.pool ? `${usd(f.pool)} is open in prizes. ` : ""}The 2027 milestone prizes go to the first teams to fully unroll a scroll, uncover the first letters of new scrolls, or recover a title; monthly prizes reward open-source progress.`,
      "Winners are verified by the challenge's technical team and papyrologists, and results are open-sourced.",
    ].join(" "),
    url: `${PRIZES}`,
    host: "website",
    status,
    tags: ["computer-vision", "ct-scanning", "segmentation", "ink-detection", "papyrology", "machine-learning", "open-science"],
    domain: "ml-research",
    images: [],
    organizer: { name: "Vesuvius Challenge (Scroll Prize)", url: `${SITE}/`, type: "community" },
    participation: {
      howToSubmit: `Read the rules on ${PRIZES}, get the scan data through ${SITE}/data, and send each result through the submission form linked under its prize. Monthly submissions are judged every month; the milestone prizes go to the first team that meets the stated conditions.`,
      submissionFormat: "A write-up with the method, the images or text produced, and the open-source code, data and model weights the prize requires.",
      requirements: ["The CT scan data (several terabytes per scroll; subsets are enough to start)", "Python with volume segmentation and ink detection tooling (the ScrollPrize/villa repository)"],
      compute: "consumer-gpu",
      computeDetails: "Ink detection models train on a single modern GPU; full-scroll unrolling pipelines need more storage and compute.",
      ...(f.grandDeadline ? { deadline: f.grandDeadline } : {}),
      rounds: `Milestone prizes until ${f.grandDeadline ?? "the 2027 deadline"}; monthly progress prizes${f.monthlyDeadline ? `, next deadline ${f.monthlyDeadline}` : ""}.`,
      prizes: [f.pool && `${usd(f.pool)} open prize pool`, f.grandPrize && `2027 Grand Prize ${usd(f.grandPrize)} in total`, f.firstLetters && `First Letters ${usd(f.firstLetters)} per scroll`, f.title && `${usd(f.title)} for the title of PHerc. Paris. 4`, f.monthly && `best monthly submission ${usd(f.monthly)}`].filter(Boolean).join("; ") || "See the prizes page",
      eligibility: "Teams or individuals; see the rules on the prizes page.",
      cost: "free",
      verification: "The Vesuvius Challenge technical team reproduces each claim and papyrologists judge legibility; the Grand Prize pipeline must be largely automated.",
    },
    venue: { type: "online" },
    links: [
      { label: "Prizes and rules", url: PRIZES },
      { label: "Data", url: `${SITE}/data` },
      { label: "Code (ScrollPrize/villa)", url: "https://github.com/ScrollPrize/villa" },
      { label: "Get started", url: `${SITE}/get_started` },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
