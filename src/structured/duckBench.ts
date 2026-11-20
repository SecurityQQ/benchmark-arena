// Deterministic builder for DuckBench (duckbench.app): coding agents train the Microduck robot duck in a MuJoCo sim and enter it in challenges.
// DuckBench has no GitHub repository, so it is a site source (main.ts SITES). Sources (public API, no login):
//   1. https://duckbench.app/api/challenges              — every challenge: duel or not, ranking unit and direction
//   2. https://duckbench.app/api/challenges/{id}/board   — solo challenges: each player's best attempt, re-run by the server on 24 hidden seeds
//   3. https://duckbench.app/api/pvp/{id}/leaderboard    — duels: each entry's Elo-like rating from server-scheduled matches
// No LLM involved. The model (and, on duel entries, the harness) behind a row is what the duckbench CLI declared:
// the site shows it as self-reported, the evidence says so, and a row with no declared model carries no attribution.

import type { LLMCompetition } from "../llm.js";
import type { AgentAttribution, Problem, RecordEntry } from "../types.js";
import { boundedFetch } from "../github.js";
import { familyFromName } from "../postprocess.js";

export const SITE = "https://duckbench.app";
const CONCURRENCY = 4;
// The API answers Node's default user agent with 426 "kit_outdated" (it takes it for an old duckbench CLI): say who is asking
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";

export interface DuckRanking { kind?: string; unit?: string; lower_is_better?: boolean; miss_s?: number | null }
export interface DuckChallenge {
  id: string; title: string; tagline?: string; what_counts?: string; metric?: string; metric_unit?: string; lower_is_better?: boolean;
  ranking?: DuckRanking; ranked_seed_count?: number; attempt_count?: number; player_count?: number; duel?: boolean;
}
export interface DuckTrained { model?: string | null; minutes?: number | null; device?: string | null; caption?: string | null }
export interface DuckAttempt {
  rank: number | null; attempt_id?: string; handle: string; house?: string | null; author_kind?: string; declared_model?: string | null;
  submitted_at?: string; seed_count?: number; result: number; worst_result?: number; trained?: DuckTrained | null; exploit?: boolean; exploit_flags?: string[];
}
export interface DuckLadderRow {
  rank: number | null; rating: number; rating_provisional?: boolean; rating_margin?: number; matches?: number; wins?: number; losses?: number; draws?: number;
  entry: { handle: string; house?: string | null; declared_model?: string | null; trained?: DuckTrained | null; agent?: { model?: string | null; harness?: string | null } | null };
}

