// Cross-competition aggregations: people and agent families
import type { Competition, AgentFamily } from "./types.js";

export interface PersonAgg {
  name: string;
  url?: string;
  records: number;
  currentBests: number;           // bests in contested tracks only
  uncontestedBests: number;       // solo entries that are trivially "best"
  competitions: { id: string; name: string; records: number; bests: number }[];
  agents: Partial<Record<AgentFamily, number>>;   // which model families this person ships with
  lastActive?: string;
}

export interface AgentAgg {
  family: AgentFamily;
  records: number;
  currentBests: number;           // bests in contested tracks only
  uncontestedBests: number;       // solo entries that are trivially "best"
  competitions: { id: string; name: string; records: number; bests: number }[];
  models: Record<string, number>;
  tools: Record<string, number>;
  contributors: string[];
  highConfidence: number;
}

export interface OpenProblem {
  competitionId: string; competitionName: string; compute: string;
  problemId: string; problemName: string; description?: string;
  metricName: string; metricDirection: string; baseline?: number; passMark?: number;
  // unbeaten: entries exist or are invited, nobody beat the baseline yet · unsolved: graded, nobody reached the pass mark
  kind: "unbeaten" | "unsolved";
  page: string; digest: string;            // site-relative: /c/{id} and /api/competitions/{id}.md
  repo?: string; howToSubmit?: string;     // where and how to act on it
  entries: number; lastEntry?: string;     // entries on this track, latest entry date on the competition
}

const isContested = (p: Competition["problems"][number]) =>
  p.contested ?? new Set(p.records.filter((r) => !r.isBaseline).map((r) => (r.contributor ?? "").trim().toLowerCase()).filter(Boolean)).size >= 2;

export function aggregatePeople(comps: Competition[]): PersonAgg[] {
  const m = new Map<string, PersonAgg>();
  for (const c of comps) {
    for (const p of c.problems) for (const r of p.records) {
      if (!r.contributor || r.isBaseline) continue;
      // skip rows where the "contributor" is itself a model being benchmarked (those belong in /agents as subjects)
      if (r.agent?.role === "subject") continue;
      if (r.contributorKind === "model" || r.contributorKind === "method") continue;
      const key = r.contributor.toLowerCase();
      const cur = m.get(key) ?? { name: r.contributor, url: r.contributorUrl, records: 0, currentBests: 0, uncontestedBests: 0, competitions: [], agents: {} };
      cur.records++;
      const best = !!r.isCurrentBest && isContested(p);
      if (r.isCurrentBest && !best) cur.uncontestedBests++;
      if (best) cur.currentBests++;
      let cc = cur.competitions.find((x) => x.id === c.id);
      if (!cc) { cc = { id: c.id, name: c.name, records: 0, bests: 0 }; cur.competitions.push(cc); }
      cc.records++; if (best) cc.bests++;
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
      const cur = m.get(f) ?? { family: f, records: 0, currentBests: 0, uncontestedBests: 0, competitions: [], models: {}, tools: {}, contributors: [], highConfidence: 0 };
      cur.records++;
      const best = !!r.isCurrentBest && isContested(p);
      if (r.isCurrentBest && !best) cur.uncontestedBests++;
      if (best) cur.currentBests++;
      if (r.agent.confidence === "high") cur.highConfidence++;
      if (r.agent.model) cur.models[r.agent.model] = (cur.models[r.agent.model] ?? 0) + 1;
      if (r.agent.tool) cur.tools[r.agent.tool] = (cur.tools[r.agent.tool] ?? 0) + 1;
      if (r.contributor && !cur.contributors.includes(r.contributor)) cur.contributors.push(r.contributor);
      let cc = cur.competitions.find((x) => x.id === c.id);
      if (!cc) { cc = { id: c.id, name: c.name, records: 0, bests: 0 }; cur.competitions.push(cc); }
      cc.records++; if (best) cc.bests++;
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
      description: p.description, metricName: p.metricName, metricDirection: p.metricDirection, baseline: p.baseline, passMark: p.passMark,
      kind: p.passMark != null ? "unsolved" : "unbeaten",
      page: `/c/${encodeURIComponent(c.id)}`, digest: `/api/competitions/${encodeURIComponent(c.id)}.md`,
      repo: c.repo ? `https://github.com/${c.repo.owner}/${c.repo.name}` : c.url, howToSubmit: c.participation.howToSubmit,
      entries: p.records.filter((r) => !r.isBaseline).length, lastEntry: c.stats.lastSubmission });
  }
  return out;
}

export interface ActivityItem {
  competitionId: string; competitionName: string; problemId: string; problemName: string;
  date: string; value: number; metricName: string; metricUnit?: string;
  contributor?: string; contributorUrl?: string; isCurrentBest: boolean;
  agent?: { family: AgentFamily; model?: string; tool?: string };
  url?: string;
}

// Latest dated entries across all boards, newest first: the "what is happening right now" feed.
// Rows that benchmark a model (role: subject) are results tables, not someone entering, so they are left out.
export function recentActivity(comps: Competition[], limit = 50): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const c of comps) for (const p of c.problems) for (const r of p.records) {
    if (r.isBaseline || !r.date || !/^\d{4}-\d{2}-\d{2}/.test(r.date) || r.agent?.role === "subject") continue;
    if (r.contributorKind === "model" || r.contributorKind === "method") continue;
    out.push({
      competitionId: c.id, competitionName: c.name, problemId: p.id, problemName: p.name,
      date: r.date.slice(0, 10), value: r.value, metricName: p.metricName, metricUnit: p.metricUnit,
      contributor: r.contributor, contributorUrl: r.contributorUrl, isCurrentBest: !!r.isCurrentBest,
      agent: r.agent && r.agent.family !== "unknown" ? { family: r.agent.family, model: r.agent.model, tool: r.agent.tool } : undefined,
      url: r.submissionUrls?.find((u) => /^https:\/\//.test(u)),
    });
  }
  // same day: records first, then agent-attributed entries, so the top of the feed is the news
  return out.sort((a, b) => b.date.localeCompare(a.date) || Number(b.isCurrentBest) - Number(a.isCurrentBest) || Number(!!b.agent) - Number(!!a.agent)).slice(0, limit);
}

// Boards where people are entering right now: most entries in the last 30 days, then the last 90
export function hotCompetitions(comps: Competition[], limit = 8): Competition[] {
  return comps.filter((c) => c.status !== "ended" && c.stats.recordsLast90d > 0)
    .sort((a, b) => b.stats.recordsLast30d - a.stats.recordsLast30d || b.stats.recordsLast90d - a.stats.recordsLast90d)
    .slice(0, limit);
}

// A few kilobytes instead of the full dataset: enough for an agent to choose, with links to the details
export function competitionIndex(comps: Competition[]) {
  return comps.map((c) => ({
    id: c.id, name: c.name, tagline: c.tagline, status: c.status, domain: c.domain, compute: c.participation.compute,
    tracks: c.problems.length, openTracks: c.problems.filter((p) => p.isOpen).length,
    entries: c.stats.totalRecords, entriesLast30d: c.stats.recordsLast30d, participants: c.stats.uniqueParticipants, lastEntry: c.stats.lastSubmission,
    agents: (c.agentStats ?? []).filter((a) => a.family !== "unknown").map((a) => a.family),
    url: c.url, page: `/c/${encodeURIComponent(c.id)}`, digest: `/api/competitions/${encodeURIComponent(c.id)}.md`,
  }));
}
