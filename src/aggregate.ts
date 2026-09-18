// Cross-competition aggregations: people and agent families
import type { Competition, AgentFamily } from "./types.js";

export interface PersonAgg {
  name: string;
  url?: string;
  records: number;
  currentBests: number;
  competitions: { id: string; name: string; records: number; bests: number }[];
  agents: Partial<Record<AgentFamily, number>>;   // which model families this person ships with
  lastActive?: string;
}

export interface AgentAgg {
  family: AgentFamily;
  records: number;
  currentBests: number;
  competitions: { id: string; name: string; records: number; bests: number }[];
  models: Record<string, number>;
  tools: Record<string, number>;
  contributors: string[];
  highConfidence: number;
}

export interface OpenProblem {
  competitionId: string; competitionName: string; compute: string;
  problemId: string; problemName: string; description?: string;
  metricName: string; metricDirection: string; baseline?: number;
}

export function aggregatePeople(comps: Competition[]): PersonAgg[] {
  const m = new Map<string, PersonAgg>();
  for (const c of comps) {
    for (const p of c.problems) for (const r of p.records) {
      if (!r.contributor || r.isBaseline) continue;
      // skip rows where the "contributor" is itself a model being benchmarked (those belong in /agents as subjects)
      if (r.agent?.role === "subject") continue;
      if (r.contributorKind === "model" || r.contributorKind === "method") continue;
      const key = r.contributor.toLowerCase();
      const cur = m.get(key) ?? { name: r.contributor, url: r.contributorUrl, records: 0, currentBests: 0, competitions: [], agents: {} };
      cur.records++;
      if (r.isCurrentBest) cur.currentBests++;
      let cc = cur.competitions.find((x) => x.id === c.id);
      if (!cc) { cc = { id: c.id, name: c.name, records: 0, bests: 0 }; cur.competitions.push(cc); }
      cc.records++; if (r.isCurrentBest) cc.bests++;
      if (r.agent && r.agent.family !== "unknown") cur.agents[r.agent.family] = (cur.agents[r.agent.family] ?? 0) + 1;
      if (r.date && (!cur.lastActive || r.date > cur.lastActive)) cur.lastActive = r.date;
      m.set(key, cur);
    }
  }
  return [...m.values()].sort((a, b) => b.currentBests - a.currentBests || b.records - a.records);
}

export function aggregateAgents(comps: Competition[], role: "author" | "subject" = "author"): AgentAgg[] {
  const m = new Map<AgentFamily, AgentAgg>();
  for (const c of comps) {
    for (const p of c.problems) for (const r of p.records) {
      if (!r.agent || r.isBaseline || r.agent.family === "unknown") continue;
      if ((r.agent.role ?? "author") !== role) continue;
      const f = r.agent.family;
      const cur = m.get(f) ?? { family: f, records: 0, currentBests: 0, competitions: [], models: {}, tools: {}, contributors: [], highConfidence: 0 };
      cur.records++;
      if (r.isCurrentBest) cur.currentBests++;
      if (r.agent.confidence === "high") cur.highConfidence++;
      if (r.agent.model) cur.models[r.agent.model] = (cur.models[r.agent.model] ?? 0) + 1;
      if (r.agent.tool) cur.tools[r.agent.tool] = (cur.tools[r.agent.tool] ?? 0) + 1;
      if (r.contributor && !cur.contributors.includes(r.contributor)) cur.contributors.push(r.contributor);
      let cc = cur.competitions.find((x) => x.id === c.id);
      if (!cc) { cc = { id: c.id, name: c.name, records: 0, bests: 0 }; cur.competitions.push(cc); }
      cc.records++; if (r.isCurrentBest) cc.bests++;
      m.set(f, cur);
    }
  }
  return [...m.values()].sort((a, b) => b.currentBests - a.currentBests || b.records - a.records);
}

export function openProblems(comps: Competition[]): OpenProblem[] {
  const out: OpenProblem[] = [];
  for (const c of comps) for (const p of c.problems) {
    if (!p.isOpen) continue;
    out.push({ competitionId: c.id, competitionName: c.name, compute: c.participation.compute, problemId: p.id, problemName: p.name,
      description: p.description, metricName: p.metricName, metricDirection: p.metricDirection, baseline: p.baseline });
  }
  return out;
}
