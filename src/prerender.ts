// Server-rendered pages: the SPA shell (site/index.html) filled per route with that page's content and metadata.
// Agents and crawlers that do not run JavaScript get a real page at /c/{id}; app.js replaces <main id="app"> on boot.
import type { Competition, CrawlResult, Problem } from "./types.js";
import { aggregateAgents, aggregatePeople, openProblems, recentActivity, hotCompetitions, type ActivityItem } from "./aggregate.js";
import { AGENT_DOCS_LEAD, JOIN_LINE, LISTING_ISSUE_URL, LISTING_TOPIC, SITE, challengeJoinLine, viaLine } from "./render.js";
import type { SocialPost } from "./social.js";
import { TOPICS, inTopic, topicJoinLine, type Topic } from "./topics.js";
import { REGISTRY, SUBMIT_PROTOCOL, authorLine, discoveryHeadline, discoveryView, type Discoveries } from "./discoveries.js";
import { OG_HEIGHT, OG_WIDTH, cardAlt, plain, type Card } from "./og.js";
import { BADGE_NOTE, BADGE_PATTERN, badgeMarkdown } from "./badge.js";

type Data = Pick<CrawlResult, "crawledAt" | "competitions">;
// card: the page's social preview (src/og.ts); a page without one keeps the shell's /og.jpg
export interface Page { file: string; path: string; title: string; description: string; body: string; markdown: string; jsonld?: unknown; noindex?: boolean; card?: Card }

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// Crawled URLs are third-party data: only http(s) becomes a link
const ext = (url: string | undefined, label: string) => (url && /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="noopener" target="_blank">${esc(label)}</a>` : esc(label));
const page = (id: string) => `/c/${encodeURIComponent(id)}`;
const digest = (id: string) => `/api/competitions/${encodeURIComponent(id)}.md`;
const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
export const COMPUTE: Record<string, string> = { none: "No compute", cpu: "CPU only", "consumer-gpu": "Consumer GPU", "datacenter-gpu": "Datacenter GPU", cluster: "Cluster", unknown: "Compute not specified" };
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

// For the organizer, at the foot of a board: the README badge (drawn by src/badge.ts at build time) and its Markdown.
// The same block as app.js badgeBlock, without the copy button (it comes with app.js).
function badgeBox(id: string): string {
  return `<div class="readme-badge"><span class="eyebrow">For the organizer</span><p class="hint"><img src="/badge/c/${encodeURIComponent(id)}.svg" alt="Open Challenge List badge" height="20" loading="lazy"> ${esc(BADGE_NOTE)}</p><pre class="quick badge-md"><code>${esc(badgeMarkdown(id))}</code></pre></div>`;
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

// "Fresh discoveries": Lean-verified results registered on Palomar in the last week, as of the registry read (so a rebuild of
// the same data gives the same page; the SPA counts from the visitor's clock). Links: the registry's permalinks, its home, our pages.
function discoveriesBand(d: Discoveries | null, limit: number, withTarget: boolean): string {
  const v = d && discoveryView(d, Date.parse(d.fetchedAt));
  if (!v || !v.items.length) return "";
  return `<section class="band pre" id="discoveries"><div class="wrap">
  <h2>Fresh discoveries</h2>
  <p>${esc(discoveryHeadline(v))} <span class="dim small">From <a href="${REGISTRY}/" rel="noopener" target="_blank">Palomar</a>, the public registry of Lean-checked mathematics.</span></p>
  <ul class="pre-list">${v.items.slice(0, limit).map((i) => `<li><span class="mono dim">${esc(i.date)}</span> · <a href="${esc(i.url)}" rel="noopener" target="_blank">${esc(i.title)}</a>${i.authors.length ? ` — ${esc(authorLine(i.authors))}` : ""}</li>`).join("")}</ul>
  <p class="dim small">Proved something with your agent? <a href="${REGISTRY}/" rel="noopener" target="_blank">Register it on Palomar</a>${withTarget ? ` · Looking for a target? <a href="/topics/math">Open math challenges →</a>` : ""}</p>
</div></section>`;
}

function homePage(data: Data, social: SocialPost[], discoveries: Discoveries | null, boards: ReturnType<typeof boardsView>): Page {
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
${discoveriesBand(discoveries, 5, true)}
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
  <p><a href="/join.txt">/join.txt</a> walks an agent through picking a challenge with its human and entering it. <a href="/llms.txt">/llms.txt</a> is the index; <a href="/api/index.json">/api/index.json</a> lists every competition in a few kilobytes; <a href="/api/open-problems">/api/open-problems</a> lists open tracks with their repositories and how to submit. Each competition page also answers <span class="mono">Accept: text/markdown</span>. Claude Code users can install the skill: <span class="mono">/plugin install open-challenges --marketplace SecurityQQ/open-challenge-list</span>.</p>
  <p>MCP clients can query the list directly: <span class="mono">${SITE}/mcp</span> is a read-only MCP server (Streamable HTTP). Claude Code: <span class="mono">claude mcp add --transport http open-challenges ${SITE}/mcp</span>.</p>
</div></section>`;
  return {
    file: "index.html", path: "/", title: "Open Challenge List — all open-source challenges in one place",
    description: `All open-source challenges in one place: ${comps.length} benchmark competitions on GitHub with public leaderboards, ${open.length} open problems and the AI agents that hold the records. Point your agent at a repo, open a pull request, get on the board.`,
    body, markdown: "/llms.txt", card: homeCard(data, boards, discoveries),
  };
}

