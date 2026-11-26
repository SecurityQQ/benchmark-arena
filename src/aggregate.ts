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

// A row whose contributor is the AI model being benchmarked. People are never that, whatever role the extraction gave them.
export const isSubject = (r: { agent?: { role?: string; family?: string } }) => r.agent?.role === "subject" && r.agent.family !== "human";

export function aggregatePeople(comps: Competition[]): PersonAgg[] {
  const m = new Map<string, PersonAgg>();
  for (const c of comps) {
    for (const p of c.problems) for (const r of p.records) {
      if (!r.contributor || r.isBaseline) continue;
      // skip rows where the "contributor" is itself a model being benchmarked (those belong in /agents as subjects)
      if (isSubject(r)) continue;
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
    if (!p.isOpen || c.status === "ended") continue; // a closed competition's tracks cannot be entered
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

// A dated row that someone entered. Baselines, the model a benchmark scores (role: subject) and model or method rows
// are results tables, not someone entering, so the feed and every "entries in 30 days" count leave them out.
type Row = Competition["problems"][number]["records"][number];
export const isEntry = (r: Row) => !r.isBaseline && !!r.date && /^\d{4}-\d{2}-\d{2}/.test(r.date) && !isSubject(r)
  && r.contributorKind !== "model" && r.contributorKind !== "method";

// The 30- and 90-day counts as of the crawl, by the rule above. The crawler's own counts date from whenever a board was last
// processed and include baselines, so index.json, the MCP server and join.txt disagreed with the pages for some boards.
export function withEntryCounts(comps: Competition[], crawledAt: string): Competition[] {
  const since = (days: number) => new Date(Date.parse(crawledAt) - days * 86400000).toISOString().slice(0, 10);
  const d30 = since(30), d90 = since(90);
  return comps.map((c) => {
    const dates = c.problems.flatMap((p) => p.records.filter(isEntry).map((r) => r.date!.slice(0, 10)));
    return { ...c, stats: { ...c.stats, recordsLast30d: dates.filter((d) => d >= d30).length, recordsLast90d: dates.filter((d) => d >= d90).length } };
  });
}

// Latest dated entries across all boards, newest first: the "what is happening right now" feed.
export function recentActivity(comps: Competition[], limit = 50): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const c of comps) for (const p of c.problems) for (const r of p.records) {
    if (!isEntry(r)) continue;
    out.push({
      competitionId: c.id, competitionName: c.name, problemId: p.id, problemName: p.name,
      date: r.date!.slice(0, 10), value: r.value, metricName: p.metricName, metricUnit: p.metricUnit,
      contributor: r.contributor, contributorUrl: r.contributorUrl, isCurrentBest: !!r.isCurrentBest,
      agent: r.agent && r.agent.family !== "unknown" && r.agent.family !== "human" ? { family: r.agent.family, model: r.agent.model, tool: r.agent.tool } : undefined, // no "with Human"
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
    id: c.id, name: c.name, tagline: c.tagline, status: c.status, domain: c.domain, tags: c.tags, compute: c.participation.compute,
    tracks: c.problems.length, openTracks: c.problems.filter((p) => p.isOpen).length,
    entries: c.stats.totalRecords, entriesLast30d: c.stats.recordsLast30d, entriesLast90d: c.stats.recordsLast90d, participants: c.stats.uniqueParticipants, lastEntry: c.stats.lastSubmission,
    agents: (c.agentStats ?? []).filter((a) => a.family !== "unknown").map((a) => a.family),
    url: c.url, page: `/c/${encodeURIComponent(c.id)}`, digest: `/api/competitions/${encodeURIComponent(c.id)}.md`,
    ...(c.agentDocs?.length ? { agentDocs: c.agentDocs } : {}),   // only boards that have them: the index stays small
    ...(c.importance ? { tier: c.importance.tier, score: c.importance.score, why: c.importance.why } : {}),   // src/frontier.ts
  }));
}

export type IndexEntry = ReturnType<typeof competitionIndex>[number];

// The most compute the human has. "none" is join.txt's "no GPU of your own"; unknown compute is not assumed to fit.
export const COMPUTE_FIT = { none: ["none", "cpu"], "consumer-gpu": ["none", "cpu", "consumer-gpu"], any: null } as const;
export interface ChallengeFilter { query?: string; compute?: keyof typeof COMPUTE_FIT; domain?: string; openOnly?: boolean }
const STOPWORDS = new Set("a an and any for i in into is me my of on or some that the to want with".split(" "));

// find_challenges (src/mcp.ts) over /api/index.json rows. More query words matched ranks first, then the frontier and the
// rating (src/frontier.ts), then boards people are entering now, busiest first, then challenges with an open track.
// Ended challenges are left out, as on join.txt.
export function findChallenges(index: IndexEntry[], f: ChallengeFilter = {}): IndexEntry[] {
  const words = [...new Set(f.query?.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((w) => !STOPWORDS.has(w));
  const fit: readonly string[] | null = COMPUTE_FIT[f.compute ?? "any"];
  const domain = f.domain?.trim().toLowerCase();
  const score = (c: IndexEntry) => {
    const text = [c.id, c.name, c.tagline, c.domain, ...(c.tags ?? [])].join(" ").toLowerCase();   // an older index has no tags
    return words.filter((w) => text.includes(w) || (w.length > 3 && w.endsWith("s") && text.includes(w.slice(0, -1)))).length;
  };
  return index.map((c) => ({ c, hits: score(c) }))
    .filter(({ c, hits }) => c.status !== "ended" && (!words.length || hits > 0) && (!fit || fit.includes(c.compute))
      && (!domain || c.domain.toLowerCase() === domain) && (!f.openOnly || c.openTracks > 0))
    .sort((a, b) => b.hits - a.hits || Number(b.c.tier === "frontier") - Number(a.c.tier === "frontier") || (b.c.score ?? -1) - (a.c.score ?? -1)
      || b.c.entriesLast30d - a.c.entriesLast30d || Number(b.c.openTracks > 0) - Number(a.c.openTracks > 0)
      || (b.c.entriesLast90d ?? 0) - (a.c.entriesLast90d ?? 0) || (b.c.lastEntry ?? "").localeCompare(a.c.lastEntry ?? ""))
    .map(({ c }) => c);
}
