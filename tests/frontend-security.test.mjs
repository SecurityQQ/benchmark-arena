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

function harness() {
  const elements = new Map(), listeners = new Map(), appended = [];
  const element = () => ({ innerHTML: "", dataset: {}, querySelectorAll: () => [], focus() {} });
  const document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element,
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    body: { appendChild: (el) => appended.push(el) },
  };
  const context = vm.createContext({
    document, URLSearchParams, payload,
    window: { addEventListener() {} },
    location: { pathname: "/", search: "", origin: "https://example.test" },
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
  const c = { id: payload, name: payload, tagline: payload, description: payload, status: payload, domain: payload, images: ["javascript:alert(1)"], tags: [payload], url: "javascript:alert(1)", stats, problems: [problem], participants: [], links: [{ label: "leaderboard", url: "data:text/html,bad" }], organizer: { name: payload, type: payload, url: "javascript:alert(1)" }, participation: { compute: payload, requirements: [payload] }, standard: { problem: true, submissions: payload } };
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
  for (const expression of ["card(D.competitions[0])", "activityPanel(D.competitions[0])", "problemBlock(D.competitions[0].problems[0], true, D.competitions[0])", "agentsBar(D.agents)", "stdBadge(D.competitions[0])"]) {
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

// Optional: point at an already-installed Playwright module/browser. No downloads.
test("browser smoke: desktop and mobile interactions under the actual strict CSP", { skip: !process.env.FRONTEND_PLAYWRIGHT, timeout: 90000 }, async (t) => {
  const { chromium } = await import(process.env.FRONTEND_PLAYWRIGHT);
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /script-src 'self' https:\/\/www\.googletagmanager\.com;/);
  const data = fixture(), c = data.competitions[0];
  data.crawledAt = "2026-09-18T00:00:00Z";
  Object.assign(c, { id: "demo", name: "Demo", status: "active", domain: "security", url: "https://example.test/repo", images: ["/demo.svg"], repo: { owner: "owner", name: "repo" }, quickstart: "echo safe", agentStats: [{ family: "openai", records: 3, currentBests: 1, models: ["model"] }] });
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
