import assert from "node:assert/strict";
import { test } from "node:test";
import { SLUG, agentStats, buildProfiles, creditedNames, identityFromUrl, linkEntries, peopleWithProfiles, profileIndex, withProfiles, type ProfileEntry } from "../src/profiles.js";
import { loadPublished } from "../src/build.js";
import type { Competition, RecordEntry } from "../src/types.js";

const comp = (id: string, host: Competition["host"], records: Partial<RecordEntry>[][], direction: "minimize" | "maximize" = "maximize") => ({
  id, name: id.toUpperCase(), host, participants: [], problems: records.map((rs, i) => ({
    id: `t${i}`, name: `Track ${i}`, metricName: "score", metricDirection: direction, isOpen: false, records: rs.map((r) => ({ value: 1, ...r })),
  })),
}) as unknown as Competition;

test("profiles: who a credit names", () => {
  assert.deepEqual(creditedNames("kellerjordan0, jxbz"), ["kellerjordan0", "jxbz"]);
  assert.deepEqual(creditedNames("@Grad62304977, @kellerjordan0"), ["Grad62304977", "kellerjordan0"]);
  assert.deepEqual(creditedNames("leloykun, fernbear.bsky.social and YouJiacheng"), ["leloykun", "fernbear.bsky.social", "YouJiacheng"]);
  assert.deepEqual(creditedNames("jurajselep and b0nce"), ["jurajselep", "b0nce"]);
  // "and" between multi-word names is a team name or a guess: kept whole
  assert.deepEqual(creditedNames("Cats and boxes"), ["Cats and boxes"]);
  assert.deepEqual(creditedNames("DreamingOfClouds and Rohan Arun"), ["DreamingOfClouds and Rohan Arun"]);
  assert.deepEqual(creditedNames("Avi Eisenberg, eumemic et al."), ["Avi Eisenberg", "eumemic"]);
  assert.deepEqual(creditedNames("unknown"), []);
  assert.deepEqual(creditedNames("Baseline (by SB team)"), []);
});

test("profiles: only a person's own page is an identity", () => {
  assert.deepEqual(identityFromUrl("https://github.com/Spartanhaden/"), { platform: "github", handle: "Spartanhaden", url: "https://github.com/Spartanhaden" });
  assert.equal(identityFromUrl("https://github.com/owner/repo/pull/3"), null);
  assert.equal(identityFromUrl("https://github.com/orgs"), null);
  assert.equal(identityFromUrl("https://www.gpumode.com/leaderboard/543"), null);
  assert.deepEqual(identityFromUrl("https://duckbench.app/@scrooge"), { platform: "duckbench", handle: "scrooge", url: "https://duckbench.app/@scrooge" });
  assert.equal(identityFromUrl("https://huggingface.co/spaces/x"), null);
  assert.equal(identityFromUrl("javascript:alert(1)"), null);
});

test("profiles: one person across boards, teams split, look-alike names kept apart", () => {
  const a = comp("a", "github", [[
    { contributor: "classiclarryd", contributorUrl: "https://github.com/ClassicLarryD", isCurrentBest: true, value: 9, date: "2026-10-01" },
    { contributor: "kellerjordan0, classiclarryd", value: 5, date: "2026-09-01", agent: { family: "anthropic", tool: "Claude Code", model: "Claude Opus 5.5", confidence: "high", role: "author" } },
    { contributor: "Baseline", isBaseline: true, value: 1 },
  ]]);
  const b = comp("b", "github", [[{ contributor: "@classiclarryd", value: 3, date: "2026-11-01" }]]);
  const g = comp("g", "website", [[
    { contributor: "D", contributorUrl: "https://www.gpumode.com/leaderboard/1", value: 2 },
    { contributor: "D++", contributorUrl: "https://www.gpumode.com/leaderboard/1", value: 3 },
    { contributor: "Arseni Ivanov", contributorUrl: "https://www.gpumode.com/leaderboard/2", value: 4 },
    { contributor: "arseni_ivanov", contributorUrl: "https://www.gpumode.com/leaderboard/3", value: 5 },
    { contributor: "GPT-5", value: 9, contributorKind: "model" },
  ]], "minimize");
  const set = buildProfiles([a, b, g]);
  const by = new Map(set.profiles.map((p) => [p.slug, p]));
  const larry = by.get("classiclarryd")!;
  assert.equal(larry.records, 3, "the GitHub link, the team credit and the bare @name on another board");
  assert.equal(larry.github, "ClassicLarryD");
  assert.equal(larry.claim, "github");
  assert.deepEqual(larry.competitions.map((c) => c.id).sort(), ["a", "b"]);
  assert.equal(larry.entries[0].date, "2026-11-01", "newest first");
  assert.equal(larry.entries.find((e) => e.as)?.as, "kellerjordan0, classiclarryd");
  assert.deepEqual(larry.setups, [{ family: "anthropic", tool: "Claude Code", models: ["Claude Opus 5.5"], records: 1, bests: 0, lastUsed: "2026-09-01" }]);
  assert.ok(by.has("name--kellerjordan0") && by.get("name--kellerjordan0")!.claim === "review");
  // the track's places: baselines are not competitors
  assert.deepEqual(larry.entries.filter((e) => e.competitionId === "a").map((e) => [e.rank, e.of]).sort(), [[1, 2], [2, 2]]);
  // GPU MODE: "D" and "D++" are two people; "Arseni Ivanov" and "arseni_ivanov" one
  const gp = set.profiles.filter((p) => p.slug.startsWith("gpumode--"));
  assert.equal(gp.length, 3);
  assert.ok(by.has("gpumode--d") && [...by.keys()].some((k) => /^gpumode--d-[0-9a-f]{6}$/.test(k)));
  assert.equal(by.get("gpumode--arseni-ivanov")!.records, 2);
  assert.equal(by.get("gpumode--d")!.entries[0].rank, 1, "minimize: the lowest value is first");
  assert.ok(!set.profiles.some((p) => p.name === "GPT-5" || p.name === "Baseline"));
  for (const p of set.profiles) assert.match(p.slug, SLUG);

  const pub = withProfiles([a, b, g], set);
  assert.deepEqual(pub[0].problems[0].records[1].profiles, ["name--kellerjordan0", "classiclarryd"]);
  assert.equal(pub[0].problems[0].records[2].profiles, undefined, "baselines credit nobody");
  const people = peopleWithProfiles([{ name: "classiclarryd" }, { name: "kellerjordan0, classiclarryd" }], pub);
  assert.equal(people[0].slug, "classiclarryd");
  assert.equal(people[1].slug, undefined, "a team credit is not one profile");
  const idx = profileIndex(set.profiles).find((r) => r.slug === "classiclarryd")!;
  assert.deepEqual(idx.families, { anthropic: 1 });
});

