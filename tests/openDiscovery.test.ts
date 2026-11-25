import assert from "node:assert/strict";
import { test } from "node:test";
import { agentOf, buildOpenDiscovery, declaredModel, seasonsToShow, seasonToProblem, str, USER_AGENT } from "../src/structured/openDiscovery.js";
import { postprocess } from "../src/postprocess.js";

const site = { site: "open-discovery-challenge", url: "https://huggingface.co/spaces/FINAL-Bench/open-discovery-challenge" };

const season3 = {
  number: 3, name: "Open Discovery Challenge", topic: "Chagas disease", topic_ko: "샤가스병", organism: "Trypanosoma cruzi",
  target: "T. cruzi CYP51", counter_target: "human CYP51A1", closes: "2026-11-30", prize_usd: 1000,
  weights: { activity: 10, binding: 30, selectivity: 30, admet: 15, novelty: 10, synthesis: 5 },
  open: true, limits: { mw_max: 750.0, heavy_max: 55 }, accepting: true,
};
const season4 = { ...season3, number: 4, topic: "Non-opioid analgesia", organism: "Homo sapiens", target: "Nav1.7 (VSD4)", counter_target: "hERG (pore tetramer)", closes: "2027-01-31", limits: { mw_max: 600.0, heavy_max: 45 } };
const season1 = { ...season3, number: 1, topic: "Malaria", organism: "Plasmodium falciparum", target: "PfDHODH", counter_target: "human DHODH", closes: "2026-09-30", accepting: false };
const season2 = { ...season1, number: 2, topic: "Tuberculosis", target: "InhA", closes: "2026-11-07", prize_usd: 2000 };
const seasons = [season1, season2, season3, season4, { name: "no number", accepting: true }];

