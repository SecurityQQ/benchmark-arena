// Deterministic builder for First Proof (1stproof.org), research-level math graded by human referees.
// Every number is read from official artifacts on each crawl, nothing is transcribed by hand:
//   1. arXiv API, title "First Proof <Nth> Batch"   — one report per graded batch (batch 1 was ungraded)
//   2. arXiv LaTeX source of each report            — systems, problems, \editorialdecision per submission, cost table
//   3. github.com/1stproof/batch-N (git tree)       — links to each AI solution and its referee reports
//   4. 1stproof.org navigation + batch pages        — the batch in progress: application deadline, results date
// A new batch shows up by itself once its report is on arXiv. Failures throw, so the crawler keeps the previous entry.

import { gunzipSync } from "node:zlib";
import type { LLMCompetition } from "../llm.js";
import type { AgentAttribution, Problem, RecordEntry } from "../types.js";
import { boundedFetch, getOctokit, isPublicRepo } from "../github.js";
import { familyFromName } from "../postprocess.js";

const SITE = "https://1stproof.org";
const ORG = "1stproof";
const ARXIV_QUERY = 'https://export.arxiv.org/api/query?search_query=ti:%22First+Proof%22&max_results=50&sortBy=submittedDate&sortOrder=ascending';
const MAX_SOURCE = 32 * 1024 * 1024;

// Editorial decision → score. A proof passes at "minor revisions" or better (the reports' "passing grade").
export const GRADE = { flawless: 3, minor: 2, major: 1, reject: 0 } as const;
export type Decision = keyof typeof GRADE;
export const PASS_MARK = GRADE.minor;
const LABEL: Record<Decision, string> = { flawless: "Essentially flawless", minor: "Minor revisions", major: "Major revisions", reject: "Reject" };

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
const ordinal = (w: string) => /^\d+$/.test(w) ? Number(w) : ORDINALS.indexOf(w.toLowerCase()) + 1;
const MONTH_DATE = /([A-Z][a-z]+ \d{1,2}, \d{4})/;
const isoDay = (s?: string) => { const t = s ? Date.parse(`${s} UTC`) : NaN; return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : undefined; };
const pad = (n: number) => String(n).padStart(2, "0");
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

// ── arXiv feed ──────────────────────────────────────────────────────────
export interface ReportRef { batch: number; id: string; title: string; published?: string }
export function parseFeed(xml: string): { reports: ReportRef[]; paper?: string } {
  const reports: ReportRef[] = [];
  let paper: string | undefined;
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = entry.match(/<id>\s*https?:\/\/arxiv\.org\/abs\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?\s*<\/id>/)?.[1];
    const title = (entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
    if (!id) continue;
    if (/^First Proof$/i.test(title)) { paper ??= id; continue; }
    const m = title.match(/^First Proof:?\s+(?:(\w+)\s+Batch|Batch\s+(\d+))$/i);
    const batch = m ? ordinal(m[1] ?? m[2]) : 0;
    if (batch > 1 && !reports.some((r) => r.batch === batch)) reports.push({ batch, id, title, published: entry.match(/<published>(\d{4}-\d{2}-\d{2})/)?.[1] });
  }
  return { reports: reports.sort((a, b) => a.batch - b.batch), paper };
}

