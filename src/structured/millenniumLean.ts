// Deterministic builder for the Millennium Prize Problems in Lean 4 (lean-dojo/LeanMillenniumPrizeProblems): Lean statements of
// the seven Clay problems and the exact propositions a solution must prove. The repository holds statements, not entries, so
// the LLM pass called it "not a competition"; its README table is a board all the same: what counts as a solution for each
// problem, and whether anyone has supplied one. Source (public, no login):
//   https://raw.githubusercontent.com/lean-dojo/LeanMillenniumPrizeProblems/main/README.md — the "seven problems" table
// No LLM involved. One track per problem: open while its status says Open; a statement the repository marks incomplete is a
// track for making the statement faithful (Hodge, Yang–Mills), not for proving it. A solved problem (Poincaré) is listed as
// taken. No records: no accepted solution exists in the repository; a sorry-free proof of a listed proposition would be one.

import type { LLMCompetition } from "../llm.js";
import type { Problem } from "../types.js";
import { boundedFetch } from "../github.js";

export const REPO = "https://github.com/lean-dojo/LeanMillenniumPrizeProblems";
export const README = "https://raw.githubusercontent.com/lean-dojo/LeanMillenniumPrizeProblems/main/README.md";
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const MAX_BYTES = 1024 * 1024;

export interface MillenniumRow { problem: string; file: string; propositions: string; status: string }

const clean = (s: string, n: number) => s.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
/** The README's "seven problems" table: one row per problem, cells as text (backticks dropped) */
export function millenniumTable(md: string): MillenniumRow[] {
  const start = md.indexOf("| Problem |");
  if (start < 0) return [];
  const rows: MillenniumRow[] = [];
  for (const line of md.slice(start).split("\n").slice(2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((c) => clean(c.replace(/`/g, ""), 300));
    if (cells.length !== 4 || !cells[0]) continue;
    rows.push({ problem: cells[0].slice(0, 60), file: cells[1], propositions: cells[2], status: cells[3] });
  }
  return rows.slice(0, 12);
}

export type Kind = "open" | "solved" | "incomplete" | "other";
export const kindOf = (status: string): Kind =>
  /^open\b/i.test(status) ? "open" : /^solved\b/i.test(status) ? "solved" : /statement incomplete|not a valid target/i.test(status) ? "incomplete" : "other";
const slug = (s: string) => s.replace(/[–—]/g, "-").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);

export function millenniumTracks(rows: MillenniumRow[]): Problem[] {
  return rows.map((r) => {
    const k = kindOf(r.status);
    const base = { group: "Millennium Prize Problems", metricName: k === "incomplete" ? "faithful statement merged" : "sorry-free Lean proof accepted", metricDirection: "maximize" as const, records: [] };
    if (k === "incomplete") return { ...base, id: `${slug(r.problem)}-statement`, name: `${r.problem}: a faithful statement`, isOpen: true,
      description: `The repository's Lean statement of ${r.problem} is incomplete and not a valid target (${r.status}). The open work is a faithful statement, which the README calls a substantial project. Lean file: ${r.file}.` };
    return { ...base, id: slug(r.problem), name: `${r.problem}: a proof`, isOpen: k === "open",
      description: `${k === "solved" ? `${r.status}. ` : ""}A sorry-free proof, using only the standard axioms, of ${r.propositions || "the problem's proposition"}. Lean file: ${r.file}.${k === "open" ? " Status in the repository: open." : ""}` };
  });
}

export async function buildMillenniumLean(): Promise<LLMCompetition> {
  let md = "";
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(README, { headers: { accept: "text/plain", "user-agent": USER_AGENT } }, MAX_BYTES, 30_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      md = await r.text();
      break;
    } catch {
      if (attempt >= 1) throw new Error("Millennium Prize Problems download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const rows = millenniumTable(md);
  if (rows.length < 5) throw new Error("Millennium Prize Problems download failed");
  const problems = millenniumTracks(rows);
  const open = rows.filter((r) => kindOf(r.status) === "open").length;
  console.log(`    millennium-lean: ${rows.length} problems, ${open} open, ${rows.filter((r) => kindOf(r.status) === "incomplete").length} with incomplete statements`);

  return {
    id: "millennium-prize-problems-lean",
    name: "Millennium Prize Problems in Lean 4",
    tagline: "The seven Clay Millennium Prize problems stated in Lean 4, with the exact propositions a machine-checked solution must prove.",
    description: [
      "The Clay Mathematics Institute's seven Millennium Prize problems, $1 million each, formalized in Lean 4 with Mathlib.",
      `For each problem the repository names the propositions that count as a solution: a sorry-free proof using only the standard axioms. ${open} are open targets today; Poincaré is solved (Perelman), and the Hodge and Yang–Mills statements are marked incomplete after a September 2026 review, so the open work there is a faithful statement.`,
      "CI builds every statement and check on each pull request. The repository makes no claim to solutions; a proof here is a formal certificate, not the Clay prize, which has its own rules.",
    ].join(" "),
    url: REPO,
    host: "github",
    status: "active",
    tags: ["millennium-prize", "lean4", "mathlib", "formal-verification", "p-vs-np", "riemann-hypothesis", "navier-stokes", "open-problem"],
    domain: "formal-methods",
    images: [],
    organizer: { name: "LeanDojo", url: REPO, type: "academic" },
    participation: {
      howToSubmit: `Open a pull request on ${REPO}: replace the placeholder theorem's sorry with a proof (Riemann, BSD, Poincaré), or prove one of the listed alternative propositions (P vs NP, Navier–Stokes). For Hodge and Yang–Mills, a pull request that replaces the sketch with a faithful statement.`,
      submissionFormat: "Lean 4 source in the repository's layout; `lake build` must pass and `#print axioms` must show only propext, Classical.choice and Quot.sound.",
      requirements: ["Lean 4 and Mathlib (lake exe cache get)", "Python 3 for the Clay reference check"],
      compute: "cpu",
      computeDetails: "Building Mathlib's cache and the statements runs on a laptop; the mathematics is the hard part.",
      deadline: "rolling",
      prizes: "None from the repository; the Clay Mathematics Institute's $1M prizes follow Clay's own rules (publication and two years of scrutiny).",
      eligibility: "Open to anyone.",
      cost: "free",
      verification: "CI builds every statement and test on each pull request; a solution is a sorry-free proof checked by Lean's kernel with only the standard axioms.",
    },
    venue: { type: "online" },
    links: [
      { label: "Repository and the seven statements", url: REPO },
      { label: "Clay Mathematics Institute: the Millennium Prize Problems", url: "https://www.claymath.org/millennium-problems/" },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
