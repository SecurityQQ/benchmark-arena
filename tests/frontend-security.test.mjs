import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createServer } from "node:http";

const source = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
const payload = `'");globalThis.pwned=true;//<x-security-probe data-x="'">&`;
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, key) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[key]);
const index = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const inlineHandler = /\son[a-z]+\s*=\s*["']/i;
function actions(html) {
  return [...html.matchAll(/<[^>]+\bdata-action=[^>]+>/g)].map(([tag]) => {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], decode(m[2] ?? m[3])]));
    const dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith("data-")).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
    if (/\sdata-stop(?:\s|>)/.test(tag)) dataset.stop = "";
    return { dataset, getAttribute: (key) => attrs[key] };
  });
}

function click(h, el) {
  const event = { target: { closest: (selector) => selector === "[data-action]" ? el : null }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  for (const fn of h.listeners.get("click")) fn(event);
  return event;
}

function harness({ querySelector = () => null, pathname = "/" } = {}) {
  const elements = new Map(), listeners = new Map(), appended = [];
  const element = () => ({ innerHTML: "", dataset: {}, querySelectorAll: () => [], focus() {} });
  const document = {
    querySelector,
    querySelectorAll: () => [],
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element,
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    body: { appendChild: (el) => appended.push(el) },
  };
  const context = vm.createContext({
    document, URLSearchParams, payload,
    window: { addEventListener() {} },
    location: { pathname, search: "", origin: "https://example.test" },
    localStorage: { getItem: () => null },
    fetch: () => new Promise(() => {}),
  });
  const run = (code) => vm.runInContext(code, context);
  run(source);
  return { context, run, elements, listeners, appended };
}

function fixture() {
  const record = { value: 1, date: payload, contributor: payload, contributorUrl: "javascript:alert(1)", description: payload, isCurrentBest: true, submissionUrls: ["data:text/html,bad"], agent: { family: "openai", confidence: payload, model: payload, tool: payload, role: "author" } };
  const problem = { id: payload, name: payload, description: payload, metricName: payload, metricDirection: payload, metricUnit: payload, baseline: 2, records: [record, { ...record, value: 2 }, { ...record, value: 3 }], isOpen: true };
  const stats = Object.fromEntries(["totalRecords", "uniqueParticipants", "recordsLast30d", "recordsLast90d", "lastSubmission", "firstSubmission"].map((key) => [key, payload]));
  const c = { id: payload, name: payload, tagline: payload, description: payload, status: payload, domain: payload, images: ["javascript:alert(1)"], tags: [payload], url: "javascript:alert(1)", stats, problems: [problem], participants: [], links: [{ label: "leaderboard", url: "data:text/html,bad" }], organizer: { name: payload, type: payload, url: "javascript:alert(1)" }, participation: { compute: payload, requirements: [payload] }, standard: { problem: true, submissions: payload }, agentDocs: [{ label: payload, url: "javascript:alert(1)" }] };
  const competition = { id: payload, name: payload, records: payload, bests: payload };
  const agent = { family: "openai", records: payload, currentBests: payload, uncontestedBests: payload, models: { [payload]: payload }, tools: { [payload]: payload }, competitions: [competition], contributors: [payload] };
  const person = { name: payload, url: `https://github.com/${payload}`, records: payload, currentBests: payload, competitions: [competition], agents: { openai: payload } };
  return { competitions: [c], people: [person], agents: [agent], evaluated: [agent], openProblems: [{ competitionId: payload, competitionName: payload, problemId: payload, problemName: payload, compute: payload, metricDirection: payload, metricName: payload }] };
}

function loadFixture(h) {
  h.context.fixture = fixture();
  h.run("D = fixture");
}

test("untrusted URL sinks reject active schemes and preserve allowed links", () => {
  const h = harness();
  for (const url of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "data:text/html,bad", "vbscript:msgbox(1)", "&#106;avascript:alert(1)"]) {
    h.context.url = url;
    assert.equal(h.run("safeUrl(url)"), "#");
    assert.match(h.run("ctaButtons({id: 'ok', url})"), /href="#"/);
    assert.match(h.run("ctaButtons({id: 'ok', links: [{label: 'leaderboard', url}]}, {}, {nested: true})"), /data-open="#"/);
    h.run("lightbox(url)");
    assert.equal(h.appended.at(-1).innerHTML, '<img src="#">');
  }
  for (const url of ["https://example.test/a?q=1&b=2", "http://example.test", "/c/ok", "#track", "mailto:a@example.test"]) {
    h.context.url = url;
    assert.equal(h.run("safeUrl(url)"), url);
  }
  h.context.url = `https://example.test/${payload}`;
  assert.ok(!h.run("ctaButtons({id: payload, url})").includes("<x-security-probe"));
  assert.match(h.run("AGENTS[0].url(payload)"), /^claude-cli:\/\/open\?q=/);
});

