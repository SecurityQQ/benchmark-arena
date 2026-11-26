import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { DOMAINS, DOMAIN_LABELS, DOMAIN_SCOPE, currentDomain } from "../src/domains.js";
import { validateCompetition } from "../src/validation.js";
import { applyStandard } from "../src/standard.js";

const APP = readFileSync("site/app.js", "utf-8");
const literal = (name: string) => Function(`return (${APP.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});\\n`))![1]});`)();

test("domains: the site's labels are the twin of DOMAIN_LABELS, and every domain has a scope and a plate that exists", () => {
  assert.deepEqual(literal("DOMAIN"), DOMAIN_LABELS);
  assert.deepEqual(Object.keys(DOMAIN_SCOPE), [...DOMAINS]);
  const art = literal("ART"), plates = literal("ART_BY_DOMAIN");
  assert.deepEqual(Object.keys(plates).sort(), [...DOMAINS].sort());
  for (const keys of Object.values(plates) as string[][]) for (const k of keys) {
    assert.ok(art[k], `ART has ${k}`);
    assert.ok(existsSync(`site/art/${k}.jpg`) && existsSync(`site/art/${k}-sm.jpg`), `site/art/${k}.jpg`);
  }
  for (const d of ["cybersecurity", "firmware", "chip-design"]) assert.ok((DOMAINS as readonly string[]).includes(d));
  for (const d of ["hardware-efficiency", "systems-perf", "security"]) assert.ok(!(DOMAINS as readonly string[]).includes(d));
});

test("domains: retired names map to the current ones, by tags where the old name was too broad", () => {
  assert.equal(currentDomain("security"), "cybersecurity");
  assert.equal(currentDomain("hardware-efficiency", ["rtl", "asic"]), "chip-design");
  assert.equal(currentDomain("hardware-efficiency", ["embedded", "microcontroller"]), "firmware");
  assert.equal(currentDomain("systems-perf", ["npu", "training-speedrun"]), "ml-research");
  assert.equal(currentDomain("hardware-efficiency", ["gpu", "cuda", "kernels"]), "coding-agents");
  assert.equal(currentDomain("hardware-efficiency", "not a list"), "coding-agents");
  for (const d of [...DOMAINS, "invented", undefined, 3]) assert.equal(currentDomain(d, ["rtl"]), d);
});

test("domains: validation keeps the new names, renames retired ones and still rejects invented ones", () => {
  const repo = { owner: "owner", name: "repo", url: "https://github.com/owner/repo", defaultBranch: "main", stars: 0, topics: [] };
  const input = (domain: unknown, tags: string[] = []) => ({ name: "Example", domain, tags, problems: [] });
  for (const d of DOMAINS) assert.equal(validateCompetition(input(d), repo).domain, d);
  assert.equal(validateCompetition(input("hardware-efficiency", ["verilog"]), repo).domain, "chip-design");
  assert.equal(validateCompetition(input("security"), repo).domain, "cybersecurity");
  assert.equal(validateCompetition(input(undefined), repo).domain, "other");
  assert.throws(() => validateCompetition(input("invented"), repo));
});

test("domains: an organizer's PROBLEM.md sets the domain; a retired name is read with its tags, an unknown one is ignored", () => {
  const repo = { owner: "owner", name: "repo", url: "https://github.com/owner/repo" };
  const base = () => validateCompetition({ name: "Example", domain: "llm-eval", problems: [] }, { ...repo, defaultBranch: "main", stars: 0, topics: [] });
  const domain = (meta: Record<string, unknown>) => applyStandard(base(), [{ path: "PROBLEM.md", meta: { spec: "problem.md/v1", ...meta }, body: "", errors: [] }], repo).competition!.domain;
  assert.equal(domain({ domain: "firmware" }), "firmware");
  assert.equal(domain({ domain: "hardware-efficiency", tags: ["rtl", "asic", "synthesis"] }), "chip-design");
  assert.equal(domain({ domain: "made-up" }), "llm-eval");
});

test("domains: the published data uses only current domains", () => {
  const data = JSON.parse(readFileSync("data/competitions.json", "utf-8"));
  for (const c of data.competitions) assert.ok((DOMAINS as readonly string[]).includes(c.domain), `${c.id}: ${c.domain}`);
});
