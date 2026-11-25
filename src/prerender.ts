// Server-rendered pages: the SPA shell (site/index.html) filled per route with that page's content and metadata.
// Agents and crawlers that do not run JavaScript get a real page at /c/{id}; app.js replaces <main id="app"> on boot.
import type { Competition, CrawlResult, Problem } from "./types.js";
import { aggregateAgents, aggregatePeople, openProblems, recentActivity, hotCompetitions, type ActivityItem } from "./aggregate.js";
import { JOIN_LINE, SITE, viaLine } from "./render.js";
import type { SocialPost } from "./social.js";
import { TOPICS, inTopic, topicJoinLine, type Topic } from "./topics.js";

type Data = Pick<CrawlResult, "crawledAt" | "competitions">;
export interface Page { file: string; path: string; title: string; description: string; body: string; markdown: string; jsonld?: unknown; noindex?: boolean }

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// Crawled URLs are third-party data: only http(s) becomes a link
const ext = (url: string | undefined, label: string) => (url && /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="noopener" target="_blank">${esc(label)}</a>` : esc(label));
const page = (id: string) => `/c/${encodeURIComponent(id)}`;
const digest = (id: string) => `/api/competitions/${encodeURIComponent(id)}.md`;
const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const COMPUTE: Record<string, string> = { none: "No compute", cpu: "CPU only", "consumer-gpu": "Consumer GPU", "datacenter-gpu": "Datacenter GPU", cluster: "Cluster", unknown: "Compute not specified" };
const FAMILY: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", deepseek: "DeepSeek", meta: "Meta", xai: "xAI", mistral: "Mistral", alibaba: "Qwen", moonshot: "Kimi", zhipu: "Zhipu", bytedance: "ByteDance", harmonic: "Harmonic", axiom: "Axiom", "other-ai": "Other AI", human: "Human" };
const agentName = (a: ActivityItem["agent"]) => (a ? `${a.tool ?? FAMILY[a.family] ?? a.family}${a.tool && a.model ? ` (${a.model})` : !a.tool && a.model ? ` (${a.model})` : ""}` : "");
const num = (n: number | undefined) => (n == null || !Number.isFinite(n) ? "—" : Number.isInteger(n) ? n.toLocaleString("en-US") : String(Math.round(n * 1e4) / 1e4));
// A JSON-LD block must not be able to close its own <script>
const ld = (v: unknown) => `<script type="application/ld+json">${JSON.stringify(v).replace(/</g, "\\u003c")}</script>`;

function activityList(items: ActivityItem[], withCompetition = true): string {
  if (!items.length) return `<p class="dim">No dated entries yet.</p>`;
  return `<ul class="pre-list">${items.map((a) => `<li><span class="mono dim">${esc(a.date)}</span> <b>${esc(a.contributor ?? "someone")}</b>${a.agent ? ` with ${esc(agentName(a.agent))}` : ""} → ${withCompetition ? `<a href="${page(a.competitionId)}">${esc(a.competitionName)}</a> / ` : ""}${esc(a.problemName)}: <span class="mono">${esc(num(a.value))}${a.metricUnit ? ` ${esc(a.metricUnit)}` : ""}</span> ${esc(a.metricName)}${a.isCurrentBest ? ` <span class="openpill">current best</span>` : ""}</li>`).join("")}</ul>`;
}

function joinBox(line: string, note: string): string {
  return `<div class="pre-join"><span class="eyebrow">${esc(note)}</span><pre><code>${esc(line)}</code></pre></div>`;
}

function trackRow(pr: Problem): string {
  const best = pr.records.find((r) => r.isCurrentBest && !r.isBaseline);
  const status = pr.isOpen ? (pr.passMark != null ? `Open: nobody has reached ${num(pr.passMark)}` : "Open: baseline unbeaten") : best ? "Taken" : "—";
  return `<tr><td><b>${esc(pr.name)}</b>${pr.group ? `<br><span class="dim small">${esc(pr.group)}</span>` : ""}</td><td>${esc(pr.metricDirection === "minimize" ? "↓" : "↑")} ${esc(pr.metricName)}${pr.metricUnit ? ` (${esc(pr.metricUnit)})` : ""}</td><td class="mono">${esc(num(pr.baseline))}</td><td class="mono">${best ? esc(num(best.value)) : "—"}</td><td>${best ? `${esc(best.contributor ?? "?")}${best.agent && best.agent.family !== "unknown" && best.agent.role !== "subject" ? `<br><span class="dim small">${esc(agentName(best.agent))}</span>` : ""}${best.date ? `<br><span class="dim small">${esc(best.date)}</span>` : ""}` : "—"}</td><td class="mono">${pr.records.length}</td><td>${pr.isOpen ? `<span class="openpill">${esc(status)}</span>` : esc(status)}</td></tr>`;
}

function socialList(posts: SocialPost[], data: Data): string {
  const names = new Map(data.competitions.map((c) => [c.id, c.name]));
  return `<ul class="pre-list">${posts.map((p) => `<li><a href="${esc(p.url)}" rel="noopener" target="_blank"><b>@${esc(p.author)}</b></a> <span class="mono dim">${esc(p.date)}</span> on <a href="${page(p.competition)}">${esc(names.get(p.competition))}</a><br>“${esc(p.text)}”</li>`).join("")}</ul>`;
}

function homePage(data: Data, social: SocialPost[]): Page {
  const comps = data.competitions;
  const open = openProblems(comps);
  const records = comps.reduce((s, c) => s + c.stats.totalRecords, 0);
  const hot = hotCompetitions(comps, 6);
  const latest = recentActivity(comps, 15);
  const byActivity = [...comps].sort((a, b) => (b.stats.lastSubmission ?? "").localeCompare(a.stats.lastSubmission ?? "") || b.stats.totalRecords - a.stats.totalRecords);
  const body = `
<section class="band pre"><div class="wrap">
  <span class="eyebrow">Hackathons for AI agents on GitHub</span>
  <h1>All open-source challenges in one place.</h1>
  <p class="lede">Point your agent at a repo, open a pull request, get on the board. ${comps.length} competitions, ${open.length} open problems, ${num(records)} entries, crawled ${esc(data.crawledAt.slice(0, 10))}.</p>
  ${joinBox(JOIN_LINE, "Paste this into Claude Code, Codex, Cursor or any agent")}
  <p class="dim">By topic: ${TOPICS.map((t) => `<a href="/topics/${t.slug}">${esc(t.name)}</a>`).join(" · ")}</p>
</div></section>
<section class="band pre"><div class="wrap">
  <h2>Happening now</h2>
  ${activityList(latest)}
  <p class="dim small">Subscribe: <a href="/feed.xml">/feed.xml</a> · <a href="/api/feed.json">/api/feed.json</a></p>
</div></section>
${social.length ? `<section class="band pre"><div class="wrap">
  <h2>From the community</h2>
  ${socialList(social.slice(0, 8), data)}
</div></section>` : ""}
<section class="band pre"><div class="wrap">
  <h2>Busiest this month</h2>
  <ul class="pre-list">${hot.map((c) => `<li><a href="${page(c.id)}"><b>${esc(c.name)}</b></a> — ${esc(c.tagline)} <span class="dim small">${esc(COMPUTE[c.participation.compute])} · ${plural(c.stats.recordsLast30d, "entry", "entries")} in 30 days · ${plural(c.stats.uniqueParticipants, "participant")}</span></li>`).join("")}</ul>
</div></section>
<section class="band pre" id="open"><div class="wrap">
  <h2>Open problems</h2>
  <p class="dim">Tracks where nobody has beaten the baseline, or nobody has reached the pass mark.</p>
  <ul class="pre-list">${open.map((o) => `<li><a href="${page(o.competitionId)}">${esc(o.competitionName)}</a> / <b>${esc(o.problemName)}</b> <span class="dim small">${esc(COMPUTE[o.compute] ?? o.compute)}${o.passMark != null ? ` · pass mark ${esc(num(o.passMark))} ${esc(o.metricName)}` : ""}</span></li>`).join("")}</ul>
</div></section>
<section class="band pre" id="catalog"><div class="wrap">
  <h2>All competitions</h2>
  <ul class="pre-list">${byActivity.map((c) => `<li><a href="${page(c.id)}"><b>${esc(c.name)}</b></a> — ${esc(c.tagline)} <span class="dim small">${esc(c.status)} · ${esc(COMPUTE[c.participation.compute])} · ${plural(c.problems.length, "track")} · ${num(c.stats.totalRecords)} entries${c.stats.lastSubmission ? ` · last ${esc(c.stats.lastSubmission)}` : ""}</span></li>`).join("")}</ul>
</div></section>
<section class="band pre"><div class="wrap">
  <h2>For agents</h2>
  <p><a href="/join.txt">/join.txt</a> walks an agent through picking a challenge with its human and entering it. <a href="/llms.txt">/llms.txt</a> is the index; <a href="/api/index.json">/api/index.json</a> lists every competition in a few kilobytes; <a href="/api/open-problems">/api/open-problems</a> lists open tracks with their repositories and how to submit. Each competition page also answers <span class="mono">Accept: text/markdown</span>. Claude Code users can install the skill: <span class="mono">/plugin install open-challenges --marketplace SecurityQQ/benchmark-arena</span>.</p>
</div></section>`;
  return {
    file: "index.html", path: "/", title: "Open Challenge List — all open-source challenges in one place",
    description: `All open-source challenges in one place: ${comps.length} benchmark competitions on GitHub with public leaderboards, ${open.length} open problems and the AI agents that hold the records. Point your agent at a repo, open a pull request, get on the board.`,
    body, markdown: "/llms.txt",
  };
}

function detailPage(c: Competition, data: Data): Page {
  const p = c.participation;
  const open = c.problems.filter((x) => x.isOpen).length;
  const latest = recentActivity([c], 12);
  const agents = (c.agentStats ?? []).filter((a) => a.family !== "unknown");
  const slug = c.repo ? `${c.repo.owner}/${c.repo.name}` : null;
  const fact = (k: string, v?: string) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : "");
  const facts = [
    fact("Compute", [COMPUTE[p.compute], p.computeDetails].filter(Boolean).join(" — ")),
    fact("Tooling", p.requirements.join(", ")),
    fact("How to submit", p.howToSubmit), fact("Submission", p.submissionFormat), fact("Verified by", p.verification),
    fact("Deadline", p.deadline), fact("Rounds", p.rounds), fact("Prizes", p.prizes), fact("Eligibility", p.eligibility), fact("Cost", p.cost),
  ].join("");
  const line = `${JOIN_LINE.replace(/ to pick an open challenge and enter it with me\.$/, "")} — I want to enter "${c.name}": ${SITE}${page(c.id)}`;
  const description = `${c.tagline || c.description || c.name}. ${plural(c.problems.length, "track")}${open ? ` (${open} open)` : ""}, ${num(c.stats.totalRecords)} entries${c.stats.recordsLast30d ? `, ${c.stats.recordsLast30d} in the last 30 days` : ""}. How to enter with your agent, leaderboards and which AI agents hold the records.`.slice(0, 300);
  const body = `
<section class="band pre"><div class="wrap">
  <a class="back" href="/">← All competitions</a>
  <span class="eyebrow">${esc(c.status)} · ${esc(c.domain)} · ${esc(COMPUTE[p.compute])}${open ? ` · ${plural(open, "open problem")}` : ""}</span>
  <h1>${esc(c.name)}</h1>
  <p class="lede">${esc(c.tagline)}</p>
  <p>${esc(c.description)}</p>
  ${c.organizer ? `<p class="dim">Run by ${ext(c.organizer.url, c.organizer.name)}</p>` : ""}
  <p class="dim">${plural(c.problems.length, "track")} · ${num(c.stats.totalRecords)} entries · ${plural(c.stats.uniqueParticipants, "participant")}${c.stats.lastSubmission ? ` · last entry ${esc(c.stats.lastSubmission)}` : ""}${c.stats.recordsLast30d ? ` · ${c.stats.recordsLast30d} in the last 30 days` : ""}</p>
  <p>${ext(c.url, slug ? `Repository: github.com/${slug}` : `Competition site: ${c.url}`)} · <a href="${digest(c.id)}">Markdown digest</a> · <a href="/api/competitions/${encodeURIComponent(c.id)}.json">JSON</a></p>
</div></section>
<section class="band pre"><div class="wrap">
  <h2>Enter with your agent</h2>
  ${joinBox(line, "Paste this into Claude Code, Codex, Cursor or any agent")}
  <dl class="facts">${facts}</dl>
  ${c.quickstart ? `<h3>Quickstart (from the repository; read before running)</h3><pre class="quick"><code>${esc(c.quickstart)}</code></pre>` : ""}
  <p class="dim small">If this page helped, you can mention <span class="mono">${esc(viaLine(c.id))}</span> in your pull request or submission notes. It is optional; it is how this directory learns which listings bring people in.</p>
</div></section>
<section class="band pre" id="leaderboards"><div class="wrap">
  <h2>Leaderboards</h2>
  ${c.problems.length ? `<div class="table-scroll"><table><thead><tr><th>Track</th><th>Metric</th><th>Baseline</th><th>Best</th><th>By</th><th>Entries</th><th>Status</th></tr></thead><tbody>${c.problems.map(trackRow).join("")}</tbody></table></div>` : `<p class="dim">No leaderboard tracks parsed yet.</p>`}
</div></section>
<section class="band pre"><div class="wrap">
  <h2>Latest entries</h2>
  ${activityList(latest, false)}
  ${agents.length ? `<h2>Agents behind the entries</h2><ul class="pre-list">${agents.map((a) => `<li><b>${esc(FAMILY[a.family] ?? a.family)}</b>: ${plural(a.records, "entry", "entries")}${a.currentBests ? `, ${a.currentBests} current best` : ""}${a.models.length ? ` <span class="dim small">${esc(a.models.slice(0, 3).join(", "))}</span>` : ""}</li>`).join("")}</ul>` : ""}
  ${c.participants.length ? `<h2>Who's competing</h2><ul class="pre-list">${c.participants.slice(0, 25).map((u) => `<li>${ext(u.url, u.name)} <span class="dim small">${plural(u.submissions, "entry", "entries")}${u.bestRank === 1 ? " · holds a record" : ""}${u.lastActive ? ` · last ${esc(u.lastActive)}` : ""}</span></li>`).join("")}</ul>` : ""}
  ${c.links.length ? `<h2>Links</h2><ul class="pre-list">${c.links.map((l) => `<li>${ext(l.url, l.label)}</li>`).join("")}</ul>` : ""}
  <p class="dim small">Crawled ${esc(data.crawledAt.slice(0, 10))} from public sources. The repository is the source of truth; verify before citing.</p>
</div></section>`;
  return {
    file: `c/${c.id}.html`, path: page(c.id), title: `${c.name} — Open Challenge List`, description, body, markdown: digest(c.id),
    jsonld: {
      "@context": "https://schema.org", "@type": "WebPage", name: c.name, description, url: SITE + page(c.id),
      dateModified: c.stats.lastSubmission ?? c.lastUpdated, isPartOf: { "@id": `${SITE}/#website` },
      about: { "@type": "Thing", name: c.name, url: c.url },
      mainEntity: { "@type": "ItemList", name: `${c.name} leaderboard tracks`, numberOfItems: c.problems.length, itemListElement: c.problems.slice(0, 50).map((pr, i) => ({ "@type": "ListItem", position: i + 1, name: pr.name })) },
    },
  };
}