test("avatars accept only GitHub profile URLs, not attribute injection or lookalike hosts", () => {
  const h = harness();
  assert.match(h.run("avatar('https://github.com/octocat')"), /src="https:\/\/github.com\/octocat.png\?size=64"/);
  for (const url of [`https://github.com/${payload}`, "https://notgithub.com/octocat", "javascript:github.com/octocat"]) {
    h.context.url = url;
    assert.ok(!h.run("avatar(url)").includes("<img"));
  }
});

test("route IDs remain data in delegated navigation", () => {
  const h = harness();
  loadFixture(h);
  const html = h.run("personRow(D.people[0]) + openCard(D.openProblems[0])");
  h.run("nav = (path) => { globalThis.destination = path; return false; }");
  const routes = actions(html).filter((el) => el.getAttribute("href")?.startsWith("/c/"));
  assert.equal(routes.length, 2);
  for (const el of routes) {
    assert.equal(click(h, el).defaultPrevented, true);
    assert.equal(decodeURIComponent(h.context.destination.slice(3)), payload);
    assert.equal(h.context.pwned, undefined);
  }
  assert.ok(!html.includes("<x-security-probe"));
});

test("sidebar filter values are escaped data, never executable code", () => {
  const h = harness();
  loadFixture(h);
  h.run("renderSidebar(); goApp = (patch) => { globalThis.patch = patch; return false; }");
  const html = h.elements.get("sidebar").innerHTML;
  assert.ok(!html.includes("<x-security-probe"));
  for (const key of ["domain", "compute"]) {
    const el = actions(html).find((el) => el.dataset.filter === key);
    assert.ok(el);
    click(h, el);
    assert.equal(h.context.patch[key], payload);
    h.run(`state.${key} = payload`);
    click(h, el);
    assert.equal(h.context.patch[key], "");
    assert.equal(h.context.pwned, undefined);
  }
});

test("image fallback uses data, not an inline JavaScript string", () => {
  const h = harness();
  loadFixture(h);
  for (const expression of ["card(D.competitions[0])", "cardArt(D.competitions[0])"]) {
    const html = h.run(expression);
    assert.ok(!html.includes("onerror="));
    const seed = decode(/data-placeholder="([^"]*)"/.exec(html)[1]);
    assert.equal(seed, payload);
    const target = { matches: () => true, dataset: { placeholder: seed } };
    for (const listener of h.listeners.get("error")) listener({ target });
    assert.match(target.outerHTML, /^<svg /);
    assert.ok(!target.outerHTML.includes("<x-security-probe"));
    assert.equal(h.context.pwned, undefined);
  }
});

test("renderers escape metadata, dates, counts, confidence, and option values", () => {
  const h = harness();
  loadFixture(h);
  for (const expression of ["card(D.competitions[0])", "activityPanel(D.competitions[0])", "problemBlock(D.competitions[0].problems[0], true, D.competitions[0])", "agentsBar(D.agents)", "stdBadge(D.competitions[0])", "badgeBlock(D.competitions[0])"]) {
    const html = h.run(expression);
    assert.ok(!html.includes("<x-security-probe"), expression);
    assert.ok(!/href="(?:javascript|data):/.test(html), expression);
    assert.ok(!/data-dir="[^"]*"\);/.test(html), expression);
  }
  for (const expression of ["renderHome()", "renderAppHome()", "renderPeople()", "renderAgents()", "renderFamily('openai')", "renderDetail(payload)"]) {
    h.run(expression);
    const html = h.elements.get("app").innerHTML;
    assert.ok(!html.includes("<x-security-probe"), expression);
    assert.ok(!/href="(?:javascript|data):/.test(html), expression);
    assert.doesNotMatch(html, inlineHandler);
  }
});

test("fresh discoveries: registry text stays data, links go only to registry permalinks and our pages, counts follow the visitor's clock", () => {
  const h = harness();
  loadFixture(h);
  const day = new Date().toISOString().slice(0, 10), link = (n) => `https://palomar-registry.org/entry?id=PALOMAR-${day}-00000${n}&version=1`;
  const item = { source: "palomar", version: 1, title: payload, authors: [payload, "B", "C", "D"], date: day, at: new Date().toISOString(), subjects: [] };
  h.context.discoveries = {
    fetchedAt: payload, totals: { results: 9, projects: 9 }, partial: true, days: { [day]: 3, "2000-01-01": 99, [payload]: 5 },
    items: [
      { ...item, id: `PALOMAR-${day}-000001`, url: link(1) },
      { ...item, id: `PALOMAR-${day}-000002`, url: "javascript:alert(1)" },
      { ...item, id: `PALOMAR-${day}-000003`, url: `https://palomar-registry.org.evil.test/entry?id=PALOMAR-${day}-000003&version=1` },
      { ...item, id: "PALOMAR-2000-01-01-000001", date: "2000-01-01", url: "https://palomar-registry.org/entry?id=PALOMAR-2000-01-01-000001&version=1" },
    ],
  };
  h.run("D.discoveries = discoveries");
  const math = "renderTopic({ slug: 'math', name: 'Math', title: 'Math', h1: 'Math', about: 'About', pick: 'an open math challenge', domains: ['formal-methods'], discoveries: true })";
  for (const [expression, target] of [["renderHome()", true], [math, false]]) {
    h.run(expression);
    const band = h.elements.get("app").innerHTML.match(/<section class="band tight live-band" id="discoveries">[\s\S]*?<\/section>/)?.[0];
    assert.ok(band, expression);
    assert.match(band, /3\+ Lean-verified results registered in the last 7 days, 3 today\./);
    assert.equal((band.match(/<li>/g) || []).length, 1, "only the in-window item with a registry permalink");
    assert.ok(!band.includes("<x-security-probe") && band.includes("B, C et al."));
    const hrefs = [...band.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1]));
    assert.deepEqual(hrefs, [`https://palomar-registry.org/`, link(1), "https://palomar-registry.org/", ...(target ? ["/topics/math"] : [])], expression);
    assert.equal(h.context.pwned, undefined);
  }
  h.run("renderTopic({ slug: 'no-gpu', name: 'No GPU', title: 'No GPU', h1: 'No GPU', about: 'About', pick: 'an open challenge that needs no GPU', computes: ['cpu'] })");
  assert.ok(!h.elements.get("app").innerHTML.includes('id="discoveries"'));
  h.run("D.discoveries = { items: 'nope' }; renderHome()");
  assert.ok(!h.elements.get("app").innerHTML.includes('id="discoveries"'));
});

