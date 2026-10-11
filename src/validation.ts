import { createHash } from "node:crypto";
import type { AgentAttribution, Competition, DiscoveredRepo } from "./types.js";
import type { LLMCompetition } from "./llm.js";

export class ValidationError extends Error {
  constructor() { super("Invalid competition data"); }
}
const fail = (): never => { throw new ValidationError(); };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const text = (v: unknown): string => typeof v === "string" ? v : fail();
const list = (v: unknown): unknown[] => v === undefined ? [] : Array.isArray(v) ? v : fail();
const number = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : fail();
const boolean = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
function choice<const T extends string>(v: unknown, values: readonly T[], fallback?: T): T {
  if (v === undefined && fallback !== undefined) return fallback;
  return typeof v === "string" && values.includes(v as T) ? v as T : fail();
}
function strings(o: Record<string, unknown>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, text(o[k])]));
}
export function safeId(v: unknown, track = false): string {
  const s = text(v);
  const pattern = track ? /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/ : /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/;
  return pattern.test(s) && !s.includes("..") && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(s) && !["__proto__", "constructor", "prototype"].includes(s) ? s : fail();
}
export function repoKey(repo: { owner: string; name: string }): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(text(repo.owner)) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(text(repo.name)) || [".", ".."].includes(repo.name)) fail();
  return `${repo.owner}/${repo.name}`.toLowerCase();
}
export function competitionId(repo: DiscoveredRepo, previous?: Competition): string {
  const key = repoKey(repo);
  if (previous) {
    if (!previous.repo || repoKey(previous.repo) !== key) fail();
    return safeId(previous.id);
  }
  return `${key.replace(/[^a-z0-9-]/g, "-")}-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}
function url(v: unknown, relative = false): string {
  const s = text(v).trim();
  if (!s || /[\u0000-\u0020\u007f\\]/.test(s)) fail();
  if (relative && !/^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith("//")) return s;
  try {
    const u = new URL(s);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) fail();
    return u.href;
  } catch { return fail(); }
}
export function validateAgent(value: unknown): AgentAttribution {
  const a = object(value);
  return {
    ...strings(a, ["model", "tool", "evidence"]),
    family: choice(a.family, ["anthropic", "openai", "google", "deepseek", "meta", "xai", "mistral", "alibaba", "moonshot", "zhipu", "bytedance", "harmonic", "axiom", "other-ai", "human", "unknown"]),
    confidence: choice(a.confidence, ["high", "medium", "low"], "low"),
    // Legacy records omit role; postprocess infers it from evidence.
    ...(a.role == null ? {} : { role: choice(a.role, ["author", "subject"]) }),
  } as AgentAttribution;
}
export function validateAttributions(value: unknown, keys: Set<string>): Record<string, AgentAttribution> {
  const out: Record<string, AgentAttribution> = {};
  for (const [key, a] of Object.entries(object(value))) {
    if (!/^\d+\.\d+$/.test(key) || !keys.has(key)) fail();
    out[key] = validateAgent(a);
  }
  return out;
}
export function validateCompetition(value: unknown, repo: DiscoveredRepo): LLMCompetition {
  repoKey(repo);
  const c = object(value), part = c.participation == null ? {} : object(c.participation);
  if (c.id !== undefined) safeId(c.id);
  const problems = list(c.problems).map((value) => {
    const p = object(value);
    return {
      ...strings(p, ["group", "description", "metricUnit"]),
      id: safeId(p.id, true), name: text(p.name), metricName: text(p.metricName),
      metricDirection: choice(p.metricDirection, ["minimize", "maximize"]),
      ...(p.baseline == null ? {} : { baseline: number(p.baseline) }),
      ...(p.passMark == null ? {} : { passMark: number(p.passMark) }), isOpen: true,
      records: list(p.records).map((value) => {
        const r = object(value);
        const date = r.date == null || r.date === "" ? undefined : text(r.date);
        if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) fail();
        return {
          ...strings(r, ["contributor", "description"]), date, value: number(r.value),
          ...(r.contributorKind == null ? {} : { contributorKind: choice(r.contributorKind, ["person", "team", "model", "method", "unknown"]) }),
          ...(r.contributorUrl == null ? {} : { contributorUrl: url(r.contributorUrl) }),
          ...(r.submissionUrls == null ? {} : { submissionUrls: list(r.submissionUrls).map((u) => url(u, true)) }),
          ...(r.isBaseline == null ? {} : { isBaseline: boolean(r.isBaseline) }),
          ...(r.isCurrentBest == null ? {} : { isCurrentBest: boolean(r.isCurrentBest) }),
          ...(r.agent == null ? {} : { agent: validateAgent(r.agent) }),
        };
      }),
    };
  });
  if (new Set(problems.map((p) => p.id)).size !== problems.length) fail();
  const organizer = c.organizer == null ? undefined : object(c.organizer);
  const venue = c.venue == null ? undefined : object(c.venue);
  const standard = c.standard == null ? undefined : object(c.standard);
  if (standard && (!Number.isSafeInteger(number(standard.submissions)) || number(standard.submissions) < 0 || !Number.isSafeInteger(number(standard.version)) || number(standard.version) < 1)) fail();
  return {
    id: c.id === undefined ? competitionId(repo) : safeId(c.id), name: text(c.name),
    tagline: c.tagline == null ? "" : text(c.tagline), description: c.description == null ? "" : text(c.description),
    url: url(c.url == null || c.url === "" ? repo.url : c.url), host: choice(c.host, ["github", "website", "kaggle", "huggingface", "other"], "github"),
    status: choice(c.status, ["active", "upcoming", "ended", "unknown"], "unknown"),
    domain: choice(c.domain, ["formal-methods", "hardware-efficiency", "llm-eval", "coding-agents", "ml-research", "systems-perf", "robotics", "security", "other"], "other"),
    tags: list(c.tags).map(text), images: list(c.images).map((u) => url(u, true)),
    participation: { ...strings(part, ["howToSubmit", "submissionFormat", "computeDetails", "deadline", "rounds", "prizes", "eligibility", "cost", "verification"]), requirements: list(part.requirements).map(text), compute: choice(part.compute, ["none", "cpu", "consumer-gpu", "datacenter-gpu", "cluster", "unknown"], "unknown") },
    links: list(c.links).map((value) => { const l = object(value); return { label: text(l.label), url: url(l.url) }; }),
    ...(organizer ? { organizer: { name: text(organizer.name), ...(organizer.url == null ? {} : { url: url(organizer.url) }), ...(organizer.type == null ? {} : { type: choice(organizer.type, ["company", "academic", "individual", "community", "foundation"]) }) } } : {}),
    ...(venue ? { venue: { ...strings(venue, ["location", "event"]), type: choice(venue.type, ["online", "in-person", "hybrid"]) } } : {}),
    ...strings(c, ["quickstart"]),
    ...(c.agentPolicy == null ? {} : { agentPolicy: strings(object(c.agentPolicy), ["agents", "attribution"]) }),
    ...(standard ? { standard: { problem: boolean(standard.problem), submission: boolean(standard.submission), submissions: number(standard.submissions), version: number(standard.version), warnings: list(standard.warnings).map((warning) => { text(warning); return "Standard document warning"; }) } } : {}),
    problems, agentStats: [],
  };
}
export function assertUniqueCompetitions(competitions: Competition[]): void {
  const ids = new Set<string>(), repos = new Set<string>();
  for (const c of competitions) {
    const id = safeId(c.id).toLowerCase(), key = c.repo ? repoKey(c.repo) : fail();
    if (ids.has(id) || repos.has(key)) fail();
    ids.add(id); repos.add(key);
  }
}
export function savedEntries(value: unknown): { value: unknown; repo: DiscoveredRepo; id: string }[] {
  const competitions = object(value).competitions;
  if (!Array.isArray(competitions)) fail();
  return list(competitions).map((value) => {
    const c = object(value), r = object(c.repo);
    const owner = text(r.owner), name = text(r.name);
    const repo = { owner, name, url: `https://github.com/${owner}/${name}`, defaultBranch: r.branch == null ? "main" : text(r.branch), stars: 0, topics: [] };
    repoKey(repo);
    return { value, repo, id: safeId(c.id) };
  });
}