const axes = { activity: 4.169, binding: 29.936, selectivity: 29.936, admet: 4.322, novelty: 9.494, synthesis: 3.189 };
const entries3 = [
  // the board's leader: no declared model, so no attribution; the structure is private and never read
  { candidate_id: "ODC-F83F19", hf_user: "topabaem", display_name: "topabaem", model_name: "Mythos5.2", total: 81.045, rank: 1, tier: 1, visibility: "private", smiles: null, smiles_masked: "NC[C@H]··········)cc1F", axes, submitted_at: 1795406478, scored_at: 1795479169, relegate_reason: [] },
  { candidate_id: "ODC-5B80CF", hf_user: "Ku-ku", display_name: "KK-C-0829-809", model_name: "Claude-Opus", total: 80.296, rank: 2, tier: 1, visibility: "private", smiles: null, smiles_masked: "NC[C@H]··········)cc1F", axes, submitted_at: 1787990326, relegate_reason: [] },
  { candidate_id: "ODC-OLDER", hf_user: "Ku-ku", display_name: "KK-C-0828-101", model_name: "Claude-Opus", total: 70.1, rank: 300, tier: 1, visibility: "public", axes, submitted_at: 1787900000, relegate_reason: [] },
  // a higher score than its account's ranked best, but the board gives a relegated/duplicate entry no rank: not a record
  { candidate_id: "ODC-DUPE", hf_user: "Ku-ku", display_name: "KK-C-0829-810", model_name: "Claude-Opus", total: 80.9, rank: null, tier: 2, visibility: "private", axes, submitted_at: 1787990400, relegate_reason: ["중복 제출 - 같은 구조는 첫 제출만 순위에 든다"] },
  { candidate_id: "ODC-E27503", hf_user: "1Dmeds", display_name: "ODC26-S3-R148-15", model_name: "OpenAI Codex / gpt-6-astra", total: 80.189, rank: 4, tier: 1, visibility: "private", axes, submitted_at: 1787927225, relegate_reason: [] },
  { candidate_id: "ODC-UNSPEC", hf_user: "healing5120", display_name: "healing5120", model_name: "미기재 / unspecified", total: 72.716, rank: 73, tier: 1, visibility: "private", axes, submitted_at: 1793319511, relegate_reason: [] },
  { candidate_id: "ODC-SELF", hf_user: "Bio-JS", display_name: "0907-S3-24", model_name: "Bio-JS", total: 70.0, rank: 120, tier: 1, visibility: "private", axes, submitted_at: 1787000000, relegate_reason: [] },
  { candidate_id: "posaconazole", is_anchor: true, display_name: "기준물질", model_name: "", total: 36.144, note: "아졸", note_en: "azole, established in vitro activity against T. cruzi", tier: 1, axes: { activity: 3.417, binding: 19.083, selectivity: 3.069, admet: 3.269, novelty: 5.898, synthesis: 1.408 } },
  { candidate_id: "fluconazole", is_anchor: true, display_name: "기준물질", model_name: "", total: 18.577, note_en: "azole, weak against T. cruzi", tier: 1, axes: {} },
  { candidate_id: "caffeine", is_anchor: true, display_name: "기준물질", model_name: "", total: 0.081, note_en: "control compound", tier: 1, axes: {} },
  // dropped: an unusable handle, a score that is not a number
  { candidate_id: "ODC-BAD1", hf_user: "../../etc/passwd", display_name: "x", model_name: "Claude Opus 5", total: 99.9, rank: 2, tier: 1, axes, submitted_at: 1787990326 },
  { candidate_id: "ODC-BAD2", hf_user: "fine-handle", display_name: "x", model_name: "Claude Opus 5", total: "high", rank: 3, tier: 1, axes, submitted_at: 1787990326 },
];
const entries4 = [
  { candidate_id: "ODC-1B8E4D", hf_user: "Bio-JS", display_name: "0922-S4-22", model_name: "", total: 83.319, rank: 1, tier: 1, visibility: "private", axes, submitted_at: 1790035565, relegate_reason: [] },
  { candidate_id: "ODC-D9336A", hf_user: "Ku-ku", display_name: "KK", model_name: "Claude Opus 5 + Codex", total: 81.907, rank: 14, tier: 1, visibility: "private", axes, submitted_at: 1789610000, relegate_reason: [] },
  { candidate_id: "PF-05089771", is_anchor: true, display_name: "기준물질", model_name: "", total: 29.725, note_en: "selective Nav1.7 arylsulfonamide, reached clinical trials", tier: 1, axes: {} },
];
const boards: Record<string, unknown> = {
  "1": { season: 1, entries: [{ candidate_id: "ODC-S1", hf_user: "winner1", display_name: "w", model_name: "Claude Fable 5", total: 84.723, rank: 1, tier: 1, axes, submitted_at: 1789472940 }], counts: { scored: 1, anchors: 0 } },
  "2": { season: 2, entries: [{ candidate_id: "ODC-S2", hf_user: "Sunghokim", display_name: "sungho_kim", model_name: "claude", total: 88.106, rank: 1, tier: 1, axes, submitted_at: 1794125218 }], counts: { scored: 1, anchors: 0 } },
  "3": { season: 3, entries: entries3, counts: { scored: 5856, anchors: 8 } },
  "4": { season: 4, entries: entries4, counts: { scored: 4965, anchors: 3 } },
};

function mockApi(t: any, override?: (url: string) => Response | undefined, list = seasons) {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    assert.equal(new Headers(init?.headers).get("user-agent"), USER_AGENT, "the crawler says who is asking");
    const o = override?.(url); if (o) return o;
    if (url.endsWith("/api/seasons")) return Response.json({ seasons: list, default: 1 });
    if (url.endsWith("/api/totals")) return Response.json({ submissions: 26182, participants: 145, opened_at: 1786753044, days: 102.4 });
    const m = url.match(/\/api\/leaderboard\?season=(\d+)$/);
    if (m && boards[m[1]]) return Response.json(boards[m[1]]);
    return Response.json({ detail: "not found" }, { status: 404 });
  });
  return calls;
}