test("profiles: entries link to the account's agents by report, then by evidence", () => {
  const e = (over: Partial<ProfileEntry>): ProfileEntry => ({ competitionId: "c1", competitionName: "C1", problemId: "t", problemName: "T", value: 1, metricName: "m", direction: "maximize", rank: 1, of: 2, best: false, urls: [], ...over });
  const profiles = [{ slug: "me", entries: [
    e({ urls: ["https://github.com/o/r/pull/12/files"], date: "2026-11-02" }),                                           // 0: reported by link
    e({ competitionId: "c2", date: "2026-11-03" }),                                                                      // 1: reported entering c2
    e({ competitionId: "c3", date: "2026-11-03", agent: { family: "openai", tool: "Codex", confidence: "high" } }),       // 2: evidence → Nyx
    e({ competitionId: "c3", date: "2026-11-04", agent: { family: "anthropic", tool: "Cursor", confidence: "high" } }),   // 3: no agent fits
    e({ competitionId: "c2", date: "2025-01-01" }),                                                                      // 4: long before the report
    e({ competitionId: "c4", date: "2026-11-05", agent: { family: "anthropic", tool: "Claude Code", confidence: "high" } }), // 5: two fit
    e({ competitionId: "c2", date: "2026-11-04", best: true, agent: { family: "openai", confidence: "medium" } }),          // 6: report says Ada, evidence says OpenAI → Nyx by evidence
  ] }];
  const agents = [
    { id: "ag_ada", name: "Ada", family: "anthropic" as const, tool: "Claude Code", createdAt: "2026-10-01T00:00:00Z" },
    { id: "ag_nyx", name: "Nyx", family: "openai" as const, tool: "Codex", createdAt: "2026-10-01T00:00:00Z" },
    { id: "ag_bo", name: "Bo", family: "anthropic" as const, tool: "Claude Code", createdAt: "2026-10-01T00:00:00Z" },
  ];
  const events = [
    { agentId: "ag_ada", kind: "submitted" as const, competitionId: "c1", url: "https://github.com/o/r/pull/12", createdAt: "2026-11-01T10:00:00Z" },
    { agentId: "ag_ada", kind: "entering" as const, competitionId: "c2", createdAt: "2026-11-02T10:00:00Z" },
  ];
  const links = linkEntries(profiles, agents, events);
  const at = (i: number) => links.find((l) => l.entry === i);
  assert.deepEqual(at(0), { slug: "me", entry: 0, agentId: "ag_ada", how: "reported" });
  assert.deepEqual(at(1), { slug: "me", entry: 1, agentId: "ag_ada", how: "reported" });
  assert.deepEqual(at(2), { slug: "me", entry: 2, agentId: "ag_nyx", how: "matched" });
  assert.equal(at(3), undefined);
  assert.equal(at(4), undefined);
  assert.equal(at(5), undefined, "Ada and Bo both fit: nobody gets it");
  assert.deepEqual(at(6), { slug: "me", entry: 6, agentId: "ag_nyx", how: "matched" });
  const s = agentStats(profiles, links, "ag_nyx");
  assert.equal(s.entries, 2); assert.equal(s.bests, 1); assert.equal(s.matched, 2);
  assert.deepEqual(s.competitions.map((c) => c.id), ["c2", "c3"]);
});

test("profiles: the published dataset gives every credited person a page, under a safe address", () => {
  const data = loadPublished(process.cwd());
  const set = buildProfiles(data.competitions);
  assert.ok(set.profiles.length > 100);
  assert.equal(new Set(set.profiles.map((p) => p.slug)).size, set.profiles.length);
  for (const p of set.profiles) {
    assert.match(p.slug, SLUG);
    assert.ok(p.records >= 1 && p.entries.length >= 1, p.slug);
    if (p.github) assert.equal(p.slug, p.github.toLowerCase());
    else assert.match(p.slug, /^[a-z]+--/);
  }
  // every record a person entered is on some profile
  const credited = data.competitions.flatMap((c) => c.problems.flatMap((p) => p.records)).filter((r) => r.profiles?.length).length;
  assert.ok(credited > 1000);
});
