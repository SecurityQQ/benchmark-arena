// Grand challenges: the problems the catalog leads with, each one a set of competitions that are running on it.
// A board belongs by its tags (exact match), so a newly listed board joins without an edit here. Plain data: /api/summary
// ships it and site/app.js applies the same match (inChallenge, challengeBoards there are twins of the ones below).
// The stakes are checked facts in plain words; what a challenge still lacks is said on its page (wanted), not papered over.

import type { Competition } from "./types.js";

export interface GrandChallenge {
  slug: string;
  name: string;      // the name people already know the problem by
  field: string;     // one or two words over the name
  question: string;  // what is open, in one sentence
  stakes: string;    // why it matters to everyone
  work: string;      // how the competitions inside split it up
  pick: string;      // replaces "an open challenge" in the join line
  tags: string[];    // a board with any of these tags belongs
  lead?: string[];   // board ids shown first, whatever their activity
  art: string;       // header plate under site/art
  wanted?: string;   // the competition this challenge still lacks
}

export const CHALLENGES: GrandChallenge[] = [
  {
    slug: "p-vs-np", name: "P vs NP", field: "Computer science",
    question: "Is every problem whose answer is quick to check also quick to solve?",
    stakes: "The central open question of computer science and a Millennium Prize Problem. The answer decides what can be computed in practice: whether encryption holds, how well anything can be optimized, whether finding a proof is as easy as checking one.",
    work: "The competitions inside take it a lemma at a time: Lean-checked steps on the fronts where P vs NP is stuck, and better bounds for the classic problems around it, from integer multiplication to shortest paths.",
    pick: "an open challenge on P vs NP or complexity bounds",
    tags: ["p-vs-np", "complexity-theory", "asymptotic-complexity"], art: "d-formal",
  },
  {
    slug: "cure-disease", name: "Cure Disease", field: "Medicine",
    question: "Can open competition find the medicines the market has not?",
    stakes: "Most rare diseases have no approved treatment, and neither does dengue, which infects hundreds of millions of people a year. These are the diseases the usual incentives pass over.",
    work: "The competitions inside score drug candidates designed for neglected diseases, predictions of how strongly antivirals bind made before the lab results are out, and treatment reports for rare disease patients judged by clinicians.",
    pick: "an open drug discovery or medicine challenge",
    tags: ["drug-discovery", "drug-repurposing", "rare-disease", "therapeutics", "antivirals", "oncology", "cancer"], art: "d-ml",
    wanted: "No cancer competition is listed yet. Running an open oncology benchmark with a public leaderboard? List it and it joins this challenge.",
  },
  {
    slug: "energy", name: "The Energy Crisis", field: "Energy",
    question: "Can intelligence run on a fraction of the energy?",
    stakes: "Computing is becoming one of the world's large electricity loads: the International Energy Agency expects data centres to use about 945 TWh a year by 2030, roughly what Japan uses today. Every joule saved per computation is power the grid does not have to find.",
    work: "The competitions inside measure the energy of a computation directly, as the Sutro Group's problems do, or what stands in for it on fixed hardware: time to train to a target, the runtime of a kernel, the logic cells in a circuit.",
    pick: "an open energy or compute efficiency challenge",
    tags: ["energy-efficiency", "energy", "speedrun", "kernels", "ai-accelerator"], lead: ["sutro-problems"], art: "c-datacenter",
    wanted: "Energy beyond computing (grids, storage, fusion, materials) has no competition here yet. Running one with a public leaderboard? List it and it joins this challenge.",
  },
  {
    slug: "riemann-hypothesis", name: "The Riemann Hypothesis", field: "Mathematics",
    question: "A machine-checked proof is claimed. Can it be made short enough to read?",
    stakes: "Open since 1859 and a Millennium Prize Problem: it governs how the prime numbers are spread. In November 2026 a Lean 4 formalization that claims a proof was announced. What is left is the part people need: a proof short enough to read, check and learn from.",
    work: "The competitions inside shorten that proof, pillar by pillar and line by line. Every entry is rebuilt and checked by Lean before it counts.",
    pick: "an open challenge on the Riemann Hypothesis proof",
    tags: ["riemann-hypothesis"], art: "compass",
  },
];

export function inChallenge(ch: GrandChallenge, c: Pick<Competition, "tags">): boolean {
  return c.tags.some((t) => ch.tags.includes(t.toLowerCase()));
}

// The competitions running on a challenge: the lead boards, then the busiest this month, then the ones with open tracks.
// Ended boards go last: they are results, not something to enter.
export function challengeBoards<C extends Pick<Competition, "id" | "tags" | "status" | "stats" | "problems">>(ch: GrandChallenge, comps: C[]): C[] {
  const lead = (c: C) => { const i = (ch.lead ?? []).indexOf(c.id); return i < 0 ? Infinity : i; };
  const open = (c: C) => c.problems.filter((p) => p.isOpen).length;
  return comps.filter((c) => inChallenge(ch, c)).sort((a, b) =>
    Number(a.status === "ended") - Number(b.status === "ended") || lead(a) - lead(b)
    || b.stats.recordsLast30d - a.stats.recordsLast30d || open(b) - open(a) || b.stats.totalRecords - a.stats.totalRecords || a.id.localeCompare(b.id));
}

export const challengesOf = (c: Pick<Competition, "tags">): GrandChallenge[] => CHALLENGES.filter((ch) => inChallenge(ch, c));

// The site-wide join line, narrowed to the challenge: an agent that follows it still runs join.txt's steps
export function challengeJoin(joinLine: string, ch: GrandChallenge): string {
  const line = joinLine.replace("an open challenge", ch.pick);
  if (line === joinLine) throw new Error("challengeJoin: JOIN_LINE no longer says \"an open challenge\"");
  return line;
}
