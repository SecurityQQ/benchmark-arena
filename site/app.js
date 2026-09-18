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
  moonshot: ["Moonshot/Kimi", "#C46686"], zhipu: ["Zhipu/GLM", "#9A98BD"],
  bytedance: ["ByteDance/Seed", "#5E9C9A"], harmonic: ["Harmonic", "#B58A4C"], axiom: ["Axiom Math", "#8C6A8E"], "other-ai": ["Other AI", "#B0AEA5"], human: ["Human", "#8FB3A6"], unknown: ["Unknown", "#B0AEA5"],
};
// brand marks from @lobehub/icons-static-svg, self-hosted under /icons
const FAM_ICON = { anthropic: "claude-color", openai: "openai", google: "gemini-color", deepseek: "deepseek-color", meta: "meta-color", xai: "xai", mistral: "mistral-color", alibaba: "qwen-color", moonshot: "kimi-color", zhipu: "zhipu-color", bytedance: "bytedance-color" };
const famIcon = (f, size = 14) => FAM_ICON[f] ? `<img class="fam-ico" src="/icons/${FAM_ICON[f]}.svg" width="${size}" height="${size}" alt="" loading="lazy">` : `<span class="fam-dot-sm" style="--c:${FAM[f]?.[1] || "#B0AEA5"};width:${Math.round(size * .6)}px;height:${Math.round(size * .6)}px"></span>`;
const famChip = (f, extra = "") => f && FAM[f] ? `<a class="fam has-ico" href="/agents/${f}" style="--c:${FAM[f][1]}" title="Where ${FAM[f][0]} is used" onclick="event.stopPropagation();return nav('/agents/${f}')">${famIcon(f, 14)}${FAM[f][0]}${extra}</a>` : "";
// flat geometric placeholder for competitions without an image — one accent per card, seeded by id
const ACCENTS = ["#D97757", "#6A9BCC", "#788C5D", "#C46686", "#D4A27F", "#BCD1CA", "#CBCADB", "#EBDBBC"];
let GEO = null;
function placeholderArt(seed) {
  // flat geometric cover: one strong accent + one soft tint + ink hairlines, eight compositions, slight hand-made tilt
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const STRONG = ["#D97757", "#6A9BCC", "#788C5D", "#C46686", "#D4A27F", "#5E9C9A", "#8C6A8E", "#B58A4C"];
  const SOFT = ["#EBDBBC", "#BCD1CA", "#CBCADB", "#F0D9CC", "#DCE4D2", "#E6D5DF"];
  // composition and colour are dealt least-used-first across the catalog, so neighbouring cards never repeat
  if (!GEO && typeof D !== "undefined" && D) {
    GEO = new Map();
    // only cards that actually show a generated cover, in a stable order; composition cycles through all eight before repeating,
    // and the colour step guarantees that a repeated composition never comes back in the same colour
    const list = [...D.competitions].filter((x) => !x.images?.length).sort((p, q) => p.id.localeCompare(q.id));
    list.forEach((x, i) => GEO.set(x.id, { k: (i * 3 + 1) % 8, ci: (i * 5 + Math.floor(i / 8) * 3 + 2) % STRONG.length }));
  }
  const dealt = GEO?.get(String(seed));
  const c = STRONG[dealt ? dealt.ci : h % STRONG.length], t = SOFT[Math.floor(h / 8) % SOFT.length], k = dealt ? dealt.k : Math.floor(h / 53) % 8;
  const rot = ((Math.floor(h / 389) % 9) - 4) * 0.7; // −2.8°…+2.8°
  const ink = 'stroke="#141413" stroke-opacity=".28" stroke-width="1.2" fill="none"';
  const comps = [
    // sun and ring
    `<circle cx="118" cy="84" r="50" fill="${c}"/><circle cx="226" cy="76" r="38" ${ink}/><circle cx="226" cy="76" r="9" fill="${t}"/><path d="M40 136H300" ${ink}/>`,
    // square meets circle
    `<rect x="64" y="34" width="92" height="92" rx="14" fill="${t}"/><circle cx="176" cy="92" r="44" fill="${c}" fill-opacity=".92"/><rect x="224" y="40" width="56" height="56" rx="28" ${ink}/>`,
    // peak
    `<path d="M70 128 L142 30 L214 128 Z" fill="${c}"/><path d="M150 128 L206 60 L262 128 Z" fill="${t}"/><circle cx="262" cy="50" r="17" ${ink}/><path d="M40 128H300" ${ink}/>`,
    // two halves
    `<path d="M150 30 A50 50 0 0 0 150 130 Z" fill="${c}"/><path d="M190 30 A50 50 0 0 1 190 130 Z" fill="${t}"/><path d="M170 18V142" ${ink}/><circle cx="276" cy="112" r="10" fill="${c}"/>`,
    // concentric arcs
    `<path d="M60 140 A110 110 0 0 1 170 30" stroke="${c}" stroke-width="22" fill="none" stroke-linecap="butt"/><path d="M100 140 A70 70 0 0 1 170 70" stroke="${t}" stroke-width="22" fill="none"/><circle cx="170" cy="140" r="16" fill="${c}"/><circle cx="250" cy="62" r="26" ${ink}/>`,
    // dot field with one marked
    `${[0,1,2,3,4,5].map((i) => [0,1,2].map((j) => `<circle cx="${72 + i * 28}" cy="${48 + j * 32}" r="7" fill="${(i * 3 + j) === (h % 18) ? c : t}"/>`).join("")).join("")}<circle cx="262" cy="80" r="40" ${ink}/><circle cx="262" cy="80" r="14" fill="${c}"/>`,
    // bars under a sun
    `${[46, 78, 58, 96, 70].map((v, i) => `<rect x="${66 + i * 30}" y="${134 - v}" width="20" height="${v}" rx="5" fill="${i === (h % 5) ? c : t}"/>`).join("")}<circle cx="258" cy="58" r="26" fill="${c}" fill-opacity=".9"/><path d="M50 134H300" ${ink}/>`,
    // three circles
    `<circle cx="130" cy="72" r="42" fill="${c}" fill-opacity=".9"/><circle cx="178" cy="72" r="42" fill="${t}" fill-opacity=".9"/><circle cx="154" cy="106" r="42" ${ink}/><circle cx="262" cy="46" r="8" fill="${c}"/>`,
  ];
  return `<svg class="placeholder" viewBox="0 0 340 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="340" height="160" fill="#F0EEE6"/><g transform="rotate(${rot} 170 80)">${comps[k]}</g></svg>`;
}
// ── Art: painted arenas. Used as card covers by domain, page headers, empty states and hidden easter eggs ──
const ART = {
  caesar:     { caption: "Veni, vidi, vici.",                          note: "Marble Caesar, gilded laurel. The runners never stop.",          pos: "78% 22%" },
  compass:    { caption: "Let no one ignorant of geometry enter.",     note: "A marble hand, a brass compass. Proofs are measured, not argued.", pos: "76% 40%" },
  armillary:  { caption: "Measure what is measurable.",                note: "An armillary sphere on marble. Benchmarks are instruments.",       pos: "80% 45%" },
  horse:      { caption: "Citius, altius, fortius.",                   note: "An antique horse crowned with laurel; the field blurs behind.",    pos: "78% 30%" },
  velodrome:  { caption: "The clock is the only judge.",               note: "A blurred peloton, one sharp brass stopwatch.",                    pos: "62% 70%", hpos: "80% 82%" },
  datacenter: { caption: "The laurel is on the floor. Pick it up.",    note: "Racks under an open sky, a bronze wreath waiting.",                pos: "40% 72%", hpos: "30% 88%" },
  // category plates: the discipline's object sharp in the foreground, the race blurred behind
  "d-coding":   { caption: "Pass the baton, keep typing.",            note: "Coding agents: a relay exchange, typewriter keys in the foreground.",       pos: "74% 78%", hpos: "80% 86%" },
  "d-llm":      { caption: "Weighed at the line.",                    note: "LLM eval: a finish by the judges' stand, brass scales on the kerb.",        pos: "78% 70%", hpos: "84% 80%" },
  "d-ml":       { caption: "Look closer, then run again.",            note: "ML research: the back straight, a microscope and notebooks.",               pos: "80% 74%", hpos: "86% 84%" },
  "d-formal":   { caption: "Every hurdle is a lemma.",                note: "Formal methods: hurdles, a marble dodecahedron and a compass.",             pos: "82% 72%", hpos: "88% 82%" },
  "d-hardware": { caption: "Heat is the opponent.",                   note: "Hardware efficiency: a sprint, a copper heatsink and a silicon wafer.",     pos: "70% 80%", hpos: "74% 90%" },
  "d-other":    { caption: "The plinth is still empty.",              note: "Other: open lanes and a blank marble medallion.",                           pos: "72% 78%", hpos: "78% 88%" },
  "d-robotics": { caption: "A hand that learned to let go.",          note: "Robotics: a brass mechanical hand on the track.",                           pos: "82% 80%", hpos: "86% 90%" },
  "d-systems":  { caption: "Thousandths decide it.",                  note: "Systems performance: the finish tape and a chronograph.",                   pos: "88% 62%", hpos: "92% 74%" },
  "c-none":       { caption: "Pencil, paper, bare feet.",             note: "No compute: a barefoot runner across a meadow.",                            pos: "72% 78%", hpos: "76% 88%" },
  "c-consumer":   { caption: "One card, one road.",                   note: "Consumer GPU: a lone runner, a graphics card on the kerb.",                 pos: "80% 78%", hpos: "86% 88%" },
  "c-cpu":        { caption: "A single chip on a pedestal.",          note: "CPU only: a processor on a marble block.",                                  pos: "74% 80%", hpos: "78% 90%" },
  "c-datacenter": { caption: "Run the aisle.",                        note: "Datacenter GPU: a runner between server racks, sky for a ceiling.",         pos: "88% 50%", hpos: "92% 60%" },
  "c-cluster":    { caption: "Ten thousand at the gun.",              note: "Cluster: a mass marathon start from above, the starting pistol on the clay.", pos: "60% 80%", hpos: "66% 90%" },
  finish:     { caption: "The tape breaks once.",                      note: "A finish line seen from the side; the winner is already a blur.",   pos: "70% 45%" },
  blocks:     { caption: "On your marks.",                             note: "Low angle, spikes leaving the blocks, clay in the air.",            pos: "72% 60%" },
  bend:       { caption: "Hold the inside line.",                      note: "The curve from above; the pack leans as one.",                     pos: "70% 62%" },
  hurdles:    { caption: "Ten barriers, one rhythm.",                  note: "Hurdlers in flight over a terracotta straight.",                   pos: "82% 40%" },
  relay:      { caption: "Nobody wins alone.",                         note: "Two hands, one baton, no time to look.",                           pos: "72% 70%" },
  dawn:       { caption: "Before the gun, the track belongs to everyone.", note: "An empty track at sunrise, eight sets of blocks waiting.",     pos: "50% 72%" },
  marathon:   { caption: "Far is a pace, not a place.",                note: "Road runners from behind, heading into the light.",                pos: "78% 55%" },
  indoor:     { caption: "Two hundred metres of wood and echo.",       note: "An indoor arena, a banked wooden track, a long window wall.",      pos: "80% 60%" },
  pool:       { caption: "Dive into the sky.",                         note: "Swimmers leave for the clouds; the medal stays on the edge.",      pos: "70% 78%", hpos: "100% 96%" },
};
const ART_BY_DOMAIN = {
  "formal-methods": ["d-formal", "compass", "caesar"], "hardware-efficiency": ["d-hardware", "datacenter", "velodrome"], "systems-perf": ["d-systems", "velodrome"],
  "coding-agents": ["d-coding", "velodrome", "armillary"], "llm-eval": ["d-llm", "armillary", "caesar"], "ml-research": ["d-ml", "armillary", "pool"],
  robotics: ["d-robotics", "horse"], security: ["caesar", "datacenter"], other: ["d-other", "pool", "horse"],
};
const ART_BY_COMPUTE = { none: "c-none", cpu: "c-cpu", "consumer-gpu": "c-consumer", "datacenter-gpu": "c-datacenter", cluster: "c-cluster" };
const hashOf = (str) => { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
// Covers for competitions with no repo image: the domain's themed plate first, then track scenes; always the least-used one, so neighbours differ
const TRACK_SET = ["finish", "blocks", "bend", "hurdles", "relay", "marathon", "indoor", "dawn"];
let COVER = null;
function assignCovers() {
  COVER = new Map(); const used = new Map();
  for (const c of [...D.competitions].filter((x) => !x.images?.length).sort((a, b) => a.id.localeCompare(b.id))) {
    const h = hashOf(c.id), rot = (arr) => arr.map((_, i) => arr[(i + h) % arr.length]);
    let pool = [...rot(ART_BY_DOMAIN[c.domain] || ART_BY_DOMAIN.other), ...rot(TRACK_SET)];
    if ((c.tagline || "").length > 105) pool = ["dawn", ...pool]; // the quiet plate for cards with a lot of text
    const k = pool.reduce((best, x) => ((used.get(x) ?? 0) < (used.get(best) ?? 0) ? x : best), pool[0]);
    used.set(k, (used.get(k) ?? 0) + 1); COVER.set(c.id, k);
  }
}
function artKeyFor(c) { if (!COVER && D) assignCovers(); return COVER?.get(c?.id) || TRACK_SET[hashOf(c?.id || "") % TRACK_SET.length]; }
function cardArt(c) { const k = artKeyFor(c); return `<img class="card-art" src="/art/${k}-sm.jpg" loading="lazy" alt="" style="object-position:${ART[k].pos}" onerror="this.outerHTML=placeholderArt('${esc(c?.id || k)}')">`; }
function cardArtById(id) { return cardArt(D.competitions.find((x) => x.id === id) || { id }); }
const artBg = (k) => `<div class="hero-bg art-bg" aria-hidden="true"><img src="/art/${k}.jpg" alt="" style="object-position:${ART[k].hpos || ART[k].pos}"></div>`;
const emptyArt = (k, title, text) => `<div class="empty-art"><img src="/art/${k}-sm.jpg" alt="" style="object-position:${ART[k].pos}"><div><div class="ea-title">${title}</div><div class="ea-text">${text}</div></div></div>`;

// hidden: full-screen plate with a caption. Triggers: type "veni", the Konami code, or tap the brand mark five times.
function showEgg(k) {
  const keys = Object.keys(ART); if (!ART[k]) k = keys[Math.floor(Math.random() * keys.length)];
  document.querySelector(".egg")?.remove();
  const d = document.createElement("div"); d.className = "egg"; d.dataset.k = k;
  d.innerHTML = `<figure><img src="/art/${k}.jpg" alt=""><figcaption><span class="egg-cap">${ART[k].caption}</span><span class="egg-note">${ART[k].note}</span><span class="egg-nav"><button data-d="-1" aria-label="Previous">←</button><span>${keys.indexOf(k) + 1} / ${keys.length}</span><button data-d="1" aria-label="Next">→</button></span></figcaption></figure>`;
  d.onclick = (e) => { const b = e.target.closest("button[data-d]"); if (b) { e.stopPropagation(); showEgg(keys[(keys.indexOf(k) + Number(b.dataset.d) + keys.length) % keys.length]); } else if (!e.target.closest("figure")) d.remove(); };
  document.body.appendChild(d);
}
(() => {
  let buf = ""; const KONAMI = "ArrowUpArrowUpArrowDownArrowDownArrowLeftArrowRightArrowLeftArrowRightba"; let kbuf = "";
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { document.querySelector(".egg")?.remove(); return; }
    const egg = document.querySelector(".egg");
    if (egg && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { const keys = Object.keys(ART); showEgg(keys[(keys.indexOf(egg.dataset.k) + (e.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length]); return; }
    kbuf = (kbuf + e.key).slice(-KONAMI.length); if (kbuf === KONAMI) { showEgg(); kbuf = ""; }
    if (/^(input|textarea|select)$/i.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.key.length !== 1) return;
    buf = (buf + e.key.toLowerCase()).slice(-8);
    if (buf.endsWith("veni")) { showEgg("caesar"); buf = ""; }
    else if (buf.endsWith("vici")) { showEgg("horse"); buf = ""; }
  });
  let taps = 0, t0 = 0;
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".sb-mark, .footer-brand")) return;
    const now = Date.now(); taps = now - t0 < 1600 ? taps + 1 : 1; t0 = now;
    if (taps >= 5) { taps = 0; e.preventDefault(); e.stopPropagation(); showEgg(); }
  }, true);
})();