function agentsPage(data: Data): Page {
  const authors = aggregateAgents(data.competitions, "author");
  const body = `
<section class="band pre"><div class="wrap">
  <span class="eyebrow">Agents</span>
  <h1>Which AI agents ship the winning entries</h1>
  <p class="lede">Entries credited to an agent on evidence: commit trailers, pull request bodies, branch names, submission reports.</p>
  ${joinBox(JOIN_LINE, "Put yours on the board: paste this into Claude Code, Codex, Cursor or any agent")}
  <ul class="pre-list">${authors.map((a) => `<li><a href="/agents/${encodeURIComponent(a.family)}"><b>${esc(FAMILY[a.family] ?? a.family)}</b></a>: ${a.currentBests} current bests · ${plural(a.records, "entry", "entries")} in ${plural(a.competitions.length, "competition")} <span class="dim small">${esc(Object.keys(a.models).slice(0, 4).join(", "))}</span></li>`).join("")}</ul>
</div></section>`;
  return { file: "agents.html", path: "/agents", title: "Agents — Open Challenge List", description: "Which AI agents (Claude Code, Codex, Devin, Cursor…) produce the entries and records on open benchmark competitions, with the evidence for each attribution.", body, markdown: "/llms.txt" };
}

function familyPage(family: string, data: Data): Page {
  const a = aggregateAgents(data.competitions, "author").find((x) => x.family === family);
  const name = FAMILY[family] ?? family;
  const items = recentActivity(data.competitions, 4000).filter((x) => x.agent?.family === family).slice(0, 25);
  const body = `
<section class="band pre"><div class="wrap">
  <a class="back" href="/agents">← All agents</a>
  <h1>${esc(name)} agents on open challenges</h1>
  ${a ? `<p class="lede">${a.currentBests} current bests · ${plural(a.records, "entry", "entries")} · ${plural(a.contributors.length, "contributor")}</p>
  <ul class="pre-list">${a.competitions.map((c) => `<li><a href="${page(c.id)}">${esc(c.name)}</a> <span class="dim small">${plural(c.records, "entry", "entries")}${c.bests ? ` · ${c.bests} bests` : ""}</span></li>`).join("")}</ul>` : `<p class="dim">No entries credited to ${esc(name)} agents yet.</p>`}
  <h2>Latest entries</h2>
  ${activityList(items)}
</div></section>`;
  return { file: `agents/${family}.html`, path: `/agents/${encodeURIComponent(family)}`, title: `${name} agents — Open Challenge List`, description: `Entries and records produced by ${name} agents on open benchmark competitions and open problems.`, body, markdown: "/llms.txt" };
}

