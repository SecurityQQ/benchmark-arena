// Deterministic builder for the SAIL AI-Tx Challenge (aitxchallenge.org, Harvard DBMI): an AI system turns a rare disease
// patient's genetic diagnosis into a therapeutic actionability report, and a panel of clinical genetics and drug development
// experts scores it. It has no public GitHub repository, so it is a site source (main.ts SITES). Sources (public, no login):
//   1. https://aitxchallenge.org/                                               — the open phase and its deadline ("Final Challenge · Now Open", "Deadline: January 5, 2027")
//   2. https://aitxchallenge.org/assets/json/final_challenge/aitx_final_patients.json — the hypothetical patients every entry reports on
// No LLM involved. One track per resource tier: each tier is judged on its own, so a system only meets systems of its size.
// Reports are judged by people after the deadline and no scores are published before the winners, so the tracks carry no records.

import type { LLMCompetition } from "../llm.js";
import type { Problem } from "../types.js";
import { boundedFetch } from "../github.js";

export const SITE = "https://aitxchallenge.org";
export const PATIENTS = `${SITE}/assets/json/final_challenge/aitx_final_patients.json`;
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const MAX_BYTES = 1024 * 1024;

export interface AitxVariant { gene?: string; transcript?: string; variant_cdna?: string; variant_protein?: string; zygosity?: string }
export interface AitxPatient { id?: string; patient?: { genotype?: AitxVariant[]; clinical_context?: string } }
export interface AitxCase { id: string; variants: string[] }

