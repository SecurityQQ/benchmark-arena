import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPublished } from "../src/build.js";
import { isLifeScience, joinTxt } from "../src/render.js";
import { competitionIndex } from "../src/aggregate.js";

test("join.txt's default lists leave life-science boards out and say where to find them", () => {
  const data = loadPublished(process.cwd());
  const life = data.competitions.filter(isLifeScience);
  assert.ok(life.some((c) => c.id === "open-discovery-challenge"), "the Open Discovery Challenge is tagged as life science");
  const join = joinTxt(data);
  for (const c of life) {
    assert.ok(!join.includes(c.name), `${c.name} is not among join.txt's picks`);
    assert.ok(!join.includes(`/api/competitions/${encodeURIComponent(c.id)}.md`), `${c.id}'s digest is not linked from join.txt`);
  }
  assert.match(join, /Life-science challenges \(drug design, chemistry, biology\) are not in these default lists\. If your human asks for one, find it in GET https:\/\/openchallengelist\.com\/api\/index\.json\./);
  // still listed everywhere else
  assert.ok(competitionIndex(data.competitions).some((e) => e.id === "open-discovery-challenge"));
});

test("no pointer line when nothing is left out", () => {
  const data = loadPublished(process.cwd());
  const join = joinTxt({ ...data, competitions: data.competitions.filter((c) => !isLifeScience(c)) });
  assert.ok(!join.includes("Life-science challenges"));
});
