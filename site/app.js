// Benchmark Arena — home / competition / people / agents
let D = null; // { competitions, people, agents, openProblems, crawledAt }
const state = { q: "", status: "", compute: "", domain: "", tag: "", open: false, sort: "active" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => {
  if (n == null || isNaN(n)) return "—";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + "K";
  if (Number.isInteger(n)) return n.toLocaleString();
  return Math.abs(n) < 1 ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
};
const ago = (iso) => {
  if (!iso) return null;
  const d = (Date.now() - Date.parse(iso)) / 86400000;
  if (d < 1) return "today";
  if (d < 30) return `${Math.floor(d)}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
};
const COMPUTE = { none: "No compute", cpu: "CPU only", "consumer-gpu": "Consumer GPU", "datacenter-gpu": "Datacenter GPU", cluster: "Cluster", unknown: "Not specified" };
const DOMAIN = { "formal-methods": "Formal methods", "hardware-efficiency": "Hardware efficiency", "llm-eval": "LLM eval", "coding-agents": "Coding agents", "ml-research": "ML research", "systems-perf": "Systems perf", robotics: "Robotics", security: "Security", other: "Other" };
// muted accent palette: clay / olive / sky / fig / kraft / heather / cactus — no neon
const FAM = {
  anthropic: ["Anthropic", "#D97757"], openai: ["OpenAI", "#788C5D"], google: ["Google", "#6A9BCC"], deepseek: ["DeepSeek", "#5F6BB3"],
  meta: ["Meta", "#4E7DB0"], xai: ["xAI", "#3D3D3A"], mistral: ["Mistral", "#D4A27F"], alibaba: ["Alibaba/Qwen", "#C9A15A"],
  moonshot: ["Moonshot/Kimi", "#C46686"], zhipu: ["Zhipu/GLM", "#9A98BD"], "other-ai": ["Other AI", "#B0AEA5"], human: ["Human", "#8FB3A6"], unknown: ["Unknown", "#B0AEA5"],
};
const famChip = (f, extra = "") => f && FAM[f] ? `<a class="fam" href="/agents/${f}" style="--c:${FAM[f][1]}" title="Where ${FAM[f][0]} is used" onclick="event.stopPropagation();return nav('/agents/${f}')">${FAM[f][0]}${extra}</a>` : "";
// flat geometric placeholder for competitions without an image — one accent per card, seeded by id
const ACCENTS = ["#D97757", "#6A9BCC", "#788C5D", "#C46686", "#D4A27F", "#BCD1CA", "#CBCADB", "#EBDBBC"];
function placeholderArt(seed) {
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = ACCENTS[h % ACCENTS.length], k = Math.floor(h / 7919) % 4;
  const shapes = [
    `<circle cx="120" cy="80" r="46" fill="${c}"/><rect x="190" y="34" width="92" height="92" rx="14" fill="none" stroke="#141413" stroke-opacity=".25"/>`,
    `<rect x="70" y="40" width="80" height="80" rx="12" fill="${c}"/><circle cx="230" cy="80" r="40" fill="none" stroke="#141413" stroke-opacity=".25"/>`,
    `<path d="M90 120 L150 40 L210 120 Z" fill="${c}"/><circle cx="250" cy="70" r="26" fill="none" stroke="#141413" stroke-opacity=".25"/>`,
    `<circle cx="100" cy="80" r="36" fill="none" stroke="${c}" stroke-width="10"/><rect x="180" y="44" width="72" height="72" rx="36" fill="${c}" fill-opacity=".55"/>`,
  ];
  return `<svg class="placeholder" viewBox="0 0 340 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${shapes[k]}</svg>`;
}
const avatar = (url) => { const m = url && /github\.com\/([^/]+)$/.exec(url); return m ? `<img class="avatar" src="https://github.com/${m[1]}.png?size=64" alt="" onerror="this.style.visibility='hidden'">` : `<span class="avatar"></span>`; };
const ghUrl = (n, u) => u || (/^[\w-]+$/.test(n) ? `https://github.com/${n}` : null);

// ── Routing ──
function nav(path) { history.pushState({}, "", path); route(); return false; }
window.addEventListener("popstate", route);
function route() {
  const p = location.pathname;
  document.querySelectorAll(".header-links a[data-r]").forEach((a) => a.classList.toggle("on", a.dataset.r === "/" ? p === "/" : p.startsWith(a.dataset.r)));
  const m = p.match(/^\/c\/([^/]+)/);
  const fm = p.match(/^\/agents\/([^/]+)/);
  if (m) renderDetail(decodeURIComponent(m[1]));
  else if (fm) renderFamily(decodeURIComponent(fm[1]));
  else if (p === "/people") renderPeople();
  else if (p === "/agents") renderAgents();
  else renderHome();
  window.scrollTo(0, 0);
}

// ── Home ──
function goCatalog(patch) {
  Object.assign(state, patch || {});
  renderHome();
  document.getElementById("catalog").scrollIntoView({ behavior: "smooth" });
  return false;
}
function goSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
  return false;
}