const avatar = (url) => { const m = url && /github\.com\/([^/]+)$/.exec(url); return m ? `<img class="avatar" src="https://github.com/${m[1]}.png?size=64" alt="" onerror="this.style.visibility='hidden'">` : `<span class="avatar"></span>`; };
const ghUrl = (n, u) => u || (/^[\w-]+$/.test(n) ? `https://github.com/${n}` : null);

// ── Routing ──
function nav(path) { history.pushState({}, "", path); route(); return false; }
window.addEventListener("popstate", route);
function route() {
  closeAskMenu();
  const p = location.pathname;
  const app = isApp();
  document.body.classList.toggle("app", app);
  document.body.classList.remove("nav-open");
  document.querySelectorAll(".header-links a[data-r]").forEach((a) => a.classList.toggle("on", a.dataset.r === "/" ? p === "/" || p === "/landing" : p.startsWith(a.dataset.r)));
  const m = p.match(/^\/c\/([^/]+)/);
  const fm = p.match(/^\/agents\/([^/]+)/);
  if (m) renderDetail(decodeURIComponent(m[1]));
  else if (fm) renderFamily(decodeURIComponent(fm[1]));
  else if (p === "/standard" || (p === "/" && /(^|\.)submission\.md$/i.test(location.hostname))) renderStandard();
  else if (p === "/submit") renderSubmit();
  else if (p === "/people") renderPeople();
  else if (p === "/agents") renderAgents();
  else if (p === "/landing" || !app) renderHome();
  else renderAppHome();
  if (app) { renderSidebar(); renderTopbar(); }
  syncMeta();
  window.scrollTo(0, 0);
}

// keep description, canonical and social tags in step with the client-side route
const META_ORIGIN = "https://problem.md", META_DEFAULT = document.querySelector('meta[name="description"]')?.content || "";
function syncMeta() {
  const p = location.pathname, m = p.match(/^\/c\/([^/]+)/), c = m && D?.competitions.find((x) => x.id === decodeURIComponent(m[1]));
  const desc = c ? `${c.tagline || c.description || c.name}. ${c.problems.length} track${c.problems.length === 1 ? "" : "s"}, ${c.stats.totalRecords} records. How to enter, leaderboards and which AI agents hold the records.`.slice(0, 300)
    : p === "/standard" ? "PROBLEM.md and SUBMISSION.md: two Markdown files that describe a competition and its entries. Repositories that ship them are crawled first, and the leaderboard is built from the files."
    : p === "/submit" ? "Add an open benchmark competition to the directory: point us at the GitHub repository." : META_DEFAULT;
  const url = META_ORIGIN + (p === "/landing" ? "/" : p);
  const set = (sel, attr, v) => document.querySelector(sel)?.setAttribute(attr, v);
  set('meta[name="description"]', "content", desc); set('meta[property="og:description"]', "content", desc); set('meta[name="twitter:description"]', "content", desc);
  set('link[rel="canonical"]', "href", url); set('meta[property="og:url"]', "content", url);
  set('meta[property="og:title"]', "content", document.title); set('meta[name="twitter:title"]', "content", document.title);
}

