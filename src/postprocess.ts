// Derive participants/stats and normalize URLs after LLM extraction

import type { Competition, Problem, Participant, Stats, DiscoveredRepo, AgentFamily, AgentStat } from "./types.js";
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

// Word-boundary aware: "Metapath2vec" is not Meta, "glmnet" is not GLM, "Opus" alone (audio codec) is not Claude.
const FAMILY_RX: [AgentFamily, RegExp][] = [
  ["anthropic", /\bclaude\b|\bclaude[- ]?(opus|sonnet|haiku|fable)|\b(opus|sonnet|haiku|fable)[- ]?\d|\banthropic\b/i],
  ["openai", /\bgpt[- ]?\d|\bgpt\b|\bo[1-9](-(mini|pro|high))?\b|\bcodex\b|\bopenai\b|\bchatgpt\b/i],
  ["google", /\bgemini\b|\bgemma\b|\bgoogle\b|\bdeepmind\b/i],
  ["deepseek", /\bdeepseek\b|deepseek[- ]?(v\d|r\d|prover|coder)/i],
  ["meta", /\bllama\b|\bmeta[- ]?(ai|llama)\b|\bcode[- ]?llama\b/i],
  ["xai", /\bgrok\b|\bxai\b/i],
  ["mistral", /\bmistral\b|\bmixtral\b|\bcodestral\b|\bdevstral\b/i],
  ["alibaba", /\bqwen\b|\bqwq\b|\balibaba\b/i],
  ["moonshot", /\bkimi\b|\bmoonshot\b/i],
  ["zhipu", /\bglm[- ]?\d|\bchatglm\b|\bzhipu\b/i],
  ["bytedance", /\bbytedance\b|\bseed[- ]?prover\b|\bdoubao\b/i],
  ["harmonic", /\bharmonic\b|\baristotle\b/i],
  ["axiom", /\baxiom (prover|math)\b|\baxiom-prover\b/i],
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
      // an explicit false (rows declared through SUBMISSION.md) is respected; the text heuristic only fills in blanks
      if (r.isBaseline === undefined && (/\b(baseline|naive|reference)\b/i.test(r.description ?? "") || (p.baseline != null && r.value === p.baseline))) r.isBaseline = true;
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
    // Contested: a "current best" only means something when at least two distinct contributors compete
    p.contested = new Set(nonBaseline.map((r) => (r.contributor ?? "").trim().toLowerCase()).filter(Boolean)).size >= 2;
  }

  // Agent stats per family
  const amap = new Map<AgentFamily, AgentStat>();
  for (const p of llm.problems ?? []) {
    for (const r of p.records ?? []) {
      if (!r.agent || r.isBaseline || r.agent.role === "subject") continue;
      const fam = r.agent.family;
      const cur = amap.get(fam) ?? { family: fam, records: 0, currentBests: 0, models: [], contributors: [] };
      cur.records++;
      if (r.isCurrentBest) { if (p.contested) cur.currentBests++; else cur.uncontestedBests = (cur.uncontestedBests ?? 0) + 1; }
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
      // a co-authored row ("alice, bob") credits each handle, it is not a third participant
      const handles = key.split(/\s*[,&]\s*/).filter(Boolean);
      const names = handles.length > 1 && handles.every((h) => /^[\w-]+$/.test(h)) ? handles : [key];
      for (const name of names) {
        const cur = pmap.get(name) ?? { name, url: names.length > 1 ? `https://github.com/${name}` : r.contributorUrl, submissions: 0, problems: [] };
        cur.submissions++;
        if (!cur.problems.includes(p.id)) cur.problems.push(p.id);
        if (r.isCurrentBest && p.contested) cur.bestRank = 1;
        if (r.date && (!cur.lastActive || r.date > cur.lastActive)) cur.lastActive = r.date;
        pmap.set(name, cur);
      }
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
    problems: orderProblems((llm.problems ?? []) as Problem[]),
    repo: { owner: repo.owner, name: repo.name, branch: repo.defaultBranch },
    participants,
    stats,
    agentStats,
    lastUpdated: new Date().toISOString(),
  };
}

// Track order: challenges (groups) newest first — by the date of their first record, a challenge with no records yet counts as newest —
// and inside a challenge the open tracks lead. Without groups this is just "open first", in the order the docs list them.
function orderProblems(problems: Problem[]): Problem[] {
  const launched = new Map<string, string>();
  for (const p of problems) {
    const g = p.group ?? "";
    const first = (p.records ?? []).map((r) => r.date ?? "").filter(Boolean).sort()[0] ?? "";
    const cur = launched.get(g);
    if (cur === undefined) launched.set(g, first);
    else if (first && (!cur || first < cur)) launched.set(g, first);
  }
  const idx = new Map(problems.map((p, i) => [p, i]));
  return [...problems].sort((a, b) => {
    const ga = a.group ?? "", gb = b.group ?? "";
    if (ga !== gb) {
      const la = launched.get(ga) || "9999", lb = launched.get(gb) || "9999";
      if (la !== lb) return la < lb ? 1 : -1;
      return ga < gb ? -1 : 1;
    }
    return Number(b.isOpen) - Number(a.isOpen) || idx.get(a)! - idx.get(b)!;
  });
}
