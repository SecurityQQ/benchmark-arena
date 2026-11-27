import assert from "node:assert/strict";
import { test } from "node:test";
import { README, USER_AGENT, buildMillenniumLean, kindOf, millenniumTable, millenniumTracks } from "../src/structured/millenniumLean.js";

const md = `# Millennium Prize Problems in Lean 4

## The seven problems

| Problem | Lean file | Propositions that count as a solution | Status |
|---|---|---|---|
| P versus NP | \`Problems/PVersusNP/Millennium.lean\` | \`Millennium.ClayPVersusNP\` (P = NP) or \`NegativeBranch\` (P ≠ NP) | Open |
| Riemann Hypothesis | \`Problems/RiemannHypothesis/Millennium.lean\` | \`Millennium.ClayRiemannHypothesis\` | Open |
| Navier–Stokes | \`Problems/NavierStokes/Millennium.lean\` | any one of \`FeffermanA\`, \`FeffermanB\` | Open |
| Birch and Swinnerton-Dyer | \`Problems/BSD/Millennium.lean\` | \`ClayBirchSwinnertonDyer\` | Open |
| Poincaré Conjecture | \`Problems/Poincare/Millennium.lean\` | \`ClayPoincareConjecture\` | Solved by Perelman; Lean proof not included |
| Hodge Conjecture | \`Problems/Hodge/Millennium.lean\` | none | Statement incomplete, not a valid target (see below) |
| Yang–Mills existence and mass gap | \`Problems/YangMills/Millennium.lean\` | none | Statement incomplete, not a valid target (see below) |

\`Problems/Registry.lean\` records the same information.
`;

test("millennium: reads the seven rows and classifies each status", () => {
  const rows = millenniumTable(md);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].file, "Problems/PVersusNP/Millennium.lean");
  assert.deepEqual(rows.map((r) => kindOf(r.status)), ["open", "open", "open", "open", "solved", "incomplete", "incomplete"]);
  assert.deepEqual(millenniumTable("no table"), []);
});

test("millennium: open problems are open proof tracks, incomplete ones are statement tracks, Poincaré is taken", () => {
  const t = millenniumTracks(millenniumTable(md));
  assert.deepEqual(t.map((p) => [p.id, p.isOpen]), [
    ["p-versus-np", true], ["riemann-hypothesis", true], ["navier-stokes", true], ["birch-and-swinnerton-dyer", true],
    ["poincare-conjecture", false], ["hodge-conjecture-statement", true], ["yang-mills-existence-and-mass-gap-statement", true],
  ]);
  assert.ok(t[5].name.endsWith("a faithful statement") && t[5].metricName === "faithful statement merged");
  assert.ok(t.every((p) => p.records.length === 0));
});

test("millennium: builds from the README with our user agent, and fails loudly on a README without the table", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    assert.equal(String(input instanceof Request ? input.url : input), README);
    assert.equal(new Headers(init?.headers).get("user-agent"), USER_AGENT);
    return new Response(md);
  });
  const c = await buildMillenniumLean();
  assert.equal(c.problems.length, 7);
  assert.ok(c.description.includes("4 are open targets"));
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response("# moved"));
  await assert.rejects(buildMillenniumLean(), /Millennium Prize Problems download failed/);
});