// month: this board's last 30 days as boardsView counts them, so the page, its card, its topic and the README agree
function detailPage(c: Competition, data: Data, month: BoardMonth): Page {
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
  const line = challengeJoinLine(c.name, c.id);
  const description = `${sentence(c.tagline || c.description || c.name)} ${plural(c.problems.length, "track")}${open ? ` (${open} open)` : ""}, ${num(c.stats.totalRecords)} entries${month.entries ? `, ${month.entries} in the last 30 days` : ""}. How to enter with your agent, leaderboards and which AI agents hold the records.`.slice(0, 300);
  const body = `
<section class="band pre"><div class="wrap">
  <a class="back" href="/">← All competitions</a>
  <span class="eyebrow">${esc(c.status)} · ${esc(c.domain)} · ${esc(COMPUTE[p.compute])}${open ? ` · ${plural(open, "open problem")}` : ""}</span>
  <h1>${esc(c.name)}</h1>
  <p class="lede">${esc(c.tagline)}</p>
  <p>${esc(c.description)}</p>
  ${c.organizer ? `<p class="dim">Run by ${ext(c.organizer.url, c.organizer.name)}</p>` : ""}
  <p class="dim">${plural(c.problems.length, "track")} · ${num(c.stats.totalRecords)} entries · ${plural(c.stats.uniqueParticipants, "participant")}${c.stats.lastSubmission ? ` · last entry ${esc(c.stats.lastSubmission)}` : ""}${month.entries ? ` · ${esc(monthLine(month))}` : ""}</p>
  <p>${ext(c.url, slug ? `Repository: github.com/${slug}` : `Competition site: ${c.url}`)} · <a href="${digest(c.id)}">Markdown digest</a> · <a href="/api/competitions/${encodeURIComponent(c.id)}.json">JSON</a></p>
</div></section>
<section class="band pre"><div class="wrap">
  <h2>Enter with your agent</h2>
  ${joinBox(line, "Paste this into Claude Code, Codex, Cursor or any agent")}
  ${c.agentDocs?.length ? `<p class="agent-docs">${esc(AGENT_DOCS_LEAD)} ${c.agentDocs.map((d) => ext(d.url, d.label)).join(" · ")}</p>` : ""}
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
  ${badgeBox(c.id)}
  <p class="dim small">Crawled ${esc(data.crawledAt.slice(0, 10))} from public sources. The repository is the source of truth; verify before citing.</p>
</div></section>`;
  return {
    file: `c/${c.id}.html`, path: page(c.id), title: `${c.name} — Open Challenge List`, description, body, markdown: digest(c.id),
    card: competitionCard(c, month, data.crawledAt),
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
// Per board, who got on it in the 30 days before the crawl: the evidence that an agent can enter it tonight
export interface BoardMonth { entries: number; people: number; withAgents: number; tools: string[] }
const monthLine = (m: BoardMonth) => (m.entries ? `${plural(m.entries, "entry", "entries")} from ${plural(m.people, "person", "people")} in 30 days${m.withAgents ? `, ${m.withAgents} with AI agents (${m.tools.join(", ")})` : ""}` : "no dated entries in 30 days");

// Boards ranked by who is entering them this month, with the evidence per board (topic pages, competition pages and their
// cards, the README's "Open right now")
export function boardsView(comps: Competition[], crawledAt: string) {
  const cutoff = new Date(Date.parse(crawledAt) - 30 * 86400000).toISOString().slice(0, 10);
  const activity = recentActivity(comps, 100000);
  const month = activity.filter((a) => a.date >= cutoff);
  const openTracks = (c: Competition) => c.problems.filter((p) => p.isOpen).length;
  const boards = [...comps].sort((a, b) => b.stats.recordsLast30d - a.stats.recordsLast30d || openTracks(b) - openTracks(a) || b.stats.totalRecords - a.stats.totalRecords);
  const months = new Map(boards.map((c): [string, BoardMonth] => {
    const mine = month.filter((a) => a.competitionId === c.id), withAgents = mine.filter((a) => a.agent && a.agent.family !== "human");
    return [c.id, {
      entries: mine.length, people: new Set(mine.map((a) => (a.contributor ?? "").toLowerCase())).size, withAgents: withAgents.length,
      tools: [...new Set(withAgents.map((a) => a.agent!.tool ?? FAMILY[a.agent!.family] ?? a.agent!.family))].slice(0, 3),
    }];
  }));
  return {
    comps: boards, months, recent: new Map([...months].map(([id, m]) => [id, monthLine(m)])), latest: activity.slice(0, 10), open: openProblems(comps),
    entries30: month.length, byAgents30: month.filter((a) => a.agent && a.agent.family !== "human").length,
    last: activity[0]?.date,
  };
}

function topicView(t: Topic, data: Data) {
  return { ...boardsView(data.competitions.filter((c) => inTopic(t, c)), data.crawledAt), line: topicJoinLine(JOIN_LINE, t) };
}

// ─── Social preview cards: the numbers the page shows, for a link shared on X (src/og.ts draws them) ───
const stat = (value: number, one: string, many: string) => ({ value, label: value === 1 ? one : many });
const SHARE = "point your agent at it";
function card(file: string, c: Omit<Card, "file" | "alt">): Card {
  const kept = { ...c, stats: c.stats.filter((s) => s.value > 0), notes: c.notes.filter(Boolean) };
  return { file, ...kept, alt: cardAlt(kept) };
}
const sentence = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

function homeCard(data: Data, v: ReturnType<typeof boardsView>, discoveries: Discoveries | null): Card {
  const fresh = discoveries && discoveryView(discoveries, Date.parse(discoveries.fetchedAt));
  return card("og/home.png", {
    eyebrow: "Open Challenge List", title: "Every open challenge your AI agent can enter",
    subtitle: "Point your agent at a repo, open a pull request, get on the board.",
    stats: [stat(data.competitions.length, "competition", "competitions"), stat(v.open.length, "open track", "open tracks"),
      stat(v.entries30, "entry in 30 days", "entries in 30 days"), stat(v.byAgents30, "by an AI agent", "by AI agents")],
    notes: [fresh?.week ? `Fresh discoveries: ${fresh.week.toLocaleString("en-US")}${fresh.plus ? "+" : ""} Lean-verified ${fresh.week === 1 && !fresh.plus ? "result" : "results"} this week` : ""],
    action: SHARE,
  });
}

function topicCard(t: Topic, v: ReturnType<typeof topicView>): Card {
  const busiest = v.comps.filter((c) => c.status !== "ended" && v.months.get(c.id)!.entries > 0).slice(0, 3).map((c) => plain(c.name, 40));
  return card(`og/topics/${t.slug}.png`, {
    eyebrow: "Open Challenge List · Topic", title: t.h1, subtitle: t.about,
    stats: [stat(v.comps.length, "competition", "competitions"), stat(v.open.length, "open track", "open tracks"),
      stat(v.entries30, "entry in 30 days", "entries in 30 days"), stat(v.byAgents30, "by an AI agent", "by AI agents")],
    notes: [busiest.length ? `Busiest: ${busiest.join(", ")}` : ""],
    action: SHARE,
  });
}

// An ended competition says so plainly: what it had, nothing to join
function competitionCard(c: Competition, m: BoardMonth, crawledAt: string): Card {
  const p = c.participation, ended = c.status === "ended", open = c.problems.filter((x) => x.isOpen).length;
  // baseline rows (the organizers' reference runs) are not entries: a board nobody has entered says so
  const entries = c.problems.reduce((n, pr) => n + pr.records.filter((r) => !r.isBaseline).length, 0);
  const topic = TOPICS.find((t) => !t.computes && inTopic(t, c));
  const last = c.stats.lastSubmission && /^\d{4}-\d{2}-\d{2}/.test(c.stats.lastSubmission) ? `Last entry ${c.stats.lastSubmission.slice(0, 10)}` : "";
  const deadline = /^\d{4}-\d{2}-\d{2}/.exec(p.deadline ?? "")?.[0];
  const until = deadline && Number.isFinite(Date.parse(deadline)) && deadline >= crawledAt.slice(0, 10)
    ? `Deadline ${new Date(`${deadline}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : "";
  return card(`og/c/${c.id}.png`, {
    eyebrow: `${ended ? "Ended" : c.status === "upcoming" ? "Upcoming challenge" : "Open challenge"}${topic ? ` · ${topic.name}` : ""}`,
    title: plain(c.name, 100) || c.id, subtitle: plain(c.tagline, 200),
    stats: ended ? [stat(entries, "entry", "entries"), stat(c.stats.uniqueParticipants, "participant", "participants"), stat(c.problems.length, "track", "tracks")]
      : m.entries ? [stat(m.entries, "entry in 30 days", "entries in 30 days"), stat(m.people, "person", "people"), stat(m.withAgents, "with an AI agent", "with AI agents"), stat(open, "open track", "open tracks")]
      : [stat(open, "open track", "open tracks"), stat(entries, "entry so far", "entries so far"), stat(c.problems.length > open ? c.problems.length : 0, "track", "tracks")],
    notes: ended ? ["Closed to new entries", last]
      : [p.compute === "none" || p.compute === "cpu" ? "No GPU needed" : p.compute === "unknown" ? "" : COMPUTE[p.compute] ?? "", until,
        m.withAgents ? `Agents: ${m.tools.map((x) => plain(x, 30)).join(", ")}` : "", m.entries ? "" : (entries ? last : "No entries yet")],
    action: ended ? "results and leaderboards" : SHARE,
  });
}

function topicPage(t: Topic, data: Data, discoveries: Discoveries | null): Page {
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
${t.discoveries ? discoveriesBand(discoveries, 3, false) : ""}
<section class="band pre"><div class="wrap">
  <h2>Competitions</h2>
  <ul class="pre-list">${v.comps.map((c) => `<li><a href="${page(c.id)}"><b>${esc(c.name)}</b></a> — ${esc(c.tagline)} <span class="dim small">${esc(c.status)} · ${esc(COMPUTE[c.participation.compute])} · ${plural(c.problems.length, "track")}${c.problems.some((p) => p.isOpen) ? ` (${c.problems.filter((p) => p.isOpen).length} open)` : ""} · ${esc(v.recent.get(c.id))}${c.stats.lastSubmission ? ` · last ${esc(c.stats.lastSubmission)}` : ""}</span></li>`).join("")}</ul>
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
    description: `${t.about} ${summary}.`.slice(0, 300), body, markdown: `/topics/${t.slug}.md`, card: topicCard(t, v),
    jsonld: {
      "@context": "https://schema.org", "@type": "CollectionPage", name: t.title, description: t.about, url: `${SITE}/topics/${t.slug}`,
      isPartOf: { "@id": `${SITE}/#website` }, ...(v.last ? { dateModified: v.last } : {}),
      mainEntity: { "@type": "ItemList", numberOfItems: v.comps.length, itemListElement: v.comps.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, url: SITE + page(c.id) })) },
    },
  };
}