// ── App mode: landing for first-time visitors, sidebar app for everyone who has been here ──
const VISITED = "ba_visited";
function isApp() {
  if (location.pathname === "/landing") return false;
  try { return localStorage.getItem(VISITED) === "1"; } catch { return false; }
}
function enterApp() { try { localStorage.setItem(VISITED, "1"); } catch {} return nav("/"); }
function showLanding() { return nav("/landing"); }
function toggleNav(force) { document.body.classList.toggle("nav-open", force); }

// inline icons, lucide-style (stroke 1.5)
const I = {
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M4 22V4a1 1 0 0 1 1-1h11l-2 4 2 4H5"/></svg>',
  bot: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M17.5 14a5.5 5.5 0 0 1 4 5.5"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0z"/><path d="M6 6H3v2a3 3 0 0 0 3 3M18 6h3v2a3 3 0 0 1-3 3"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  cpu: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  panel: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 10l-2 2 2 2"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14l2 2 4-4"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

// ── Ask an agent: a prompt with competition shortcuts, handed over by deep link (and always copied) ──
const BRAND = {
  claude: '<svg class="brand-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>',
  openai: '<svg class="brand-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>',
  cursor: '<svg class="brand-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"/></svg>',
  devin: '<svg class="brand-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h7.5a9 9 0 0 1 0 18H4zm3.2 3.2v11.6h4.3a5.8 5.8 0 0 0 0-11.6z"/></svg>',
  copy: '<svg class="line-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
};
const enc = encodeURIComponent;
// paste: no documented prompt-prefill URL — open the app, the prompt is on the clipboard
const AGENTS = [
  { id: "claude-code", name: "Claude Code", icon: "claude", url: (p) => `claude-cli://open?q=${enc(p)}`, hint: "Nothing opened? Run claude and paste." },
  { id: "claude", name: "Claude.ai", icon: "claude", url: (p) => `https://claude.ai/new?q=${enc(p)}` },
  { id: "chatgpt", name: "ChatGPT", icon: "openai", url: (p) => `https://chatgpt.com/?q=${enc(p)}` },
  { id: "codex", name: "Codex", icon: "openai", url: () => "https://chatgpt.com/codex", paste: true },
  { id: "devin", name: "Devin", icon: "devin", url: () => "https://app.devin.ai/", paste: true },
  { id: "cursor", name: "Cursor", icon: "cursor", url: (p) => `https://cursor.com/link/prompt?text=${enc(p)}` },
];
const AGENT_KEY = "ba_agent";
function currentAgent() { let id; try { id = localStorage.getItem(AGENT_KEY); } catch {} return AGENTS.find((a) => a.id === id) || AGENTS[0]; }

const PROMPT_MAX = 4500; // claude-cli:// caps q at 5,000 characters
const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
function trackLine(pr) {
  const b = pr.records.find((r) => r.isCurrentBest && !r.isBaseline);
  return `- ${pr.name}: ${pr.metricDirection} ${pr.metricName}${pr.metricUnit ? ` (${pr.metricUnit})` : ""}${pr.baseline != null ? `, baseline ${fmt(pr.baseline)}` : ""}${pr.isOpen ? ", OPEN: nobody has beaten the baseline" : b ? `, best ${fmt(b.value)}${b.contributor ? ` by ${b.contributor}` : ""}` : ""}, ${pr.records.length} records`;
}
function buildPrompt(c, pr) {
  const p = c.participation, slug = c.repo ? `${c.repo.owner}/${c.repo.name}` : null;
  const api = `${location.origin}/api/competitions/${enc(c.id)}`;
  const head = [
    `I want to enter the "${c.name}" competition${pr ? `, track "${pr.name}"` : ""}. Help me get started:`,
    slug ? `1. Fork and clone the repo: gh repo fork ${slug} --clone${c.repo.branch ? ` (default branch: ${c.repo.branch})` : ""}` : `1. Open ${c.url} and find the competition repository.`,
    `2. Read the README, rules and submission docs, then tell me briefly: what is measured, how entries are scored and verified, what a submission looks like, deadlines and prizes, and what compute I need.`,
    pr ? `3. Focus on the "${pr.name}" track: study the current leaderboard and the best existing entries, and find the number I have to beat.` : `3. Study the leaderboard and the best existing entries, and tell me which track is the easiest way in.`,
    `4. Propose a concrete plan for a first valid submission. Do not push, submit or open a PR without asking me.`,
  ].join("\n");
  const tail = `Full digest (fetch it first, it has every track and record):\n${api}.md\n${api}.json`;
  const fields = (quick) => [
    ["Competition", c.name], ["About", clip(c.tagline || c.description, 240)], ["URL", c.url], ["Repo", slug && `https://github.com/${slug}`], ["Status", c.status],
    ["Organizer", c.organizer?.name], ["Deadline", clip(p.deadline, 160)], ["Prizes", clip(p.prizes, 200)],
    ["Compute", [p.compute !== "unknown" ? COMPUTE[p.compute] : "", clip(p.computeDetails, 200)].filter(Boolean).join(" — ")],
    ["Requirements", p.requirements?.join(", ")], ["How to submit", clip(p.howToSubmit, 400)], ["Submission format", clip(p.submissionFormat, 240)],
    ["Verified by", clip(p.verification, 200)], ["Cost", clip(p.cost, 120)], ["Eligibility", clip(p.eligibility, 160)],
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n") + (quick && c.quickstart ? `\nQuickstart:\n${String(c.quickstart).trim().slice(0, 700)}` : "");
  const tracks = (n) => {
    if (pr) return `Track:\n${trackLine(pr)}${pr.description ? `\n  ${clip(pr.description, 300)}` : ""}${c.problems.length > 1 ? `\n(${c.problems.length - 1} other tracks, see the digest)` : ""}`;
    if (!c.problems.length || !n) return "";
    const list = [...c.problems].sort((a, b) => (b.isOpen ? 1 : 0) - (a.isOpen ? 1 : 0));
    return `Tracks (${list.length}):\n${list.slice(0, n).map(trackLine).join("\n")}${list.length > n ? `\n(+${list.length - n} more, see the digest)` : ""}`;
  };
  const links = (n) => (n && c.links.length ? `Links:\n${c.links.slice(0, n).map((l) => `- ${l.label}: ${l.url}`).join("\n")}` : "");
  const note = `Shortcuts (crawled by Benchmark Arena${D?.crawledAt ? ` on ${D.crawledAt.slice(0, 10)}` : ""}; the repo is the source of truth):`;
  // degrade in order: links → track list → quickstart; the digest URL always survives
  for (const [l, t, q] of [[6, 12, true], [0, 12, true], [0, 5, true], [0, 5, false], [0, 0, false]]) {
    const out = [head, note + "\n" + fields(q), tracks(t), links(l), tail].filter(Boolean).join("\n\n");
    if (out.length <= PROMPT_MAX) return out;
  }
  const room = PROMPT_MAX - head.length - tail.length - note.length - 8;
  return [head, note + "\n" + fields(false).slice(0, Math.max(0, room)) + "…", tail].join("\n\n");
}
// where "Open" goes: the competition page, or for a track the leaderboard / submission page when the crawl found one
function openUrl(c, pr) {
  if (pr) { const l = c.links.find((x) => /leaderboard/i.test(x.label)) || c.links.find((x) => /submi/i.test(x.label)); if (l) return l.url; }
  return c.url;
}
function ctaButtons(c, pr, o = {}) {
  const a = currentAgent(), sm = o.small ? " small" : "", url = esc(openUrl(c, pr));
  const data = `data-comp="${esc(c.id)}"${pr ? ` data-problem="${esc(pr.id ?? pr.name)}"` : ""}`;
  // nested: the host element is already a link, so "Open" has to be a button
  const open = o.nested
    ? `<button type="button" class="btn${sm}" data-open="${url}">${o.openLabel || "Open"} ${I.ext}</button>`
    : `<a class="btn${o.small ? " small" : " primary"}" href="${url}" target="_blank" rel="noopener">${o.openLabel || "Open"} ${I.ext}</a>`;
  return `${open}<span class="ask${sm}" ${data}><button type="button" class="ask-main" data-ask="${a.id}" title="Hand this ${pr ? "track" : "competition"} to ${a.name} with a ready prompt">${BRAND[a.icon]}<span>Ask ${a.name}</span></button><button type="button" class="ask-caret" data-ask-menu aria-haspopup="menu" aria-label="Choose an agent">${I.chev}</button></span>`;
}
function askTarget(el) {
  const host = el.closest("[data-comp]"); if (!host) return null;
  const c = D.competitions.find((x) => x.id === host.dataset.comp); if (!c) return null;
  const k = host.dataset.problem;
  return { c, pr: k ? c.problems.find((x) => (x.id ?? x.name) === k) : undefined };
}
function copyPrompt(text) { try { return navigator.clipboard.writeText(text).then(() => true, () => false); } catch { return Promise.resolve(false); } }
function askAgent(id, c, pr) {
  const prompt = buildPrompt(c, pr);
  const copied = copyPrompt(prompt); // always: custom schemes fail silently, and paste-only agents need it
  if (id === "copy") return copied.then((ok) => toast(ok ? "Prompt copied" : "Could not copy: clipboard is blocked"));
  const a = AGENTS.find((x) => x.id === id) || AGENTS[0], url = a.url(prompt);
  try { localStorage.setItem(AGENT_KEY, a.id); } catch {}
  document.querySelectorAll(".ask-main").forEach((b) => { b.dataset.ask = a.id; b.innerHTML = `${BRAND[a.icon]}<span>Ask ${a.name}</span>`; });
  if (/^https?:/.test(url)) window.open(url, "_blank", "noopener"); else location.href = url;
  copied.then((ok) => toast(a.paste ? (ok ? `Prompt copied. Paste it into ${a.name}` : `Opening ${a.name}. Clipboard is blocked, use “Copy prompt”`) : `${ok ? "Prompt copied. " : ""}Opening ${a.name}…${a.hint ? ` ${a.hint}` : ""}`));
}
function closeAskMenu() { document.querySelector(".ask-menu")?.remove(); document.querySelector(".ask-caret[aria-expanded]")?.removeAttribute("aria-expanded"); }
function openAskMenu(caret) {
  const was = caret.hasAttribute("aria-expanded"); closeAskMenu(); if (was) return;
  const host = caret.closest("[data-comp]"), cur = currentAgent().id;
  const m = document.createElement("div"); m.className = "ask-menu"; m.setAttribute("role", "menu");
  m.dataset.comp = host.dataset.comp; if (host.dataset.problem) m.dataset.problem = host.dataset.problem;
  m.innerHTML = AGENTS.map((a) => `<button type="button" role="menuitem" data-ask="${a.id}" class="${a.id === cur ? "on" : ""}">${BRAND[a.icon]}<span>${a.name}</span>${a.paste ? `<small>paste</small>` : ""}</button>`).join("") + `<hr><button type="button" role="menuitem" data-ask="copy">${BRAND.copy}<span>Copy prompt</span></button>`;
  document.body.appendChild(m); caret.setAttribute("aria-expanded", "true");
  const r = host.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
  m.style.top = `${r.bottom + 6 + h > innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : r.bottom + 6}px`;
  m.querySelector("button")?.focus();
}
// capture phase: these controls sit inside clickable cards and links, which must not fire
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-ask],[data-ask-menu],[data-open]");
  if (!el) { if (!e.target.closest(".ask-menu")) closeAskMenu(); return; }
  e.preventDefault(); e.stopPropagation();
  if (el.dataset.open) { closeAskMenu(); return void window.open(el.dataset.open, "_blank", "noopener"); }
  if (el.hasAttribute("data-ask-menu")) return openAskMenu(el);
  const t = askTarget(el); closeAskMenu();
  if (t) askAgent(el.dataset.ask, t.c, t.pr);
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAskMenu(); });
window.addEventListener("scroll", closeAskMenu, { passive: true });
window.addEventListener("resize", closeAskMenu);
let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; requestAnimationFrame(() => t.classList.add("on"));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 3200);
}

