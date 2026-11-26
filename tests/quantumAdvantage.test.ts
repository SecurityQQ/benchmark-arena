import assert from "node:assert/strict";
import { test } from "node:test";
import { DATA, USER_AGENT, buildQuantumAdvantage, variationalTracks, verifiableTracks } from "../src/structured/quantumAdvantage.js";

const issue = (n: number) => `https://github.com/quantum-advantage-tracker/quantum-advantage-tracker.github.io/issues/${n}`;
const variational = [
  { createdAt: "2025-11-10T21:41:25Z", url: issue(5), name: "SKQD", hamiltonian: "anderson_impurity_model_4i_28b_32e", qubits: 64, gates: 3281, energy: -62.25, method: "SKQD", institutions: "IBM, ORNL, University of Maryland", computeResourcesQuantum: "IBM Heron r2" },
  { createdAt: "2025-11-12T10:00:00Z", url: issue(9), name: "DMRG", hamiltonian: "anderson_impurity_model_4i_28b_32e", energy: -62.31, method: "DMRG", institutions: "Flatiron Institute" },
  { createdAt: "2025-11-11T16:34:49Z", url: "https://evil.example/x", hamiltonian: "4fe_4s_54e_36o", energy: -326.9, method: "SQD‮", institutions: "IBM" },
  { hamiltonian: "../escape", energy: 1 }, { hamiltonian: "n2", energy: "low" },
];
const verifiable = [
  { createdAt: "2025-11-12T12:57:53Z", url: issue(43), circuit: "peaked_circuit_heavy_hex_49x4020", value: "100%", method: "Quantum + Cluster Distillation", institutions: "IBM", runtimeQuantum: 633, runtimeClassical: 197, computeResourcesQuantum: "ibm_boston" },
  { createdAt: "2025-11-11T23:28:18Z", url: issue(27), circuit: "peaked_circuit_heavy_hex_49x4020", value: "100%", method: "TNS+BP", institutions: "BlueQubit", runtimeClassical: 2 },
  { circuit: "peaked_circuit_heavy_hex_49x4020", value: "40%", institutions: "Someone", runtimeClassical: 1 },
];

test("quantum advantage: one track per Hamiltonian, lowest energy first, classical and quantum together", () => {
  const t = variationalTracks(variational as any);
  assert.deepEqual(t.map((p) => [p.id, p.metricDirection, p.records.map((r) => r.value)]), [
    ["variational-4fe_4s_54e_36o", "minimize", [-326.9]],
    ["variational-anderson_impurity_model_4i_28b_32e", "minimize", [-62.31, -62.25]],
  ]);
  const skqd = t[1].records[1];
  assert.equal(skqd.contributor, "IBM, ORNL, University of Maryland");
  assert.equal(skqd.date, "2025-11-10");
  assert.deepEqual(skqd.submissionUrls, [issue(5)]);
  assert.ok(skqd.description!.includes("64 qubits") && skqd.description!.includes("on IBM Heron r2"));
  assert.equal(t[0].records[0].submissionUrls, undefined, "only the tracker's own issues are linked");
  assert.ok(!t[0].records[0].description!.includes("‮"));
});

test("quantum advantage: verifiable circuits rank full recoveries by total runtime; partial ones are left out", () => {
  const [p] = verifiableTracks(verifiable as any);
  assert.equal(p.metricUnit, "s");
  assert.deepEqual(p.records.map((r) => [r.contributor, r.value]), [["BlueQubit", 2], ["IBM", 830]]);
});

test("quantum advantage: builds from the three data files with our user agent, and fails loudly when they are gone", async (t) => {
  const files: Record<string, unknown> = { "variational-problems/submissions.json": variational, "classically-verifiable-problems/submissions.json": verifiable, "observable-estimations/submissions.json": [{ circuit: "x" }] };
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    assert.equal(new Headers(init?.headers).get("user-agent"), USER_AGENT);
    const f = files[url.slice(DATA.length + 1)];
    return f ? Response.json(f) : new Response("not found", { status: 404 });
  });
  const c = await buildQuantumAdvantage();
  assert.equal(c.problems.length, 3);
  assert.ok(c.description.includes("1 observable estimates"));
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response("gone", { status: 404 }));
  await assert.rejects(buildQuantumAdvantage(), /Quantum Advantage Tracker download failed/);
});