// ── arXiv source: .gz of one .tex, or .tar.gz ───────────────────────────
export function texFromSource(gz: Uint8Array): string {
  // fetch may already have undone a Content-Encoding: gzip
  const raw = gz[0] === 0x1f && gz[1] === 0x8b ? gunzipSync(gz, { maxOutputLength: MAX_SOURCE }) : Buffer.from(gz);
  if (raw.length < 512 || raw.toString("latin1", 257, 262) !== "ustar") return raw.toString("utf-8");
  const files: [string, string][] = [];
  for (let off = 0; off + 512 <= raw.length;) {
    const name = raw.toString("utf-8", off, off + 100).replace(/\0.*$/s, "");
    if (!name) break;
    const prefix = raw.toString("utf-8", off + 345, off + 500).replace(/\0.*$/s, "");
    const size = parseInt(raw.toString("latin1", off + 124, off + 136).replace(/\0.*$/s, "").trim() || "0", 8);
    const type = raw.toString("latin1", off + 156, off + 157);
    if (!Number.isFinite(size) || size < 0) break;
    const path = prefix ? `${prefix}/${name}` : name;
    if ((type === "0" || type === "\0") && path.endsWith(".tex")) files.push([path, raw.toString("utf-8", off + 512, off + 512 + size)]);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files.sort(([a], [b]) => a.localeCompare(b)).map(([, t]) => t).join("\n");
}

// ── LaTeX → text, just enough for names and titles ──────────────────────
const ACCENT: Record<string, string> = { "'": "\u0301", '"': "\u0308", "`": "\u0300", "^": "\u0302", "~": "\u0303", v: "\u030C", c: "\u0327", H: "\u030B", u: "\u0306", "=": "\u0304", ".": "\u0307" };
export function detex(s: string): string {
  return s
    .replace(/\\([vcHu])\{(\w)\}/g, (_, a, ch) => ch + ACCENT[a])
    .replace(/\\(['"`^~=.])\{?(\w)\}?/g, (_, a, ch) => ch + ACCENT[a])
    .replace(/\\(?:footnote|label|footnotemark|newcounter|setcounter)(?:\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .replace(/\\(?:texttt|textbf|emph|textit|mathrm)\{([^{}]*)\}/g, "$1")
    .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, "$1")
    .replace(/---/g, "—").replace(/--/g, "–").replace(/~/g, " ").replace(/\\[,;: ]/g, " ")
    .replace(/\\[a-zA-Z]+\*?/g, "").replace(/[{}]/g, "")
    .replace(/\s+/g, " ").trim().normalize("NFC");
}

// Balanced-brace argument starting at s[i] === "{"
function braced(s: string, i: number): { text: string; end: number } | null {
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
  }
  return null;
}
// Every \subsection / \section with its title and the body up to the next heading of the same or higher level
function headings(tex: string): { level: number; title: string; body: string }[] {
  const out: { level: number; title: string; at: number; start: number }[] = [];
  for (const m of tex.matchAll(/\\(sub)?section\*?\s*(?=\{)/g)) {
    const arg = braced(tex, m.index! + m[0].length);
    if (arg) out.push({ level: m[1] ? 2 : 1, title: arg.text, at: m.index!, start: arg.end });
  }
  return out.map((h, i) => {
    const next = out.slice(i + 1).find((x) => x.level <= h.level);
    return { level: h.level, title: h.title, body: tex.slice(h.start, next ? next.at : tex.length) };
  });
}

export function decisionOf(text: string): Decision | undefined {
  const t = text.toLowerCase();
  return /flawless/.test(t) ? "flawless" : /minor/.test(t) ? "minor" : /major/.test(t) ? "major" : /reject/.test(t) ? "reject" : undefined;
}

export interface ReportSystem { letter: string; name: string; models: string[]; url?: string; cost?: number; wallClock?: string }
export interface ReportProblem { n: number; field: string; authors: string; decisions: Record<string, Decision | undefined>; cost: Record<string, number | undefined> }
export interface Report { title: string; date?: string; systems: ReportSystem[]; problems: ReportProblem[] }

export function parseReport(tex: string): Report {
  const hs = headings(tex);
  const title = detex(tex.match(/\\title\s*\{([^{}]*)\}/)?.[1] ?? "");
  const date = isoDay(detex(tex.match(/\\date\s*\{([^{}]*)\}/)?.[1] ?? ""));

  const systems: ReportSystem[] = hs.filter((h) => h.level === 2).flatMap((h) => {
    const m = detex(h.title).match(/^System ([A-Z]):\s*(.+)$/);
    if (!m) return [];
    const models = [...new Set([...h.body.matchAll(/\\texttt\{([^{}]+)\}/g)].map((x) => detex(x[1])).filter((x) => /[a-z]/i.test(x) && /\d/.test(x) && !/[/\\]/.test(x)))];
    const url = h.body.match(/\\href\{(https:\/\/github\.com\/[^{}\s]+)\}/)?.[1];
    return [{ letter: m[1], name: m[2].trim(), models, url }];
  });

  const statements = new Map<number, { field: string; authors: string }>();
  for (const h of hs) {
    const m = detex(h.title).match(/^Problem (\d+):\s*(.+?)\s*\(([^()]+)\)\s*$/);
    if (m) statements.set(Number(m[1]), { authors: m[2].replace(/,?\s+and\s+/g, ", ").replace(/,\s*,/g, ","), field: m[3].charAt(0).toUpperCase() + m[3].slice(1) });
  }

  const problems: ReportProblem[] = [];
  for (const h of hs) {
    const m = detex(h.title).match(/^Problem (\d+)$/);
    if (!m) continue;
    const n = Number(m[1]);
    const decisions: Record<string, Decision | undefined> = {};
    const parts = h.body.split(/\\paragraph\*?\{Submission ([A-Z])\.?\}/);
    for (let i = 1; i < parts.length; i += 2) {
      const chunk = parts[i + 1];
      const d = chunk.match(/\\editorialdecision\{([^{}]*)\}/)?.[1] ?? chunk.match(/Editorial Decision:?\}?\s*([A-Za-z ]+)/)?.[1];
      decisions[parts[i]] = d ? decisionOf(d) : undefined;
    }
    const s = statements.get(n);
    if (Object.keys(decisions).length) problems.push({ n, field: s?.field ?? `Problem ${n}`, authors: s?.authors ?? "", decisions, cost: {} });
  }
  problems.sort((a, b) => a.n - b.n);

  // Cost table: rows "P<n> & in & out & $ & …", three columns per system in the order of the header
  const table = [...tex.matchAll(/\\begin\{tabular\}([\s\S]*?)\\end\{tabular\}/g)].map((m) => m[1]).find((t) => /Prob\./.test(t) && /\\\$/.test(t));
  if (table) {
    const letters = [...(table.match(/[^\n]*System[^\n]*\\\\/)?.[0] ?? "").matchAll(/System~?\s*([A-Z])/g)].map((x) => x[1]);
    const num = (c?: string) => { const v = Number((c ?? "").replace(/[^\d.]/g, "")); return c && /^[\s\d.,\\]+$/.test(c) && /\d/.test(c) && Number.isFinite(v) ? v : undefined; };
    for (const row of table.split("\\\\")) {
      const cells = row.split("&").map((c) => c.trim());
      const label = detex(cells[0] ?? "").toLowerCase();
      const p = label.match(/^p(\d+)$/);
      letters.forEach((L, k) => {
        if (p) { const prob = problems.find((x) => x.n === Number(p[1])); if (prob) prob.cost[L] = num(cells[1 + 3 * k + 2]); }
        const sys = systems.find((x) => x.letter === L);
        if (sys && label === "total") sys.cost = num(cells[1 + 3 * k + 2]);
      });
      if (label.startsWith("wall clock")) {
        const walls = [...row.matchAll(/\\multicolumn\{3\}\{c\}\{([^{}]*)\}/g)].map((x) => detex(x[1]).replace(/\s+h$/, " h"));
        letters.forEach((L, k) => { const sys = systems.find((x) => x.letter === L); if (sys && walls[k]) sys.wallClock = walls[k]; });
      }
    }
  }
  return { title, date, systems, problems };
}

// ── GitHub: which solution / review PDFs exist for batch N ──────────────
async function repoFiles(batch: number): Promise<{ repo?: string; paths: string[] }> {
  const repo = `batch-${batch}`;
  try {
    const octokit = getOctokit();
    const { data: info } = await octokit.rest.repos.get({ owner: ORG, repo });
    if (!isPublicRepo(info)) return { paths: [] };
    const { data } = await octokit.rest.git.getTree({ owner: ORG, repo, tree_sha: info.default_branch, recursive: "true" });
    return { repo: `https://github.com/${ORG}/${repo}/blob/${info.default_branch}`, paths: data.tree.filter((t) => t.type === "blob" && t.path).map((t) => t.path!) };
  } catch {
    console.log(`    first-proof: batch ${batch} repository unavailable, records link the report only`);
    return { paths: [] };
  }
}
function filesFor(paths: string[], batch: number, n: number, letter: string) {
  const prob = `problem-0*${n}`;
  const solution = paths.find((p) => new RegExp(`^batch-${batch}-AI-solutions/${prob}/submission-${letter}\\.pdf$`).test(p));
  const reviews = paths.find((p) => new RegExp(`^batch-${batch}-reviews/${prob}/submission-${letter}/[^/]*reviews\\.pdf$`).test(p));
  return [solution, reviews].filter((p): p is string => !!p);
}

// ── 1stproof.org: the batch still in progress ───────────────────────────
export interface PendingBatch { batch: number; url: string; deadline?: string; results?: string }
export function parsePending(page: string, batch: number, url: string): PendingBatch {
  const text = page.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return { batch, url, deadline: isoDay(text.match(new RegExp(`\\bby\\s+${MONTH_DATE.source}`))?.[1]), results: isoDay(text.match(new RegExp(`published on\\s+${MONTH_DATE.source}`))?.[1]) };
}
async function pendingBatch(graded: number): Promise<PendingBatch | undefined> {
  try {
    const home = await (await boundedFetch(`${SITE}/`, undefined, 2 * 1024 * 1024, 20_000)).text();
    const pages = [...home.matchAll(/href="([a-z]+)-batch\.html"/g)].map((m) => ({ batch: ordinal(m[1]), file: `${m[1]}-batch.html` })).filter((p) => p.batch > graded);
    const next = pages.sort((a, b) => b.batch - a.batch)[0];
    if (!next) return undefined;
    const url = `${SITE}/${next.file}`;
    const r = await boundedFetch(url, undefined, 2 * 1024 * 1024, 20_000);
    return r.ok ? parsePending(await r.text(), next.batch, url) : { batch: next.batch, url };
  } catch { return undefined; }
}

async function bytes(url: string, accept: string, max: number): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(url, { headers: { accept } }, max, 60_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      return new Uint8Array(await r.arrayBuffer());
    } catch {
      if (attempt >= 1) throw new Error("First Proof download failed");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

// ── tracks ──────────────────────────────────────────────────────────────
interface Batch { n: number; ref: ReportRef; report: Report; repo?: string; paths: string[] }
const abs = (id: string) => `https://arxiv.org/abs/${id}`;
const systemUrl = (b: Batch, s: ReportSystem) => s.url ?? abs(b.ref.id);
function agentOf(s: ReportSystem, evidence: string): AgentAttribution {
  const label = s.models[0] ?? s.name;
  return { family: familyFromName(label) ?? familyFromName(s.name) ?? "other-ai", model: label, tool: s.name, confidence: "high", role: "subject", evidence };
}
const markBest = (records: RecordEntry[]) => { const top = Math.max(...records.map((r) => r.value)); for (const r of records) if (r.value === top) r.isCurrentBest = true; return records; };

export function problemTrack(b: Batch, p: ReportProblem): Problem {
  const date = b.report.date ?? b.ref.published;
  const records: RecordEntry[] = b.report.systems.flatMap((s): RecordEntry[] => {
    const d = p.decisions[s.letter];
    if (!d) return [];
    const files = b.repo ? filesFor(b.paths, b.n, p.n, s.letter).map((f) => `${b.repo}/${f}`) : [];
    const cost = p.cost[s.letter];
    return [{
      value: GRADE[d], date, contributor: s.name, contributorKind: "team", contributorUrl: systemUrl(b, s),
      description: `System ${s.letter} · ${LABEL[d]}${cost != null ? ` · ${usd(cost)} API` : ""}`,
      submissionUrls: files.length ? files : [abs(b.ref.id)],
      agent: agentOf(s, `${b.report.title || b.ref.title} (arXiv:${b.ref.id}), Problem ${p.n}, Submission ${s.letter}: "${LABEL[d]}"`),
    }];
  });
  const passed = b.report.systems.filter((s) => p.decisions[s.letter] && GRADE[p.decisions[s.letter]!] >= PASS_MARK).map((s) => s.letter);
  const missing = b.report.systems.filter((s) => s.letter in p.decisions && !p.decisions[s.letter]).map((s) => s.letter);
  return {
    id: `b${b.n}-p${pad(p.n)}`,
    name: `P${p.n} · ${p.field}`,
    group: `batch-${b.n}`,
    description: [
      p.authors ? `Batch ${b.n} problem by ${p.authors}.` : `Batch ${b.n} problem.`,
      passed.length ? `Passed by system${passed.length > 1 ? "s" : ""} ${passed.join(", ")}.` : "No passing proof yet.",
      missing.length ? `System ${missing.join(", ")}: no solution.` : "",
    ].filter(Boolean).join(" "),
    metricName: "referee grade",
    metricUnit: "of 3",
    metricDirection: "maximize",
    passMark: PASS_MARK,
    isOpen: !passed.length,
    records: markBest(records),
  };
}

export function systemsTrack(b: Batch): Problem | null {
  const ps = b.report.problems;
  const records = b.report.systems.map((s): RecordEntry => {
    const ds = ps.map((p) => p.decisions[s.letter]).filter((d): d is Decision => !!d);
    const count = (d: Decision) => ds.filter((x) => x === d).length;
    const breakdown = (["flawless", "minor", "major", "reject"] as Decision[]).filter(count).map((d) => `${count(d)} ${d}`).concat(ds.length < ps.length ? [`${ps.length - ds.length} missing`] : []);
    const spend = [s.cost != null ? `${usd(s.cost)} API` : "", s.wallClock ?? ""].filter(Boolean).join(", ");
    return {
      value: ds.reduce((n, d) => n + GRADE[d], 0), date: b.report.date ?? b.ref.published,
      contributor: s.name, contributorKind: "team", contributorUrl: systemUrl(b, s),
      description: [`System ${s.letter} · ${ds.filter((d) => GRADE[d] >= PASS_MARK).length}/${ps.length} passed (${breakdown.join(", ")})`, spend, s.models.join(", ")].filter(Boolean).join(" · "),
      submissionUrls: b.repo ? [`${b.repo.replace("/blob/", "/tree/")}/batch-${b.n}-AI-solutions`, `${b.repo.replace("/blob/", "/tree/")}/batch-${b.n}-reviews`] : [abs(b.ref.id)],
      agent: agentOf(s, `${b.report.title || b.ref.title} (arXiv:${b.ref.id}): System ${s.letter}, ${ds.length} graded solutions`),
    };
  });
  if (!records.length) return null;
  return {
    id: `b${b.n}-systems`,
    name: `Batch ${b.n} · all ${ps.length} problems`,
    group: `batch-${b.n}`,
    description: `Sum of editorial grades over the Batch ${b.n} problems: 3 essentially flawless, 2 minor revisions (passing), 1 major revisions, 0 reject or missing. One shot per problem, run by the editorial board.`,
    metricName: "total referee grade",
    metricUnit: `of ${ps.length * GRADE.flawless}`,
    metricDirection: "maximize",
    isOpen: false,
    records: markBest(records),
  };
}

export async function buildFirstProof(): Promise<LLMCompetition> {
  const { reports, paper } = parseFeed(new TextDecoder().decode(await bytes(ARXIV_QUERY, "application/atom+xml", 4 * 1024 * 1024)));
  const batches: Batch[] = [];
  for (const ref of reports) {
    try {
      const tex = texFromSource(await bytes(`https://arxiv.org/src/${ref.id}`, "application/gzip", MAX_SOURCE));
      const report = parseReport(tex);
      // only reports from the project: they point at 1stproof.org or the 1stproof GitHub org, and carry graded submissions
      if (!/1stproof\.org|github\.com\/1stproof\//.test(tex) || !report.problems.some((p) => Object.values(p.decisions).some(Boolean))) {
        console.log(`    first-proof: arXiv:${ref.id} is not a graded First Proof report, skipping`);
        continue;
      }
      batches.push({ n: ref.batch, ref, report, ...(await repoFiles(ref.batch)) });
    } catch { console.log(`    first-proof: batch ${ref.batch} report unavailable or unparsable, skipping`); }
  }
  if (!batches.length) throw new Error("First Proof download failed");
  const latest = batches[batches.length - 1];
  const pending = await pendingBatch(latest.n);

  const problems: Problem[] = [];
  for (const b of [...batches].reverse()) {
    const sys = systemsTrack(b);
    problems.push(...(sys ? [sys] : []), ...b.report.problems.map((p) => problemTrack(b, p)));
  }
  const latestTracks = problems.filter((p) => p.group === `batch-${latest.n}` && p.passMark != null);
  const open = latestTracks.filter((p) => p.isOpen);
  const graded = latest.report.problems.reduce((n, p) => n + Object.values(p.decisions).filter(Boolean).length, 0);
  const costs = latest.report.systems.map((s) => s.cost).filter((c): c is number => c != null);
  const today = new Date().toISOString().slice(0, 10);
  const inProgress = pending && (!pending.results || pending.results >= today);
  const latestDate = latest.report.date ?? latest.ref.published;
  console.log(`    first-proof: ${batches.length} graded batch(es) on arXiv (${batches.map((b) => `${b.n}: ${b.ref.id}`).join(", ")}), latest has ${latestTracks.length} problems, ${graded} graded solutions, ${open.length} open${pending ? `; batch ${pending.batch} in progress` : ""}`);

  const pendingText = pending
    ? `Batch ${pending.batch} is under way${pending.results ? `; results are due ${pending.results}` : ""}.`
    : "The next batch is announced on 1stproof.org.";
  return {
    id: "first-proof",
    name: "First Proof",
    tagline: "Unpublished research-level math problems; AI systems get one shot each and expert referees grade the proofs blind.",
    description: `First Proof is an independent benchmark run by research mathematicians to measure whether AI systems can autonomously prove research-level results. Each batch collects problems that arose in the contributors' own work and whose proofs are unpublished; the editorial board runs every system itself, one shot per problem with no human input, and expert referees grade the proofs double blind. Batch ${latest.n}${latestDate ? ` (${latestDate})` : ""}: ${latest.report.systems.length} systems, ${graded} graded solutions, ${latestTracks.length - open.length} of ${latestTracks.length} problems got at least one passing proof${open.length ? `; ${open.map((t) => t.name.split(" · ")[0]).join(", ")} remain open` : ""}. ${pendingText}`,
    url: `${SITE}/`,
    host: "website",
    status: inProgress || (latestDate && Date.now() - Date.parse(latestDate) < 180 * 86_400_000) ? "active" : "ended",
    tags: ["mathematics", "research-math", "proofs", "referee-graded", "ai-evaluation", "benchmark"],
    domain: "llm-eval",
    images: [],
    organizer: { name: "First Proof Foundation", url: `${SITE}/`, type: "foundation" },
    participation: {
      howToSubmit: `Systems enter per batch through the call for submissions on 1stproof.org${pending?.deadline ? ` (Batch ${pending.batch} applications ${pending.deadline < today ? "closed" : "close"} ${pending.deadline})` : ""}. A system is an open-source harness calling publicly available models, or a public product; First Proof clones the submitter's repository, builds its Docker image on an approved EC2 instance and runs it once on the problem file, following the protocol published with each batch (e.g. 1stproof/batch-${latest.n}).`,
      submissionFormat: "A repository with Dockerfile, hardware.json, README.md and src/; the container reads the LaTeX problems from /data/input/input.json and writes LaTeX proofs to /data/output.",
      requirements: ["Open-source harness or public AI product", "Publicly available models", "Docker", "Model API keys"],
      compute: "none",
      computeDetails: `Runs on First Proof's AWS instances; model API usage goes on the submitter's keys.${costs.length ? ` Batch ${latest.n} systems spent ${usd(Math.min(...costs))}–${usd(Math.max(...costs))} in API fees for ${latestTracks.length} problems.` : ""}`,
      deadline: pending ? [`Batch ${pending.batch}:`, pending.deadline ? `applications until ${pending.deadline};` : "", pending.results ? `results ${pending.results}.` : "see 1stproof.org."].filter(Boolean).join(" ") : "per batch; see 1stproof.org",
      rounds: "Batches of unpublished research problems, each graded and published with every solution and referee report, plus community experiments where problems are posted publicly and solutions follow a week later.",
      prizes: "recognition only",
      eligibility: "AI companies and academic teams; only publicly available models, or harnesses that will be released.",
      cost: "free to enter; API usage is paid by the submitter",
      verification: "Each proof is refereed double blind by at least two experts in the field; the editorial board decides essentially flawless, minor revisions, major revisions or reject. Problems, human solutions, AI solutions, referee reports and logs are all published.",
    },
    venue: { type: "online", location: "1stproof.org / GitHub" },
    quickstart: `git clone https://github.com/${ORG}/batch-${latest.n} && cd batch-${latest.n}\nls   # protocol and reference submission (batch-${latest.n}-design), problems, human and AI solutions, referee reports`,
    links: [
      { label: "Website", url: `${SITE}/` },
      ...(pending ? [{ label: `Batch ${pending.batch}${pending.results ? ` (results ${pending.results})` : ""}`, url: pending.url }] : []),
      ...[...batches].reverse().flatMap((b) => [
        { label: `Batch ${b.n} report (arXiv:${b.ref.id})`, url: abs(b.ref.id) },
        ...(b.repo ? [{ label: `Batch ${b.n}: solutions, reviews, harnesses`, url: `https://github.com/${ORG}/batch-${b.n}` }] : []),
      ]),
      ...(paper ? [{ label: `Batch 1 paper (arXiv:${paper})`, url: abs(paper) }] : []),
      { label: "Batch 1 problems (1stproof/batch-1)", url: `https://github.com/${ORG}/batch-1` },
      { label: "Community experiment", url: `${SITE}/community-experiment.html` },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