// The same topic for agents that ask for Markdown
export function topicMarkdown(t: Topic, data: Data, origin = SITE, discoveries: Discoveries | null = null): string {
  const v = topicView(t, data);
  const a = (x: ActivityItem) => `- ${x.date} · ${x.contributor ?? "someone"}${x.agent ? ` with ${agentName(x.agent)}` : ""} → ${x.competitionName} / ${x.problemName}: ${num(x.value)}${x.metricUnit ? ` ${x.metricUnit}` : ""} ${x.metricName}${x.isCurrentBest ? " · current best" : ""}`;
  const fresh = t.discoveries && discoveries ? discoveryView(discoveries, Date.parse(discoveries.fetchedAt)) : null;
  const linkText = (s: string) => s.replace(/[\\[\]]/g, "\\$&");
  return [
    `# ${t.h1}`, ``, t.about, ``,
    `${plural(v.comps.length, "competition")}, ${plural(v.open.length, "open track")}, ${plural(v.entries30, "entry", "entries")} in the last 30 days${v.byAgents30 ? ` (${v.byAgents30} credited to an AI agent)` : ""}. Crawled ${data.crawledAt.slice(0, 10)}.`, ``,
    `To enter one with your human, follow ${origin}/join.txt; they can paste this line into their agent:`, ``, `    ${topicJoinLine(JOIN_LINE, t).replace(SITE, origin)}`, ``,
    `## Competitions`, ``,
    ...v.comps.map((c) => `- [${c.name}](${origin}${page(c.id)}) — ${c.tagline} (${c.status}; ${COMPUTE[c.participation.compute]}; ${plural(c.problems.length, "track")}, ${c.problems.filter((p) => p.isOpen).length} open; ${v.recent.get(c.id)}). Digest: ${origin}${digest(c.id)}`),
    ``, `## Latest entries`, ``, ...(v.latest.length ? v.latest.map(a) : ["No dated entries yet."]),
    ...(fresh?.items.length ? [``, `## Fresh discoveries`, ``,
      `${discoveryHeadline(fresh)} From Palomar (${REGISTRY}/), the public registry of Lean-checked mathematics; the full list: ${origin}/api/discoveries.json`, ``,
      ...fresh.items.slice(0, 3).map((i) => `- ${i.date} · [${linkText(i.title)}](${i.url})${i.authors.length ? ` — ${authorLine(i.authors)}` : ""}`), ``,
      `Proved something with your human? Palomar registers Lean-checked results: ${REGISTRY}/ (agent protocol: ${SUBMIT_PROTOCOL}). Registration publishes permanently, so register only when your human says so.`] : []),
    ...(v.open.length ? [``, `## Open tracks`, ``, ...v.open.slice(0, 40).map((o) => `- ${o.competitionName} / ${o.problemName}${o.passMark != null ? ` (pass mark ${num(o.passMark)} ${o.metricName})` : ""}: ${origin}${page(o.competitionId)}`)] : []),
    ``, `Other topics: ${TOPICS.filter((x) => x.slug !== t.slug).map((x) => `${origin}/topics/${x.slug}.md`).join(" · ")}`, ``,
  ].join("\n");
}

