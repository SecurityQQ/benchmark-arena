// The PROBLEM.md / SUBMISSION.md standard (problem.md · submission.md).
//   PROBLEM.md    — one per repository, at the root. The organizers' statement: the task, rules, tracks
//                   (metric, direction, baseline) and how to submit, including the folder entries go into.
//   SUBMISSION.md — one per entry, inside that folder. The solution: approach, the value achieved on each
//                   track, who made it and which model/agent was involved.
// YAML front matter carries the facts, the Markdown body carries the prose. Both are authoritative: declared
// facts override the LLM extraction, and the leaderboard can be built from SUBMISSION.md files with no LLM at all.

import { parse as parseYaml } from "yaml";
import type { LLMCompetition } from "./llm.js";
import type { Problem, RecordEntry, ComputeTier, CompetitionStatus, AgentAttribution } from "./types.js";
import { familyFromName } from "./postprocess.js";

export const STANDARD_VERSION = 1;
export const PROBLEM_FILES = ["PROBLEM.md", "problem.md", ".github/PROBLEM.md", "docs/PROBLEM.md"];
export const SPEC_MARKERS = { problem: "problem.md/v1", submission: "submission.md/v1" };
export const MAX_SUBMISSIONS = 400;

export interface StandardDoc { path: string; meta: Record<string, any>; body: string; errors: string[] }
export interface StandardInfo { problem: boolean; submission: boolean; submissions: number; version: number; warnings: string[] }

const COMPUTE: ComputeTier[] = ["none", "cpu", "consumer-gpu", "datacenter-gpu", "cluster", "unknown"];
const STATUS: CompetitionStatus[] = ["active", "upcoming", "ended", "unknown"];
const DOMAINS = ["formal-methods", "hardware-efficiency", "llm-eval", "coding-agents", "ml-research", "systems-perf", "robotics", "security", "other"];
const str = (v: unknown, max = 600): string | undefined => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) || undefined : undefined);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const isProblemPath = (p: string) => /(^|\/)problem\.md$/i.test(p);
const isSubmissionPath = (p: string) => /(^|\/)submission\.md$/i.test(p);

/** Split "---\nyaml\n---\nbody". A file without front matter is prose, not data. */
export function parseStandardDoc(path: string, content: string): StandardDoc {
  const errors: string[] = [];
  const m = content.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { path, meta: {}, body: content, errors: ["no YAML front matter"] };
  let meta: Record<string, any> = {};
  try { const y = parseYaml(m[1], { maxAliasCount: 0 }); if (y && typeof y === "object" && !Array.isArray(y)) meta = y; else errors.push("front matter is not a mapping"); }
  catch (e) { errors.push(`invalid YAML: ${(e as Error).message.split("\n")[0]}`); }
  return { path, meta, body: m[2], errors };
}

/** A file only counts as ours when its front matter carries the marker. Plenty of repos have an unrelated PROBLEM.md. */
export function isStandardDoc(d: StandardDoc): boolean {
  const spec = String(d.meta?.spec ?? "").trim().toLowerCase();
  if (!/^(problem|submission)\.md\/v\d+$/.test(spec)) return false;
  return isProblemPath(d.path) ? spec.startsWith("problem.md/") : isSubmissionPath(d.path) ? spec.startsWith("submission.md/") : false;
}

/** "submissions/<handle>/" → "submissions". Only a plain relative directory is accepted. */
export function submissionsDir(problem: StandardDoc | undefined): string | null {
  const raw = str(problem?.meta?.submit?.path ?? problem?.meta?.submissions, 200);
  if (!raw) return null;
  const dir = raw.split("<")[0].replace(/^\.?\//, "").replace(/\/+$/, "");
  return /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,3}$/.test(dir) && !dir.split("/").includes("..") ? dir : null;
}

function tracksFrom(meta: Record<string, any>, warnings: string[]): Problem[] {
  const list = Array.isArray(meta.tracks) ? meta.tracks : meta.metric ? [meta] : [];
  const out: Problem[] = [];
  for (const t of list.slice(0, 200)) {
    if (!t || typeof t !== "object") continue;
    const name = str(t.name, 160) ?? str(t.id, 80);
    const metricName = str(t.metric, 80);
    if (!name || !metricName) { warnings.push("PROBLEM.md: track skipped, it needs name and metric"); continue; }
    const dir = str(t.direction);
    if (dir !== "minimize" && dir !== "maximize") { warnings.push(`PROBLEM.md: track "${name}": direction must be minimize or maximize`); continue; }
    const baseline = typeof t.baseline === "number" && isFinite(t.baseline) ? t.baseline : undefined;
    out.push({ id: str(t.id, 80) ? slug(String(t.id)) : slug(name), name, description: str(t.description, 500), metricName, metricUnit: str(t.unit, 24), metricDirection: dir, baseline, isOpen: true, records: [] });
  }
  return out;
}

