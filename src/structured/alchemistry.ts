// Deterministic builder for the Alchemistry 2027 Blind Challenge (OMSF Alchemistry, with ASAP Discovery, OpenADMET and OpenBind):
// predict how strongly 54 inhibitors bind the Dengue-2 NS2B-NS3 protease, a target of ASAP's open pan-flavivirus antiviral
// programme, before the measured potencies are released. Its submission portal is a Hugging Face Space with no GitHub repository,
// so it is a site source (main.ts SITES). Source (public, no login):
//   https://huggingface.co/spaces/openadmet/alchemistry-2027-challenge/resolve/main/config.py — the Space's own configuration: the
//   phase it is in (CURRENT_PHASE), the test set size, the submission cooldown and the deadlines it shows participants
// No LLM involved. One track per leaderboard the Space ranks (free energy methods, machine learning). The leaderboards are read
// from a private bucket by the Space, so the tracks carry no records; the final ranking is published from 2027-04-01.

import type { LLMCompetition } from "../llm.js";
import type { Problem } from "../types.js";
import { boundedFetch } from "../github.js";

export const SPACE = "https://huggingface.co/spaces/openadmet/alchemistry-2027-challenge";
export const CONFIG = `${SPACE}/resolve/main/config.py`;
export const DATASET = "https://huggingface.co/datasets/openadmet/alchemistry-2027-antiviral-blind-challenge";
export const NEWS = "https://omsf.io/alchemistry/news/2026/10/alchemistry-blind-challenge-2027/";
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const MAX_BYTES = 512 * 1024;