function renderSidebar() {
  const el = document.getElementById("sidebar");
  const p = location.pathname, onHome = p === "/";
  const comps = D.competitions;
  const count = (fn) => comps.reduce((o, c) => { const k = fn(c); if (k) o[k] = (o[k] || 0) + 1; return o; }, {});
  const domains = Object.entries(count((c) => c.domain)).sort((a, b) => b[1] - a[1]);
  const computes = Object.entries(count((c) => c.participation.compute)).filter(([k]) => k !== "unknown").sort((a, b) => b[1] - a[1]);
  const tracks = comps.reduce((s, c) => s + c.problems.length, 0);
  const fams = D.agents.filter((a) => a.family !== "human" && a.family !== "unknown").slice(0, 8);
  const item = (opts) => `<a class="sb-item ${opts.on ? "on" : ""} ${opts.cls || ""}" href="${opts.href}" onclick="${opts.click}"><span class="l">${opts.icon || ""}<span>${opts.label}</span></span>${opts.n != null ? `<span class="n">${opts.n}</span>` : opts.kbd ? `<kbd>${opts.kbd}</kbd>` : ""}</a>`;
  const filterClick = (k, v) => `return goApp({ ${k}: state.${k} === '${v}' ? '' : '${v}' })`;
  el.innerHTML = `
    <div class="sb-brand">
      <a href="/" onclick="return goApp({ q: '', status: '', compute: '', domain: '', tag: '', open: false })"><span class="sb-mark">B</span>Benchmark Arena</a>
      <button class="sb-collapse" title="Close" onclick="toggleNav(false)">${I.panel}</button>
    </div>
    <div class="sb-group">
      ${item({ href: "/", icon: I.search, label: "Search", kbd: "⌘K", click: "return focusSearch()" })}
      ${item({ href: "/", icon: I.grid, label: "Competitions", n: comps.length, on: onHome && !state.open && !state.domain && !state.compute, click: "return goApp({ q: '', status: '', compute: '', domain: '', tag: '', open: false, sort: 'active' })" })}
      ${item({ href: "/", icon: I.flag, label: "Open problems", n: D.openProblems.length, on: onHome && state.open, click: "return goApp({ open: true, sort: 'open' })" })}
      ${item({ href: "/agents", icon: I.bot, label: "Agents", n: D.agents.length, on: p.startsWith("/agents"), click: "return nav('/agents')" })}
      ${item({ href: "/people", icon: I.users, label: "People", n: D.people.length, on: p === "/people", click: "return nav('/people')" })}
      ${item({ href: "/", icon: I.trophy, label: "Leaderboards", n: tracks, on: false, click: "return goApp({ sort: 'records' })" })}
    </div>
    <div class="sb-group open">
      <div class="sb-heading">Domains</div>
      ${domains.map(([d, n]) => item({ href: "/", icon: I.folder, label: DOMAIN[d] || d, n, on: onHome && state.domain === d, click: filterClick("domain", d) })).join("")}
    </div>
    <div class="sb-group open">
      <div class="sb-heading">Compute</div>
      ${computes.map(([k, n]) => item({ href: "/", icon: I.cpu, label: COMPUTE[k] || k, n, on: onHome && state.compute === k, click: filterClick("compute", k) })).join("")}
    </div>
    <div class="sb-group open">
      <div class="sb-heading">Model families</div>
      ${fams.map((a) => item({ href: `/agents/${a.family}`, icon: `<span class="sb-ico">${famIcon(a.family, 16)}</span>`, label: FAM[a.family][0], n: a.records, on: p === `/agents/${a.family}`, click: `return nav('/agents/${a.family}')` })).join("")}
    </div>
    <div class="sb-bottom">
      ${item({ href: "/standard", icon: I.doc, label: "PROBLEM.md standard", on: p === "/standard", click: "return nav('/standard')" })}
      ${item({ href: "/submit", icon: I.plus, label: "Submit a competition", on: p === "/submit", click: "return nav('/submit')" })}
      ${item({ href: "/llms.txt", icon: I.file, label: "llms.txt", cls: "mono", click: "" })}
      ${item({ href: "/api/summary", icon: I.code, label: "/api/summary", cls: "mono", click: "" })}
      ${item({ href: "/landing", icon: I.home, label: "Show landing page", click: "return showLanding()" })}
    </div>`;
}

function crumbFor() {
  const p = location.pathname;
  const m = p.match(/^\/c\/([^/]+)/), fm = p.match(/^\/agents\/([^/]+)/);
  if (m) { const c = D.competitions.find((x) => x.id === decodeURIComponent(m[1])); return [["Competitions", "/"], [c ? c.name : "Not found"]]; }
  if (fm) { const f = FAM[decodeURIComponent(fm[1])]; return [["Agents", "/agents"], [f ? f[0] : "Unknown"]]; }
  if (p === "/standard") return [["The standard"]];
  if (p === "/submit") return [["Submit a competition"]];
  if (p === "/people") return [["People"]];
  if (p === "/agents") return [["Agents"]];
  return [[state.open ? "Open problems" : state.domain ? DOMAIN[state.domain] || state.domain : "Competitions"]];
}
function renderTopbar() {
  const el = document.getElementById("topbar");
  const crumbs = crumbFor();
  el.innerHTML = `
    <div class="tb-left">
      <button class="tb-toggle" aria-label="Menu" onclick="toggleNav()">${I.menu}</button>
      <div class="tb-crumb">${crumbs.map(([t, href], i) => href ? `<a href="${href}" onclick="return nav('${href}')">${esc(t)}</a><span>/</span>` : `<b>${esc(t)}</b>`).join("")}</div>
    </div>
    <div class="tb-right">
      <label class="tb-search">${I.search}<input id="tb-q" placeholder="Search competitions…" value="${esc(state.q)}"><kbd>⌘K</kbd></label>
      <a class="btn small tb-add" href="/submit" onclick="return nav('/submit')">${I.plus}<span>Submit</span></a>
      <a class="tb-link" href="/landing" onclick="return showLanding()">Landing</a>
    </div>`;
  const q = document.getElementById("tb-q");
  q.oninput = (e) => { state.q = e.target.value; if (location.pathname === "/") { const g = document.getElementById("grid"); if (g) renderGrid(); else renderAppHome(); } };
  q.onkeydown = (e) => { if (e.key === "Enter" && location.pathname !== "/") goApp({}); };
}
function focusSearch() { const q = document.getElementById("tb-q"); if (q && getComputedStyle(q.parentElement).display !== "none") { q.focus(); q.select(); } else { goApp({}); setTimeout(() => document.getElementById("q")?.focus(), 0); } return false; }
document.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (isApp()) focusSearch(); else { goCatalog({}); setTimeout(() => document.getElementById("q")?.focus(), 0); } } });

// navigate to app home with a state patch (used by sidebar filters)
function goApp(patch) {
  Object.assign(state, patch || {});
  if (location.pathname !== "/") history.pushState({}, "", "/");
  route();
  return false;
}