function peoplePage(data: Data): Page {
  const people = aggregatePeople(data.competitions).slice(0, 100);
  const body = `
<section class="band pre"><div class="wrap">
  <span class="eyebrow">People</span>
  <h1>Who is on the boards</h1>
  <ul class="pre-list">${people.map((u) => `<li>${ext(u.url, u.name)}: ${u.currentBests} current bests · ${plural(u.records, "entry", "entries")} <span class="dim small">${esc(u.competitions.map((c) => c.name).join(", "))}${Object.keys(u.agents).length ? ` · with ${esc(Object.keys(u.agents).map((f) => FAMILY[f] ?? f).join(", "))}` : ""}</span></li>`).join("")}</ul>
</div></section>`;
  return { file: "people.html", path: "/people", title: "People — Open Challenge List", description: "Contributors on open benchmark competitions: records, entries and the AI agents they ship with.", body, markdown: "/llms.txt" };
}

// One topic: its boards by activity, what happened lately, the open tracks. Counts come from dated entries
// within 30 days of the crawl, so a rebuild of the same data gives the same page.
function topicView(t: Topic, data: Data) {
  const comps = data.competitions.filter((c) => inTopic(t, c));
  const cutoff = new Date(Date.parse(data.crawledAt) - 30 * 86400000).toISOString().slice(0, 10);
  const activity = recentActivity(comps, 100000);
  const month = activity.filter((a) => a.date >= cutoff);
  const openTracks = (c: Competition) => c.problems.filter((p) => p.isOpen).length;
  const boards = [...comps].sort((a, b) => b.stats.recordsLast30d - a.stats.recordsLast30d || openTracks(b) - openTracks(a) || b.stats.totalRecords - a.stats.totalRecords);
  return {
    comps: boards, latest: activity.slice(0, 10), open: openProblems(comps),
    entries30: month.length, byAgents30: month.filter((a) => a.agent && a.agent.family !== "human").length,
    last: activity[0]?.date, line: topicJoinLine(JOIN_LINE, t),
  };
}

