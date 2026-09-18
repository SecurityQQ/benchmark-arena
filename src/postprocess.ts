// Derive participants/stats and normalize URLs after LLM extraction

import type { Competition, Participant, Stats, DiscoveredRepo, AgentFamily, AgentStat } from "./types.js";
import type { LLMCompetition } from "./llm.js";

const DAY = 86_400_000;

function resolveUrl(u: string, repo: DiscoveredRepo, raw: boolean): string {
  if (!u) return u;
  if (/^https?:\/\//.test(u)) return u;
  const path = u.replace(/^\.?\//, "");
  const base = raw
    ? `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.defaultBranch}`
    : `https://github.com/${repo.owner}/${repo.name}/blob/${repo.defaultBranch}`;
  return `${base}/${path}`;
}

function isBadge(u: string): boolean {
  return /shields\.io|badge|img\.shields|travis|circleci|codecov|colab-badge|license/i.test(u);
}

const FAMILY_RX: [AgentFamily, RegExp][] = [
  ["anthropic", /claude|opus|sonnet|haiku|fable|anthropic/i],
  ["openai", /gpt|\bo[1-9]\b|codex|openai|chatgpt/i],
  ["google", /gemini|gemma|google/i],
  ["deepseek", /deepseek/i],
  ["meta", /llama|meta/i],
  ["xai", /grok|xai/i],
  ["mistral", /mistral|mixtral|codestral/i],
  ["alibaba", /qwen|alibaba/i],
  ["moonshot", /kimi|moonshot/i],
  ["zhipu", /glm|zhipu/i],
];
export function familyFromName(s?: string): AgentFamily | undefined {
  if (!s) return undefined;
  for (const [fam, rx] of FAMILY_RX) if (rx.test(s)) return fam;
  return undefined;
}

export function postprocess(llm: LLMCompetition, repo: DiscoveredRepo): Competition {
  const now = Date.now();

  // Normalize image + submission + link URLs
  const images = (llm.images ?? [])
    .map((u) => resolveUrl(u, repo, true))
    .filter((u) => !isBadge(u))
    .slice(0, 4);

  for (const p of llm.problems ?? []) {
    for (const r of p.records ?? []) {
      if (r.submissionUrls) r.submissionUrls = r.submissionUrls.map((u) => resolveUrl(u, repo, false));
      if (!r.contributorKind || r.contributorKind === "unknown") {
        if (familyFromName(r.contributor)) r.contributorKind = "model";
        else if (r.contributorUrl && /github\.com\/[^/]+\/?$/.test(r.contributorUrl)) r.contributorKind = "person";
        else if (r.contributor && /^[a-z][\w-]{2,38}$/.test(r.contributor) && /\d|-|[a-z][A-Z]/.test(r.contributor)) r.contributorKind = "person";
        else if (r.contributor && /\s|\(|[A-Z]{3,}/.test(r.contributor)) r.contributorKind = "method";
      }
      if (r.contributor && !r.contributorUrl && r.contributorKind === "person" && /^[\w-]+$/.test(r.contributor)) {
        r.contributorUrl = `https://github.com/${r.contributor}`;
      }
    }
    // Ensure exactly one isCurrentBest
    const recs = p.records ?? [];
    if (recs.length && !recs.some((r) => r.isCurrentBest)) {
      const best = recs.reduce((a, b) =>
        p.metricDirection === "minimize" ? (b.value < a.value ? b : a) : (b.value > a.value ? b : a));
      best.isCurrentBest = true;
    }
    // Baseline rows: LLM flag, or description says so, or value equals declared baseline
    for (const r of recs) {
      if (!r.isBaseline && (/\b(baseline|naive|reference)\b/i.test(r.description ?? "") || (p.baseline != null && r.value === p.baseline))) r.isBaseline = true;
    }
    // Agent family sanity: derive from model/contributor name if LLM left unknown
    for (const r of recs) {
      if (r.agent && (r.agent.family === "unknown" || !r.agent.family)) {
        const fam = familyFromName(r.agent.model) ?? familyFromName(r.agent.tool);
        if (fam) r.agent.family = fam;
      }
      if (!r.agent) {
        const fam = familyFromName(r.contributor);
        if (fam) r.agent = { family: fam, model: r.contributor, confidence: "high", evidence: "leaderboard row is a model name", role: "subject" };
      }
      if (r.agent && !r.agent.role) {
        const ev = r.agent.evidence ?? "";
        const authorEvidence = !!r.agent.tool || /co-authored|generated with|branch|codex\/|\[codex\]|assisted|agent-driven|session|declared_model|submitted by|harness/i.test(ev);
        const contributorIsModel = !!familyFromName(r.contributor) || /leaderboard row is a model name|row is the model/i.test(ev)
          || (!!r.contributor && !!r.agent.model && r.contributor.toLowerCase().replace(/[^a-z0-9]/g, "") === r.agent.model.toLowerCase().replace(/[^a-z0-9]/g, ""));
        r.agent.role = contributorIsModel && !authorEvidence ? "subject" : "author";
      }
    }
    // Open problem: nobody has beaten the baseline yet
    const nonBaseline = recs.filter((r) => !r.isBaseline);
    p.isOpen = nonBaseline.length === 0;
  }

  // Agent stats per family
  const amap = new Map<AgentFamily, AgentStat>();
  for (const p of llm.problems ?? []) {
    for (const r of p.records ?? []) {
      if (!r.agent || r.isBaseline || r.agent.role === "subject") continue;
      const fam = r.agent.family;
      const cur = amap.get(fam) ?? { family: fam, records: 0, currentBests: 0, models: [], contributors: [] };
      cur.records++;
      if (r.isCurrentBest) cur.currentBests++;
      if (r.agent.model && !cur.models.includes(r.agent.model)) cur.models.push(r.agent.model);
      if (r.contributor && !cur.contributors.includes(r.contributor)) cur.contributors.push(r.contributor);
      amap.set(fam, cur);
    }
  }
  const agentStats = [...amap.values()].sort((a, b) => b.currentBests - a.currentBests || b.records - a.records);

  // Participants
  const pmap = new Map<string, Participant>();
  const dates: string[] = [];
  for (const p of llm.problems ?? []) {
    for (const r of p.records ?? []) {
      if (r.date) dates.push(r.date);
      const key = (r.contributor ?? "unknown").trim();
      if (!key || key === "unknown") continue;
      if (r.contributorKind === "model" || r.contributorKind === "method") continue;
      const cur = pmap.get(key) ?? { name: key, url: r.contributorUrl, submissions: 0, problems: [] };
      cur.submissions++;
      if (!cur.problems.includes(p.id)) cur.problems.push(p.id);
      if (r.isCurrentBest) cur.bestRank = 1;
      if (r.date && (!cur.lastActive || r.date > cur.lastActive)) cur.lastActive = r.date;
      pmap.set(key, cur);
    }
  }
  const participants = [...pmap.values()].sort((a, b) =>
    (a.bestRank ?? 9) - (b.bestRank ?? 9) || b.submissions - a.submissions);

  dates.sort();
  const totalRecords = (llm.problems ?? []).reduce((s, p) => s + (p.records?.length ?? 0), 0);
  const stats: Stats = {
    totalRecords,
    uniqueParticipants: participants.length,
    firstSubmission: dates[0],
    lastSubmission: dates[dates.length - 1],
    recordsLast30d: dates.filter((d) => now - Date.parse(d) < 30 * DAY).length,
    recordsLast90d: dates.filter((d) => now - Date.parse(d) < 90 * DAY).length,
  };

  // Status heuristic override if LLM said unknown
  let status = llm.status ?? "unknown";
  if (status === "unknown" && stats.lastSubmission) {
    status = now - Date.parse(stats.lastSubmission) < 180 * DAY ? "active" : "ended";
  }

  return {
    ...llm,
    id: llm.id || `${repo.owner}-${repo.name}`.toLowerCase(),
    url: llm.url || repo.url,
    status,
    images,
    tags: llm.tags ?? [],
    links: llm.links ?? [],
    participation: {
      ...(llm.participation ?? {}),
      requirements: llm.participation?.requirements ?? [],
      compute: llm.participation?.compute ?? "unknown",
    },
    problems: llm.problems ?? [],
    repo: { owner: repo.owner, name: repo.name, branch: repo.defaultBranch },
    participants,
    stats,
    agentStats,
    lastUpdated: new Date().toISOString(),
  };
}