test("a declared model is read as the dataset writes model names; a handle, a pipeline or \"unspecified\" names none", () => {
  assert.equal(declaredModel("Claude-Opus"), "Claude Opus");
  assert.equal(declaredModel("claude opus5"), "Claude Opus 5");
  assert.equal(declaredModel("anthropic/claude-opus-5"), "Claude Opus 5");
  assert.equal(declaredModel("Opus 5.5 judge · Luna Gemini Sonnet round 6"), "Claude Opus 5.5");
  assert.equal(declaredModel("claude-fable-5 (W2 ADMET-floor repair)"), "Claude Fable 5");
  assert.equal(declaredModel("Agentlas(opus 5.6)"), "Claude Opus 5.6");
  assert.equal(declaredModel("gpt-6-astra / Hermes + RDKit"), "GPT-6 Astra");
  assert.equal(declaredModel("OpenAI GPT-5.6 Codex — active-learning map"), "GPT-5.6 Codex");
  assert.equal(declaredModel("Agentlas(Qwen3:30B)"), "Qwen3");
  assert.equal(declaredModel("GLM-5.3"), "GLM-5.3");
  assert.equal(declaredModel("Gemini 3.8"), "Gemini 3.8");
  assert.equal(declaredModel("azure/gpt41mini-mva"), undefined, "a number glued to letters is not a version this builder reads");
  assert.equal(declaredModel("claude"), undefined, "a family on its own is not a model");
  assert.equal(declaredModel("Claude Code"), undefined, "a coding tool is not a model");
  assert.equal(declaredModel("mary 8b"), undefined);
  assert.equal(declaredModel("SAR factorial (no docking)"), undefined);
  assert.equal(declaredModel("Magnopus"), undefined, "a word that merely contains a model name is not one");

  assert.deepEqual(agentOf("Claude Opus 5", "season 3 leaderboard"), {
    family: "anthropic", model: "Claude Opus 5", confidence: "high", role: "author",
    evidence: "open-discovery-challenge season 3 leaderboard: model_name \"Claude Opus 5\" (typed by the entrant, self-reported)",
  });
  assert.deepEqual({ ...agentOf("Codex + SOMANG / RDKit 2026.03.5", "e"), evidence: undefined }, { family: "openai", tool: "Codex", evidence: undefined, confidence: "high", role: "author" });
  assert.deepEqual({ ...agentOf("azure/gpt41mini-mva", "e"), evidence: undefined }, { family: "openai", evidence: undefined, confidence: "medium", role: "author" }, "the company is named, the model is not");
  assert.equal(agentOf("<script>alert(1)</script> Claude Opus 5", "e")!.evidence!.includes("<"), false, "the declared text is quoted back as data, never as markup");
  assert.equal(agentOf("미기재 / unspecified", "e"), undefined);
  assert.equal(agentOf("", "e"), undefined);
  assert.equal(agentOf("-", "e"), undefined);
  assert.equal(agentOf("by hand", "e"), undefined);
  assert.equal(agentOf("1Dmeds", "e"), undefined, "an account handle in the model box is not an agent");
  assert.equal(agentOf("Ox Alpha", "e"), undefined);
  assert.equal(agentOf("ensemble", "e"), undefined);
  assert.equal(agentOf({ model: "Claude Opus 5" }, "e"), undefined, "only a string is read");
  assert.equal(str("a\u0000b‮ c", 80), "a b c", "control and bidi characters are dropped");
});

test("tracks are the seasons still taking entries; when none is, the one that closed last", () => {
  const open = seasonsToShow(seasons as any);
  assert.deepEqual(open.seasons.map((s) => s.number), [3, 4]);
  assert.equal(open.accepting, true);
  const none = seasonsToShow([season1, season2] as any);
  assert.deepEqual(none.seasons.map((s) => s.number), [2], "season 2 closed after season 1");
  assert.equal(none.accepting, false);
  assert.deepEqual(seasonsToShow([] as any).seasons, []);
});

