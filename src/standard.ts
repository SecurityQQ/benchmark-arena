// The PROBLEM.md / SUBMISSION.md standard (problem.md · submission.md).
// A repository that ships these two files at its root describes its own competition in a machine-readable way:
// YAML front matter carries the facts, the Markdown body carries the prose. The crawler treats both as authoritative:
// their fields override whatever the LLM extracted, and a repo with a valid PROBLEM.md is a competition by definition.

import { parse as parseYaml } from "yaml";
import type { LLMCompetition } from "./llm.js";
import type { Problem, ComputeTier, CompetitionStatus } from "./types.js";

export const STANDARD_VERSION = 1;
export const STANDARD_FILES = ["PROBLEM.md", "SUBMISSION.md", "problem.md", "submission.md", ".github/PROBLEM.md", ".github/SUBMISSION.md", "docs/PROBLEM.md", "docs/SUBMISSION.md"];

export interface StandardDoc { path: string; meta: Record<string, any>; body: string; errors: string[] }
export const SPEC_MARKERS = { problem: "problem.md/v1", submission: "submission.md/v1" };
/** A file only counts as ours when its front matter carries the marker. Plenty of repos have an unrelated PROBLEM.md. */
export function isStandardDoc(d: StandardDoc): boolean {
  const spec = String(d.meta?.spec ?? "").trim().toLowerCase();
  return /^(problem|submission)\.md\/v\d+$/.test(spec) && spec.startsWith(/problem\.md$/i.test(d.path) ? "problem.md/" : "submission.md/");
}
export interface StandardInfo { problem: boolean; submission: boolean; version: number; warnings: string[] }

const COMPUTE: ComputeTier[] = ["none", "cpu", "consumer-gpu", "datacenter-gpu", "cluster", "unknown"];
const STATUS: CompetitionStatus[] = ["active", "upcoming", "ended", "unknown"];
const DOMAINS = ["formal-methods", "hardware-efficiency", "llm-eval", "coding-agents", "ml-research", "systems-perf", "robotics", "security", "other"];
const str = (v: unknown, max = 600): string | undefined => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) || undefined : undefined);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** Split "---\nyaml\n---\nbody". Files without front matter are still useful prose, just not machine-readable. */
export function parseStandardDoc(path: string, content: string): StandardDoc {
  const errors: string[] = [];
  const m = content.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { path, meta: {}, body: content, errors: ["no YAML front matter"] };
  let meta: Record<string, any> = {};
  try { const y = parseYaml(m[1], { maxAliasCount: 0 }); if (y && typeof y === "object" && !Array.isArray(y)) meta = y; else errors.push("front matter is not a mapping"); }
  catch (e) { errors.push(`invalid YAML: ${(e as Error).message.split("\n")[0]}`); }
  return { path, meta, body: m[2], errors };
}

function tracksFrom(meta: Record<string, any>, warnings: string[]): Problem[] {
  const list = Array.isArray(meta.tracks) ? meta.tracks : meta.metric ? [meta] : [];
  const out: Problem[] = [];
  for (const t of list.slice(0, 200)) {
    if (!t || typeof t !== "object") continue;
    const name = str(t.name, 160) ?? str(t.id, 80);
    const metricName = str(t.metric, 80);
    if (!name || !metricName) { warnings.push("track skipped: needs name and metric"); continue; }
    const dir = str(t.direction);
    if (dir !== "minimize" && dir !== "maximize") { warnings.push(`track "${name}": direction must be minimize or maximize`); continue; }
    const baseline = typeof t.baseline === "number" && isFinite(t.baseline) ? t.baseline : undefined;
    out.push({ id: str(t.id, 80) ? slug(String(t.id)) : slug(name), name, description: str(t.description, 500), metricName, metricUnit: str(t.unit, 24), metricDirection: dir, baseline, isOpen: true, records: [] });
  }
  return out;
}