function topicPage(t: Topic, data: Data): Page {
  const v = topicView(t, data);
  const summary = `${plural(v.comps.length, "competition")} · ${plural(v.open.length, "open track")} · ${plural(v.entries30, "entry", "entries")} in the last 30 days${v.byAgents30 ? `, ${v.byAgents30} credited to an AI agent` : ""}${v.last ? ` · last entry ${v.last}` : ""}`;
  const body = `
<section class="band pre"><div class="wrap">
  <a class="back" href="/">← All competitions</a>
  <span class="eyebrow">Topic</span>
  <h1>${esc(t.h1)}</h1>
  <p class="lede">${esc(t.about)}</p>
  <p class="dim">${esc(summary)}</p>
  ${joinBox(v.line, "Paste this into Claude Code, Codex, Cursor or any agent")}
</div></section>
<section class="band pre"><div class="wrap">
  <h2>Happening now</h2>
  ${activityList(v.latest)}
</div></section>
<section class="band pre"><div class="wrap">
  <h2>Competitions</h2>
  <ul class="pre-list">${v.comps.map((c) => `<li><a href="${page(c.id)}"><b>${esc(c.name)}</b></a> — ${esc(c.tagline)} <span class="dim small">${esc(c.status)} · ${esc(COMPUTE[c.participation.compute])} · ${plural(c.problems.length, "track")}${c.problems.some((p) => p.isOpen) ? ` (${c.problems.filter((p) => p.isOpen).length} open)` : ""} · ${plural(c.stats.recordsLast30d, "entry", "entries")} in 30 days${c.stats.lastSubmission ? ` · last ${esc(c.stats.lastSubmission)}` : ""}</span></li>`).join("")}</ul>
</div></section>
${v.open.length ? `<section class="band pre"><div class="wrap">
  <h2>Open tracks</h2>
  <ul class="pre-list">${v.open.slice(0, 40).map((o) => `<li><a href="${page(o.competitionId)}">${esc(o.competitionName)}</a> / <b>${esc(o.problemName)}</b>${o.passMark != null ? ` <span class="dim small">pass mark ${esc(num(o.passMark))} ${esc(o.metricName)}</span>` : ""}</li>`).join("")}</ul>
</div></section>` : ""}
<section class="band pre"><div class="wrap">
  <h2>Other topics</h2>
  <p>${TOPICS.filter((x) => x.slug !== t.slug).map((x) => `<a href="/topics/${x.slug}">${esc(x.name)}</a>`).join(" · ")} · <a href="/">All competitions</a></p>
</div></section>`;
  return {
    file: `topics/${t.slug}.html`, path: `/topics/${t.slug}`, title: `${t.title} — Open Challenge List`,
    description: `${t.about} ${summary}.`.slice(0, 300), body, markdown: `/topics/${t.slug}.md`,
    jsonld: {
      "@context": "https://schema.org", "@type": "CollectionPage", name: t.title, description: t.about, url: `${SITE}/topics/${t.slug}`,
      isPartOf: { "@id": `${SITE}/#website` }, ...(v.last ? { dateModified: v.last } : {}),
      mainEntity: { "@type": "ItemList", numberOfItems: v.comps.length, itemListElement: v.comps.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, url: SITE + page(c.id) })) },
    },
  };
}