test("pulse: board text stays data, links go only to the live sources and our board pages, faces only for GitHub logins, two rows a board", () => {
  const h = harness();
  loadFixture(h);
  h.run("renderHome()");
  const now = new Date().toISOString();
  h.context.pulse = {
    at: now, sources: [],
    agentsNow: { total: payload, counts: [{ board: payload, boardName: payload, count: 5, fleet: 2, outside: 3, windowMinutes: 30 }] },
    activity: { lastHour: { count: 5, boards: 1, partial: false, by: [{ name: payload, count: 5, noun: payload }] }, last24h: { count: 9, boards: 1, partial: true, by: [] } },
    events: [
      { id: "1", at: now, kind: "headline", source: "pequalnp", board: payload, boardName: payload, text: payload, url: "javascript:alert(1)" },
      { id: "2", at: now, kind: "proof", source: "pequalnp", board: "b", boardName: "P = NP?", who: payload, text: payload, url: "https://pequalnp.com/lemma.html#L-meta-1" },
      { id: "3", at: payload, kind: "proof", source: "pequalnp", board: "b", who: "ada", text: "ok", url: "https://pequalnp.com.evil.test/" },
      { id: "4", at: now, kind: "submission", source: "pequalnp", board: "b", text: "a third row from one board", url: "https://pequalnp.com/" },
      { id: "5", at: now, kind: "record", source: "riemann", board: "rh", boardName: payload, agent: payload, text: payload, url: "https://play.bohrium.com/challenges/x" },
      { id: "6", at: now, kind: payload, source: "palomar", who: payload, text: payload, url: "https://palomar-registry.org/entry?id=x" },
    ],
  };
  h.run("PULSE.data = pulse; paintPulse()");
  const card = h.elements.get("pulse-card"), pill = h.elements.get("pulse-pill"), bar = h.elements.get("just-in");
  for (const el of [card, pill, bar]) {
    assert.equal(el.hidden, false);
    assert.ok(!el.innerHTML.includes("<x-security-probe"), el.innerHTML);
    assert.ok(!/href="(?:javascript|data):/.test(el.innerHTML));
  }
  const ours = `/c/${h.run("pathPart(payload)")}`;
  assert.deepEqual([...card.innerHTML.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1])),
    [ours, ours, "/c/b", "https://pequalnp.com/lemma.html#L-meta-1", "/c/b", "/c/b", "/c/rh", "https://play.bohrium.com/challenges/x", "https://palomar-registry.org/", "https://palomar-registry.org/entry?id=x", "/api/pulse.md"]);
  assert.ok(!card.innerHTML.includes("a third row from one board"), "at most two rows from one board");
  assert.deepEqual([...card.innerHTML.matchAll(/<img[^>]*src="([^"]*)"/g)].map((m) => m[1]), ["https://github.com/ada.png?size=48"]);
  assert.match(card.innerHTML, /<b>5<\/b> entries in the last hour · <b>9\+<\/b> in 24 h/);
  assert.match(card.innerHTML, /class="pc-agent" title="As the entry names it">with &#39;&quot;\);globalThis/);
  assert.match(pill.innerHTML, /<b class="pp-n">—<\/b>/);
  assert.deepEqual([...bar.innerHTML.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1])), [ours]);
  h.run("PULSE.fails = 2; paintPulse()");
  assert.match(card.innerHTML, /paused · retrying/);
  h.run("PULSE.data = null; paintPulse()");
  assert.ok(card.hidden && pill.hidden && bar.hidden);
  assert.equal(h.context.pwned, undefined);
});