async function getText(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(url, { headers: { accept: "text/plain", "user-agent": USER_AGENT } }, MAX_BYTES, 30_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      return await r.text();
    } catch {
      if (attempt >= 1) throw new Error("Alchemistry 2027 download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const isoDay = (s: string | undefined) =>
  s && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : undefined;
const intOf = (py: string, name: string) => {
  const m = py.match(new RegExp(`^${name}\\s*=\\s*(\\d{1,6})\\s*$`, "m"));
  return m ? Number(m[1]) : undefined;
};

export interface AlchemistryConfig { phase?: number; compounds?: number; cooldownHours?: number; intermediate?: string; deadline?: string }
// Only integer constants and ISO dates in the organizers' fixed sentences are read; the rest of the file is code and prose
export function configOf(py: string): AlchemistryConfig {
  return {
    phase: intOf(py, "CURRENT_PHASE"),
    compounds: intOf(py, "ACTIVITY_DATASET_SIZE"),
    cooldownHours: intOf(py, "HOURS_BETWEEN_SUBMISSIONS"),
    intermediate: isoDay(py.match(/Intermediate submission deadline is (20\d\d-\d\d-\d\d)/)?.[1]),
    deadline: isoDay(py.match(/Submissions will close on (20\d\d-\d\d-\d\d)/)?.[1]),
  };
}
// The Space's phases: 0 not yet open, 1 open, 2 open with the intermediate board out, 3 closed, 4 final board out.
// Past the closing date it is over whatever the phase says.
export function statusOf(cfg: AlchemistryConfig, today = new Date().toISOString().slice(0, 10)): "active" | "upcoming" | "ended" | "unknown" {
  if (cfg.deadline && cfg.deadline < today) return "ended";
  switch (cfg.phase) {
    case 0: return "upcoming";
    case 1: case 2: return cfg.deadline ? "active" : "unknown";
    case 3: case 4: return "ended";
    default: return "unknown";
  }
}

const TRACKS: { id: string; name: string; description: string }[] = [
  { id: "free-energy", name: "Free energy methods", description: "Physics-based predictions: relative (FEP/TI over a perturbation map, with per-edge ΔΔG also submitted) or absolute binding free energy calculations." },
  { id: "machine-learning", name: "Machine learning and hybrid methods", description: "Pure machine-learning, docking-based and other or hybrid predictions, ranked on their own leaderboard." },
];

export async function buildAlchemistry(today?: string): Promise<LLMCompetition> {
  const cfg = configOf(await getText(CONFIG));
  if (cfg.phase === undefined || !cfg.compounds) throw new Error("Alchemistry 2027 download failed");
  const status = statusOf(cfg, today);
  const n = cfg.compounds;
  console.log(`    alchemistry-2027: ${status}, phase ${cfg.phase}, deadline ${cfg.deadline ?? "unknown"}, ${n} compounds`);

  const problems: Problem[] = TRACKS.map((t) => ({
    id: t.id, name: t.name,
    description: `${t.description} Predict the binding free energy (kcal/mol, with an uncertainty) of all ${n} test compounds against the Dengue-2 NS2B-NS3 protease; ranked by Kendall's τ against the measured potencies. The live board scores half the compounds; the final ranking, on all ${n}, is published from 2027-04-01.`,
    metricName: "Kendall's τ", metricDirection: "maximize", isOpen: status !== "ended", records: [],
  }));

  return {
    id: "alchemistry-2027",
    name: "Alchemistry 2027 Blind Challenge: Dengue Antivirals",
    tagline: `Predict how strongly ${n} candidate dengue antivirals bind their target before the lab results are released.`,
    description: [
      "Dengue infects hundreds of millions of people a year and has no approved antiviral. The Alchemistry 2027 Blind Challenge, run by the Open Molecular Software Foundation's Alchemistry community with ASAP Discovery, OpenADMET and OpenBind, takes a real lead series from ASAP's open pan-flavivirus antiviral programme and asks how well computational methods would have guided it.",
      `Entrants get the structures of ${n} congeneric inhibitors of the Dengue-2 NS2B-NS3 protease, spanning more than two orders of magnitude in measured potency, and predict each one's binding free energy before the measurements are released. Free energy calculations and machine learning are ranked on separate leaderboards by Kendall's τ.`,
      "Half the compounds score a live leaderboard while the challenge runs; the other half are held back, so the final ranking cannot be tuned against. Top performers present at the Alchemistry 2027 workshop.",
    ].join(" "),
    url: SPACE,
    host: "huggingface",
    status,
    tags: ["drug-discovery", "virology", "dengue", "antivirals", "free-energy", "binding-affinity", "cheminformatics", "blind-challenge"],
    domain: "ml-research",
    images: [],
    organizer: { name: "OMSF Alchemistry, with ASAP Discovery, OpenADMET and OpenBind", url: NEWS, type: "foundation" },
    participation: {
      howToSubmit: `Sign in to ${SPACE} with a Hugging Face account, download the test set from ${DATASET}, and upload your predictions on the Space's Submit tab, choosing your method class. Participation is anonymous by default.`,
      submissionFormat: `A .parquet (preferred) or .csv file with exactly ${n} rows: Molecule_Name, "CXSMILES (CDD Compatible)", denv2_ns2b_ns3_potency_predicted and denv2_ns2b_ns3_potency_predicted_uncertainty (kcal/mol). Relative methods also upload an edge file of predicted ΔΔG.`,
      requirements: ["A Hugging Face account (one per lab or team)", "A binding free energy or affinity prediction method", "A short method description with each submission"],
      compute: "consumer-gpu",
      computeDetails: "Free energy calculations want a GPU; machine-learning entries can run on a laptop. Organizer partners (Cresset, OpenEye, Rowan) offer licences and compute tokens on request.",
      ...(cfg.deadline ? { deadline: cfg.deadline } : {}),
      rounds: `Submissions are open from the test set release (2026-11-01)${cfg.deadline ? ` to ${cfg.deadline}, 23:59 UTC` : ""}${cfg.intermediate ? `; entries in by ${cfg.intermediate} make the intermediate leaderboard` : ""}. Final leaderboard from 2027-04-01, talks at Alchemistry 2027 (May 3–5, 2027, San Francisco).`,
      prizes: "No cash prize: top performers are invited to present at the Alchemistry 2027 workshop.",
      eligibility: "Open to anyone with a Hugging Face account; open-sourcing your method is required for community recognition.",
      cost: "free",
      verification: `Scored by the organizers against hidden measured potencies; at most one submission per track every ${cfg.cooldownHours ?? 48} hours, and only the latest valid one counts.`,
    },
    venue: { type: "online", event: "Alchemistry 2027" },
    quickstart: `# paste into your coding agent:\nRead ${NEWS} and the About tab of ${SPACE}.\nDownload the ${n} test compounds from ${DATASET}.\nPredict each compound's binding free energy to the Dengue-2 NS2B-NS3 protease in kcal/mol with an uncertainty,\nand write exactly ${n} rows with the columns Molecule_Name, "CXSMILES (CDD Compatible)", denv2_ns2b_ns3_potency_predicted,\ndenv2_ns2b_ns3_potency_predicted_uncertainty to predictions.csv.\n# then sign in and upload the file yourself on the Space's Submit tab`,
    links: [
      { label: "Announcement and timeline", url: NEWS },
      { label: "Submission portal and leaderboards", url: SPACE },
      { label: "Test set (Hugging Face dataset)", url: DATASET },
      { label: "Discord (#alchemistry-2027-challenge)", url: "https://discord.gg/Vmp8cfjQHB" },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
