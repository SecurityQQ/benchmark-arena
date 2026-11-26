// Deterministic builder for the Quantum Advantage Tracker (quantum-advantage-tracker/quantum-advantage-tracker.github.io): IBM,
// Algorithmiq, the Flatiron Institute and BlueQubit's open tracker of candidate quantum advantage experiments and the classical
// methods that answer them. Entries are GitHub issues, reviewed in public; the accepted ones are kept as JSON in the repository.
// Sources (public, no login):
//   https://raw.githubusercontent.com/quantum-advantage-tracker/quantum-advantage-tracker.github.io/main/data/
//     variational-problems/submissions.json            — ground-state energies per Hamiltonian instance, quantum and classical
//     classically-verifiable-problems/submissions.json — peaked circuits and the like: who recovered the answer, in how long
//     observable-estimations/submissions.json          — observable estimates (counted, not ranked: an estimate is not "better")
// No LLM involved. One track per Hamiltonian (lowest variational energy wins: a variational energy is an upper bound on the true
// ground state) and one per classically verifiable circuit (least total runtime among entries that recovered it fully). Every
// accepted submission is a record, credited to its institutions, dated by its issue.

import type { LLMCompetition } from "../llm.js";
import type { Problem, RecordEntry } from "../types.js";
import { boundedFetch } from "../github.js";

export const REPO = "https://github.com/quantum-advantage-tracker/quantum-advantage-tracker.github.io";
export const SITE = "https://quantum-advantage-tracker.github.io/";
export const DATA = "https://raw.githubusercontent.com/quantum-advantage-tracker/quantum-advantage-tracker.github.io/main/data";
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const MAX_BYTES = 4 * 1024 * 1024, MAX_ROWS = 5000;

async function json(path: string): Promise<unknown[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(`${DATA}/${path}`, { headers: { accept: "application/json", "user-agent": USER_AGENT } }, MAX_BYTES, 30_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      const v = await r.json();
      if (!Array.isArray(v)) throw new Error("not a list");
      return v.slice(0, MAX_ROWS);
    } catch {
      if (attempt >= 1) throw new Error("Quantum Advantage Tracker download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export interface Submission {
  createdAt?: string; url?: string; name?: string; method?: string; institutions?: string;
  hamiltonian?: string; circuit?: string; energy?: number; value?: string; qubits?: number; gates?: number;
  runtimeQuantum?: number; runtimeClassical?: number; computeResourcesQuantum?: string; computeResourcesClassical?: string;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const ISSUE = /^https:\/\/github\.com\/quantum-advantage-tracker\/quantum-advantage-tracker\.github\.io\/issues\/\d{1,7}$/;
const clean = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const day = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s)) ? s.slice(0, 10) : undefined);
const runtime = (s: Submission) => { const q = num(s.runtimeQuantum) ?? 0, c = num(s.runtimeClassical) ?? 0; return q + c > 0 ? q + c : undefined; };

function record(s: Submission, value: number, detail: string[]): RecordEntry {
  const date = day(s.createdAt), url = typeof s.url === "string" && ISSUE.test(s.url) ? s.url : undefined;
  return {
    value, contributor: clean(s.institutions, 120) || clean(s.name, 120) || "unknown", contributorKind: "team",
    ...(date ? { date } : {}), description: [clean(s.method, 120), ...detail].filter(Boolean).join(" · "),
    ...(url ? { submissionUrls: [url] } : {}),
  };
}

/** One track per Hamiltonian instance: each accepted energy, lowest first */
export function variationalTracks(rows: Submission[]): Problem[] {
  const by = new Map<string, RecordEntry[]>();
  for (const s of rows) {
    const e = num(s.energy);
    if (!s || typeof s.hamiltonian !== "string" || !KEY.test(s.hamiltonian) || e === undefined) continue;
    const hw = clean(s.computeResourcesQuantum, 60);
    const detail = [num(s.qubits) ? `${s.qubits} qubits` : "", num(s.gates) ? `${s.gates} gates` : "", hw ? `on ${hw}` : "classical"];
    by.set(s.hamiltonian, [...(by.get(s.hamiltonian) ?? []), record(s, e, detail)]);
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([h, records]) => ({
    id: `variational-${h}`, name: `Ground-state energy: ${h}`, group: "Variational problems",
    description: `The lowest energy any method finds for the ${h} Hamiltonian. A variational energy is an upper bound on the true ground state, so lower is better; quantum (sample-based) and classical methods compete on the same instance.`,
    metricName: "variational energy", metricDirection: "minimize", isOpen: false, records: records.sort((a, b) => a.value - b.value),
  }));
}