/** Overlay the files' facts on top of the LLM extraction (or on an empty shell). Never trusts free text as structure. */
export function applyStandard(base: LLMCompetition | null, docs: StandardDoc[], repo: { owner: string; name: string; url: string }): { competition: LLMCompetition | null; info: StandardInfo | null } {
  docs = docs.filter(isStandardDoc);
  const P = docs.find((d) => /problem\.md$/i.test(d.path)), S = docs.find((d) => /submission\.md$/i.test(d.path));
  if (!P && !S) return { competition: base, info: null };
  const warnings = [...(P?.errors ?? []).map((e) => `PROBLEM.md: ${e}`), ...(S?.errors ?? []).map((e) => `SUBMISSION.md: ${e}`)];
  const p = P?.meta ?? {}, s = S?.meta ?? {};
  const info: StandardInfo = { problem: !!P, submission: !!S, version: Number(String(p.spec ?? s.spec ?? "").match(/v(\d+)$/)?.[1] ?? STANDARD_VERSION) || STANDARD_VERSION, warnings };

  // A valid PROBLEM.md makes the repo a competition even when the LLM was unsure
  const declared = tracksFrom(p, warnings);
  if (!base) {
    if (!P || !str(p.name)) return { competition: null, info };
    base = { id: slug(str(p.name)!), name: str(p.name, 120)!, tagline: "", description: "", url: repo.url, host: "github", status: "unknown", tags: [], domain: "other", images: [], participation: { requirements: [], compute: "unknown" }, links: [], problems: [], agentStats: [] } as LLMCompetition;
  }
  const c = base;
  if (str(p.name, 120)) c.name = str(p.name, 120)!;
  if (str(p.tagline, 160)) c.tagline = str(p.tagline, 160)!;
  if (str(p.description, 900)) c.description = str(p.description, 900)!;
  else if (!c.description && P) c.description = P.body.replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (STATUS.includes(p.status)) c.status = p.status;
  if (DOMAINS.includes(p.domain)) c.domain = p.domain;
  if (Array.isArray(p.tags)) c.tags = [...new Set([...p.tags.map((t: unknown) => str(t, 40)?.toLowerCase()).filter(Boolean) as string[], ...(c.tags ?? [])])].slice(0, 8);
  if (str(p.website) && /^https?:\/\//.test(p.website)) c.links = [{ label: "Website", url: p.website }, ...(c.links ?? []).filter((l) => l.url !== p.website)].slice(0, 6);
  if (str(p.leaderboard) && /^https?:\/\//.test(p.leaderboard)) c.links = [{ label: "Leaderboard", url: p.leaderboard }, ...(c.links ?? []).filter((l) => l.url !== p.leaderboard)].slice(0, 6);
  if (p.organizer && typeof p.organizer === "object" && str(p.organizer.name)) c.organizer = { name: str(p.organizer.name, 80)!, url: /^https?:\/\//.test(p.organizer.url ?? "") ? p.organizer.url : undefined };
  else if (str(p.organizer, 80)) c.organizer = { name: str(p.organizer, 80)! };

  const part = (c.participation ??= { requirements: [], compute: "unknown" });
  if (COMPUTE.includes(p.compute)) part.compute = p.compute;
  if (str(p.compute_details)) part.computeDetails = str(p.compute_details, 300);
  if (str(p.deadline, 80)) part.deadline = str(p.deadline, 80);
  if (str(p.prizes, 200)) part.prizes = str(p.prizes, 200);
  if (str(p.rounds, 200)) part.rounds = str(p.rounds, 200);
  if (Array.isArray(s.requirements)) part.requirements = s.requirements.map((r: unknown) => str(r, 60)).filter(Boolean).slice(0, 12) as string[];
  const how = [str(s.how, 40), str(s.path, 160) ? `under ${str(s.path, 160)}` : ""].filter(Boolean).join(" ");
  if (str(s.instructions, 400) || how) part.howToSubmit = str(s.instructions, 400) ?? how;
  if (str(s.format, 300)) part.submissionFormat = str(s.format, 300);
  if (str(s.verification, 300)) part.verification = str(s.verification, 300);
  if (str(s.eligibility, 200)) part.eligibility = str(s.eligibility, 200);
  if (str(s.cost, 80)) part.cost = str(s.cost, 80);
  if (str(s.quickstart, 900)) c.quickstart = str(s.quickstart, 900);
  if (str(s.agents, 40) || str(s.attribution, 200)) (c as any).agentPolicy = { agents: str(s.agents, 40), attribution: str(s.attribution, 200) };

  // Tracks: declared facts win on metric/direction/baseline; records always come from the leaderboard
  for (const d of declared) {
    const hit = (c.problems ?? []).find((x) => x.id === d.id || x.name.toLowerCase() === d.name.toLowerCase());
    if (hit) { hit.metricName = d.metricName; hit.metricDirection = d.metricDirection; if (d.metricUnit) hit.metricUnit = d.metricUnit; if (d.baseline !== undefined) hit.baseline = d.baseline; if (d.description) hit.description = d.description; }
    else (c.problems ??= []).push(d);
  }
  return { competition: c, info };
}