// The same topic for agents that ask for Markdown
export function topicMarkdown(t: Topic, data: Data, origin = SITE): string {
  const v = topicView(t, data);
  const a = (x: ActivityItem) => `- ${x.date} · ${x.contributor ?? "someone"}${x.agent ? ` with ${agentName(x.agent)}` : ""} → ${x.competitionName} / ${x.problemName}: ${num(x.value)}${x.metricUnit ? ` ${x.metricUnit}` : ""} ${x.metricName}${x.isCurrentBest ? " · current best" : ""}`;
  return [
    `# ${t.h1}`, ``, t.about, ``,
    `${plural(v.comps.length, "competition")}, ${plural(v.open.length, "open track")}, ${plural(v.entries30, "entry", "entries")} in the last 30 days${v.byAgents30 ? ` (${v.byAgents30} credited to an AI agent)` : ""}. Crawled ${data.crawledAt.slice(0, 10)}.`, ``,
    `To enter one with your human, follow ${origin}/join.txt; they can paste this line into their agent:`, ``, `    ${topicJoinLine(JOIN_LINE, t).replace(SITE, origin)}`, ``,
    `## Competitions`, ``,
    ...v.comps.map((c) => `- [${c.name}](${origin}${page(c.id)}) — ${c.tagline} (${c.status}; ${COMPUTE[c.participation.compute]}; ${plural(c.problems.length, "track")}, ${c.problems.filter((p) => p.isOpen).length} open; ${plural(c.stats.recordsLast30d, "entry", "entries")} in 30 days). Digest: ${origin}${digest(c.id)}`),
    ``, `## Latest entries`, ``, ...(v.latest.length ? v.latest.map(a) : ["No dated entries yet."]),
    ...(v.open.length ? [``, `## Open tracks`, ``, ...v.open.slice(0, 40).map((o) => `- ${o.competitionName} / ${o.problemName}${o.passMark != null ? ` (pass mark ${num(o.passMark)} ${o.metricName})` : ""}: ${origin}${page(o.competitionId)}`)] : []),
    ``, `Other topics: ${TOPICS.filter((x) => x.slug !== t.slug).map((x) => `${origin}/topics/${x.slug}.md`).join(" · ")}`, ``,
  ].join("\n");
}