function renderAppHome() {
  document.title = "Competitions — Benchmark Arena";
  const app = document.getElementById("app");
  const comps = D.competitions;
  const domains = [...new Set(comps.map((c) => c.domain).filter(Boolean))].sort();
  const tags = Object.entries(comps.flatMap((c) => c.tags).reduce((a, t) => ((a[t] = (a[t] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  const SORTS = { active: "Most active", records: "Most records", recent: "Newest entries", open: "Open problems first", name: "Name A–Z" };
  const fams = D.agents.filter((a) => a.family !== "human" && a.family !== "unknown").slice(0, 9);
  const max = Math.max(1, ...fams.map((a) => a.records));
  const active = [
    state.domain ? ["domain", DOMAIN[state.domain] || state.domain] : null,
    state.compute ? ["compute", COMPUTE[state.compute] || state.compute] : null,
    state.status ? ["status", state.status] : null,
    state.tag ? ["tag", state.tag] : null,
    state.open ? ["open", "has open problems"] : null,
  ].filter(Boolean);

  app.innerHTML = `
    <section class="band"><div class="wrap">
      ${(() => { const k = state.domain && ART_BY_DOMAIN[state.domain] ? ART_BY_DOMAIN[state.domain][0] : state.compute && ART_BY_COMPUTE[state.compute] ? ART_BY_COMPUTE[state.compute] : state.open ? "datacenter" : null; if (!k) return ""; const label = state.domain ? DOMAIN[state.domain] || state.domain : state.compute ? COMPUTE[state.compute] : "Open problems"; return `<div class="ah-art">${artBg(k)}<div class="ah-art-cap"><span class="eyebrow">${state.domain ? "Domain" : state.compute ? "Compute" : "Unclaimed"}</span><div class="t">${esc(label)}</div><div class="q">${ART[k].caption}</div></div></div>`; })()}
      <div class="ah-intro">${introPill()}</div>
      <div class="ah-head">
        <div><h1>${state.open ? "Open problems" : state.domain ? esc(DOMAIN[state.domain] || state.domain) : "Competitions"}</h1><p>Open benchmark competitions on GitHub with public leaderboards. Pick one, point your agent at the repository, get on the board.</p></div>
        <div class="dim small mono" id="grid-count"></div>
      </div>

      <div class="ah-strip">
        <div class="ah-strip-head"><div><span class="t">Which agents ship the records</span> <span class="s">· records authored by an AI agent, by model family</span></div><a href="/agents" onclick="return nav('/agents')">All agents →</a></div>
        <div class="ah-bars">${fams.map((a) => `<a class="ah-bar" style="--c:${FAM[a.family][1]}" href="/agents/${a.family}" onclick="return nav('/agents/${a.family}')" title="${FAM[a.family][0]}: ${a.records} records, ${a.currentBests} current bests"><span class="v">${a.records}</span><span class="b" style="height:${Math.max(4, Math.round((a.records / max) * 64))}px"></span><span class="f">${famIcon(a.family, 14)}${FAM[a.family][0]}</span></a>`).join("")}</div>
      </div>

      <div class="toolbar ah-toolbar">
        <input id="q" placeholder="Search name, tagline, tags…" value="${esc(state.q)}">
        <select id="f-status"><option value="">Any status</option>${["active", "upcoming", "ended", "unknown"].map((s) => `<option ${state.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        <select id="f-compute"><option value="">Any compute</option>${Object.keys(COMPUTE).map((k) => `<option value="${k}" ${state.compute === k ? "selected" : ""}>${COMPUTE[k]}</option>`).join("")}</select>
        <select id="f-domain"><option value="">Any domain</option>${domains.map((d) => `<option value="${d}" ${state.domain === d ? "selected" : ""}>${DOMAIN[d] || d}</option>`).join("")}</select>
        <select id="f-sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${(state.sort || "active") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <label class="chip ${state.open ? "on" : ""}"><input type="checkbox" id="f-open" ${state.open ? "checked" : ""} hidden> has open problems</label>
      </div>
      <div class="chips" style="margin-bottom:20px">${tags.map((t) => `<button class="chip ${state.tag === t ? "on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      ${active.length ? `<div class="ah-active"><span class="dim small">Filters:</span>${active.map(([k, v]) => `<button class="chip on" onclick="return goApp({ ${k}: ${k === "open" ? "false" : "''"} })">${esc(v)}<span class="x">×</span></button>`).join("")}<button class="chip" onclick="return goApp({ q: '', status: '', compute: '', domain: '', tag: '', open: false })">Clear all</button></div>` : ""}
      <div class="grid" id="grid"></div>
    </div></section>`;

  document.getElementById("q").oninput = (e) => { state.q = e.target.value; const t = document.getElementById("tb-q"); if (t) t.value = state.q; renderGrid(); };
  document.getElementById("f-status").onchange = (e) => { state.status = e.target.value; renderGrid(); };
  document.getElementById("f-compute").onchange = (e) => goApp({ compute: e.target.value });
  document.getElementById("f-domain").onchange = (e) => goApp({ domain: e.target.value });
  document.getElementById("f-sort").onchange = (e) => { state.sort = e.target.value; renderGrid(); };
  document.getElementById("f-open").onchange = (e) => goApp({ open: e.target.checked });
  app.querySelectorAll(".chip[data-tag]").forEach((b) => (b.onclick = () => goApp({ tag: state.tag === b.dataset.tag ? "" : b.dataset.tag })));
  renderGrid();
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
  document.title = "Benchmark Arena — all open-source challenges in one place";
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
        ${introPill()}
        <span class="eyebrow">Open benchmark competitions on GitHub</span>
        <h1>All open-source challenges in one place.</h1>
        <p class="lede">Point your agent at a repo, open a pull request, get on the board.</p>
        <div class="cta">
          <a class="lm lm-ink" href="/" onclick="return enterApp()"><span class="lm-body" aria-hidden="true"><span class="lm-ring"></span><span class="lm-face"></span></span><span class="lm-label">Browse competitions →</span></a>
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

    <section class="band art-band std-promo">${artBg("d-coding")}<div class="wrap">
      <div class="hero"><span class="eyebrow">For organizers</span><h2 style="font-size:36px;line-height:1.1">Ship <span class="mono-title">PROBLEM.md</span> and <span class="mono-title">SUBMISSION.md</span>. Get crawled first.</h2>
      <p class="lede" style="margin-top:16px">PROBLEM.md at the root: the task, the rules, where entries go. SUBMISSION.md in every entry: the solution and its score. Our bot finds them on its own, reads them daily and builds the leaderboard from the files.</p>
      <div class="cta"><a class="btn primary" href="/standard" onclick="return nav('/standard')">Read the standard →</a><a class="btn" href="/submit" onclick="return nav('/submit')">Or just submit a repository</a></div></div>
    </div></section>

    <section class="band" id="attribution"><div class="wrap">
      <div class="band-head">
        <div><span class="eyebrow">Attribution</span><h2>Which agents actually ship the records</h2></div>
        <a class="more" href="/agents" onclick="return nav('/agents')">All agents →</a>
      </div>
      <div class="two">
        <div class="panel fill">
          <div class="panel-head"><h2>Records by model family</h2></div>
          ${agentsBar(D.agents)}
          <div class="hint">Records <b>authored by an AI agent</b>, evidenced by commit trailers (<code>Co-Authored-By: Claude…</code>), PR bodies, <code>codex/</code> branches and submission reports. Unattributed records are not counted. A <b>current best</b> counts only in tracks with at least two contributors; a lone entry is not a win. ${D.evaluated?.length ? `Separately, <a href="/agents?view=subject" onclick="return nav('/agents?view=subject')">${D.evaluated.reduce((s, a) => s + a.records, 0)} rows</a> benchmark models as the subject.` : ""}</div>
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
    <div class="table-scroll"><table class="mini"><thead><tr><th>Family</th><th>Records</th><th title="Best entry in a track with at least two contributors">Current bests</th><th>Models</th></tr></thead><tbody>
      ${list.slice(0, 6).map((a) => `<tr>
        <td>${famChip(a.family)}</td>
        <td class="mono">${a.records} <span class="dim">(${Math.round((a.records / total) * 100)}%)</span></td>
        <td class="mono">${a.currentBests}${bests ? ` <span class="dim">(${Math.round((a.currentBests / bests) * 100)}%)</span>` : ""}${a.uncontestedBests ? ` <span class="dim small" title="Only entry in its track: not counted as a best">+${a.uncontestedBests} solo</span>` : ""}</td>
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
  const oc = D.competitions.find((x) => x.id === o.competitionId), opr = oc?.problems.find((x) => (o.problemId != null && x.id === o.problemId) || x.name === o.problemName);
  const octa = oc ? `<div class="mini-cta">${ctaButtons(oc, opr, { small: true, nested: true })}</div>` : "";
  return `<a class="open-card" href="/c/${o.competitionId}" onclick="return nav('/c/${o.competitionId}')">
    <div class="oc-top"><span class="badge open">open</span>${o.compute && o.compute !== "unknown" ? `<span class="tag compute">${COMPUTE[o.compute] || o.compute}</span>` : ""}</div>
    <div class="oc-name">${esc(o.problemName)}</div>
    <div class="oc-comp">${esc(o.competitionName)}</div>
    ${o.description ? `<div class="oc-desc">${esc(o.description)}</div>` : ""}
    <div class="oc-foot">${o.metricDirection} ${esc(o.metricName)}${o.baseline != null ? ` · baseline <b class="mono">${fmt(o.baseline)}</b>` : " · no baseline yet"}</div>
    ${octa}
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
        default: return st || Number(!!b.standard?.problem) - Number(!!a.standard?.problem) || b.stats.recordsLast90d - a.stats.recordsLast90d || b.stats.totalRecords - a.stats.totalRecords;
      }
    });
  const grid = document.getElementById("grid");
  const count = document.getElementById("grid-count");
  if (count) count.textContent = `${list.length} of ${D.competitions.length}`;
  if (!list.length) return (grid.innerHTML = `<div style="grid-column:1/-1">${emptyArt("compass", "Nothing matches.", "The measure is too strict. Clear a filter and try again, or <a href='/submit' onclick=\"return nav('/submit')\">submit the competition you were looking for</a>.")}</div>`);
  grid.innerHTML = list.map(card).join("");
  grid.querySelectorAll(".card").forEach((el) => (el.onclick = (e) => { if (!e.target.closest(".btn, .ask")) nav(`/c/${el.dataset.id}`); }));
}

function card(c) {
  const p = c.participation, last = ago(c.stats.lastSubmission), img = c.images[0];
  const open = c.problems.filter((x) => x.isOpen).length;
  const top = (c.agentStats || []).filter((a) => a.family !== "human" && a.family !== "unknown").slice(0, 2);
  return `
    <article class="card" data-id="${esc(c.id)}">
      <div class="card-img">${img ? `<img src="${esc(img)}" loading="lazy" alt="" onerror="this.outerHTML=placeholderArt('${esc(c.id)}')">` : placeholderArt(c.id)}</div>
      <div class="card-body">
        <div class="card-top"><h3>${esc(c.name)}</h3><span class="badge ${c.status}">${c.status}</span></div>
        ${stdBadge(c)}
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
      <div class="card-cta">${ctaButtons(c, undefined, { small: true })}</div>
    </article>`;
}

const introPill = () => `<a class="intro-pill" href="/standard" onclick="return nav('/standard')"><span class="ip-tag">New</span><span class="ip-text">Introducing <b>Problem.MD</b> &amp; <b>Submission.MD</b></span><span class="ip-arrow" aria-hidden="true">→</span></a>`;
// ── The standard: PROBLEM.md + SUBMISSION.md (problem.md · submission.md) ──
const stdBadge = (c) => c.standard?.problem || c.standard?.submission ? `<a class="std-badge" href="/standard" title="Follows the standard: PROBLEM.md${c.standard.submissions ? ` and ${c.standard.submissions} SUBMISSION.md entr${c.standard.submissions === 1 ? "y" : "ies"}` : ""}. Crawled daily, facts taken from the files" onclick="event.stopPropagation();return nav('/standard')">${I.doc}<span>${c.standard.problem ? "PROBLEM.md" : "SUBMISSION.md"}</span></a>` : "";
// does a repo ship the two files? raw.githubusercontent serves with CORS, so the browser can look
async function checkStandard(owner, name, branch) {
  const marked = (t, k) => new RegExp(`^spec\\s*:\\s*${k}\\.md/v\\d+`, "mi").test(t || "");
  const front = (t) => (/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(t || "") || [])[1] || "";
  let problem = null, ref = null;
  outer: for (const b of [branch, "main", "master"].filter(Boolean)) for (const p of ["PROBLEM.md", "problem.md", ".github/PROBLEM.md", "docs/PROBLEM.md"]) {
    try { const r = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${b}/${p}`); if (r.ok) { const text = await r.text(); problem = { path: p, text, fm: front(text), marked: marked(front(text), "problem") }; ref = b; break outer; } } catch {}
  }
  const res = { problem, dir: null, entries: null, withFile: 0, sampled: 0, problemOk: false, submission: false };
  if (!problem || !problem.marked) return res;
  res.missing = ["name", "tracks", "submit"].filter((k) => !new RegExp(`^${k}\\s*:`, "m").test(problem.fm));
  res.problemOk = !res.missing.length;
  const m = /^\s+path\s*:\s*["']?([^\s"'#<]+)/m.exec(problem.fm);
  res.dir = m ? m[1].replace(/^\.?\//, "").replace(/\/+$/, "") : null;
  if (!res.dir || !/^[\w.-]+(\/[\w.-]+){0,3}$/.test(res.dir)) return res;
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${res.dir}?ref=${ref}`, { headers: { Accept: "application/vnd.github+json" } });
    if (r.ok) { const list = (await r.json()).filter((e) => e.type === "dir"); res.entries = list.length; const sample = list.slice(0, 6); res.sampled = sample.length;
      const hits = await Promise.all(sample.map((e) => fetch(`https://raw.githubusercontent.com/${owner}/${name}/${ref}/${e.path}/SUBMISSION.md`).then((x) => (x.ok ? x.text() : "")).then((t) => marked(front(t), "submission")).catch(() => false)));
      res.withFile = hits.filter(Boolean).length; res.submission = res.withFile > 0; }
  } catch {}
  return res;
}
function stdReport(res) {
  const li = (cls, html) => `<li class="${cls}">${html}</li>`;
  const out = [];
  if (!res.problem) out.push(li("miss", "<b>PROBLEM.md</b> not found at the repository root."));
  else if (!res.problem.marked) out.push(li("warn", `<b>PROBLEM.md</b> found at <code>${esc(res.problem.path)}</code>, but its front matter has no <code>spec: problem.md/v1</code> marker, so it is just prose to us.`));
  else out.push(li(res.problemOk ? "ok" : "warn", `<b>PROBLEM.md</b> found at <code>${esc(res.problem.path)}</code>${res.problemOk ? ", front matter looks complete." : `, front matter is missing: ${res.missing.map((k) => `<code>${k}</code>`).join(", ")}.`}`));
  if (res.problem?.marked) {
    if (!res.dir) out.push(li("miss", "No <code>submit.path</code> in PROBLEM.md, so we do not know where entries live."));
    else if (res.entries == null) out.push(li("warn", `Entries folder <code>${esc(res.dir)}/</code> could not be listed (missing, or GitHub rate limit).`));
    else if (!res.entries) out.push(li("miss", `<code>${esc(res.dir)}/</code> has no entry folders yet. The first SUBMISSION.md opens the leaderboard.`));
    else out.push(li(res.withFile ? "ok" : "warn", `<code>${esc(res.dir)}/</code> has ${res.entries} entr${res.entries === 1 ? "y" : "ies"}; ${res.withFile} of the first ${res.sampled} carry a valid <b>SUBMISSION.md</b>.`));
  }
  return `<ul class="std-report">${out.join("")}</ul>`;
}
// cream code blocks with a touch of YAML/Markdown colour
function hiTemplate(t) {
  return esc(t).split("\n").map((l) => {
    if (/^---\s*$/.test(l)) return `<span class="y-sep">${l}</span>`;
    if (/^#{1,3} /.test(l)) return `<span class="y-h">${l}</span>`;
    const m = /^(\s*-?\s*)([A-Za-z_][\w-]*)(:)(.*)$/.exec(l);
    let body = m ? `${m[1]}<span class="y-k">${m[2]}</span>${m[3]}${m[4]}` : l;
    return body.replace(/(^|\s)(#\s.*)$/, (x, a, c) => `${a}<span class="y-c">${c}</span>`);
  }).join("\n");
}
function renderStandard() {
  document.title = "PROBLEM.md and SUBMISSION.md — the standard";
  const app = document.getElementById("app");
  const n = D.competitions.filter((c) => c.standard?.problem).length;
  app.innerHTML = `
    <section class="band art-band">${artBg("d-formal")}<div class="wrap">
      <a class="back" href="/" onclick="return nav('/')">← Home</a>
      <div class="hero"><span class="eyebrow">The standard · v1</span><h1><span class="mono-title">PROBLEM.md</span> and <span class="mono-title">SUBMISSION.md</span></h1>
      <p class="lede"><b>PROBLEM.md</b> sits at the root of your repository: the task, the rules, the tracks and the folder entries go into. <b>SUBMISSION.md</b> sits inside each entry: the solution and the score it achieved. People read them; agents and our crawler parse them.</p>
      <div class="cta"><a class="btn primary" href="#templates" onclick="return goSection('templates')">Get the templates ↓</a><a class="btn" href="#check" onclick="return goSection('check')">Check my repository</a></div></div>
    </div></section>

    <section class="band"><div class="wrap">
      <div class="band-head"><div><span class="eyebrow">Why bother</span><h2>What the two files buy you</h2></div>${n ? `<div class="dim small mono">${n} listed competition${n === 1 ? "" : "s"} ship${n === 1 ? "s" : ""} them</div>` : ""}</div>
      <div class="std-grid">
        <div class="panel"><h2>Found without asking</h2><p>The bot searches all of GitHub for these file names every day. No form, no approval queue, no star threshold: if the files are there, the repository is crawled.</p></div>
        <div class="panel"><h2>First in line, daily</h2><p>Standard repositories are processed before everything else and re-crawled every day. The rest of the catalog is refreshed every three days.</p></div>
        <div class="panel"><h2>A leaderboard that builds itself</h2><p>Every <code>SUBMISSION.md</code> is a row: author, date, the value per track, the approach. No table to maintain by hand, no language model guessing numbers out of a README.</p></div>
        <div class="panel"><h2>Honest agent attribution</h2><p>Entries declare the model and harness that produced them. An agent pointed at your repository reads <code>PROBLEM.md</code>, knows what to optimize and where to put its answer. Listed competitions get a <span class="std-badge static">${I.doc}<span>PROBLEM.md</span></span> mark.</p></div>
      </div>
    </div></section>

    <section class="band soft" id="templates"><div class="wrap">
      <div class="band-head"><div><span class="eyebrow">Templates</span><h2>One for the organizer, one for every entry</h2><p>YAML front matter carries the facts, the Markdown body carries the prose. <code>PROBLEM.md</code> goes to the repository root. <code>SUBMISSION.md</code> goes into each entry folder named by <code>submit.path</code>. Unknown fields are ignored.</p></div></div>
      <div class="std-files">
        ${["PROBLEM.md", "SUBMISSION.md"].map((f) => `<div class="std-file"><div class="std-file-head"><span class="mono">${f}</span><span class="std-where">${f === "PROBLEM.md" ? "repository root · by the organizer" : "submissions/&lt;handle&gt;/ · by each participant"}</span><span><button class="btn small" data-copy="${f}">Copy</button> <a class="btn small" href="/standard/${f}" download="${f}">Download</a></span></div><pre class="std-pre" id="tpl-${f}"><code>Loading…</code></pre></div>`).join("")}
      </div>
      <div class="hint">From a terminal: <code>curl -O https://problem.md/standard/PROBLEM.md -O https://submission.md/standard/SUBMISSION.md</code></div>
    </div></section>

    <section class="band" id="check"><div class="wrap"><div class="submit-grid">
      <form class="panel submit-form" id="std-form" novalidate>
        <label class="field"><span class="eyebrow">Check a repository</span>
          <input id="std-repo" autocomplete="off" spellcheck="false" placeholder="owner/repo or https://github.com/owner/repo">
          <div class="field-state" id="std-state" aria-live="polite"></div>
        </label>
        <div class="submit-actions"><button type="submit" class="btn primary">Check</button><span class="hint" style="margin:0">Looks for both files on the default branch. Nothing is stored.</span></div>
      </form>
      <aside class="submit-side"><div class="panel fill"><h2>The rules of the lane</h2>
        <ul class="ticks">
          <li><code>PROBLEM.md</code> lives at the repository root (or in <code>.github/</code> or <code>docs/</code>) and starts with <code>spec: problem.md/v1</code>.</li>
          <li>It needs <code>name</code>, at least one track with <code>metric</code> and <code>direction</code>, and <code>submit.path</code>: the folder entries go into.</li>
          <li>Each entry is a folder under that path with a <code>SUBMISSION.md</code>: <code>spec: submission.md/v1</code>, <code>author</code>, and <code>results</code> with a <code>track</code> id and a numeric <code>value</code>.</li>
          <li>Scores are taken as declared. Verification stays with the organizers: say how in <code>submit.verification</code>.</li>
          <li>The repository must be public. Forks are ignored.</li>
        </ul></div></aside>
    </div></div></section>`;

  // one JSON first, per-file fetch as a fallback, a visible error instead of an endless "Loading…"
  const paint = (f, t) => { const el = document.querySelector(`#tpl-${CSS.escape(f)} code`); if (el && t) { el.dataset.raw = t; el.innerHTML = hiTemplate(t); } };
  const timed = (url) => { const c = new AbortController(); const id = setTimeout(() => c.abort(), 7000); return fetch(url, { signal: c.signal }).then((r) => { if (!r.ok) throw new Error(r.status); return r; }).finally(() => clearTimeout(id)); };
  timed("/standard/templates.json").then((r) => r.json()).catch(() => ({})).then((all) => Promise.all(["PROBLEM.md", "SUBMISSION.md"].map((f) =>
    all[f] ? paint(f, all[f]) : timed(`/standard/${f}`).then((r) => r.text()).then((t) => paint(f, t)).catch(() => { const el = document.querySelector(`#tpl-${CSS.escape(f)} code`); if (el) el.innerHTML = `Could not load the template (a content blocker may be stopping it). <a href="https://github.com/${SITE_REPO}/blob/master/site/standard/${f}" target="_blank" rel="noopener" style="text-decoration:underline">Open ${f} on GitHub</a>.`; }))));
  app.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => { const t = document.querySelector(`#tpl-${CSS.escape(b.dataset.copy)} code`)?.dataset.raw || ""; navigator.clipboard.writeText(t).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1400); }); }));
  const input = document.getElementById("std-repo"), st = document.getElementById("std-state");
  const run = async () => {
    const r = parseRepo(input.value); if (!r) { st.className = "field-state bad"; st.innerHTML = "Use <code>owner/repo</code> or a GitHub URL."; return; }
    st.className = "field-state wait"; st.innerHTML = `Looking into <code>${esc(r.owner)}/${esc(r.name)}</code>…`;
    const res = await checkStandard(r.owner, r.name);
    const both = res.problemOk && res.submission, listed = D.competitions.find((c) => c.repo && `${c.repo.owner}/${c.repo.name}`.toLowerCase() === `${r.owner}/${r.name}`.toLowerCase());
    st.className = "field-state"; st.innerHTML = stdReport(res) + `<div class="std-verdict ${both ? "ok" : ""}">${both ? "Priority lane: crawled daily, and the leaderboard is built from the SUBMISSION.md files." : res.problemOk ? "Priority lane: this repository will be picked up by the daily crawl. Entries appear as soon as they carry a SUBMISSION.md." : res.problem ? "Almost. Fix PROBLEM.md as noted above to enter the priority lane." : "Not in the priority lane yet. Add PROBLEM.md, or submit the repository the ordinary way."}${listed ? ` It is already listed as <a href="/c/${esc(listed.id)}" onclick="return nav('/c/${esc(listed.id)}')">${esc(listed.name)}</a>.` : !res.problemOk ? ` <a href="/submit?repo=${encodeURIComponent(r.owner + "/" + r.name)}" onclick="state.prefillRepo='${esc(r.owner)}/${esc(r.name)}';return nav('/submit')">Submit it →</a>` : ""}</div>`;
  };
  document.getElementById("std-form").onsubmit = (e) => { e.preventDefault(); run(); };
  const pre = state.prefillRepo || new URLSearchParams(location.search).get("repo"); if (pre) { input.value = pre; state.prefillRepo = null; run(); }
}

// ── Submit a competition: no backend; the form opens a prefilled GitHub issue that a maintainer approves ──
const SITE_REPO = "SecurityQQ/benchmark-arena";
function parseRepo(v) {
  const t = String(v || "").trim();
  const m = t.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[\/#?].*)?$/i) || t.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/);
  return m ? { owner: m[1], name: m[2] } : null;
}
function renderSubmit() {
  document.title = "Submit a competition — Benchmark Arena";
  const app = document.getElementById("app");
  app.innerHTML = `
    <section class="band art-band">${artBg("blocks")}<div class="wrap">
      <a class="back" href="/" onclick="return nav('/')">← Home</a>
      <div class="hero"><span class="eyebrow">Submit</span><h1>Add a competition</h1>
      <p class="lede">Know a benchmark with a public leaderboard that people or agents can submit to? Point us at the repository. We check it, a maintainer approves it, and the crawler picks it up.</p></div>
    </div></section>
    <section class="band"><div class="wrap"><div class="submit-grid">
      <form class="panel submit-form" id="submit-form" novalidate>
        <label class="field"><span class="eyebrow">GitHub repository <b>required</b></span>
          <input id="sf-repo" name="repo" autocomplete="off" spellcheck="false" placeholder="https://github.com/owner/repo" required>
          <div class="field-state" id="sf-state" aria-live="polite"></div>
        </label>
        <label class="field"><span class="eyebrow">Leaderboard or website</span>
          <input id="sf-lb" name="leaderboard" type="url" autocomplete="off" spellcheck="false" placeholder="https://… (if the leaderboard lives outside the README)">
        </label>
        <label class="field"><span class="eyebrow">Why it belongs here</span>
          <textarea id="sf-notes" name="notes" rows="4" maxlength="1200" placeholder="What is measured, how to submit, anything the README does not make obvious."></textarea>
        </label>
        <div class="submit-actions">
          <button type="submit" class="btn primary" id="sf-go" disabled>${BRAND_GH}<span>Continue on GitHub</span> ${I.ext}</button>
          <span class="hint" style="margin:0">Opens a prefilled issue in <a href="https://github.com/${SITE_REPO}" target="_blank" rel="noopener">${SITE_REPO}</a>. You need a GitHub account.</span>
        </div>
      </form>
      <aside class="submit-side">
        <div class="panel fill"><h2>What qualifies</h2>
          <ul class="ticks">
            <li>A public repository with a leaderboard: a table, a results file or a linked site.</li>
            <li>A documented way to submit: a PR, an issue, a form.</li>
            <li>Entries compete on the same metric, so a best result exists.</li>
          </ul>
          <div class="hint">Libraries, paper lists and static result tables with no submission path are skipped by the extractor.</div>
        </div>
        <div class="panel"><h2>What happens next</h2>
          <ol class="steps">
            <li><b>You open the issue.</b> The form fills it in; you press “Submit new issue”.</li>
            <li><b>A maintainer approves.</b> Nothing is crawled before a human looks at it.</li>
            <li><b>The crawler runs.</b> Every three days it reads the repository, extracts tracks, records and agent attribution.</li>
            <li><b>It appears here.</b> With an API digest for agents at <code>/api/competitions/{id}.md</code>.</li>
          </ol>
        </div>
      </aside>
    </div></div></section>`;

  const repoEl = document.getElementById("sf-repo"), stateEl = document.getElementById("sf-state"), go = document.getElementById("sf-go");
  let current = null, timer = null, seq = 0;
  const set = (cls, html, ok) => { stateEl.className = "field-state " + cls; stateEl.innerHTML = html; go.disabled = !ok; };
  const check = () => {
    const r = parseRepo(repoEl.value); current = null;
    if (!repoEl.value.trim()) return set("", "", false);
    if (!r) return set("bad", "That does not look like a GitHub repository. Use <code>https://github.com/owner/repo</code>.", false);
    const dup = D.competitions.find((c) => c.repo && `${c.repo.owner}/${c.repo.name}`.toLowerCase() === `${r.owner}/${r.name}`.toLowerCase());
    if (dup) return set("dup", `Already listed: <a href="/c/${esc(dup.id)}" onclick="return nav('/c/${esc(dup.id)}')">${esc(dup.name)}</a>. If the data looks wrong, open an issue instead.`, false);
    current = r; set("wait", `Checking <code>${esc(r.owner)}/${esc(r.name)}</code>…`, true);
    const my = ++seq;
    fetch(`https://api.github.com/repos/${r.owner}/${r.name}`, { headers: { Accept: "application/vnd.github+json" } }).then(async (res) => {
      if (my !== seq) return;
      if (res.status === 404) { current = null; return set("bad", "GitHub has no public repository at that address.", false); }
      if (!res.ok) return set("warn", "Could not verify the repository right now (GitHub rate limit). You can still continue.", true);
      const m = await res.json();
      current = { owner: m.owner.login, name: m.name };
      checkStandard(m.owner.login, m.name, m.default_branch).then((std) => { if (my !== seq) return; const el = document.getElementById("sf-std"); if (el) el.innerHTML = std.problemOk ? `<div class="std-verdict ok">Ships a valid PROBLEM.md: it is in the priority lane and will be crawled daily, no approval needed.</div>` : `<div class="std-verdict">Tip: add <a href="/standard" onclick="return nav('/standard')">PROBLEM.md</a> to the repository root and the bot crawls it daily, ahead of the queue.</div>`; });
      set("ok", `<div class="repo-preview"><img src="${esc(m.owner.avatar_url)}&s=64" alt="" width="32" height="32"><div><div class="rp-name">${esc(m.full_name)} <span class="dim">★ ${fmt(m.stargazers_count)}</span></div><div class="rp-desc">${esc(m.description || "No description")}</div></div></div>${m.archived ? `<div class="rp-note">This repository is archived; it will be listed as ended.</div>` : ""}<div id="sf-std"></div>`, true);
    }).catch(() => { if (my === seq) set("warn", "Could not reach GitHub to verify. You can still continue.", true); });
  };
  repoEl.oninput = () => { clearTimeout(timer); timer = setTimeout(check, 450); const r = parseRepo(repoEl.value); go.disabled = !r; };
  document.getElementById("submit-form").onsubmit = (e) => {
    e.preventDefault();
    const r = current || parseRepo(repoEl.value); if (!r) { repoEl.focus(); return; }
    const lb = document.getElementById("sf-lb").value.trim(), notes = document.getElementById("sf-notes").value.trim();
    const body = [`### Repository`, `https://github.com/${r.owner}/${r.name}`, ``, `### Leaderboard or website`, /^https?:\/\//.test(lb) ? lb : "_none_", ``, `### Why it belongs here`, notes || "_no notes_", ``, `---`, `Submitted from ${location.origin}/submit. A maintainer adds the \`approved\` label to queue it for the crawler.`].join("\n");
    window.open(`https://github.com/${SITE_REPO}/issues/new?title=${encodeURIComponent(`Add competition: ${r.owner}/${r.name}`)}&labels=submission&body=${encodeURIComponent(body)}`, "_blank", "noopener");
    toast?.("Issue opened in a new tab. Press “Submit new issue” there.");
  };
  const pre = new URLSearchParams(location.search).get("repo") || state.prefillRepo; state.prefillRepo = null; if (pre) { repoEl.value = pre; check(); }
  repoEl.focus();
}
const BRAND_GH = '<img class="btn-ico" src="/icons/github.svg" width="16" height="16" alt="">';

// ── People ──
function renderPeople() {
  document.title = "Contributors — Benchmark Arena";
  const app = document.getElementById("app");
  const list = D.people;
  app.innerHTML = `
    <section class="band art-band">${artBg("pool")}<div class="wrap">
    <a class="back" href="/" onclick="return nav('/')">← Home</a>
    <div class="hero"><span class="eyebrow">People</span><h1>Contributors</h1><p class="lede">${list.length} people with records across ${D.competitions.length} competitions. ★ marks a current best in a contested track. Chips show which model families they ship with.</p></div>
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
    <section class="band art-band">${artBg("horse")}<div class="wrap">
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
  if (!fam) return (app.innerHTML = `<section class="band"><div class="wrap"><a class="back" href="/agents" onclick="return nav('/agents')">← Agents</a>${emptyArt("horse", "No such stable.", "This model family has not entered any race here.")}</div></section>`);
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
    <section class="band art-band">${artBg("armillary")}<div class="wrap">
      <a class="back" href="/agents" onclick="return nav('/agents')">← All agents</a>
      <div class="hero">
        <span class="eyebrow">Model family</span>
        <h1 class="fam-title">${FAM_ICON[f] ? `<span class="fam-logo">${famIcon(f, 40)}</span>` : `<span class="fam-dot" style="--c:${fam[1]}"></span>`}${esc(fam[0])}</h1>
        <p class="lede">${aRows.length ? `${aRows.length} leaderboard record${aRows.length === 1 ? "" : "s"} authored with ${esc(fam[0])} models across ${tracks.size} track${tracks.size === 1 ? "" : "s"} in ${authored.size} competition${authored.size === 1 ? "" : "s"}.` : `No records authored by ${esc(fam[0])} agents yet.`}${sRows.length ? ` Separately, ${sRows.length} row${sRows.length === 1 ? " evaluates" : "s evaluate"} ${esc(fam[0])} models as the benchmark subject.` : ""}</p>
      </div>
    </div></section>
    <section class="band tight fam-stats"><div class="wrap">
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
  if (!c) return (app.innerHTML = `<section class="band"><div class="wrap"><a class="back" href="/" onclick="return nav('/')">← Home</a>${emptyArt("caesar", "Veni, vidi… non inveni.", "There is no competition at this address. The arena is back that way.")}</div></section>`);
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
          ${stdBadge(c)}
          ${openCount ? `<span class="badge open">${openCount} open problem${openCount === 1 ? "" : "s"}</span>` : ""}
          ${c.domain ? `<span class="tag domain">${DOMAIN[c.domain] || c.domain}</span>` : ""}
          ${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
        </div>
        <h1>${esc(c.name)}</h1>
        <div class="tagline">${esc(c.tagline)}</div>
        <div class="desc">${esc(c.description)}</div>
        ${c.organizer ? `<div class="org">Run by ${c.organizer.url ? `<a href="${esc(c.organizer.url)}" target="_blank">${esc(c.organizer.name)}</a>` : esc(c.organizer.name)}${c.organizer.type ? ` · ${c.organizer.type}` : ""}</div>` : ""}
        <div class="cta">
          ${ctaButtons(c, undefined, { openLabel: c.host === "github" ? "Open repository" : "Open competition" })}
          ${c.links.slice(0, 3).map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ${I.ext}</a>`).join("")}
        </div>
      </div>
      <div>${c.images.length ? `<div class="gallery ${c.images.length > 1 ? "multi" : ""}">${c.images.map((u) => `<img src="${esc(u)}" alt="" loading="lazy" onclick="lightbox(this.src)" onerror="this.remove()">`).join("")}</div>` : `<div class="detail-art">${cardArt(c).replace("-sm.jpg", ".jpg")}</div><div class="panel" style="margin-top:16px"><h2>Activity</h2>${activityPanel(c)}</div>`}</div>
    </div>
    </div></section>

    <section class="band"><div class="wrap">
    <div class="cols">
      <div>
        <div class="section"><h2>What it takes to participate</h2><div class="panel"><dl class="facts">${facts}</dl></div></div>
        ${submit || c.quickstart ? `<div class="section"><h2>How to submit</h2><div class="panel">${submit}${c.quickstart ? `<pre class="quick"><button class="copy" onclick="copyText(this)">copy</button><code>${esc(c.quickstart)}</code></pre>` : ""}</div></div>` : ""}
        <div class="section">
          <h2>Leaderboards <small>${c.problems.length} track${c.problems.length === 1 ? "" : "s"} · ${c.stats.totalRecords} records${openCount ? ` · <span class="openpill">${openCount} open</span>` : ""}</small></h2>
          ${c.problems.length ? [...c.problems].sort((a, b) => (b.isOpen ? 1 : 0) - (a.isOpen ? 1 : 0)).map((pr, i) => problemBlock(pr, i === 0, c)).join("") : `<div class="empty">No leaderboard tracks parsed yet.</div>`}
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

  app.querySelectorAll(".problem-head").forEach((h) => (h.onclick = (e) => { if (!e.target.closest(".btn, .ask")) h.parentElement.classList.toggle("open"); }));
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

function problemBlock(pr, open, c) {
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
          ${c ? `<div class="mini-cta">${ctaButtons(c, pr, { small: true })}</div>` : ""}
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
  const b = e.target.closest(".lm, .btn, .ask");
  if (!b || b.disabled) return;
  const rect = b.getBoundingClientRect();
  const r = document.createElement("span");
  r.className = "lm-ripple";
  r.style.left = `${e.clientX - rect.left}px`; r.style.top = `${e.clientY - rect.top}px`;
  b.appendChild(r); setTimeout(() => r.remove(), 650);
  if (b.classList.contains("lm")) { b.classList.add("lm-burst"); setTimeout(() => b.classList.remove("lm-burst"), 400); }
});

fetch("/api/summary").then((r) => r.json()).then((d) => {
  D = d;
  // shareable filters: /?domain=formal-methods, /?compute=cpu, /?open=1, /?q=lean
  { const qp = new URLSearchParams(location.search); for (const k of ["domain", "compute", "status", "tag", "q", "sort"]) if (qp.get(k)) state[k] = qp.get(k); if (qp.get("open")) state.open = true; if (qp.get("repo")) state.prefillRepo = qp.get("repo"); }
  // legacy query params → clean paths
  const q = new URLSearchParams(location.search);
  if (q.has("landing")) history.replaceState({}, "", "/landing");
  else if (q.has("app")) { try { localStorage.setItem(VISITED, "1"); } catch {} history.replaceState({}, "", location.pathname + location.hash); }
  const firstVisit = (() => { try { return localStorage.getItem(VISITED) !== "1"; } catch { return true; } })();
  if (firstVisit && location.pathname === "/") history.replaceState({}, "", "/landing");
  if (location.pathname !== "/landing") { try { localStorage.setItem(VISITED, "1"); } catch {} }
  // shareable easter egg: /#veni, /#vici, or /#plate-<name>
  const openHashEgg = () => { const h = location.hash.slice(1).toLowerCase(); if (h === "veni") showEgg("caesar"); else if (h === "vici") showEgg("horse"); else if (h.startsWith("plate-") && ART[h.slice(6)]) showEgg(h.slice(6)); };
  window.addEventListener("hashchange", openHashEgg); setTimeout(openHashEgg, 0);
  const records = d.competitions.reduce((s, c) => s + c.stats.totalRecords, 0);
  document.getElementById("footer-meta").innerHTML = `<span>${d.competitions.length} competitions</span><span>${records} records</span><span>crawled ${new Date(d.crawledAt).toISOString().slice(0, 10)}</span>`;
  route();
});