/** One track per classically verifiable circuit: entries that recovered the answer fully, fastest first */
export function verifiableTracks(rows: Submission[]): Problem[] {
  const by = new Map<string, RecordEntry[]>();
  for (const s of rows) {
    const t = runtime(s);
    if (!s || typeof s.circuit !== "string" || !KEY.test(s.circuit) || t === undefined || clean(s.value, 10) !== "100%") continue;
    const hw = [clean(s.computeResourcesQuantum, 60), clean(s.computeResourcesClassical, 60)].filter(Boolean).join(" + ");
    by.set(s.circuit, [...(by.get(s.circuit) ?? []), record(s, t, [hw ? `on ${hw}` : ""])]);
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([c, records]) => ({
    id: `verifiable-${c}`, name: `Recover the answer: ${c}`, group: "Classically verifiable problems",
    description: `Recover the hidden answer of the ${c} circuit, by quantum hardware, classical simulation or both; the answer can be checked classically. Ranked by total runtime (quantum plus classical) among entries that recovered it fully.`,
    metricName: "total runtime", metricUnit: "s", metricDirection: "minimize", isOpen: false, records: records.sort((a, b) => a.value - b.value),
  }));
}

export async function buildQuantumAdvantage(): Promise<LLMCompetition> {
  const [variational, verifiable, observable] = await Promise.all([
    json("variational-problems/submissions.json"), json("classically-verifiable-problems/submissions.json"), json("observable-estimations/submissions.json"),
  ]);
  const problems = [...variationalTracks(variational as Submission[]), ...verifiableTracks(verifiable as Submission[])];
  if (!problems.length) throw new Error("Quantum Advantage Tracker download failed");
  console.log(`    quantum-advantage-tracker: ${problems.length} tracks, ${variational.length} variational, ${verifiable.length} verifiable, ${observable.length} observable submissions`);

  return {
    id: "quantum-advantage-tracker",
    name: "Quantum Advantage Tracker",
    tagline: "Claim quantum advantage on a shared problem, or beat a quantum claim with a classical method: every entry is reviewed in public.",
    description: [
      "The Quantum Advantage Tracker, run by IBM, Algorithmiq, the Flatiron Institute and BlueQubit, keeps an open record of candidate quantum advantage experiments and the classical methods that answer them.",
      "Its problems come in three kinds: observable estimation on large circuits, variational ground-state problems for molecules and model Hamiltonians, and classically verifiable problems such as peaked circuits, whose answer anyone can check.",
      "Anyone can submit, quantum or classical, through a GitHub issue; entries are reviewed in public, and a classical result can supersede a quantum claim.",
      `Here: one track per Hamiltonian (lowest energy wins) and one per verifiable circuit (fastest full recovery wins). ${observable.length} observable estimates are on the tracker itself; estimates are compared, not ranked.`,
    ].join(" "),
    url: SITE,
    host: "github",
    status: "active",
    tags: ["quantum-computing", "quantum-advantage", "tensor-networks", "variational-algorithms", "quantum-chemistry", "benchmark"],
    domain: "other",
    images: [],
    organizer: { name: "IBM, Algorithmiq, Flatiron Institute, BlueQubit", url: SITE, type: "community" },
    participation: {
      howToSubmit: `Open a submission issue on ${REPO}/issues/new/choose for the problem kind (observable estimation, variational, classically verifiable) with your result, method, runtime and hardware; reviewers check it in public and accepted entries join the tracker.`,
      submissionFormat: "A GitHub issue from the repository's templates: the instance, your value (energy, observable, or recovered answer), the method, runtimes and compute resources, and a link to code or a paper.",
      requirements: ["A quantum computer, or a classical method (tensor networks, belief propagation, selected configuration interaction…)", "The problem instances in the repository's data/ folder"],
      compute: "unknown",
      computeDetails: "Classical entries range from a laptop to a supercomputer; quantum entries need hardware access.",
      deadline: "rolling",
      prizes: "recognition only",
      eligibility: "Open to anyone.",
      cost: "free",
      verification: "Public review of each issue; a CI workflow checks the submission's format before it is merged into the tracker's data.",
    },
    venue: { type: "online" },
    links: [
      { label: "The tracker", url: SITE },
      { label: "Repository and problem instances", url: REPO },
      { label: "Submit an entry", url: `${REPO}/issues/new/choose` },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