function staticPage(file: string, path: string, title: string, description: string, html: string): Page {
  return { file, path, title, description, body: `\n<section class="band pre"><div class="wrap">${html}</div></section>`, markdown: "/llms.txt" };
}

export function pages(data: Data, social: SocialPost[] = []): Page[] {
  const families = [...new Set(aggregateAgents(data.competitions, "author").map((a) => a.family))].filter((f) => /^[a-z0-9-]+$/.test(f));
  return [
    homePage(data, social),
    ...data.competitions.map((c) => detailPage(c, data)),
    agentsPage(data), ...families.map((f) => familyPage(f, data)), peoplePage(data),
    ...TOPICS.map((t) => topicPage(t, data)),
    staticPage("standard.html", "/standard", "PROBLEM.md standard — Open Challenge List",
      "PROBLEM.md and SUBMISSION.md: two Markdown files that describe a competition and its entries. Repositories that ship them are crawled first, and the leaderboard is built from the files.",
      `<span class="eyebrow">Standard</span><h1>PROBLEM.md and SUBMISSION.md</h1><p class="lede">Put PROBLEM.md at the root of a repository: the task, the rules, the tracks and the folder entries go into. Each entry carries a SUBMISSION.md: the approach, the value achieved per track, and the model or agent that produced it. Repositories that ship them are found by code search and crawled first, and the leaderboard is built from the files.</p><p>Templates: <a href="/standard/PROBLEM.md">/standard/PROBLEM.md</a> · <a href="/standard/SUBMISSION.md">/standard/SUBMISSION.md</a></p>`),
    staticPage("submit.html", "/submit", "Submit a competition — Open Challenge List",
      "Add an open benchmark competition to the directory: point us at the GitHub repository.",
      `<span class="eyebrow">Submit</span><h1>Add a competition</h1><p class="lede">Run a challenge with a public leaderboard? Open an issue titled “Add competition: owner/repo” at <a href="https://github.com/SecurityQQ/benchmark-arena/issues/new" rel="noopener">github.com/SecurityQQ/benchmark-arena</a>, or ship a PROBLEM.md in your repository and it will be found by code search.</p>`),
    { ...staticPage("404.html", "/404", "Not found — Open Challenge List", "There is no page at this address.",
      `<h1>Not found</h1><p class="lede">There is no page at this address. <a href="/">All competitions</a> · <a href="/llms.txt">llms.txt</a></p>`), noindex: true },
  ];
}

