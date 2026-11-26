import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { FRONTIER_MIN, byImportance, frontierBoards, isFrontier, loadRatings, validRatings, withImportance } from "../src/frontier.js";
import { loadPublished } from "../src/build.js";
import { FRONTIER_LINE, pages } from "../src/prerender.js";
import type { Competition } from "../src/types.js";

const APP = readFileSync("site/app.js", "utf-8");
const rating = (over: Record<string, unknown> = {}) => ({ stakes: 4, open: 3, verified: 3, why: "It matters.", checked: "2026-11-26", ...over });

test("frontier: every listed board is rated, and every rating names a listed board", () => {
  const ratings = loadRatings(process.cwd());
  const ids = new Set(loadPublished(process.cwd()).competitions.map((c) => c.id));
  assert.deepEqual([...ids].filter((id) => !ratings[id]), [], "rate new boards in data/frontier.json");
  assert.deepEqual(Object.keys(ratings).filter((id) => !ids.has(id)), []);
});

test("frontier: only well-formed ratings get through", () => {
  assert.equal(Object.keys(validRatings({ ratings: { a: rating() } })).length, 1);
  for (const bad of [{ stakes: 5 }, { open: 4 }, { verified: -1 }, { stakes: 2.5 }, { why: "" }, { why: "x".repeat(201) }, { checked: "today" }])
    assert.equal(Object.keys(validRatings({ ratings: { a: rating(bad) } })).length, 0, JSON.stringify(bad));
  assert.deepEqual(validRatings({ ratings: { "../x": rating() } }), {});
  assert.deepEqual(validRatings(null), {});
});

test("frontier: high stakes, a high total and open to entries; an ended board drops off", () => {
  assert.ok(isFrontier({ stakes: FRONTIER_MIN.stakes, open: 3, verified: 2 }, "active"));
  assert.ok(!isFrontier({ stakes: 2, open: 3, verified: 3 }, "active"), "stakes below the bar");
  assert.ok(!isFrontier({ stakes: 3, open: 2, verified: 2 }, "active"), "total below the bar");
  assert.ok(!isFrontier({ stakes: 4, open: 3, verified: 3 }, "ended"));
});

test("frontier: the published data puts the Millennium problems and neglected cures on the frontier", () => {
  const comps = loadPublished(process.cwd()).competitions, front = frontierBoards(comps).map((c) => c.id);
  for (const id of ["open-goat-pequalnp-proofs-529cfdd011232bcc", "alchemistry-2027", "osgood001-riemann-hypothesis-27b8a22da0a4924e"]) assert.ok(front.includes(id), id);
  assert.ok(!front.includes("squad-explorer"));
  assert.ok(front.length >= 8 && front.length <= 20, `${front.length} frontier boards: the tier should stay selective`);
});

test("frontier: site/app.js orders the catalog exactly as src/frontier.ts and says the same rule", () => {
  const twin = Function(`${APP.match(/function byImportance\(a, b\) \{[\s\S]*?\n\}\n/)![0]}; return byImportance;`)() as typeof byImportance;
  const comps = loadPublished(process.cwd()).competitions;
  const unrated = { ...comps[0], id: "zz", name: "Zed", importance: undefined } as Competition;
  const all = [...comps, unrated];
  assert.deepEqual([...all].sort(twin).map((c) => c.id), [...all].sort(byImportance).map((c) => c.id));
  assert.equal([...all].sort(byImportance).at(-1)!.id, "zz", "unrated boards sort last");
  assert.equal(APP.match(/const FRONTIER_LINE = "([^"]*)";/)![1], FRONTIER_LINE);
});

test("frontier: the home page lists the frontier before everything else, and board pages say why", () => {
  const data = loadPublished(process.cwd());
  const all = pages(data);
  const home = all.find((p) => p.path === "/")!.body;
  assert.ok(home.indexOf("<h2>On the frontier</h2>") < home.indexOf("<h2>Everything else</h2>"));
  assert.ok(home.indexOf("P = NP?") < home.indexOf("SQuAD"));
  const c = data.competitions.find((x) => x.id === "alchemistry-2027")!;
  assert.ok(all.find((p) => p.path === "/c/alchemistry-2027")!.body.includes(`On the frontier: <b>${c.importance!.score}/10</b>`));
  assert.ok(withImportance([c], {})[0].importance, "an attached rating is kept when nothing new is rated");
});