async function get(url: string, accept: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(url, { headers: { accept, "user-agent": USER_AGENT } }, MAX_BYTES, 30_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      return r;
    } catch {
      if (attempt >= 1) throw new Error("AI-Tx Challenge download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// "Deadline: January 5, 2027" → "2027-01-05"; anything else → undefined
export function deadlineOf(html: string): string | undefined {
  const m = html.match(/Deadline:\s*([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),\s*(20\d\d)/);
  const month = m ? MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase()) && m[1].length >= 3) : -1;
  if (!m || month < 0) return undefined;
  const iso = `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso ? iso : undefined;
}
// The organizers' own banner says whether the final task takes entries; past its deadline it is over whatever the banner says
export function statusOf(html: string, deadline: string | undefined, today = new Date().toISOString().slice(0, 10)): "active" | "ended" | "unknown" {
  if (deadline && deadline < today) return "ended";
  if (/Final Challenge\s*·\s*Now Open/i.test(html)) return deadline ? "active" : "unknown";
  if (/Final Challenge\s*·\s*Closed/i.test(html)) return "ended";
  return "unknown";
}

const ID = /^AITX-\d{4,6}$/;
const GENE = /^[A-Z][A-Z0-9-]{0,14}$/;
const CDNA = /^c\.[A-Za-z0-9_+*>()\-]{1,40}$/;
// Only the gene and the cDNA change are shown, and only in the shapes HGVS allows: the file is the organizers', its text is data
export function casesOf(value: unknown): AitxCase[] {
  if (!Array.isArray(value)) throw new Error("AI-Tx Challenge download failed");
  const out: AitxCase[] = [];
  for (const p of value as AitxPatient[]) {
    if (!p || typeof p.id !== "string" || !ID.test(p.id)) continue;
    const variants = (Array.isArray(p.patient?.genotype) ? p.patient!.genotype : [])
      .filter((v) => v && typeof v.gene === "string" && GENE.test(v.gene) && typeof v.variant_cdna === "string" && CDNA.test(v.variant_cdna))
      .map((v) => `${v.gene} ${v.variant_cdna}`);
    if (variants.length) out.push({ id: p.id, variants });
  }
  return out;
}

const TIERS: { id: string; name: string; description: string }[] = [
  { id: "tier-1-small-open", name: "Tier 1: Small (≤ 32B parameters, open weights)", description: "Systems built on open-weight models of at most 32B total parameters (one GPU or a workstation can serve them), including domain-tuned models such as TxGemma-27B or MedGemma-27B." },
  { id: "tier-2-large-open", name: "Tier 2: Large (≤ 500B parameters, open weights)", description: "Systems built on open-weight models of at most 500B total parameters, sparse mixture-of-experts counted by their full weight count (gpt-oss-120b counts as 117B)." },
  { id: "tier-3-unrestricted", name: "Tier 3: Unrestricted (any size, closed models allowed)", description: "Anything goes: frontier APIs such as Claude, GPT or Gemini, closed or commercial systems, or open models above 500B parameters." },
];

export async function buildAiTx(today?: string): Promise<LLMCompetition> {
  const html = await (await get(`${SITE}/`, "text/html")).text();
  const deadline = deadlineOf(html);
  const status = statusOf(html, deadline, today);
  const cases = casesOf(await (await get(PATIENTS, "application/json")).json());
  if (!cases.length) throw new Error("AI-Tx Challenge download failed");
  console.log(`    ai-tx-challenge: ${status}, deadline ${deadline ?? "unknown"}, ${cases.length} patients`);

  const caseList = cases.map((c) => `${c.id} (${c.variants.join(", ")})`).join("; ");
  const problems: Problem[] = TIERS.map((t) => ({
    id: t.id, name: t.name,
    description: `${t.description} Each entry reports on the same ${cases.length} hypothetical patients: ${caseList}. Scored by the expert panel on the report rubric; scores are not published before the winners are announced.`,
    metricName: "expert panel score", metricDirection: "maximize", isOpen: true, records: [],
  }));

  return {
    id: "ai-tx-challenge",
    name: "SAIL AI-Tx Challenge: Actionability Report Generation",
    tagline: "Build an AI system that turns a rare disease patient's genetic diagnosis into a therapeutic actionability report, judged by clinical experts.",
    description: [
      "The SAIL AI-Tx Challenge (run by researchers at Harvard Medical School, Stanford, the University of Washington and Hugging Face, with NEJM AI as publication partner) asks what an AI system can do once a rare disease patient finally has a genetic diagnosis: which treatments are actually within reach?",
      `The final task gives every entrant the same ${cases.length} hypothetical patients — one or more diagnostic variants plus a short clinical history — and asks for one Markdown report per patient in a fixed template: established targeted and supportive therapies, clinical trial eligibility, off-label and repurposing candidates, and bespoke options such as antisense oligonucleotides or gene therapy, with a verifiable source or explicit reasoning for every claim.`,
      "Reports must be generated by the system without manual editing. A panel of experts in clinical genetics, translational research and drug development scores them after the deadline, separately in three tiers by model size, so a small open model only meets other small open models.",
      "There is no public leaderboard: the tracks here are open until the winners are announced.",
    ].join(" "),
    url: `${SITE}/`,
    host: "website",
    status,
    tags: ["rare-disease", "genomics", "clinical-genetics", "drug-repurposing", "therapeutics", "medical-ai", "llm-agents"],
    domain: "llm-eval",
    images: [],
    organizer: { name: "SAIL AI-Tx Challenge (Harvard Medical School DBMI)", url: `${SITE}/people/`, type: "academic" },
    participation: {
      howToSubmit: `Register (free) on ${SITE}/participate/, download the ${cases.length} hypothetical patient cases from ${SITE}/models/, run your system on each, and upload one JSON array of {"id", "report_markdown"} objects through the submission form on that page, choosing your tier. One submission per individual or team; resubmitting replaces the earlier one.`,
      submissionFormat: "One JSON file (max 5 MB): an array with exactly one object per patient id, each holding a Markdown report that follows the challenge's actionability report template, every required section heading present and in order. The form checks this before it accepts the file.",
      requirements: ["An AI system that writes the reports end to end (no manual editing)", "Access to biomedical sources: ClinVar, OMIM, GeneReviews, ClinicalTrials.gov, drug labels, the literature", "A Hugging Face Space only if you win (to show the system)"],
      compute: "cpu",
      computeDetails: "Tier 3 runs on any API model, so a laptop is enough; Tiers 1 and 2 require open weights you serve yourself (≤ 32B fits one GPU).",
      ...(deadline ? { deadline } : {}),
      rounds: "The final phase of three: question benchmark curation and the question-answering task are closed; actionability report generation is open. Winners are announced by 2027-02-26 and present at SAIL 2027 (Puerto Rico, May 11–14, 2027).",
      prizes: "$12,500 in cash prizes to the winners of the final challenge, an invitation to present at SAIL 2027, and an invitation to submit the solution to NEJM AI.",
      eligibility: "Individuals or teams; closed models are allowed (Tier 3). Cash prizes are paid by Harvard and are taxable.",
      cost: "free",
      verification: "Expert panel review against the challenge's report rubric (cited, verifiable claims; conditional actions where patient details are missing; no repeated actions across sections). Winners must make their system available as a Hugging Face Space.",
    },
    venue: { type: "online", event: "SAIL 2027" },
    quickstart: `# paste into your coding agent:\nRead ${SITE}/ (the challenge specification and report template) and ${SITE}/models/.\nDownload the patients from ${PATIENTS}.\nFor each patient, write the therapeutic actionability report in the required template, citing a verifiable source\n(ClinVar, GeneReviews, a drug label, a ClinicalTrials.gov record) for every claim. Save one JSON array of {"id", "report_markdown"}.\n# then register and upload the file yourself on ${SITE}/models/ (reports must be the system's output, unedited)`,
    links: [
      { label: "Challenge specification and report template", url: `${SITE}/` },
      { label: "Patients and submission form", url: `${SITE}/models/` },
      { label: "Register and key dates", url: `${SITE}/participate/` },
      { label: "Tutorials: therapeutic workflows and sources", url: `${SITE}/tutorial/` },
      { label: "FAQ", url: `${SITE}/faq/` },
      { label: "Patient cases (JSON)", url: PATIENTS },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