test("a season becomes one track: each account's best ranked entry over the reference compounds", () => {
  const p = seasonToProblem(season3 as any, entries3 as any, true);
  assert.equal(p.id, "season-3");
  assert.equal(p.name, "Season 3 — Chagas disease (T. cruzi CYP51)");
  assert.equal(p.metricName, "score");
  assert.equal(p.metricUnit, "pts");
  assert.equal(p.metricDirection, "maximize");
  assert.equal(p.baseline, 36.144, "the best reference compound");
  assert.match(p.description!, /Inhibit T\. cruzi CYP51 \(Trypanosoma cruzi\), not human CYP51A1\./);
  assert.match(p.description!, /Points: activity 10, binding 30, selectivity 30, ADMET 15, novelty 10, synthesis 5\./);
  assert.match(p.description!, /molecular weight ≤ 750, ≤ 55 heavy atoms/);
  assert.match(p.description!, /Closes 2026-11-30 \(end of day UTC\); USD 1,000 to the top-ranked entry\./);
  assert.deepEqual(p.records.map((r) => r.contributor), ["topabaem", "Ku-ku", "1Dmeds", "healing5120", "Bio-JS", "posaconazole", "fluconazole", "caffeine"],
    "one row per account, highest first; unusable handles and values are dropped");

  const [top, kuku, dmeds, unspec] = p.records;
  assert.equal(top.value, 81.045);
  assert.equal(top.date, "2026-11-23");
  assert.equal(top.contributorKind, "person");
  assert.equal(top.contributorUrl, "https://huggingface.co/topabaem");
  assert.equal(top.isCurrentBest, true);
  assert.equal(top.isBaseline, false);
  assert.equal(top.submissionUrls, undefined, "an entry has no page of its own");
  assert.match(top.description!, /^rank 1 of 8 ranked entries · one scored entry · candidate ODC-F83F19 · activity 4\.2\/10, binding 29\.9\/30, selectivity 29\.9\/30, ADMET 4\.3\/15, novelty 9\.5\/10, synthesis 3\.2\/5 · structure kept private \(the entrant's choice\)$/);
  assert.equal(top.agent, undefined, "\"Mythos5.2\" names no known model");
  assert.ok(!JSON.stringify(p).includes("··········"), "a masked structure is never published");

  assert.equal(kuku.value, 80.296, "the best entry the board ranked, not the higher-scoring duplicate it relegated");
  assert.match(kuku.description!, /best of this account's 3 scored entries/, "relegated entries still count as entries");
  assert.equal(kuku.isCurrentBest, false);
  assert.equal(kuku.agent!.family, "anthropic");
  assert.equal(kuku.agent!.model, "Claude Opus");
  assert.match(kuku.agent!.evidence!, /season 3 leaderboard: model_name "Claude-Opus" \(typed by the entrant, self-reported\)/);
  assert.equal(dmeds.agent!.tool, "Codex");
  assert.equal(dmeds.agent!.model, "GPT-6 Astra");
  assert.equal(unspec.agent, undefined);
  assert.equal(p.records.find((r) => r.contributor === "Bio-JS")!.agent, undefined, "the model box repeating the handle is not an agent");

  const anchor = p.records.find((r) => r.contributor === "posaconazole")!;
  assert.equal(anchor.isBaseline, true);
  assert.equal(anchor.contributorKind, "method");
  assert.equal(anchor.contributorUrl, undefined);
  assert.equal(anchor.date, undefined);
  assert.equal(anchor.agent, undefined);
  assert.match(anchor.description!, /Reference compound scored by the organizers · azole, established in vitro activity against T\. cruzi · activity 3\.4\/10/);

  const closed = seasonToProblem(season2 as any, [] as any, false);
  assert.deepEqual(closed.records, []);
  assert.equal(closed.baseline, undefined);
  assert.match(closed.description!, /Closed on 2026-11-07: this season no longer takes entries \(USD 2,000 went to its top-ranked entry\)\./);
});

test("buildOpenDiscovery reads only the open seasons and survives postprocess as a site with no repository", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = mockApi(t);
  const built = await buildOpenDiscovery();
  assert.equal(built.id, "open-discovery-challenge");
  assert.equal(built.host, "huggingface");
  assert.equal(built.domain, "ml-research");
  assert.equal(built.status, "active");
  assert.equal(built.participation.compute, "cpu");
  assert.equal(built.participation.deadline, "Season 3 closes 2026-11-30; Season 4 closes 2027-01-31 (end of day UTC)");
  assert.match(built.participation.eligibility!, /5 entries per account per day/);
  assert.match(built.description, /26,182 submissions from 145 accounts so far\./);
  assert.deepEqual(built.problems.map((p) => p.id), ["season-3", "season-4"], "a season with no number, and the closed seasons, are not tracks");
  assert.ok(!calls.some((u) => /season=[12]\b/.test(u)), "a closed season's 10 MB board is never downloaded");
  assert.ok(calls.every((u) => u.startsWith("https://final-bench-open-discovery-challenge.hf.space/api/")));

  const c = postprocess(built, site, undefined);
  assert.equal(c.id, "open-discovery-challenge");
  assert.equal("repo" in c, false);
  assert.equal(c.status, "active");
  assert.ok(c.problems.every((p) => !p.isOpen), "a season whose entries beat the reference compounds is not an open problem");
  assert.ok(c.problems.every((p) => p.contested));
  const urls = c.problems.flatMap((p) => p.records.map((r) => r.contributorUrl)).filter(Boolean);
  assert.ok(urls.length && urls.every((u) => u!.startsWith("https://huggingface.co/")), "entrants link to their Hugging Face profile");
  assert.ok(!c.participants.some((p) => ["posaconazole", "caffeine", "PF-05089771"].includes(p.name)), "reference compounds are not participants");
  assert.deepEqual(c.agentStats.map((a) => a.family).sort(), ["anthropic", "openai"]);
  assert.ok(c.agentStats.every((a) => a.records > 0 && !a.currentBests), "the two leaders declared no model, so no family holds a contested best");
  assert.ok(c.problems.flatMap((p) => p.records).every((r) => r.agent?.role !== "subject"), "the row is an entrant's molecule, not a model's score");
});

test("when no season takes entries the board shows the last one, closed", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = mockApi(t, undefined, [season1, season2]);
  const built = await buildOpenDiscovery();
  assert.equal(built.status, "ended");
  assert.deepEqual(built.problems.map((p) => p.id), ["season-2"]);
  assert.equal(built.participation.deadline, "closed");
  assert.ok(calls.some((u) => u.endsWith("season=2")) && !calls.some((u) => u.endsWith("season=1")));
  assert.match(built.problems[0].description!, /no longer takes entries/);
  const c = postprocess(built, site, undefined);
  assert.equal(c.status, "ended");
});

test("the headline totals are optional; a board that stays down fails the whole build", async (t) => {
  t.mock.method(console, "log", () => {});
  // one retry, then the previous entry is kept by the caller
  let n = 0;
  mockApi(t, (url) => (url.endsWith("/api/seasons") && n++ === 0 ? new Response("SECRET busy", { status: 503 }) : undefined));
  const retried = await buildOpenDiscovery();
  assert.equal(retried.problems.length, 2);

  mockApi(t, (url) => (url.endsWith("/api/totals") ? new Response("SECRET down", { status: 500 }) : undefined));
  const built = await buildOpenDiscovery();
  assert.equal(built.problems.length, 2, "the board is what matters; the totals are two numbers in the description");
  assert.ok(!/submissions from/.test(built.description));

  mockApi(t, (url) => (url.includes("season=3") ? new Response("SECRET down", { status: 502 }) : undefined));
  await assert.rejects(buildOpenDiscovery(), (e: Error) => e.message === "Open Discovery Challenge download failed");
  mockApi(t, (url) => (url.endsWith("/api/seasons") ? Response.json({ seasons: [] }) : undefined));
  await assert.rejects(buildOpenDiscovery(), (e: Error) => e.message === "Open Discovery Challenge download failed");
});