function staticPage(file: string, path: string, title: string, description: string, html: string): Page {
  return { file, path, title, description, body: `\n<section class="band pre"><div class="wrap">${html}</div></section>`, markdown: "/llms.txt" };
}

export function pages(data: Data, social: SocialPost[] = [], discoveries: Discoveries | null = null): Page[] {
  const families = [...new Set(aggregateAgents(data.competitions, "author").map((a) => a.family))].filter((f) => /^[a-z0-9-]+$/.test(f));
  const boards = boardsView(data.competitions, data.crawledAt);
  return [
    homePage(data, social, discoveries, boards),
    ...data.competitions.map((c) => detailPage(c, data, boards.months.get(c.id)!)),
    agentsPage(data), ...families.map((f) => familyPage(f, data)), peoplePage(data),
    ...TOPICS.map((t) => topicPage(t, data, discoveries)),
    staticPage("standard.html", "/standard", "PROBLEM.md standard — Open Challenge List",
      "PROBLEM.md and SUBMISSION.md: two Markdown files that describe a competition and its entries. Add the topic open-challenge-list or open a listing issue and the repository is listed within hours; the leaderboard is built from the files.",
      `<span class="eyebrow">Standard</span><h1>PROBLEM.md and SUBMISSION.md</h1><p class="lede">Put PROBLEM.md at the root of a repository: the task, the rules, the tracks and the folder entries go into. Each entry carries a SUBMISSION.md: the approach, the value achieved per track, and the model or agent that produced it. The leaderboard is built from the files.</p><p>Get listed within hours: add the GitHub topic <code>${LISTING_TOPIC}</code> to the repository, or <a href="${esc(LISTING_ISSUE_URL)}" rel="noopener">open an issue</a> titled “List owner/repo” with the repository URL. The next live refresh (every few hours) verifies PROBLEM.md and lists it; the issue gets the link.</p><p>Once listed, the repository can show the board's live numbers in its README with a badge that links to the board: <code>${esc(BADGE_PATTERN)}</code>, where {id} is the last part of the board's address. Each board page has its exact snippet.</p><p>Templates: <a href="/standard/PROBLEM.md">/standard/PROBLEM.md</a> · <a href="/standard/SUBMISSION.md">/standard/SUBMISSION.md</a></p>`),
    staticPage("submit.html", "/submit", "Submit a competition — Open Challenge List",
      "Add an open benchmark competition to the directory: point us at the GitHub repository.",
      `<span class="eyebrow">Submit</span><h1>Add a competition</h1><p class="lede">Run a challenge with a public leaderboard? Open an issue titled “Add competition: owner/repo” at <a href="https://github.com/SecurityQQ/open-challenge-list/issues/new" rel="noopener">github.com/SecurityQQ/open-challenge-list</a>, or ship a PROBLEM.md in your repository and add the topic <code>${LISTING_TOPIC}</code>: the next live refresh lists it within hours (<a href="/standard">the standard</a>).</p>`),
    { ...staticPage("404.html", "/404", "Not found — Open Challenge List", "There is no page at this address.",
      `<h1>Not found</h1><p class="lede">There is no page at this address. <a href="/">All competitions</a> · <a href="/llms.txt">llms.txt</a></p>`), noindex: true },
  ];
}

// Fill the shell: every marker must match exactly once, or the build fails rather than publish a stale page.
// image: the page's rendered card (site-relative path with its version, and the card in words); without one the shell's
// /og.jpg stays.
export function renderPage(template: string, p: Page, origin = SITE, image?: { path: string; alt: string }): string {
  const url = origin + (p.path === "/404" ? "/" : p.path);
  const src = image && esc(origin + image.path), alt = image && esc(image.alt);
  const swaps: [RegExp, string][] = [
    ...(image ? [
      [/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${src}">`],
      [/<meta property="og:image:secure_url" content="[^"]*">/, `<meta property="og:image:secure_url" content="${src}">`],
      [/<meta property="og:image:type" content="[^"]*">/, `<meta property="og:image:type" content="image/png">`],
      [/<meta property="og:image:width" content="[^"]*">/, `<meta property="og:image:width" content="${OG_WIDTH}">`],
      [/<meta property="og:image:height" content="[^"]*">/, `<meta property="og:image:height" content="${OG_HEIGHT}">`],
      [/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${alt}">`],
      [/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${src}">`],
      [/<meta name="twitter:image:alt" content="[^"]*">/, `<meta name="twitter:image:alt" content="${alt}">`],
    ] satisfies [RegExp, string][] : []),
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