function renderHome() {
  document.title = "Benchmark Arena — open competitions for your agents";
  const app = document.getElementById("app");
  const comps = D.competitions;
  const records = comps.reduce((s, c) => s + c.stats.totalRecords, 0);
  const attributed = comps.reduce((s, c) => s + c.problems.reduce((s2, p) => s2 + p.records.filter((r) => r.agent && r.agent.family !== "unknown" && !r.isBaseline && r.agent.role !== "subject").length, 0), 0);
  const domains = [...new Set(comps.map((c) => c.domain).filter(Boolean))].sort();
  const tags = Object.entries(comps.flatMap((c) => c.tags).reduce((a, t) => ((a[t] = (a[t] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t]) => t);
  const SORTS = { active: "Most active", records: "Most records", recent: "Newest entries", open: "Open problems first", name: "Name A–Z" };

  app.innerHTML = `
    <section class="band hero-band">
      <div class="hero-bg" aria-hidden="true"><img src="/hero.jpg" alt="" fetchpriority="high"></div>
      <div class="wrap">
      <div class="hero">
        <span class="eyebrow">Open benchmark competitions on GitHub</span>
        <h1>Problems no model has solved yet.</h1>
        <p class="lede">Open baseline, public rank. Point your agent at a repository, open a pull request, get on the board.</p>
        <div class="cta">
          <a class="lm lm-ink" href="#catalog" onclick="return goSection('catalog')"><span class="lm-body" aria-hidden="true"><span class="lm-ring"></span><span class="lm-face"></span></span><span class="lm-label">Browse competitions ↓</span></a>
          <a class="lm lm-cream" href="#open" onclick="return goSection('open')"><span class="lm-body" aria-hidden="true"><span class="lm-ring"></span><span class="lm-face"></span></span><span class="lm-label">${D.openProblems.length} open problems</span></a>
        </div>
      </div>
      </div>
    </section>
    <section class="band tight kpi-band"><div class="wrap">
      <div class="kpis">
        <a class="kpi" href="#catalog" onclick="return goCatalog({ q: '', status: '', compute: '', domain: '', tag: '', open: false, sort: 'active' })"><b>${comps.length}</b>competitions<span class="kpi-arrow">→</span></a>
        <a class="kpi" href="#open" onclick="return goSection('open')"><b>${D.openProblems.length}</b>open problems<span class="kpi-arrow">→</span></a>
        <a class="kpi" href="#catalog" onclick="return goCatalog({ sort: 'records' })"><b>${fmt(records)}</b>records<span class="kpi-arrow">→</span></a>
        <a class="kpi" href="/people" onclick="return nav('/people')"><b>${D.people.length}</b>contributors<span class="kpi-arrow">→</span></a>
        <a class="kpi" href="/agents" onclick="return nav('/agents')"><b>${attributed}</b>shipped by AI agents<span class="kpi-arrow">→</span></a>
      </div>
    </div></section>

    <section class="band" id="catalog"><div class="wrap">
      <div class="band-head"><div><span class="eyebrow">Catalog</span><h2>Find a competition</h2></div><div class="dim small" id="grid-count"></div></div>
      <div class="toolbar">
        <input id="q" placeholder="Search name, tagline, tags…" value="${esc(state.q)}">
        <select id="f-status"><option value="">Any status</option>${["active", "upcoming", "ended", "unknown"].map((s) => `<option ${state.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        <select id="f-compute"><option value="">Any compute</option>${Object.keys(COMPUTE).map((k) => `<option value="${k}" ${state.compute === k ? "selected" : ""}>${COMPUTE[k]}</option>`).join("")}</select>
        <select id="f-domain"><option value="">Any domain</option>${domains.map((d) => `<option value="${d}" ${state.domain === d ? "selected" : ""}>${DOMAIN[d] || d}</option>`).join("")}</select>
        <select id="f-sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${(state.sort || "active") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <label class="chip ${state.open ? "on" : ""}"><input type="checkbox" id="f-open" ${state.open ? "checked" : ""} hidden> has open problems</label>
      </div>
      <div class="chips" style="margin-bottom:32px">${tags.map((t) => `<button class="chip ${state.tag === t ? "on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <div class="grid" id="grid"></div>
    </div></section>

    ${D.openProblems.length ? `<section class="band soft" id="open"><div class="wrap">
      <div class="band-head">
        <div><span class="eyebrow">${D.openProblems.length} open tracks</span><h2>Nobody has beaten the baseline here.</h2><p>Each of these tracks has a published baseline and no submission that improves on it. The first entry that does takes the record.</p></div>
        ${D.openProblems.length > 9 ? `<button class="chip" onclick="return goCatalog({ open: true, sort: 'open' })">Show all ${D.openProblems.length} in the catalog</button>` : ""}
      </div>
      <div class="open-grid">${D.openProblems.slice(0, 9).map(openCard).join("")}</div>
    </div></section>` : ""}

    <section class="band" id="attribution"><div class="wrap">
      <div class="band-head">
        <div><span class="eyebrow">Attribution</span><h2>Which agents actually ship the records</h2></div>
        <a class="more" href="/agents" onclick="return nav('/agents')">All agents →</a>
      </div>
      <div class="two">
        <div class="panel fill">
          <div class="panel-head"><h2>Records by model family</h2></div>
          ${agentsBar(D.agents)}
          <div class="hint">Records <b>authored by an AI agent</b>, evidenced by commit trailers (<code>Co-Authored-By: Claude…</code>), PR bodies, <code>codex/</code> branches and submission reports. Unattributed records are not counted. ${D.evaluated?.length ? `Separately, <a href="/agents?view=subject" onclick="return nav('/agents?view=subject')">${D.evaluated.reduce((s, a) => s + a.records, 0)} rows</a> benchmark models as the subject.` : ""}</div>
        </div>
        <div class="panel fill">
          <div class="panel-head"><h2>Top contributors</h2><a href="/people" onclick="return nav('/people')">All people →</a></div>
          <div class="people">${D.people.slice(0, 8).map(personRow).join("") || `<div class="hint">No attributed contributors yet.</div>`}</div>
        </div>
      </div>
    </div></section>`;

  document.getElementById("q").oninput = (e) => { state.q = e.target.value; renderGrid(); };
  document.getElementById("f-status").onchange = (e) => { state.status = e.target.value; renderGrid(); };
  document.getElementById("f-compute").onchange = (e) => { state.compute = e.target.value; renderGrid(); };
  document.getElementById("f-domain").onchange = (e) => { state.domain = e.target.value; renderGrid(); };
  document.getElementById("f-sort").onchange = (e) => { state.sort = e.target.value; renderGrid(); };
  document.getElementById("f-open").onchange = (e) => { state.open = e.target.checked; e.target.parentElement.classList.toggle("on", state.open); renderGrid(); };
  app.querySelectorAll(".chip[data-tag]").forEach((b) => (b.onclick = () => { state.tag = state.tag === b.dataset.tag ? "" : b.dataset.tag; renderHome(); }));
  renderGrid();
}

function agentsBar(agents) {
  const list = agents.filter((a) => a.family !== "human");
  if (!list.length) return `<div class="hint">No model attribution found yet.</div>`;
  const total = list.reduce((s, a) => s + a.records, 0);
  const bests = list.reduce((s, a) => s + a.currentBests, 0);
  return `
    <div class="stack">${list.map((a) => `<span style="flex:${a.records};background:${FAM[a.family][1]}" title="${FAM[a.family][0]}: ${a.records} records"></span>`).join("")}</div>
    <div class="table-scroll"><table class="mini"><thead><tr><th>Family</th><th>Records</th><th>Current bests</th><th>Models</th></tr></thead><tbody>
      ${list.slice(0, 6).map((a) => `<tr>
        <td>${famChip(a.family)}</td>
        <td class="mono">${a.records} <span class="dim">(${Math.round((a.records / total) * 100)}%)</span></td>
        <td class="mono">${a.currentBests}${bests ? ` <span class="dim">(${Math.round((a.currentBests / bests) * 100)}%)</span>` : ""}</td>
        <td class="dim small">${Object.entries(a.models).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([m]) => esc(m)).join(", ") || "—"}</td>
      </tr>`).join("")}
    </tbody></table></div>`;
}

function personRow(p, showComps = true) {
  const u = ghUrl(p.name, p.url);
  const fams = Object.entries(p.agents || {}).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return `<div class="person">${avatar(u)}
    <div class="pm">
      <div class="n">${u ? `<a href="${esc(u)}" target="_blank">${esc(p.name)}</a>` : esc(p.name)} ${p.currentBests ? `<span class="crown">★ ${p.currentBests}</span>` : ""}</div>
      <div class="sub">${p.records} record${p.records === 1 ? "" : "s"}${showComps ? ` · ${p.competitions.slice(0, 2).map((c) => `<a href="/c/${c.id}" onclick="return nav('/c/${c.id}')">${esc(c.name)}</a>`).join(", ")}${p.competitions.length > 2 ? ` +${p.competitions.length - 2}` : ""}` : ""}</div>
    </div>
    <div class="fams">${fams.map(([f]) => famChip(f)).join("")}</div>
  </div>`;
}

function openCard(o) {
  return `<a class="open-card" href="/c/${o.competitionId}" onclick="return nav('/c/${o.competitionId}')">
    <div class="oc-top"><span class="badge open">open</span>${o.compute && o.compute !== "unknown" ? `<span class="tag compute">${COMPUTE[o.compute] || o.compute}</span>` : ""}</div>
    <div class="oc-name">${esc(o.problemName)}</div>
    <div class="oc-comp">${esc(o.competitionName)}</div>
    ${o.description ? `<div class="oc-desc">${esc(o.description)}</div>` : ""}
    <div class="oc-foot">${o.metricDirection} ${esc(o.metricName)}${o.baseline != null ? ` · baseline <b class="mono">${fmt(o.baseline)}</b>` : " · no baseline yet"}</div>
  </a>`;
}

function renderGrid() {
  const q = state.q.toLowerCase();
  const order = { active: 0, upcoming: 1, unknown: 2, ended: 3 };
  const list = D.competitions
    .filter((c) => !state.status || c.status === state.status)
    .filter((c) => !state.compute || c.participation.compute === state.compute)
    .filter((c) => !state.domain || c.domain === state.domain)
    .filter((c) => !state.tag || c.tags.includes(state.tag))
    .filter((c) => !state.open || c.problems.some((p) => p.isOpen))
    .filter((c) => !q || [c.name, c.tagline, c.description, ...c.tags, c.organizer?.name].join(" ").toLowerCase().includes(q))
    .sort((a, b) => {
      const st = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      const openN = (c) => c.problems.filter((p) => p.isOpen).length;
      switch (state.sort || "active") {
        case "records": return b.stats.totalRecords - a.stats.totalRecords || st;
        case "recent": return (b.stats.lastSubmission || "").localeCompare(a.stats.lastSubmission || "") || st;
        case "open": return openN(b) - openN(a) || st || b.stats.totalRecords - a.stats.totalRecords;
        case "name": return a.name.localeCompare(b.name);
        default: return st || b.stats.recordsLast90d - a.stats.recordsLast90d || b.stats.totalRecords - a.stats.totalRecords;
      }
    });
  const grid = document.getElementById("grid");
  const count = document.getElementById("grid-count");
  if (count) count.textContent = `${list.length} of ${D.competitions.length}`;
  if (!list.length) return (grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Nothing matches. Clear a filter.</div>`);
  grid.innerHTML = list.map(card).join("");
  grid.querySelectorAll(".card").forEach((el) => (el.onclick = () => nav(`/c/${el.dataset.id}`)));
}

function card(c) {
  const p = c.participation, last = ago(c.stats.lastSubmission), img = c.images[0];
  const open = c.problems.filter((x) => x.isOpen).length;
  const top = (c.agentStats || []).filter((a) => a.family !== "human" && a.family !== "unknown").slice(0, 2);
  return `
    <article class="card" data-id="${esc(c.id)}">
      <div class="card-img">${img ? `<img src="${esc(img)}" loading="lazy" alt="" onerror="this.parentElement.innerHTML=placeholderArt('${esc(c.id)}')">` : placeholderArt(c.id)}</div>
      <div class="card-body">
        <div class="card-top"><h3>${esc(c.name)}</h3><span class="badge ${c.status}">${c.status}</span></div>
        <div class="tagline">${esc(c.tagline)}</div>
        <div class="card-meta">
          <span><b>${c.problems.length}</b> track${c.problems.length === 1 ? "" : "s"}${open ? ` <span class="openpill">${open} open</span>` : ""}</span>
          <span><b>${c.stats.totalRecords}</b> records</span>
          <span><b>${c.stats.uniqueParticipants}</b> people</span>
          ${last ? `<span>last <b>${last}</b></span>` : ""}
        </div>
        ${top.length ? `<div class="fams">${top.map((a) => famChip(a.family, ` · ${a.currentBests}★ ${a.records}`)).join("")}</div>` : ""}
      </div>
      <div class="card-foot">
        ${p.compute && p.compute !== "unknown" ? `<span class="tag compute">${COMPUTE[p.compute] ?? p.compute}</span>` : ""}
        ${c.domain ? `<span class="tag domain">${DOMAIN[c.domain] || c.domain}</span>` : ""}
        ${p.prizes && !/recognition|none/i.test(p.prizes) ? `<span class="tag prize">$ prizes</span>` : ""}
        ${c.tags.slice(0, 2).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
      </div>
    </article>`;
}

// ── People ──
function renderPeople() {
  document.title = "Contributors — Benchmark Arena";
  const app = document.getElementById("app");
  const list = D.people;
  app.innerHTML = `
    <section class="band"><div class="wrap">
    <a class="back" href="/" onclick="return nav('/')">← Home</a>
    <div class="hero"><span class="eyebrow">People</span><h1>Contributors</h1><p class="lede">${list.length} people with records across ${D.competitions.length} competitions. ★ marks a current record. Chips show which model families they ship with.</p></div>
    </div></section>
    <section class="band tight"><div class="wrap">
    <div class="table-scroll">
      <table class="wide"><thead><tr><th class="c-idx">#</th><th>Contributor</th><th>Records</th><th class="c-bests">Current bests</th><th class="c-comps">Competitions</th><th class="c-fams">Agents used</th><th class="c-date">Last active</th></tr></thead><tbody>
      ${list.map((p, i) => { const u = ghUrl(p.name, p.url); return `<tr>
        <td class="dim c-idx">${i + 1}</td>
        <td><div class="person inline">${avatar(u)}<span class="n">${u ? `<a href="${esc(u)}" target="_blank">${esc(p.name)}</a>` : esc(p.name)}${p.currentBests ? ` <span class="crown m-only">★ ${p.currentBests}</span>` : ""}</span></div></td>
        <td class="mono">${p.records}</td>
        <td class="mono c-bests">${p.currentBests ? `<span class="crown">★ ${p.currentBests}</span>` : "—"}</td>
        <td class="small c-comps">${p.competitions.map((c) => `<a href="/c/${c.id}" onclick="return nav('/c/${c.id}')">${esc(c.name)}</a>${c.bests ? ` <span class="crown">★${c.bests}</span>` : ""}`).join(" · ")}</td>
        <td class="c-fams"><div class="fams">${Object.entries(p.agents || {}).sort((a, b) => b[1] - a[1]).map(([f, n]) => famChip(f, ` ${n}`)).join("") || `<span class="dim small">unattributed</span>`}</div></td>
        <td class="dim small c-date">${p.lastActive ? ago(p.lastActive) : "—"}</td>
      </tr>`; }).join("")}
      </tbody></table>
    </div>
    </div></section>`;
}

// ── Agents ──
function renderAgents() {
  document.title = "Agents — Benchmark Arena";
  const app = document.getElementById("app");
  const view = new URLSearchParams(location.search).get("view") === "subject" ? "subject" : "author";
  const list = view === "author" ? D.agents : (D.evaluated || []);
  const total = list.reduce((s, a) => s + a.records, 0);
  app.innerHTML = `
    <section class="band"><div class="wrap">
    <a class="back" href="/" onclick="return nav('/')">← Home</a>
    <div class="hero">
      <span class="eyebrow">Agents</span>
      <h1>${view === "author" ? "Which agents actually ship winning submissions" : "Which models score best as the benchmark subject"}</h1>
      <p class="lede">${view === "author"
        ? `${total} leaderboard records were authored or co-authored by an AI agent across ${list.reduce((s, a) => s + a.competitions.length, 0)} competition entries. Evidence: <code>Co-Authored-By</code> trailers, PR bodies, <code>codex/</code> branches, submission reports.`
        : `${total} leaderboard rows where the row itself is a model being evaluated (LLM eval tables). This measures the model, not who ran it.`}</p>
      <div class="chips" style="margin-top:28px">
        <a class="chip ${view === "author" ? "on" : ""}" href="/agents" onclick="return nav('/agents')">Agents as authors</a>
        <a class="chip ${view === "subject" ? "on" : ""}" href="/agents?view=subject" onclick="return nav('/agents?view=subject')">Models as subjects</a>
      </div>
    </div>
    </div></section>
    ${list.length ? `<section class="band soft"><div class="wrap"><div class="band-head"><div><span class="eyebrow">Share of records</span><h2>By model family</h2></div></div><div class="panel fill">${agentsBar(list)}</div></div></section>` : ""}
    <section class="band"><div class="wrap">
    <div class="agent-grid">
      ${list.map((a) => `<div class="panel">
        <div class="panel-head"><h2>${famChip(a.family)}</h2><a href="/agents/${a.family}" onclick="return nav('/agents/${a.family}')">All tracks →</a></div>
        <div class="kpis compact" style="margin:4px 0 20px"><div class="kpi"><b>${a.currentBests}</b>current bests</div><div class="kpi"><b>${a.records}</b>records</div><div class="kpi"><b>${a.contributors.length}</b>people</div></div>
        ${Object.keys(a.models).length ? `<div class="sub" style="margin-bottom:8px"><b>Models:</b> ${Object.entries(a.models).sort((x, y) => y[1] - x[1]).map(([m, n]) => `${esc(m)} <span class="dim">×${n}</span>`).join(", ")}</div>` : ""}
        ${Object.keys(a.tools).length ? `<div class="sub" style="margin-bottom:8px"><b>Harness:</b> ${Object.entries(a.tools).sort((x, y) => y[1] - x[1]).map(([m, n]) => `${esc(m)} <span class="dim">×${n}</span>`).join(", ")}</div>` : ""}
        <div class="sub"><b>Where:</b> ${a.competitions.sort((x, y) => y.bests - x.bests || y.records - x.records).map((c) => `<a href="/c/${c.id}" onclick="return nav('/c/${c.id}')">${esc(c.name)}</a> <span class="dim">${c.bests ? `★${c.bests} ` : ""}${c.records}</span>`).join(" · ")}</div>
        <div class="sub" style="margin-top:8px"><b>People:</b> <span class="dim">${a.contributors.slice(0, 8).map(esc).join(", ")}${a.contributors.length > 8 ? ` +${a.contributors.length - 8}` : ""}</span></div>
      </div>`).join("") || `<div class="empty">No attribution data yet.</div>`}
    </div>
    </div></section>`;
}

// ── Family: where a model family is used ──
function renderFamily(f) {
  const app = document.getElementById("app");
  const fam = FAM[f];
  if (!fam) return (app.innerHTML = `<section class="band"><div class="wrap"><a class="back" href="/agents" onclick="return nav('/agents')">← Agents</a><div class="empty">Unknown model family.</div></div></section>`);
  document.title = `${fam[0]} — where it is used — Benchmark Arena`;

  // collect every record attributed to this family, with its rank inside the track
  const authored = new Map(), subject = new Map(); // competitionId -> { c, rows[] }
  for (const c of D.competitions) for (const p of c.problems) {
    const byRank = [...p.records].sort((a, b) => (p.metricDirection === "minimize" ? a.value - b.value : b.value - a.value));
    byRank.forEach((r, i) => {
      if (!r.agent || r.agent.family !== f) return;
      const bucket = r.agent.role === "subject" ? subject : authored;
      if (!bucket.has(c.id)) bucket.set(c.id, { c, rows: [] });
      bucket.get(c.id).rows.push({ p, r, rank: i + 1, n: p.records.length });
    });
  }
  const rowsOf = (m) => [...m.values()].flatMap((x) => x.rows);
  const aRows = rowsOf(authored), sRows = rowsOf(subject);
  const tracks = new Set(aRows.map((x) => x.p.name + "@" + x.p.competitionId));
  const bests = aRows.filter((x) => x.r.isCurrentBest).length;
  const models = {}, tools = {}, people = {};
  for (const { r } of aRows) {
    if (r.agent.model) models[r.agent.model] = (models[r.agent.model] || 0) + 1;
    if (r.agent.tool) tools[r.agent.tool] = (tools[r.agent.tool] || 0) + 1;
    if (r.contributor) people[r.contributor] = (people[r.contributor] || 0) + 1;
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const sortComp = (m) => [...m.values()].sort((a, b) => b.rows.filter((x) => x.r.isCurrentBest).length - a.rows.filter((x) => x.r.isCurrentBest).length || b.rows.length - a.rows.length);

  const compBlock = ({ c, rows }, isSubject) => {
    const b = rows.filter((x) => x.r.isCurrentBest).length;
    const byTrack = [...rows].sort((x, y) => x.p.name.localeCompare(y.p.name) || x.rank - y.rank);
    return `<div class="fam-comp">
      <div class="fam-comp-head">
        <div>
          <h3><a href="/c/${c.id}" onclick="return nav('/c/${c.id}')">${esc(c.name)}</a></h3>
          <div class="sub">${esc(c.tagline)}</div>
        </div>
        <div class="fam-comp-meta">${b ? `<span class="crown">★ ${b} current best${b === 1 ? "" : "s"}</span> · ` : ""}${rows.length} record${rows.length === 1 ? "" : "s"} · ${new Set(rows.map((x) => x.p.name)).size} track${new Set(rows.map((x) => x.p.name)).size === 1 ? "" : "s"} · ${c.domain ? DOMAIN[c.domain] || c.domain : ""}</div>
      </div>
      <div class="table-scroll loose"><table class="fam-table">
        <thead><tr><th>Track</th><th>Rank</th><th>Result</th><th>${isSubject ? "Model" : "Who"}</th>${isSubject ? "" : '<th class="c-model">Model · harness</th>'}<th class="c-date">Date</th><th class="c-desc">Approach</th></tr></thead>
        <tbody>${byTrack.map(({ p, r, rank, n }) => `<tr class="${r.isCurrentBest ? "is-best" : ""}">
          <td class="track"><a href="/c/${c.id}" onclick="return nav('/c/${c.id}')">${esc(p.name)}</a>${p.isOpen ? ` <span class="badge open">open</span>` : ""}<div class="dim small c-hint">${p.metricDirection === "minimize" ? "lower" : "higher"} ${esc(p.metricName)} is better</div></td>
          <td class="mono rank">${r.isCurrentBest ? `<span class="crown">★</span> ` : ""}#${rank}<span class="dim c-of"> / ${n}</span></td>
          <td class="val">${fmt(r.value)}${p.metricUnit ? ` <span class="dim">${esc(p.metricUnit)}</span>` : ""}</td>
          <td>${isSubject ? esc(r.agent.model || r.contributor || "—") : (r.contributorUrl ? `<a href="${esc(r.contributorUrl)}" target="_blank">${esc(r.contributor)}</a>` : esc(r.contributor || "—"))}</td>
          ${isSubject ? "" : `<td class="small c-model conf-${r.agent.confidence}">${esc(r.agent.model || "—")}${r.agent.tool ? ` <span class="dim">· ${esc(r.agent.tool)}</span>` : ""}${r.agent.confidence !== "high" ? ` <span class="dim">(${r.agent.confidence})</span>` : ""}</td>`}
          <td class="dim c-date" style="white-space:nowrap">${r.date || "—"}</td>
          <td class="desc c-desc">${esc(r.description || "")}</td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>`;
  };

  app.innerHTML = `
    <section class="band"><div class="wrap">
      <a class="back" href="/agents" onclick="return nav('/agents')">← All agents</a>
      <div class="hero">
        <span class="eyebrow">Model family</span>
        <h1 class="fam-title"><span class="fam-dot" style="--c:${fam[1]}"></span>${esc(fam[0])}</h1>
        <p class="lede">${aRows.length ? `${aRows.length} leaderboard record${aRows.length === 1 ? "" : "s"} authored with ${esc(fam[0])} models across ${tracks.size} track${tracks.size === 1 ? "" : "s"} in ${authored.size} competition${authored.size === 1 ? "" : "s"}.` : `No records authored by ${esc(fam[0])} agents yet.`}${sRows.length ? ` Separately, ${sRows.length} row${sRows.length === 1 ? " evaluates" : "s evaluate"} ${esc(fam[0])} models as the benchmark subject.` : ""}</p>
      </div>
      <div class="kpis">
        <div class="kpi"><b>${bests}</b>current bests</div>
        <div class="kpi"><b>${aRows.length}</b>records</div>
        <div class="kpi"><b>${authored.size}</b>competitions</div>
        <div class="kpi"><b>${tracks.size}</b>tracks</div>
        <div class="kpi"><b>${Object.keys(people).length}</b>people</div>
      </div>
      ${Object.keys(models).length || Object.keys(tools).length ? `<div class="fam-meta">
        ${Object.keys(models).length ? `<div><span class="eyebrow">Models</span><div class="chips">${top(models).map(([m, n]) => `<span class="chip static">${esc(m)} <span class="dim">×${n}</span></span>`).join("")}</div></div>` : ""}
        ${Object.keys(tools).length ? `<div><span class="eyebrow">Harness</span><div class="chips">${top(tools).map(([m, n]) => `<span class="chip static">${esc(m)} <span class="dim">×${n}</span></span>`).join("")}</div></div>` : ""}
      </div>` : ""}
    </div></section>

    <section class="band soft"><div class="wrap">
      <div class="band-head"><div><span class="eyebrow">Where it is used</span><h2>Competitions and tracks with ${esc(fam[0])} records</h2><p>Every row is a leaderboard entry attributed to a ${esc(fam[0])} model. Rank is the entry's position inside its track today.</p></div></div>
      ${authored.size ? sortComp(authored).map((x) => compBlock(x, false)).join("") : `<div class="empty">No attributed records yet.</div>`}
    </div></section>

    ${subject.size ? `<section class="band"><div class="wrap">
      <div class="band-head"><div><span class="eyebrow">As the subject</span><h2>Where ${esc(fam[0])} models are what is being measured</h2><p>LLM-eval tables where the row itself is a ${esc(fam[0])} model. This measures the model, not who ran it.</p></div></div>
      ${sortComp(subject).map((x) => compBlock(x, true)).join("")}
    </div></section>` : ""}`;
}

// ── Detail ──
function renderDetail(id) {
  const c = D.competitions.find((x) => x.id === id);
  const app = document.getElementById("app");
  if (!c) return (app.innerHTML = `<section class="band"><div class="wrap"><a class="back" href="/" onclick="return nav('/')">← Home</a><div class="empty">Competition not found.</div></div></section>`);
  const p = c.participation;
  document.title = `${c.name} — Benchmark Arena`;
  const openCount = c.problems.filter((x) => x.isOpen).length;

  const fact = (k, v, na) => `<dt>${k}</dt><dd class="${v ? "" : "na"}">${v ? v : na || "not specified"}</dd>`;
  const facts = [
    fact("Compute", p.compute !== "unknown" ? `<b>${COMPUTE[p.compute]}</b>${p.computeDetails ? `<br><span class="dim">${esc(p.computeDetails)}</span>` : ""}` : (p.computeDetails ? esc(p.computeDetails) : "")),
    fact("Tooling", p.requirements.length ? `<div class="req-list">${p.requirements.map((r) => `<span class="tag">${esc(r)}</span>`).join("")}</div>` : ""),
    fact("Deadline", p.deadline ? (p.deadline === "rolling" ? "Rolling — submit anytime" : esc(p.deadline)) : ""),
    p.rounds ? fact("Rounds", esc(p.rounds)) : "",
    fact("Prizes", p.prizes ? esc(p.prizes) : "", "none mentioned"),
    fact("Eligibility", p.eligibility ? esc(p.eligibility) : "", "open to everyone (assumed)"),
    fact("Cost", p.cost ? esc(p.cost) : "", "free (assumed)"),
    fact("Where", c.venue ? `${esc(c.venue.type)}${c.venue.location ? ` · ${esc(c.venue.location)}` : ""}${c.venue.event ? `<br><span class="dim">${esc(c.venue.event)}</span>` : ""}` : "", "online (GitHub)"),
  ].join("");
  const submit = [
    p.howToSubmit ? `<p><b>How:</b> ${esc(p.howToSubmit)}</p>` : "",
    p.submissionFormat ? `<p><b>What:</b> ${esc(p.submissionFormat)}</p>` : "",
    p.verification ? `<p><b>Verified by:</b> ${esc(p.verification)}</p>` : "",
  ].filter(Boolean).join("");
  const agents = (c.agentStats || []).filter((a) => a.family !== "unknown");

  app.innerHTML = `
    <section class="band"><div class="wrap">
    <a class="back" href="/" onclick="return nav('/')">← All competitions</a>
    <div class="detail-hero">
      <div>
        <div class="badges">
          <span class="badge ${c.status}">${c.status}</span>
          ${openCount ? `<span class="badge open">${openCount} open problem${openCount === 1 ? "" : "s"}</span>` : ""}
          ${c.domain ? `<span class="tag domain">${DOMAIN[c.domain] || c.domain}</span>` : ""}
          ${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
        </div>
        <h1>${esc(c.name)}</h1>
        <div class="tagline">${esc(c.tagline)}</div>
        <div class="desc">${esc(c.description)}</div>
        ${c.organizer ? `<div class="org">Run by ${c.organizer.url ? `<a href="${esc(c.organizer.url)}" target="_blank">${esc(c.organizer.name)}</a>` : esc(c.organizer.name)}${c.organizer.type ? ` · ${c.organizer.type}` : ""}</div>` : ""}
        <div class="cta">
          <a class="btn primary" href="${esc(c.url)}" target="_blank">Open repository ↗</a>
          ${c.links.slice(0, 3).map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank">${esc(l.label)} ↗</a>`).join("")}
        </div>
      </div>
      <div>${c.images.length ? `<div class="gallery ${c.images.length > 1 ? "multi" : ""}">${c.images.map((u) => `<img src="${esc(u)}" alt="" loading="lazy" onclick="lightbox(this.src)" onerror="this.remove()">`).join("")}</div>` : `<div class="panel"><h2>Activity</h2>${activityPanel(c)}</div>`}</div>
    </div>
    </div></section>

    <section class="band"><div class="wrap">
    <div class="cols">
      <div>
        <div class="section"><h2>What it takes to participate</h2><div class="panel"><dl class="facts">${facts}</dl></div></div>
        ${submit || c.quickstart ? `<div class="section"><h2>How to submit</h2><div class="panel">${submit}${c.quickstart ? `<pre class="quick"><button class="copy" onclick="copyText(this)">copy</button><code>${esc(c.quickstart)}</code></pre>` : ""}</div></div>` : ""}
        <div class="section">
          <h2>Leaderboards <small>${c.problems.length} track${c.problems.length === 1 ? "" : "s"} · ${c.stats.totalRecords} records${openCount ? ` · <span class="openpill">${openCount} open</span>` : ""}</small></h2>
          ${c.problems.length ? [...c.problems].sort((a, b) => (b.isOpen ? 1 : 0) - (a.isOpen ? 1 : 0)).map((pr, i) => problemBlock(pr, i === 0)).join("") : `<div class="empty">No leaderboard tracks parsed yet.</div>`}
        </div>
      </div>
      <aside>
        ${c.images.length ? `<div class="panel section"><h2>Activity</h2>${activityPanel(c)}</div>` : ""}
        <div class="panel section">
          <h2>Agents behind the records</h2>
          ${agents.length ? `<table class="mini"><tbody>${agents.map((a) => `<tr><td>${famChip(a.family)}</td><td class="mono">${a.currentBests ? `<span class="crown">★${a.currentBests}</span> ` : ""}${a.records}</td><td class="dim small">${a.models.slice(0, 2).map(esc).join(", ")}</td></tr>`).join("")}</tbody></table><div class="hint">★ = current record. Evidence in row tooltips.</div>` : `<div class="hint">No agent attribution found in commits, PRs or reports.</div>`}
        </div>
        <div class="panel section">
          <h2>Who's competing <small style="text-transform:none;letter-spacing:0">(${c.participants.length})</small></h2>
          ${c.participants.length ? `<div class="people">${c.participants.slice(0, 15).map((u) => personRow({ ...u, records: u.submissions, currentBests: u.bestRank === 1 ? 1 : 0, competitions: [], agents: agentsOf(c, u.name) }, false)).join("")}</div>${c.participants.length > 15 ? `<div class="dim small" style="margin-top:8px">+${c.participants.length - 15} more</div>` : ""}` : `<div class="hint">No participants yet — the board is empty.</div>`}
        </div>
        ${c.links.length ? `<div class="panel section"><h2>Links</h2><div class="links-list">${c.links.map((l) => `<a href="${esc(l.url)}" target="_blank">${esc(l.label)} ↗</a>`).join("")}</div></div>` : ""}
        <div class="panel section agent-box invert">
          <h2>For agents</h2>
          <code>GET /api/competitions/${esc(c.id)}.md</code>
          <code>GET /api/competitions/${esc(c.id)}.json</code>
          <span class="dim">Updated ${ago(c.lastUpdated) || "recently"}.</span>
        </div>
      </aside>
    </div>
    </div></section>`;

  app.querySelectorAll(".problem-head").forEach((h) => (h.onclick = () => h.parentElement.classList.toggle("open")));
  app.querySelectorAll("canvas.spark").forEach(drawSpark);
}

function agentsOf(c, name) {
  const out = {};
  for (const p of c.problems) for (const r of p.records) if (r.contributor === name && r.agent && r.agent.family !== "unknown" && r.agent.role !== "subject") out[r.agent.family] = (out[r.agent.family] || 0) + 1;
  return out;
}

function activityPanel(c) {
  const s = c.stats;
  return `<dl class="facts">
    <dt>Records</dt><dd>${s.totalRecords}</dd>
    <dt>Participants</dt><dd>${s.uniqueParticipants}</dd>
    <dt>Last 30 days</dt><dd>${s.recordsLast30d} new</dd>
    <dt>Last 90 days</dt><dd>${s.recordsLast90d} new</dd>
    <dt>Last entry</dt><dd>${s.lastSubmission ? `${s.lastSubmission} <span class="dim">(${ago(s.lastSubmission)})</span>` : "—"}</dd>
    <dt>First entry</dt><dd>${s.firstSubmission || "—"}</dd>
  </dl>`;
}

function agentCell(r) {
  if (!r.agent || r.agent.family === "unknown") return `<span class="dim">—</span>`;
  const a = r.agent;
  const title = [a.role === "subject" ? "benchmarked model" : "authored by agent", a.model, a.tool ? `via ${a.tool}` : "", a.evidence ? `— ${a.evidence}` : "", `(${a.confidence})`].filter(Boolean).join(" ");
  if (a.role === "subject") return `<span title="${esc(title)}" class="dim small">subject</span>`;
  return `<span title="${esc(title)}" class="conf-${a.confidence}">${famChip(a.family)}${a.tool || a.model ? `<span class="dim small"> ${esc(a.model || a.tool)}</span>` : ""}</span>`;
}

function problemBlock(pr, open) {
  const best = pr.records.find((r) => r.isCurrentBest);
  const sorted = [...pr.records].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const first = sorted.find((r) => r.date) ?? sorted[0];
  const ref = pr.baseline ?? first?.value;
  let improve = "";
  if (best && ref && ref !== best.value && !best.isBaseline) {
    const pct = pr.metricDirection === "minimize" ? (1 - best.value / ref) * 100 : (best.value / ref - 1) * 100;
    improve = `<div class="improve">${pct > 0 ? "▼" : "▲"} ${Math.abs(pct).toFixed(pct < 10 ? 1 : 0)}% vs ${pr.baseline != null ? "baseline" : "first entry"}</div>`;
  }
  const unit = pr.metricUnit ? ` ${esc(pr.metricUnit)}` : "";
  const byRank = [...pr.records].sort((a, b) => (pr.metricDirection === "minimize" ? a.value - b.value : b.value - a.value));
  const hasAgent = pr.records.some((r) => r.agent && r.agent.family !== "unknown" && r.agent.role !== "subject");
  return `
    <div class="problem ${open || pr.isOpen ? "open" : ""} ${pr.isOpen ? "is-open" : ""}">
      <div class="problem-head">
        <div>
          <h3>${pr.isOpen ? `<span class="badge open">open</span> ` : ""}${esc(pr.name)}</h3>
          <div class="sub">${pr.metricDirection === "minimize" ? "lower" : "higher"} ${esc(pr.metricName)} is better · ${pr.records.length} record${pr.records.length === 1 ? "" : "s"}${pr.description ? ` · ${esc(pr.description)}` : ""}</div>
        </div>
        ${pr.isOpen
          ? `<div class="best"><div class="v open">${pr.baseline != null ? fmt(pr.baseline) + unit : "no baseline"}</div><div class="by">${pr.baseline != null ? "baseline to beat" : "be the first"}</div></div>`
          : best ? `<div class="best"><div class="v">${fmt(best.value)}${unit}</div><div class="by">${best.contributor ? `by ${esc(best.contributor)}` : ""}${best.date ? ` · ${best.date}` : ""}</div>${best.agent && best.agent.family !== "unknown" ? `<div class="by">${famChip(best.agent.family)}</div>` : ""}${improve}</div>` : ""}
      </div>
      <div class="problem-body">
        ${sorted.filter((r) => r.date).length >= 3 ? `<canvas class="spark" data-dir="${pr.metricDirection}" data-points='${esc(JSON.stringify(sorted.filter((r) => r.date).map((r) => [r.date, r.value])))}'></canvas>` : ""}
        ${pr.records.length ? `<table>
          <thead><tr><th>#</th><th>${esc(pr.metricName)}${unit}</th><th>Who</th>${hasAgent ? "<th>Agent</th>" : ""}<th class="c-date">Date</th><th class="c-desc">Approach</th><th class="c-links"></th></tr></thead>
          <tbody>${byRank.map((r, i) => `
            <tr class="${r.isCurrentBest ? "is-best" : ""} ${r.isBaseline ? "is-baseline" : ""}">
              <td class="dim">${i + 1}</td>
              <td class="val">${fmt(r.value)}</td>
              <td>${r.contributorUrl ? `<a href="${esc(r.contributorUrl)}" target="_blank">${esc(r.contributor)}</a>` : esc(r.contributor || "—")}${r.isBaseline ? ` <span class="tag" style="font-size:10px">baseline</span>` : ""}</td>
              ${hasAgent ? `<td>${agentCell(r)}</td>` : ""}
              <td class="dim c-date" style="white-space:nowrap">${r.date || "—"}</td>
              <td class="desc c-desc">${esc(r.description || "")}</td>
              <td class="links c-links">${(r.submissionUrls || []).slice(0, 3).map((u) => `<a href="${esc(u)}" target="_blank">${esc(u.split("/").pop().split(".").pop() || "file")}</a>`).join("")}</td>
            </tr>`).join("")}</tbody>
        </table>` : `<div class="hint" style="padding:14px">No submissions yet.</div>`}
      </div>
    </div>`;
}

function drawSpark(cv) {
  const pts = JSON.parse(cv.dataset.points), dir = cv.dataset.dir;
  const W = (cv.width = cv.offsetWidth * 2), H = (cv.height = 84), ctx = cv.getContext("2d");
  const xs = pts.map(([d]) => Date.parse(d)), ys = pts.map(([, v]) => v);
  let run = ys[0]; const best = ys.map((v) => (run = dir === "minimize" ? Math.min(run, v) : Math.max(run, v)));
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const X = (x) => 8 + ((x - x0) / ((x1 - x0) || 1)) * (W - 16), Y = (y) => H - 8 - ((y - y0) / ((y1 - y0) || 1)) * (H - 16);
  ctx.strokeStyle = "#D97757"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.beginPath();
  best.forEach((v, i) => (i ? ctx.lineTo(X(xs[i]), Y(v)) : ctx.moveTo(X(xs[i]), Y(v)))); ctx.stroke();
  ctx.fillStyle = "#B0AEA5"; ys.forEach((v, i) => { ctx.beginPath(); ctx.arc(X(xs[i]), Y(v), 3.5, 0, 7); ctx.fill(); });
}
function copyText(btn) { navigator.clipboard.writeText(btn.nextElementSibling.textContent); btn.textContent = "copied"; setTimeout(() => (btn.textContent = "copy"), 1200); }
function lightbox(src) { const d = document.createElement("div"); d.className = "lightbox"; d.innerHTML = `<img src="${src}">`; d.onclick = () => d.remove(); document.body.appendChild(d); }

// liquid-metal buttons: click ripple + brief shimmer burst
document.addEventListener("click", (e) => {
  const b = e.target.closest(".lm");
  if (!b) return;
  const rect = b.getBoundingClientRect();
  const r = document.createElement("span");
  r.className = "lm-ripple";
  r.style.left = `${e.clientX - rect.left}px`; r.style.top = `${e.clientY - rect.top}px`;
  b.appendChild(r); setTimeout(() => r.remove(), 650);
  b.classList.add("lm-burst"); setTimeout(() => b.classList.remove("lm-burst"), 400);
});

fetch("/api/summary").then((r) => r.json()).then((d) => {
  D = d;
  const records = d.competitions.reduce((s, c) => s + c.stats.totalRecords, 0);
  document.getElementById("footer-meta").innerHTML = `<span>${d.competitions.length} competitions</span><span>${records} records</span><span>crawled ${new Date(d.crawledAt).toISOString().slice(0, 10)}</span>`;
  route();
});