async function getJson<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(`${SITE}${path}`, { headers: { accept: "application/json", "user-agent": USER_AGENT } }, 8 * 1024 * 1024, 30_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      const j: any = await r.json();
      if (j == null || typeof j !== "object") throw new Error("bad payload");
      return j as T;
    } catch {
      if (attempt >= 1) throw new Error("DuckBench download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HANDLE = /^[a-z0-9][a-z0-9_-]{0,38}$/i;
const day = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined);
const round = (v: number) => Math.round(v * 1000) / 1000;
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

// Declared ids read like the names used elsewhere in the dataset: "claude-opus-5-5" → "Claude Opus 5.5", "gpt-6.1-sol" → "GPT-6.1 Sol"; other shapes stay as declared
export function modelLabel(id: string): string {
  const s = id.trim();
  const c = s.match(/^claude-([a-z]+)-(\d{1,2})(?:[-.](\d{1,2}))?(?:-\d{8})?$/i);
  if (c) return `Claude ${cap(c[1])} ${c[2]}${c[3] ? `.${c[3]}` : ""}`;
  const g = s.match(/^gpt-(\d+(?:\.\d+)?)(?:-([a-z]+))?$/i);
  if (g) return `GPT-${g[1]}${g[2] ? ` ${cap(g[2])}` : ""}`;
  return s;
}
const HARNESS: Record<string, string> = { "codex": "Codex", "codex-cli": "Codex", "claude-code": "Claude Code", "claude-app": "Claude app", "cursor": "Cursor", "gemini-cli": "Gemini CLI" };
export function harnessLabel(h?: string | null): string | undefined {
  const s = h?.trim();
  if (!s) return undefined;
  return HARNESS[s.toLowerCase().replace(/[\s_]+/g, "-")] ?? s;
}

export function agentOf(model: string | null | undefined, harness: string | null | undefined, evidence: string): AgentAttribution | undefined {
  const id = model?.trim();
  if (!id) return undefined;
  const tool = harnessLabel(harness);
  return { family: familyFromName(id) ?? "other-ai", model: modelLabel(id), ...(tool ? { tool } : {}), evidence, confidence: "high", role: "author" };
}

// An Arena bot is DuckBench's own reference duck (house easy / medium / hard): a baseline, not a participant
function botRecord(house: string, value: number, extra: string[]): RecordEntry {
  return { value, contributor: `Arena bot (${house})`, contributorKind: "method", isBaseline: true, description: ["DuckBench's house bot", ...extra].join(" · ") };
}
const bestOf = (values: number[], minimize: boolean) => (values.length ? (minimize ? Math.min(...values) : Math.max(...values)) : undefined);

function rankingNote(c: DuckChallenge, minimize: boolean, unit: string): string {
  const seeds = c.ranked_seed_count ?? 24;
  const miss = c.ranking?.miss_s;
  if (c.ranking?.kind === "finish") return `Ranked by finish time: the mean of the best half of ${seeds} hidden seeds${miss ? ` (a seed that never finishes counts as ${miss} s)` : ""}, lower is better.`;
  return `Ranked by ${unit || "score"}: the server re-runs each attempt on ${seeds} hidden seeds, ${minimize ? "lower" : "higher"} is better.`;
}

export function boardToProblem(c: DuckChallenge, entries: DuckAttempt[]): Problem {
  const minimize = c.ranking?.lower_is_better ?? c.lower_is_better === true;
  const unit = c.ranking?.unit ?? c.metric_unit ?? "";
  const records: RecordEntry[] = [];
  for (const e of entries ?? []) {
    if (!e || typeof e.result !== "number" || !Number.isFinite(e.result) || typeof e.handle !== "string" || !HANDLE.test(e.handle)) continue;
    const value = round(e.result);
    const trained = e.trained?.caption?.trim();
    if (e.house) { records.push(botRecord(e.house, value, [trained ?? ""].filter(Boolean))); continue; }
    const bits = [`rank ${e.rank ?? "–"}`, `best half of ${e.seed_count ?? c.ranked_seed_count ?? 24} hidden seeds`];
    if (typeof e.worst_result === "number" && Number.isFinite(e.worst_result)) bits.push(`worst seed ${round(e.worst_result)}${unit ? ` ${unit}` : ""}`);
    if (trained) bits.push(trained);
    if (e.exploit) bits.push(`"exploit" label${e.exploit_flags?.length ? `: ${e.exploit_flags.join(", ")}` : ""} (allowed, rank unchanged)`);
    const attemptUrl = e.attempt_id && /^[a-z0-9]{6,32}$/.test(e.attempt_id) ? `${SITE}/challenges/${c.id}/attempts/${e.attempt_id}` : undefined;
    const agent = agentOf(e.declared_model, undefined, `duckbench.app ${c.title} board: declared_model "${e.declared_model}" (self-reported by the duckbench CLI)`);
    records.push({
      value,
      date: day(e.submitted_at),
      contributor: e.handle,
      contributorKind: "person",
      contributorUrl: `${SITE}/@${e.handle}`,
      description: bits.join(" · "),
      ...(attemptUrl ? { submissionUrls: [attemptUrl] } : {}),
      isBaseline: false, // a player who ties the best bot is still a player
      isCurrentBest: e.rank === 1,
      ...(agent ? { agent } : {}),
    });
  }
  return {
    id: c.id,
    name: c.title,
    group: c.ranking?.kind === "finish" ? "Races" : "Scored",
    description: [c.tagline ? `${c.tagline}.` : "", c.what_counts ?? "", rankingNote(c, minimize, unit)].filter(Boolean).join(" "),
    metricName: c.ranking?.kind === "finish" ? "finish time" : (c.metric ?? "score").replace(/_/g, " "),
    ...(unit ? { metricUnit: unit } : {}),
    metricDirection: minimize ? "minimize" : "maximize",
    baseline: bestOf(records.filter((r) => r.isBaseline).map((r) => r.value), minimize),
    isOpen: true,
    records,
  };
}

export function ladderToProblem(c: DuckChallenge, rows: DuckLadderRow[]): Problem {
  const records: RecordEntry[] = [];
  for (const r of rows ?? []) {
    const e = r?.entry;
    if (!e || typeof r.rating !== "number" || !Number.isFinite(r.rating) || typeof e.handle !== "string" || !HANDLE.test(e.handle)) continue;
    const played = `${r.wins ?? 0}–${r.losses ?? 0}–${r.draws ?? 0} (W–L–D) in ${r.matches ?? 0} match${r.matches === 1 ? "" : "es"}`;
    if (e.house) { records.push(botRecord(e.house, r.rating, [played])); continue; }
    const bits = [`rank ${r.rank ?? "–"}`, played];
    if (r.rating_provisional) bits.push("provisional rating");
    else if (r.rating_margin) bits.push(`±${r.rating_margin}`);
    const trained = e.trained?.caption?.trim();
    if (trained) bits.push(trained);
    const model = e.agent?.model ?? e.declared_model;
    const agent = agentOf(model, e.agent?.harness, `duckbench.app ${c.title} ladder: entry agent model "${model}"${e.agent?.harness ? `, harness "${e.agent.harness}"` : ""} (self-reported by the duckbench CLI)`);
    records.push({
      value: r.rating,
      contributor: e.handle,
      contributorKind: "person",
      contributorUrl: `${SITE}/@${e.handle}`,
      description: bits.join(" · "),
      // no submission URL: duel duckscripts stay private (the match replays are public on the challenge page)
      isBaseline: false,
      isCurrentBest: r.rank === 1,
      ...(agent ? { agent } : {}),
    });
  }
  return {
    id: c.id,
    name: c.title,
    group: "Duels",
    description: [c.tagline ? `${c.tagline}.` : "", c.what_counts ?? "", "Duel: each match is 3 secret seeds played from both sides; the server schedules placement matches against the Arena bots, then rated matches against neighbours. Ranked by an Elo-like rating (provisional until 3 matches)."].filter(Boolean).join(" "),
    metricName: "rating",
    metricUnit: "Elo",
    metricDirection: "maximize",
    baseline: bestOf(records.filter((x) => x.isBaseline).map((x) => x.value), false),
    isOpen: true,
    records,
  };
}

export async function buildDuckBench(): Promise<LLMCompetition> {
  const { challenges } = await getJson<{ challenges: DuckChallenge[] }>("/api/challenges");
  if (!Array.isArray(challenges) || !challenges.length) throw new Error("DuckBench download failed");
  const list = challenges.filter((c) => typeof c?.id === "string" && SLUG.test(c.id) && typeof c.title === "string" && c.title.trim());
  const problems = await mapLimit(list, CONCURRENCY, async (c) => c.duel
    ? ladderToProblem(c, (await getJson<{ rows?: DuckLadderRow[] }>(`/api/pvp/${c.id}/leaderboard`)).rows ?? [])
    : boardToProblem(c, (await getJson<{ entries?: DuckAttempt[] }>(`/api/challenges/${c.id}/board`)).entries ?? []));
  const players = new Set(problems.flatMap((p) => p.records.filter((r) => !r.isBaseline).map((r) => r.contributor)));
  const ranked = problems.reduce((n, p) => n + p.records.filter((r) => !r.isBaseline).length, 0);
  const duels = list.filter((c) => c.duel).length;
  console.log(`    duckbench: ${problems.length} challenges (${duels} duels), ${ranked} ranked rows, ${players.size} players`);

  return {
    id: "duckbench",
    name: "DuckBench",
    tagline: "Your coding agent trains the Microduck robot duck in a MuJoCo sim and enters it in races and duels; the server re-runs every entry on hidden seeds.",
    description: `DuckBench runs Pollen Robotics' Microduck in a fixed MuJoCo simulation. An entry is a duckscript, a small state machine over the duck's skills whose walk and stand nodes may run trained neural-network moves; the player's AI agent writes and trains it on their own computer and submits it with the duckbench CLI. Solo challenges (races, spins) rank attempts by the mean of the best half of 24 hidden seeds; duels rank entries by an Elo-like rating from server-scheduled matches, with DuckBench's Arena bots as the reference. ${problems.length} challenges (${duels} duels), ${ranked} ranked entries from ${players.size} players. The model behind each entry is declared by the CLI (self-reported).`,
    url: `${SITE}/`,
    host: "website",
    status: "active",
    tags: ["robotics", "mujoco", "reinforcement-learning", "simulation", "microduck", "agents", "leaderboard"],
    domain: "robotics",
    images: [],
    organizer: { name: "DuckBench", url: `${SITE}/` },
    participation: {
      howToSubmit: "Tell your coding agent: \"read duckbench.app and win.\" It follows duckbench.app/skill.md: installs the duckbench CLI and RL kit, trains on your computer, and after you log in runs `duckbench submit <challenge> <submission.json>`. The server re-runs the entry; that run is the result.",
      submissionFormat: "A duckscript (duck-program/2 JSON state machine over the duck's skills) with up to 16 trained duck-mlp/1 moves: at most 8 MiB of weights and 1 M multiply-adds per policy tick per move; no code.",
      requirements: ["An AI coding agent (Claude Code, Codex, …)", "Node.js", "Python 3.12 via uv (training kit, ~1 GB)", "Apple-silicon Mac or Linux", "Google account to submit"],
      compute: "cpu",
      computeDetails: "Training runs on your own computer: Apple-silicon Macs (MLX learner) or Linux (CPU learner), about 13k env steps/s on a quiet Mac; Intel Macs are not supported. Ranked runs are re-simulated on DuckBench's server.",
      deadline: "rolling (no deadline)",
      rounds: "Duels: the server schedules placement matches against the Arena bots, then rated matches against neighbours on the board.",
      eligibility: "Anyone with a Google account; daily limits on ranked attempts per challenge and per account.",
      cost: "free",
      verification: "The server re-runs every attempt on 24 hidden seeds (duels: 3 secret seeds from both sides per match); sim exploits stay on the board with an \"exploit\" label, unstable physics invalidates an attempt. Models and harnesses are self-reported.",
    },
    venue: { type: "online", location: "duckbench.app" },
    quickstart: "# paste into your coding agent (Claude Code, Codex, …):\nread duckbench.app and win.\n# it follows https://duckbench.app/skill.md: installs the duckbench CLI, trains locally, and submits",
    links: [
      { label: "Challenges", url: `${SITE}/` },
      { label: "Instructions for agents (skill.md)", url: `${SITE}/skill.md` },
      { label: "Player guide", url: `${SITE}/guide.md` },
      { label: "How it works", url: `${SITE}/how-it-works` },
      { label: "Microduck (Pollen Robotics)", url: "https://github.com/pollen-robotics/microduck" },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
