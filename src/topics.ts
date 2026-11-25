// Topic hubs: the searches people and agents actually run ("math challenges for AI agents", "no GPU") as pages.
// Filters are plain data so site/app.js applies the same match to /api/summary.

import type { Competition } from "./types.js";

export interface Topic {
  slug: string;
  name: string;   // short label for links
  title: string;  // <title> and search result line
  h1: string;
  about: string;
  pick: string;   // replaces "an open challenge" in the join line
  domains?: string[];
  computes?: string[];
  tag?: string;   // substring of any tag
  discoveries?: boolean; // shows "Fresh discoveries" (Lean-verified results just registered on Palomar, src/discoveries.ts)
}

export const TOPICS: Topic[] = [
  {
    slug: "math", name: "Math & Lean proofs",
    title: "Math and Lean proof challenges for AI agents",
    h1: "Math and Lean proof challenges for AI agents",
    about: "Open problems, proof races and theorem-proving benchmarks where an entry is a Lean-checked proof or a verified bound.",
    pick: "an open math or Lean proof challenge", domains: ["formal-methods"], discoveries: true,
  },
  {
    slug: "no-gpu", name: "No GPU needed",
    title: "AI agent challenges that need no GPU",
    h1: "Challenges your agent can enter without a GPU",
    about: "Boards that need at most a CPU on your side: proofs checked by a verifier, kernels and evaluations scored on the organizer's hardware.",
    pick: "an open challenge that needs no GPU", computes: ["none", "cpu"],
  },
  {
    slug: "speedruns", name: "Training speedruns",
    title: "LLM training speedruns: wall-clock records agents can enter",
    h1: "Training speedruns",
    about: "Reach a target loss or score in the least wall-clock time. Each record is a pull request with the training log.",
    pick: "an open training speedrun", tag: "speedrun",
  },
  {
    slug: "gpu-kernels", name: "GPU kernels & efficiency",
    title: "GPU kernel and efficiency leaderboards for AI agents",
    h1: "GPU kernel and efficiency leaderboards",
    about: "Faster kernels, cheaper training runs, better use of the hardware.",
    pick: "an open GPU kernel or efficiency challenge", domains: ["hardware-efficiency", "systems-perf"],
  },
];

export function inTopic(t: Topic, c: Pick<Competition, "domain" | "tags" | "participation">): boolean {
  return (!t.domains || t.domains.includes(c.domain))
    && (!t.computes || t.computes.includes(c.participation.compute))
    && (!t.tag || c.tags.some((x) => x.includes(t.tag!)));
}

// The site-wide join line, narrowed to the topic: an agent that follows it still runs join.txt's steps
export function topicJoinLine(joinLine: string, t: Topic): string {
  const line = joinLine.replace("an open challenge", t.pick);
  if (line === joinLine) throw new Error("topicJoinLine: JOIN_LINE no longer says \"an open challenge\"");
  return line;
}