test("just joined: names stay data, a face only for a GitHub login, links only to the boards' pages, each board's newest kept in view", () => {
  const h = harness();
  loadFixture(h);
  h.run("renderHome()");
  const now = Date.now(), at = (m) => new Date(now - m * 60000).toISOString();
  const filler = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, who: `Team ${i}`, at: at(10 + i), source: "pequalnp-people", board: "b", boardName: "P = NP?", url: "https://pequalnp.com/" }));
  h.context.pulse = {
    at: at(0), sources: [], agentsNow: null, events: [], activity: null,
    joined: { lastHour: 2, last24h: 290, partial: true, by: [{ name: payload, count: 3 }], people: [
      { id: "a", who: payload, login: payload, at: at(1), source: "pequalnp-people", board: "b", boardName: payload, first: payload, url: "javascript:alert(1)" },
      { id: "b", who: "@ada", login: "ada", at: at(2), source: "pequalnp-people", board: "b", boardName: "P = NP?", url: "https://pequalnp.com/a/ada" },
      ...filler,
      { id: "z", who: "Arnav Raj", at: at(500), source: "looped-lens", board: "l", boardName: "Looped Lens", url: "https://ndif-looped-lens-challenge.hf.space/" },
    ] },
  };
  h.run("PULSE.data = pulse; paintJoiners(pulse)");
  const box = h.elements.get("joiners"), html = box.innerHTML;
  assert.equal(box.hidden, false);
  assert.ok(!html.includes("<x-security-probe") && !/href="(?:javascript|data):/.test(html));
  const hrefs = [...html.matchAll(/class="jn-chip[^"]*"[^>]*href="([^"]*)"/g)].map((m) => decode(m[1]));
  assert.equal(hrefs.length, 24);
  assert.deepEqual([hrefs[0], hrefs[1], hrefs.at(-1)], ["/c/b", "https://pequalnp.com/a/ada", "https://ndif-looped-lens-challenge.hf.space/"], "the oldest board's newest joiner stays in view, last");
  assert.deepEqual([...html.matchAll(/<img[^>]*src="([^"]*)"/g)].map((m) => m[1]), ["https://github.com/ada.png?size=48"]);
  assert.match(html, /<span class="jn-face jn-mono" style="--c:#[0-9A-F]{6}" aria-hidden="true">AR<\/span>/);
  assert.match(html, /<b>290\+<\/b> people made their first entry in the last 24 h/);
  const again = box.innerHTML;
  h.run("paintJoiners(pulse)");
  assert.equal(box.innerHTML, again, "the same people: the strip is not drawn again");
  h.run("PULSE.data = null; paintPulse()");
  assert.ok(box.hidden);
  assert.equal(h.context.pwned, undefined);
});

test("most active: names stay data, three rows a board on all boards, a board's own five on its chip, links only to the boards' pages, the invitation last", () => {
  const h = harness();
  loadFixture(h);
  h.run("renderHome()");
  const now = Date.now(), at = (m) => new Date(now - m * 60000).toISOString();
  const row = (who, board, count, extra = {}) => ({ who, url: "https://pequalnp.com/a/x", source: "pequalnp", board, boardName: board, noun: "proofs", count, rank: 1, last: at(5), spark: [0, 1, 2], ...extra });
  h.context.pulse = {
    at: at(0), sources: [], agentsNow: null, events: [], activity: null, joined: null,
    leaders: { active: { hour: 12, day: 40, week: 90 }, rows: {
      hour: [row(payload, "pnp", 9, { login: payload, url: "javascript:alert(1)", move: 2 }), row("@b", "pnp", 8, { login: "b" }), row("@c", "pnp", 7), row("@d", "pnp", 6), row("Andrew Pullin", "rh", 5, { source: "riemann", noun: payload, url: "https://riemann.verifytask.cn/" })],
      day: [row("@day", "pnp", 50)], week: [],
    } },
  };
  h.run("PULSE.data = pulse; paintLeaders(pulse)");
  const sec = h.elements.get("leaders"), html = sec.innerHTML;
  assert.equal(sec.hidden, false);
  assert.ok(!html.includes("<x-security-probe") && !/href="(?:javascript|data):/.test(html));
  const names = [...html.matchAll(/class="lb-name"[^>]*>([^<]*)</g)].map((m) => decode(m[1]));
  assert.deepEqual(names, [payload, "@b", "@c", "Andrew Pullin", "Your agent here"], "at most three from one board, then the invitation");
  const hrefs = [...html.matchAll(/<a class="lb-name" href="([^"]*)"/g)].map((m) => decode(m[1]));
  assert.deepEqual(hrefs, ["/c/pnp", "https://pequalnp.com/a/x", "https://pequalnp.com/a/x", "https://riemann.verifytask.cn/"]);
  assert.deepEqual([...html.matchAll(/<img[^>]*src="([^"]*)"/g)].map((m) => m[1]), ["https://github.com/b.png?size=56"]);
  assert.match(html, /<span class="lb-move up" title="Up 2 on this board since an hour ago">▲2<\/span>/);
  assert.match(html, /12 people and teams made entries in the last hour/);
  assert.match(html, /data-action="copy-join" data-comp-id="">copy<\/button><code>Fetch and follow the instructions at https:\/\/openchallengelist\.com\/join\.txt/);
  h.run("LB.board = 'pnp'; paintLeaders(pulse)");
  assert.deepEqual([...sec.innerHTML.matchAll(/class="lb-name"[^>]*>([^<]*)</g)].map((m) => decode(m[1])), [payload, "@b", "@c", "@d", "Your agent here"], "a board's chip shows its own rows");
  h.run("LB.board = ''; LB.window = 'day'; paintLeaders(pulse)");
  assert.match(sec.innerHTML, /40 people and teams made entries in the last 24 hours/);
  h.run("LB.window = ''; pulse.leaders.rows = { hour: [], day: [], week: [] }; paintLeaders(pulse)");
  assert.equal(sec.hidden, true);
  assert.equal(h.context.pwned, undefined);
});

test("static and dynamic sources contain no executable inline handlers or code compilation", () => {
  assert.doesNotMatch(source, inlineHandler);
  assert.doesNotMatch(index, inlineHandler);
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/);
  assert.doesNotMatch(source, /set(?:Timeout|Interval)\s*\(\s*["'`]/);
  assert.doesNotMatch(index, /<script(?![^>]*(?:\bsrc=|type="application\/ld\+json"))[^>]*>/i);
});

test("delegation preserves cancellation, explicit stopPropagation and action arguments", () => {
  const h = harness();
  loadFixture(h);
  h.run(`globalThis.calls = []; nav = (...args) => calls.push(['nav', ...args]);
    goApp = (...args) => calls.push(['app', ...args]); goCatalog = (...args) => calls.push(['catalog', ...args]);
    enterApp = () => calls.push(['enter']); showLanding = () => calls.push(['landing']);
    focusSearch = () => calls.push(['search']); toggleNav = (...args) => calls.push(['toggle', ...args]);
    goSection = (...args) => calls.push(['section', ...args]); gotoTrack = (...args) => calls.push(['track', ...args]);
    copyText = () => calls.push(['copy']); lightbox = (...args) => calls.push(['lightbox', ...args]);`);
  const stopped = click(h, actions(h.run("famChip('openai')"))[0]);
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.defaultPrevented, true);
  assert.equal(click(h, actions(h.run("stdBadge(D.competitions[0])"))[0]).stopped, true);
  for (const [action, expected] of [["enter", "enter"], ["landing", "landing"], ["search", "search"]]) {
    assert.equal(click(h, { dataset: { action } }).defaultPrevented, true);
    assert.equal(h.context.calls.at(-1)[0], expected);
  }
  for (const action of ["app", "catalog"]) {
    click(h, { dataset: { action, patch: JSON.stringify({ open: true, q: payload }) } });
    assert.deepEqual(JSON.parse(JSON.stringify(h.context.calls.at(-1))), [action, { open: true, q: payload }]);
  }
  click(h, { dataset: { action: "home-section", section: "open" } });
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.calls.slice(-2))), [["nav", "/"], ["section", "open"]]);
  for (const action of ["track", "section"]) {
    assert.equal(click(h, { dataset: { action, [action]: payload } }).defaultPrevented, true);
    assert.equal(h.context.calls.at(-1)[1], payload);
  }
  click(h, { dataset: { action: "close-nav" } });
  assert.equal(h.context.calls.at(-1)[1], false);
  click(h, { dataset: { action: "toggle-nav" } });
  assert.equal(h.context.calls.at(-1).length, 1);
  click(h, { dataset: { action: "copy" } });
  assert.equal(h.context.calls.at(-1)[0], "copy");
  click(h, { dataset: { action: "lightbox" }, src: "https://example.test/a.png" });
  assert.equal(h.context.calls.at(-1)[1], "https://example.test/a.png");
  const count = h.context.calls.length;
  click(h, { dataset: { action: payload } });
  assert.equal(h.context.calls.length, count);
  assert.equal(h.context.pwned, undefined);
});

test("board page: the organizer's README badge, its snippet with a copy button, the id kept as data", () => {
  const h = harness();
  loadFixture(h);
  h.run("D.competitions.push({ ...D.competitions[0], id: 'duckbench' }); renderDetail('duckbench')");
  const html = h.elements.get("app").innerHTML;
  assert.ok(html.includes("For the organizer"));
  assert.ok(html.includes('<img src="/badge/c/duckbench.svg" alt="Open Challenge List badge" height="20" loading="lazy" data-error="remove">'));
  assert.ok(html.includes("<code>[![Open Challenge List](https://openchallengelist.com/badge/c/duckbench.svg)](https://openchallengelist.com/c/duckbench)</code>"));
  // the id goes into URLs percent-encoded and into the attribute escaped; copying sends one analytics event with it
  const hostile = h.run("badgeBlock(D.competitions[0])");
  assert.ok(!hostile.includes(payload) && hostile.includes(`/badge/c/${encodeURIComponent(payload).replace(/'/g, "%27")}.svg`));
  h.run("globalThis.calls = []; copyText = () => calls.push(['copy']); window.gtag = (...args) => calls.push(args)");
  click(h, actions(hostile).find((el) => el.dataset.action === "copy-badge"));
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.calls)), [["copy"], ["event", "copy_badge", { competition: payload }]]);
  assert.equal(h.context.pwned, undefined);
});