function agentFrom(a: any): AgentAttribution | undefined {
  if (!a || typeof a !== "object") return undefined;
  const model = str(a.model, 80), tool = str(a.harness ?? a.tool, 60);
  if (!model && !tool) return undefined;
  return { family: familyFromName(model) ?? familyFromName(tool) ?? "other-ai", model, tool, evidence: `SUBMISSION.md declares ${[model, tool && `via ${tool}`].filter(Boolean).join(" ")}${str(a.role, 20) === "assisted" ? " (assisted)" : ""}`.slice(0, 120), confidence: "high", role: "author" };
}

/** SUBMISSION.md files → leaderboard rows. Declared rows enrich or replace what the LLM read from tables; they never duplicate. */
function mergeSubmissions(c: LLMCompetition, subs: StandardDoc[], repo: { owner: string; name: string; branch?: string }, warnings: string[]): number {
  let used = 0;
  const base = `https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch ?? "main"}`;
  for (const d of subs) {
    const m = d.meta, folder = d.path.replace(/\/?submission\.md$/i, "");
    const authors: string[] = (Array.isArray(m.authors) ? m.authors : [m.author]).map((x: unknown) => str(x, 60)?.replace(/^@/, "")).filter(Boolean) as string[];
    const results = Array.isArray(m.results) ? m.results : m.track !== undefined && m.value !== undefined ? [m] : [];
    if (!authors.length || !results.length) { warnings.push(`${d.path}: needs author and results`); continue; }
    const date = m.date instanceof Date ? m.date.toISOString().slice(0, 10) : /^\d{4}-\d{2}-\d{2}/.test(String(m.date ?? "")) ? String(m.date).slice(0, 10) : undefined;
    const description = [str(m.title, 140), d.body.replace(/```[\s\S]*?```/g, "").replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 220)].filter(Boolean).join(" — ").slice(0, 320);
    const code = str(m.code, 300);
    const urls = [`${base}/${folder}`, ...(code && /^https?:\/\//.test(code) ? [code] : [])];
    let counted = false;
    for (const r of results.slice(0, 50)) {
      const value = typeof r?.value === "number" ? r.value : Number(r?.value);
      const tid = str(r?.track, 80);
      if (!tid || !isFinite(value)) { warnings.push(`${d.path}: result skipped, it needs track and a numeric value`); continue; }
      const track = (c.problems ?? []).find((p) => p.id === slug(tid) || p.name.toLowerCase() === tid.toLowerCase()) ?? ((c.problems ?? []).length === 1 && tid === "main" ? c.problems![0] : undefined);
      if (!track) { warnings.push(`${d.path}: unknown track "${tid}"`); continue; }
      const entry: RecordEntry = { date, value, contributor: authors.join(", "), contributorKind: authors.length > 1 ? "team" : "person", contributorUrl: authors.length === 1 && /^[\w-]+$/.test(authors[0]) ? `https://github.com/${authors[0]}` : undefined, description: [description, str(r.notes, 120)].filter(Boolean).join(" · "), submissionUrls: urls, agent: agentFrom(m.agent), isBaseline: m.baseline === true };
      const same = track.records.find((x) => (x.contributor ?? "").toLowerCase() === entry.contributor!.toLowerCase() && Math.abs(x.value - value) <= Math.abs(value) * 1e-9);
      if (same) Object.assign(same, { ...entry, agent: entry.agent ?? same.agent, date: entry.date ?? same.date });
      else track.records.push(entry);
      for (const x of track.records) delete x.isCurrentBest; // recomputed in postprocess
      counted = true;
    }
    if (counted) used++;
  }
  return used;
}

/** Overlay the files' facts on top of the LLM extraction (or on an empty shell). Free text is never trusted as structure. */
export function applyStandard(base: LLMCompetition | null, docs: StandardDoc[], repo: { owner: string; name: string; url: string; branch?: string }): { competition: LLMCompetition | null; info: StandardInfo | null } {
  docs = docs.filter(isStandardDoc);
  const P = docs.find((d) => isProblemPath(d.path)), subs = docs.filter((d) => isSubmissionPath(d.path));
  if (!P && !subs.length) return { competition: base, info: null };
  const warnings = [...(P?.errors ?? []).map((e) => `PROBLEM.md: ${e}`), ...subs.flatMap((s) => s.errors.map((e) => `${s.path}: ${e}`))];
  const p = P?.meta ?? {}, s = (p.submit && typeof p.submit === "object" ? p.submit : {}) as Record<string, any>;
  const info: StandardInfo = { problem: !!P, submission: false, submissions: 0, version: Number(String(p.spec ?? "").match(/v(\d+)$/)?.[1] ?? STANDARD_VERSION) || STANDARD_VERSION, warnings };

  const declared = tracksFrom(p, warnings);
  if (!base) {
    // a valid PROBLEM.md makes the repo a competition even when the LLM was unsure
    if (!P || !str(p.name)) return { competition: null, info };
    base = { id: slug(str(p.name)!), name: str(p.name, 120)!, tagline: "", description: "", url: repo.url, host: "github", status: "unknown", tags: [], domain: "other", images: [], participation: { requirements: [], compute: "unknown" }, links: [], problems: [], agentStats: [] } as LLMCompetition;
  }
  const c = base;
  if (str(p.name, 120)) c.name = str(p.name, 120)!;
  if (str(p.tagline, 160)) c.tagline = str(p.tagline, 160)!;
  if (str(p.description, 900)) c.description = str(p.description, 900)!;
  else if (!c.description && P) c.description = P.body.replace(/```[\s\S]*?```/g, "").replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (STATUS.includes(p.status)) c.status = p.status;
  if (DOMAINS.includes(p.domain)) c.domain = p.domain;
  if (Array.isArray(p.tags)) c.tags = [...new Set([...(p.tags.map((t: unknown) => str(t, 40)?.toLowerCase()).filter(Boolean) as string[]), ...(c.tags ?? [])])].slice(0, 8);
  for (const [label, key] of [["Website", "website"], ["Leaderboard", "leaderboard"]] as const) if (str(p[key]) && /^https?:\/\//.test(p[key])) c.links = [{ label, url: p[key] }, ...(c.links ?? []).filter((l) => l.url !== p[key])].slice(0, 6);
  if (p.organizer && typeof p.organizer === "object" && str(p.organizer.name)) c.organizer = { name: str(p.organizer.name, 80)!, url: /^https?:\/\//.test(p.organizer.url ?? "") ? p.organizer.url : undefined };
  else if (str(p.organizer, 80)) c.organizer = { name: str(p.organizer, 80)! };

  const part = (c.participation ??= { requirements: [], compute: "unknown" });
  if (COMPUTE.includes(p.compute)) part.compute = p.compute;
  if (str(p.compute_details)) part.computeDetails = str(p.compute_details, 300);
  if (str(p.deadline, 80)) part.deadline = str(p.deadline, 80);
  if (str(p.prizes, 200)) part.prizes = str(p.prizes, 200);
  if (str(p.rounds, 200)) part.rounds = str(p.rounds, 200);
  if (Array.isArray(s.requirements)) part.requirements = s.requirements.map((r: unknown) => str(r, 60)).filter(Boolean).slice(0, 12) as string[];
  const how = [str(s.how, 40)?.replace(/-/g, " "), str(s.path, 160) ? `into ${str(s.path, 160)} with a SUBMISSION.md` : ""].filter(Boolean).join(" ");
  if (str(s.instructions, 400) || how) part.howToSubmit = str(s.instructions, 400) ?? how;
  if (str(s.format, 300)) part.submissionFormat = str(s.format, 300);
  if (str(s.verification, 300)) part.verification = str(s.verification, 300);
  if (str(s.eligibility, 200)) part.eligibility = str(s.eligibility, 200);
  if (str(s.cost, 80)) part.cost = str(s.cost, 80);
  if (str(p.quickstart, 900)) c.quickstart = str(p.quickstart, 900);
  if (str(s.agents, 40) || str(s.attribution, 200)) (c as any).agentPolicy = { agents: str(s.agents, 40), attribution: str(s.attribution, 200) };

  // tracks: declared facts win on metric/direction/baseline
  for (const d of declared) {
    const hit = (c.problems ?? []).find((x) => x.id === d.id || x.name.toLowerCase() === d.name.toLowerCase());
    if (hit) { hit.id = d.id; hit.metricName = d.metricName; hit.metricDirection = d.metricDirection; if (d.metricUnit) hit.metricUnit = d.metricUnit; if (d.baseline !== undefined) hit.baseline = d.baseline; if (d.description) hit.description = d.description; }
    else (c.problems ??= []).push(d);
  }
  // entries: every SUBMISSION.md is a leaderboard row
  info.submissions = mergeSubmissions(c, subs.slice(0, MAX_SUBMISSIONS), repo, warnings);
  info.submission = info.submissions > 0;
  info.warnings = warnings.slice(0, 40);
  return { competition: c, info };
}
