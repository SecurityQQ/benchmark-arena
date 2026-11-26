import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { CHALLENGES, challengeBoards, challengeJoin, challengesOf, inChallenge } from "../src/challenges.js";
import { JOIN_LINE } from "../src/render.js";
import { GRAND, HOME } from "../src/prerender.js";
import { SITE_ASSETS } from "../src/build.js";

const APP = readFileSync("site/app.js", "utf-8");
const literal = (name: string) => Function(`return (${APP.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});\\n`))![1]});`)();

test("grand challenges: slugs are URL-safe and unique, tags are lower case, every plate is published, and the join line still points at join.txt", () => {
  assert.equal(new Set(CHALLENGES.map((ch) => ch.slug)).size, CHALLENGES.length);
  for (const ch of CHALLENGES) {
    assert.match(ch.slug, /^[a-z0-9-]{1,40}$/);
    assert.ok(ch.tags.length && ch.tags.every((t) => t === t.toLowerCase() && /^[a-z0-9.+-]+$/.test(t)), ch.slug);
    for (const f of [`art/${ch.art}.jpg`, `art/${ch.art}-sm.jpg`]) assert.ok(SITE_ASSETS.has(f) && existsSync(`site/${f}`), f);
    assert.match(challengeJoin(JOIN_LINE, ch), /^Fetch and follow the instructions at https:\/\/openchallengelist\.com\/join\.txt to pick an open .+ and enter it with me\.$/);
    for (const text of [ch.name, ch.field, ch.question, ch.stakes, ch.work]) assert.ok(text.trim().length > 3);
    assert.match(ch.question, /\?$/);
  }
  assert.throws(() => challengeJoin("Something else entirely.", CHALLENGES[0]));
  // no board in two challenges: a tag belongs to one of them
  const tags = CHALLENGES.flatMap((ch) => ch.tags);
  assert.equal(new Set(tags).size, tags.length);
});

test("grand challenges: a board belongs by an exact tag; inside, ended boards go last, the lead board first, then the busiest this month", () => {
  const by = (slug: string) => CHALLENGES.find((ch) => ch.slug === slug)!;
  const c = (id: string, tags: string[], month = 0, status = "active", open = 0) => ({ id, tags, status, stats: { totalRecords: month, uniqueParticipants: 0, recordsLast30d: month, recordsLast90d: month }, problems: Array.from({ length: open }, () => ({ isOpen: true })) }) as any;
  assert.ok(inChallenge(by("p-vs-np"), c("a", ["Complexity-Theory"])));
  assert.ok(!inChallenge(by("p-vs-np"), c("a", ["complexity-theory-of-mind", "np"])), "a tag that only contains one is not a match");
  assert.ok(inChallenge(by("riemann-hypothesis"), c("a", ["lean4", "riemann-hypothesis"])));
  assert.deepEqual(challengesOf(c("a", ["drug-discovery", "smiles"])).map((ch) => ch.slug), ["cure-disease"]);
  assert.deepEqual(challengesOf(c("a", ["robotics"])), []);
  const boards = [c("busy", ["kernels"], 40), c("over", ["speedrun"], 90, "ended"), c("sutro-problems", ["energy-efficiency"], 2), c("quiet-open", ["speedrun"], 0, "active", 3), c("quiet", ["speedrun"]), c("other", ["lean4"], 500)];
  assert.deepEqual(challengeBoards(by("energy"), boards).map((b) => b.id), ["sutro-problems", "busy", "quiet-open", "quiet", "over"]);
});

test("grand challenges: the app's copy over the cards and its hero names are the pre-rendered page's", () => {
  assert.deepEqual(literal("GRAND"), GRAND);
  assert.deepEqual(Object.keys(literal("HERO_NAMES")), CHALLENGES.map((ch) => ch.slug));
  for (const name of Object.values(literal("HERO_NAMES")) as string[]) assert.ok(HOME.lede.includes(name), name);
  for (const text of [HOME.h1, HOME.eyebrow, HOME.title.split(" — ")[1]]) assert.ok(APP.includes(text), text);
  const shell = readFileSync("site/index.html", "utf-8");
  assert.ok(shell.includes(`<title>${HOME.title}</title>`));
});