test("external error listener hides avatars and removes failed gallery images", () => {
  const h = harness();
  for (const action of ["hide", "remove"]) {
    const target = { style: {}, matches: (selector) => selector === `img[data-error='${action}']`, remove() { this.removed = true; } };
    for (const fn of h.listeners.get("error")) fn({ target });
    if (action === "hide") assert.equal(target.style.visibility, "hidden");
    else assert.equal(target.removed, true);
  }
});

test("numeric formatting does not return markup or throw for numeric strings", () => {
  const h = harness();
  assert.equal(h.run("fmt(payload)"), "\u2014");
  assert.equal(h.run("fmt('12.5')"), "12.5");
  assert.equal(h.run("fmt(1234)"), h.run("(1234).toLocaleString()"));
});

test("client-side routes keep the social image in step: the server page's own card, another route's card, or /og.jpg", () => {
  // the head as the build renders /c/a: its card with a version, and the card in words
  const head = new Map(Object.entries({ "og:image": "https://openchallengelist.com/og/c/a.png?v=0123456789", "og:image:secure_url": "https://openchallengelist.com/og/c/a.png?v=0123456789",
    "og:image:type": "image/png", "og:image:alt": "A. 3 entries in 30 days. openchallengelist.com.", "twitter:image": "https://openchallengelist.com/og/c/a.png?v=0123456789",
    "twitter:image:alt": "A. 3 entries in 30 days. openchallengelist.com.", description: "", "og:description": "", "twitter:description": "", "og:url": "", "og:title": "", "twitter:title": "" }));
  const tag = (key) => ({ getAttribute: () => head.get(key), setAttribute: (_, value) => head.set(key, value) });
  const querySelector = (sel) => { const key = sel.match(/meta\[(?:property|name)="([^"]+)"\]/)?.[1]; return key && head.has(key) ? tag(key) : null; };
  const h = harness({ querySelector, pathname: "/c/a" });
  h.run(`D = { competitions: [{ id: "a", name: "A", tagline: "Ends with a stop.", problems: [], stats: { totalRecords: 0 } }, { id: "b", name: "B", tagline: "B", problems: [], stats: { totalRecords: 0 } }], topics: [{ slug: "math", about: "Math" }] }`);
  h.context.document.title = "B — Open Challenge List";
  const visit = (path) => { h.context.location.pathname = path; h.run("syncMeta()"); return Object.fromEntries(["og:image", "og:image:secure_url", "twitter:image", "og:image:type", "og:image:alt", "twitter:image:alt"].map((k) => [k, head.get(k)])); };
  const own = visit("/c/a");
  assert.equal(own["og:image"], "https://openchallengelist.com/og/c/a.png?v=0123456789");
  assert.equal(own["og:image:alt"], "A. 3 entries in 30 days. openchallengelist.com.");
  assert.match(head.get("description"), /^Ends with a stop\. 0 tracks/, "one full stop after a tagline that has one");
  const other = visit("/c/b");
  assert.deepEqual([other["og:image"], other["og:image:secure_url"], other["twitter:image"], other["og:image:type"], other["og:image:alt"], other["twitter:image:alt"]],
    ["https://openchallengelist.com/og/c/b.png", "https://openchallengelist.com/og/c/b.png", "https://openchallengelist.com/og/c/b.png", "image/png", "B — Open Challenge List", "B — Open Challenge List"]);
  assert.equal(visit("/topics/math")["og:image"], "https://openchallengelist.com/og/topics/math.png");
  assert.equal(visit("/landing")["og:image"], "https://openchallengelist.com/og/home.png");
  assert.deepEqual([visit("/agents")["og:image"], head.get("og:image:type")], ["https://openchallengelist.com/og.jpg", "image/jpeg"]);
  assert.deepEqual([visit("/c/missing")["og:image"], visit("/c/a")["og:image"]], ["https://openchallengelist.com/og.jpg", "https://openchallengelist.com/og/c/a.png?v=0123456789"]);
});

// Optional: point at an already-installed Playwright module/browser. No downloads.
test("browser smoke: desktop and mobile interactions under the actual strict CSP", { skip: !process.env.FRONTEND_PLAYWRIGHT, timeout: 90000 }, async (t) => {
  const { chromium } = await import(process.env.FRONTEND_PLAYWRIGHT);
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /script-src 'self' https:\/\/www\.googletagmanager\.com;/);
  const data = fixture(), c = data.competitions[0];
  data.crawledAt = "2026-09-18T00:00:00Z";
  Object.assign(c, { id: "demo", name: "Demo", status: "active", domain: "cybersecurity", url: "https://example.test/repo", images: ["/demo.svg"], repo: { owner: "owner", name: "repo" }, quickstart: "echo safe", agentStats: [{ family: "openai", records: 3, currentBests: 1, models: ["model"] }] });
  c.participation.compute = "cpu";
  c.stats = { totalRecords: 3, uniqueParticipants: 1, recordsLast30d: 3, recordsLast90d: 3, lastSubmission: "2026-09-17", firstSubmission: "2026-09-01" };
  Object.assign(c.problems[0], { id: "one", name: "Track One", metricDirection: "minimize" });
  c.problems[0].records.forEach((r, i) => { r.date = `2026-09-0${i + 1}`; });
  c.problems.push({ ...c.problems[0], id: "two", name: "Track Two", isOpen: false });
  data.openProblems.forEach((o) => Object.assign(o, { competitionId: "demo", problemId: "one" }));
  data.people[0].url = "https://github.com/octocat";
  data.people[0].competitions[0].id = "demo";
  data.agents[0].competitions[0].id = "demo";
  const css = readFileSync(new URL("../site/style.css", import.meta.url));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>';
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const [type, body] = path === "/app.js" ? ["text/javascript", source]
      : path === "/analytics.js" ? ["text/javascript", readFileSync(new URL("../site/analytics.js", import.meta.url))]
      : path === "/style.css" ? ["text/css", css]
      : path === "/api/summary" ? ["application/json", JSON.stringify(data)]
      : path === "/standard/templates.json" ? ["application/json", JSON.stringify({ "PROBLEM.md": "spec: problem.md/v1", "SUBMISSION.md": "spec: submission.md/v1" })]
      : /\.(svg|jpg|png)$/.test(path) ? ["image/svg+xml", svg] : ["text/html", index];
    res.writeHead(200, { "Content-Type": type, "Content-Security-Policy": csp }); res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.FRONTEND_CHROMIUM ? { executablePath: process.env.FRONTEND_CHROMIUM } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.route("https://**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("https://fonts.googleapis.com")) return route.fulfill({ contentType: "text/css", body: "" });
    if (url.startsWith("https://github.com/")) return route.fulfill({ contentType: "image/svg+xml", body: svg });
    return route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
  });
  await context.addInitScript(() => {
    window.cspViolations = []; window.opened = []; window.copied = []; window.navCalls = [];
    document.addEventListener("securitypolicyviolation", (e) => window.cspViolations.push(e.violatedDirective));
    window.open = (...args) => { window.opened.push(args); return null; };
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text) => { window.copied.push(text); } } });
    const push = history.pushState.bind(history);
    history.pushState = (...args) => { window.navCalls.push(args[2]); return push(...args); };
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(8000);
  const check = async () => {
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    assert.equal(await page.locator("*").evaluateAll((els) => els.some((el) => [...el.attributes].some((a) => /^on/i.test(a.name)))), false);
    assert.equal(await page.locator("x-security-probe").count(), 0);
    assert.deepEqual(errors, []);
  };
  await page.goto(origin);
  await page.locator(".open-card").waitFor();
  await page.locator(".open-card [data-open]").click();
  assert.equal(await page.evaluate(() => window.opened.length), 1);
  assert.equal(new URL(page.url()).pathname, "/landing");
  await page.locator(".open-card [data-ask-menu]").click();
  await page.locator('.ask-menu [data-ask="copy"]').click();
  assert.equal(new URL(page.url()).pathname, "/landing");
  assert.equal(await page.evaluate(() => window.copied.length), 1);
  await page.locator('.hero [data-action="enter"]').click();
  assert.equal(await page.locator("body").getAttribute("class"), "app");
  await page.locator('.sb-item[data-filter="compute"]').click();
  assert.equal(await page.locator("#f-compute").inputValue(), "cpu");
  await page.locator('.sb-item[data-filter="compute"]').click();
  assert.equal(await page.locator("#f-compute").inputValue(), "");
  await page.locator('.sb-item[data-filter="domain"]').click();
  await page.locator('.ah-active .chip.on').click();
  assert.equal(await page.locator("#f-domain").inputValue(), "");
  const before = await page.evaluate(() => window.navCalls.length);
  await page.locator(".card .fam").click();
  assert.equal(new URL(page.url()).pathname, "/agents/openai");
  assert.equal(await page.evaluate(() => window.navCalls.length), before + 1);
  await page.locator('.fam-comp-head a').click();
  assert.equal(new URL(page.url()).pathname, "/c/demo");
  await page.locator('[data-track="track-two"]').click();
  assert.match(await page.locator("#track-two").getAttribute("class"), /\bopen\b/);
  await page.locator("#track-two .problem-head").click();
  assert.doesNotMatch(await page.locator("#track-two").getAttribute("class"), /\bopen\b/);
  await page.locator(".gallery img").click();
  await page.locator(".lightbox").waitFor();
  await page.locator(".lightbox").click();
  assert.equal(await page.locator(".lightbox").count(), 0);
  await page.locator(".byhand summary").click();
  await page.locator('[data-action="copy"]').click();
  assert.equal(await page.evaluate(() => window.copied.at(-1)), "echo safe");
  await page.locator(".gallery img").dispatchEvent("error");
  assert.equal(await page.locator(".gallery img").count(), 0);
  await page.locator('.sb-item[href="/"][data-action="app"]').first().click();
  await page.locator(".card-img img").dispatchEvent("error");
  assert.equal(await page.locator(".card-img svg.placeholder").count(), 1);
  assert.equal(await page.locator(".card .std-badge span").textContent(), "problem.md/v1", "the badge names the spec and its version");
  await page.locator(".card .std-badge").click();
  assert.equal(new URL(page.url()).pathname, "/standard");
  await page.locator('[data-copy="PROBLEM.md"]').click();
  assert.equal(await page.evaluate(() => window.copied.at(-1)), "spec: problem.md/v1");
  await page.locator("#std-repo").fill("other/newrepo");
  await page.locator('#std-form button[type="submit"]').click();
  await page.locator('#std-state a[href^="/submit?repo="]').click();
  assert.equal(await page.locator("#sf-repo").inputValue(), "other/newrepo");
  await page.locator("#sf-repo").fill("owner/repo");
  await page.locator('#sf-state a[href="/c/demo"]').click();
  assert.equal(new URL(page.url()).pathname, "/c/demo");
  await page.locator('.sb-item[href="/people"]').click();
  await page.locator(".person .avatar").dispatchEvent("error");
  assert.equal(await page.locator(".person .avatar").evaluate((el) => el.style.visibility), "hidden");
  await check();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.tb-toggle').click();
  assert.match(await page.locator("body").getAttribute("class"), /nav-open/);
  await page.locator('#sidebar-scrim').click({ position: { x: 380, y: 400 } });
  assert.doesNotMatch(await page.locator("body").getAttribute("class"), /nav-open/);
  await page.locator('.tb-toggle').click();
  await page.locator('.sb-collapse').click();
  assert.doesNotMatch(await page.locator("body").getAttribute("class"), /nav-open/);
  await page.locator('.tb-toggle').click();
  await page.locator('.sb-item[data-action="landing"]').click();
  assert.equal(new URL(page.url()).pathname, "/landing");
  await page.locator('.footer-cols [data-action="home-section"]').click();
  assert.equal(new URL(page.url()).pathname, "/");
  await check();
});

// <img src="*.svg"> renders nothing for malformed XML, even though the file is served fine
test("every published SVG is a complete document", () => {
  const build = readFileSync(new URL("../src/build.ts", import.meta.url), "utf8");
  const names = ["favicon.svg", ...[...build.matchAll(/"([^"]+)"\.split\(" "\)\.map\(\(n\) => `icons\/\$\{n\}\.svg`\)/g)].flatMap((m) => m[1].split(" ").map((n) => `icons/${n}.svg`))];
  assert.ok(names.length > 10);
  for (const name of names) {
    const svg = readFileSync(new URL(`../site/${name}`, import.meta.url), "utf8").trim();
    assert.match(svg, /^(<\?xml[^>]*\?>\s*)?<svg[\s>]/, name);
    assert.match(svg, /<\/svg>$/, name);
    assert.equal((svg.match(/<svg[\s>]/g) || []).length, (svg.match(/<\/svg>/g) || []).length, name);
  }
});