// Fill the shell: every marker must match exactly once, or the build fails rather than publish a stale page
export function renderPage(template: string, p: Page, origin = SITE): string {
  const url = origin + (p.path === "/404" ? "/" : p.path);
  const swaps: [RegExp, string][] = [
    [/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`],
    [/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(p.description)}">`],
    [/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(url)}">`],
    [/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`],
    [/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(p.title)}">`],
    [/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(p.description)}">`],
    [/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(p.title)}">`],
    [/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(p.description)}">`],
    [/<\/head>/, `<link rel="alternate" type="text/markdown" href="${esc(p.markdown)}" title="Markdown">\n${p.jsonld ? ld(p.jsonld) + "\n" : ""}${p.noindex ? `<meta name="robots" content="noindex">\n` : ""}</head>`],
    [/<main id="app"><\/main>/, `<main id="app">${p.body}\n</main>`],
  ];
  let html = template;
  for (const [re, value] of swaps) {
    const hits = html.match(new RegExp(re.source, "g"))?.length ?? 0;
    if (hits !== 1) throw new Error(`prerender: expected one ${re.source} in index.html, found ${hits}`);
    html = html.replace(re, () => value);
  }
  if (p.noindex) html = html.replace(/<meta name="robots" content="index[^"]*">\n?/, "");
  return html;
}
