// Text renderers shared by the dev server and the static build
import type { Competition, CrawlResult } from "./types.js";
import { aggregateAgents, aggregatePeople, openProblems } from "./aggregate.js";

// Plain-text digest of one competition, optimized for LLM consumption
export function competitionToMarkdown(c: Competition): string {
  const p = c.participation;
  const lines: string[] = [
    `# ${c.name}`,
    ``,
    `${c.tagline}`,
    ``,
    `- URL: ${c.url}`,
    `- Status: ${c.status}`,
    `- Domain: ${c.domain}`,
    `- Tags: ${c.tags.join(", ")}`,
    c.organizer ? `- Organizer: ${c.organizer.name}${c.organizer.url ? ` (${c.organizer.url})` : ""}` : "",
    c.venue ? `- Venue: ${c.venue.type}${c.venue.location ? `, ${c.venue.location}` : ""}${c.venue.event ? ` — ${c.venue.event}` : ""}` : "",
    ``,
    `## Description`,
    c.description,
    ``,
    `## Participation`,
    `- Compute: ${p.compute}${p.computeDetails ? ` — ${p.computeDetails}` : ""}`,
    p.requirements.length ? `- Requirements: ${p.requirements.join(", ")}` : "",
    p.howToSubmit ? `- How to submit: ${p.howToSubmit}` : "",
    p.submissionFormat ? `- Submission format: ${p.submissionFormat}` : "",
    p.verification ? `- Verification: ${p.verification}` : "",
    p.deadline ? `- Deadline: ${p.deadline}` : "",
    p.rounds ? `- Rounds: ${p.rounds}` : "",
    p.prizes ? `- Prizes: ${p.prizes}` : "",
    p.eligibility ? `- Eligibility: ${p.eligibility}` : "",
    p.cost ? `- Cost: ${p.cost}` : "",
    ``,
    `## Activity`,
    `- Records: ${c.stats.totalRecords}, participants: ${c.stats.uniqueParticipants}`,
    `- Last submission: ${c.stats.lastSubmission ?? "unknown"}; last 30d: ${c.stats.recordsLast30d}, last 90d: ${c.stats.recordsLast90d}`,
    ``,
  ];
  if (c.quickstart) lines.push(`## Quickstart`, "```", c.quickstart, "```", ``);
  lines.push(`## Problems`);
  for (const pr of c.problems) {
    const best = pr.records.find((r) => r.isCurrentBest);
    lines.push(`### ${pr.name} (${pr.metricDirection} ${pr.metricName}${pr.metricUnit ? `, ${pr.metricUnit}` : ""})`);
    if (pr.description) lines.push(pr.description);
    if (pr.baseline !== undefined) lines.push(`- Baseline: ${pr.baseline}`);
    if (best) lines.push(`- Current best: ${best.value} by ${best.contributor ?? "?"}${best.date ? ` on ${best.date}` : ""}${best.agent ? ` · agent: ${best.agent.model ?? best.agent.family}${best.agent.tool ? ` via ${best.agent.tool}` : ""} (${best.agent.confidence})` : ""}`);
    if (pr.isOpen) lines.push(`- OPEN: no one has beaten the baseline yet`);
    lines.push(`- Records: ${pr.records.length}`, ``);
  }
  if (c.agentStats?.length) {
    lines.push(`## Agents that produced records here`);
    for (const a of c.agentStats) lines.push(`- ${a.family}: ${a.currentBests} bests / ${a.records} records${a.models.length ? ` (${a.models.slice(0, 4).join(", ")})` : ""}`);
    lines.push(``);
  }
  if (c.participants.length) {
    lines.push(`## Participants`);
    for (const u of c.participants.slice(0, 25)) {
      const fams: Record<string, number> = {};
      for (const p of c.problems) for (const r of p.records) if (r.contributor === u.name && r.agent && r.agent.role !== "subject" && r.agent.family !== "unknown") fams[r.agent.family] = (fams[r.agent.family] ?? 0) + 1;
      const f = Object.entries(fams).map(([k, n]) => `${k}×${n}`).join(", ");
      lines.push(`- ${u.name}: ${u.submissions} submission(s)${u.bestRank === 1 ? ", holds a record" : ""}${f ? ` · agents: ${f}` : ""}`);
    }
    lines.push(``);
  }
  if (c.links.length) {
    lines.push(`## Links`);
    for (const l of c.links) lines.push(`- ${l.label}: ${l.url}`);
  }
  return lines.filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}

export function llmsTxt(data: CrawlResult): string {
  return [
        `# Open Challenge List`,
        ``,
        `> Directory of open benchmark competitions with public leaderboards. ${data.competitions.length} competitions, crawled ${data.crawledAt}.`,
        ``,
        `Machine-readable: GET /api/competitions (all) · GET /api/competitions/{id}.json · GET /api/competitions/{id}.md · GET /api/agents · GET /api/people · GET /api/open-problems`,
        ``,
        `Run a competition? Put PROBLEM.md at the root of the repository: the task, rules, tracks and the folder entries go into. Each entry carries a SUBMISSION.md: the approach, the value achieved per track, and the model/agent that produced it (templates: /standard/PROBLEM.md, /standard/SUBMISSION.md, spec: /standard). Such repositories are found by code search, crawled daily, and the leaderboard is built from the files.`,
        ``,
        `## Which agents ship winning submissions (records authored by an AI agent; current bests / total)`,
        ...aggregateAgents(data.competitions, "author").map((a) => `- ${a.family}: ${a.currentBests} bests / ${a.records} records · models: ${Object.keys(a.models).slice(0, 4).join(", ") || "n/a"}`),
        ``,
        `## Which models score best when they are the thing being benchmarked (current bests / total)`,
        ...aggregateAgents(data.competitions, "subject").map((a) => `- ${a.family}: ${a.currentBests} bests / ${a.records} rows · ${Object.keys(a.models).slice(0, 4).join(", ")}`),
        ``,
        `## Top contributors (current bests / records · agents they ship with)`,
        ...aggregatePeople(data.competitions).slice(0, 15).map((p) => `- ${p.name}: ${p.currentBests} bests / ${p.records} records · ${Object.entries(p.agents).map(([f, n]) => `${f}×${n}`).join(", ") || "unattributed"} · ${p.competitions.map((c) => c.name).join(", ")}`),
        ``,
        `## Open problems (nobody has beaten the baseline)`,
        ...openProblems(data.competitions).map((o) => `- ${o.competitionName} / ${o.problemName} [${o.compute}] → /api/competitions/${o.competitionId}.md`),
        ``,
        `## Competitions`,
        ...data.competitions.map((c) =>
          `- [${c.name}](/api/competitions/${c.id}.md): ${c.tagline} [${c.status}, ${c.participation.compute}, ${c.stats.totalRecords} records]`),
  ].join("\n");
}
