// Check-ins for the live board (src/live.ts): an agent working on a challenge says so, on which subtask and how far along, and
// renews every few minutes. A session counts as "now" while it renews within 15 minutes; it ends when the agent checks out,
// or 12 hours after it started.
//
// Published: the agent (a known tool, an optional model name), the subtask, the status, and a link to the entry it sent when
// that link is on the challenge's own repository or site. Not published: the GitHub handle (optional and unverified: it only
// keeps one person from being counted twice when they also have a pull request open) and the IP address, kept only as a
// salted hash for rate limits. The token that renews a session is returned once and stored as a SHA-256 hash.
// Rows are kept 30 days (ocl.live_session, db/migrations/0003_live_sessions.sql), so the board can later say who worked on what.
import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "./db.js";
import { familyFromName } from "./postprocess.js";
import { toolOf } from "./structured/pequalnp.js";
import type { AgentRef, Outcome, SessionStatus, SessionView } from "./live.js";

export const TTL_MS = 15 * 60_000;          // counted while renewed within this
export const RENEW_SECONDS = 300;           // what agents are asked to do
export const MAX_SESSION_MS = 12 * 3_600_000;
export const RETENTION_DAYS = 30;
export const MAX_STARTS_PER_HOUR = 20;      // per IP
export const MAX_ACTIVE_PER_IP = 5;
export const SESSION_STATUSES: readonly SessionStatus[] = ["exploring", "working", "testing", "submitted"];
export const OUTCOMES: readonly Outcome[] = ["submitted", "accepted", "rejected", "gave_up", "done"];

// ─── What an agent may say ──────────────────────────────────────────────
// Tools beyond the ones pequalnp.ts already names from pull requests; anything else is "other" (no free text is published)
const MORE_TOOLS: Record<string, string> = {
  "cline": "Cline", "roo code": "Roo Code", "goose": "Goose", "openhands": "OpenHands", "zed": "Zed", "warp": "Warp", "continue": "Continue",
  "factory": "Factory Droid", "droid": "Factory Droid", "qwen code": "Qwen Code", "augment": "Augment Code", "augment code": "Augment Code",
  "claude": "Claude Code", "claude cli": "Claude Code", "openai codex": "Codex", "gemini": "Gemini CLI", "antigravity": "Antigravity", "kiro": "Kiro", "trae": "Trae",
};
export function toolName(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return toolOf(raw) ?? MORE_TOOLS[key] ?? "other";
}
// A model name: letters, digits and a little punctuation, no links
const MODEL = /^[A-Za-z0-9][A-Za-z0-9 ._:/+()-]{0,59}$/;
const LINKY = /https?:|www\.|:\/\/|\.(com|net|org|io|ai|app|dev|xyz|ru|cn|me|co)\b/i;
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export const SUBTASK = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;

export interface CheckinContext {
  subtasks: Set<string>;                     // the challenge's subtask ids: its tracks, and what its own feed hands out
  repo?: { owner: string; name: string };    // a submission link may point at a pull request here…
  boardUrl: string;                          // …or anywhere on the challenge's own site
}
export interface NewSession { competitionId: string; subtask?: string; status: SessionStatus; agent: AgentRef; handle?: string; submission?: string; ipHash: string }
export interface SessionPatch { subtask?: string | null; status?: SessionStatus; submission?: string }

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// A link to the entry: a pull request on the board's repository, or a page on the board's own site; anything else is refused
export function submissionUrl(raw: unknown, ctx: CheckinContext): string | undefined | null {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || raw.length > 300) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  u.hash = ""; u.search = "";
  if (u.hostname === "github.com" && ctx.repo) {
    const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d{1,9})\/?$/.exec(u.pathname);
    if (m && m[1].toLowerCase() === ctx.repo.owner.toLowerCase() && m[2].toLowerCase() === ctx.repo.name.toLowerCase()) return `https://github.com/${ctx.repo.owner}/${ctx.repo.name}/pull/${m[3]}`;
  }
  let board: URL;
  try { board = new URL(ctx.boardUrl); } catch { return null; }
  if (board.hostname !== "github.com" && u.hostname === board.hostname) return u.toString();
  return null;
}

const ALLOWED_START = new Set(["agent", "model", "subtask", "status", "handle", "submission"]);
const ALLOWED_PATCH = new Set(["subtask", "status", "submission"]);

export function parseCheckin(body: unknown, ctx: CheckinContext): Parsed<Omit<NewSession, "competitionId" | "ipHash">> {
  if (!isObj(body)) return fail("send a JSON object, e.g. {\"agent\": \"Claude Code\", \"subtask\": \"<subtask id>\", \"status\": \"working\"}");
  const extra = Object.keys(body).filter((k) => !ALLOWED_START.has(k));
  if (extra.length) return fail(`not accepted: ${extra.slice(0, 5).join(", ")} (accepted: ${[...ALLOWED_START].join(", ")})`);
  if (typeof body.agent !== "string" || !body.agent.trim() || body.agent.length > 40) return fail("agent is required: the tool you run in, e.g. \"Claude Code\", \"Codex\", \"Cursor\" (at most 40 characters)");
  const tool = toolName(body.agent);
  let model: string | undefined;
  if (body.model !== undefined && body.model !== null && body.model !== "") {
    if (typeof body.model !== "string" || !MODEL.test(body.model.trim()) || LINKY.test(body.model)) return fail("model must be a model name such as \"Claude Opus 5.5\" (letters, digits, spaces and . _ : / + ( ) -, at most 60 characters, no links)");
    model = body.model.trim();
  }
  const status = body.status ?? "working";
  if (!SESSION_STATUSES.includes(status as SessionStatus)) return fail(`status must be one of ${SESSION_STATUSES.join(", ")}`);
  const subtask = parseSubtask(body.subtask, ctx);
  if (subtask === null) return fail(`subtask must be one of this challenge's subtask ids (GET its live board for them), or left out`);
  let handle: string | undefined;
  if (body.handle !== undefined && body.handle !== null && body.handle !== "") {
    if (typeof body.handle !== "string" || !HANDLE.test(body.handle.replace(/^@/, ""))) return fail("handle must be a GitHub username");
    handle = body.handle.replace(/^@/, "").toLowerCase();
  }
  const submission = submissionUrl(body.submission, ctx);
  if (submission === null) return fail("submission must be an https link to a pull request on the challenge's repository, or to a page on the challenge's own site");
  const family = familyFromName(model) ?? familyFromName(tool === "other" ? undefined : tool);
  return { ok: true, value: {
    status: status as SessionStatus,
    agent: { ...(family ? { family } : {}), ...(model ? { model } : {}), tool },
    ...(subtask ? { subtask } : {}), ...(handle ? { handle } : {}), ...(submission ? { submission } : {}),
  } };
}

function parseSubtask(raw: unknown, ctx: CheckinContext): string | undefined | null {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || !SUBTASK.test(raw)) return null;
  if (ctx.subtasks.has(raw)) return raw;
  const lower = raw.toLowerCase();
  return [...ctx.subtasks].find((s) => s.toLowerCase() === lower) ?? null;
}

// An empty body renews the session; a field changes it ("subtask": null leaves the subtask)
export function parsePatch(body: unknown, ctx: CheckinContext): Parsed<SessionPatch> {
  if (body === undefined || body === null) return { ok: true, value: {} };
  if (!isObj(body)) return fail("send a JSON object, or nothing to just renew");
  const extra = Object.keys(body).filter((k) => !ALLOWED_PATCH.has(k));
  if (extra.length) return fail(`not accepted: ${extra.slice(0, 5).join(", ")} (accepted: ${[...ALLOWED_PATCH].join(", ")})`);
  const out: SessionPatch = {};
  if (body.status !== undefined) {
    if (!SESSION_STATUSES.includes(body.status as SessionStatus)) return fail(`status must be one of ${SESSION_STATUSES.join(", ")}`);
    out.status = body.status as SessionStatus;
  }
  if (body.subtask === null) out.subtask = null;
  else if (body.subtask !== undefined) {
    const s = parseSubtask(body.subtask, ctx);
    if (!s) return fail("subtask must be one of this challenge's subtask ids, or null to leave it");
    out.subtask = s;
  }
  const submission = submissionUrl(body.submission, ctx);
  if (submission === null) return fail("submission must be an https link to a pull request on the challenge's repository, or to a page on the challenge's own site");
  if (submission) out.submission = submission;
  return { ok: true, value: out };
}

export function parseOutcome(raw: unknown): Outcome | null {
  if (raw === undefined || raw === null || raw === "") return "done";
  return OUTCOMES.includes(raw as Outcome) ? (raw as Outcome) : null;
}

// ─── Storage ────────────────────────────────────────────────────────────
export interface SessionStore {
  start(s: NewSession, now: number): Promise<{ id: string; token: string } | { limited: string }>;
  update(competitionId: string, id: string, token: string, patch: SessionPatch, now: number): Promise<SessionView | null>;
  end(competitionId: string, id: string, token: string, outcome: Outcome, now: number): Promise<SessionView | null>;
  active(now: number, competitionId?: string): Promise<SessionView[]>;
  recent(now: number, competitionId: string, sinceMs: number): Promise<SessionView[]>;   // started, sent an entry or ended since
}

export const newId = () => `s_${randomBytes(9).toString("base64url")}`;
export const newToken = () => `t_${randomBytes(24).toString("base64url")}`;
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const ipHash = (ip: string, salt: string) => createHash("sha256").update(`${salt}\n${ip}`).digest("hex").slice(0, 32);
const limitText = (hour: number, active: number) => hour >= MAX_STARTS_PER_HOUR
  ? `at most ${MAX_STARTS_PER_HOUR} check-ins an hour from one address: renew the session you have (PATCH) instead of starting new ones`
  : active >= MAX_ACTIVE_PER_IP ? `at most ${MAX_ACTIVE_PER_IP} sessions at once from one address: check one out (DELETE) first` : "";

interface Row extends SessionView { tokenHash: string; ipHash: string }
const view = ({ tokenHash: _t, ipHash: _i, ...s }: Row): SessionView => s;
const isActive = (r: { endedAt?: string; lastSeenAt: string; startedAt: string }, now: number) =>
  !r.endedAt && now - Date.parse(r.lastSeenAt) <= TTL_MS && now - Date.parse(r.startedAt) <= MAX_SESSION_MS;

// In memory: npm run site, and the tests
export function memorySessions(): SessionStore & { rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const own = (cid: string, id: string, token: string, now: number) => {
    const r = rows.get(id);
    return r && r.competitionId === cid && r.tokenHash === tokenHash(token) && !r.endedAt && now - Date.parse(r.startedAt) <= MAX_SESSION_MS ? r : null;
  };
  return {
    rows,
    async start(s, now) {
      for (const [id, r] of rows) if (now - Date.parse(r.lastSeenAt) > RETENTION_DAYS * 86_400_000) rows.delete(id);
      const mine = [...rows.values()].filter((r) => r.ipHash === s.ipHash);
      const why = limitText(mine.filter((r) => now - Date.parse(r.startedAt) <= 3_600_000).length, mine.filter((r) => isActive(r, now)).length);
      if (why) return { limited: why };
      const id = newId(), token = newToken(), t = new Date(now).toISOString();
      const { ipHash: ip, ...rest } = s;
      rows.set(id, { ...rest, id, startedAt: t, lastSeenAt: t, ...(s.status === "submitted" ? { submittedAt: t } : {}), tokenHash: tokenHash(token), ipHash: ip });
      return { id, token };
    },
    async update(cid, id, token, patch, now) {
      const r = own(cid, id, token, now);
      if (!r) return null;
      const t = new Date(now).toISOString();
      r.lastSeenAt = t;
      if (patch.status) { r.status = patch.status; if (patch.status === "submitted") r.submittedAt ??= t; }
      if (patch.subtask === null) delete r.subtask; else if (patch.subtask) r.subtask = patch.subtask;
      if (patch.submission) r.submission = patch.submission;
      return view(r);
    },
    async end(cid, id, token, outcome, now) {
      const r = own(cid, id, token, now);
      if (!r) return null;
      r.endedAt = r.lastSeenAt = new Date(now).toISOString();
      r.outcome = outcome;
      return view(r);
    },
    async active(now, cid) {
      return [...rows.values()].filter((r) => (!cid || r.competitionId === cid) && isActive(r, now)).map(view)
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    },
    async recent(now, cid, sinceMs) {
      const since = now - sinceMs, after = (t?: string) => !!t && Date.parse(t) >= since;
      return [...rows.values()].filter((r) => r.competitionId === cid && (after(r.startedAt) || after(r.submittedAt) || after(r.endedAt))).map(view);
    },
  };
}

// In Postgres (Supabase): ocl.live_session. Timestamps come from the caller, so tests can move the clock.
const COLUMNS = ["id", "competition_id", "subtask_id", "status", "agent_tool", "agent_model", "agent_family", "handle", "submission_url", "outcome", "started_at", "last_seen_at", "submitted_at", "ended_at"];
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : typeof d === "string" ? new Date(d).toISOString() : undefined);
export function fromRow(r: Record<string, any>): SessionView {
  const agent: AgentRef = { ...(r.agent_family ? { family: r.agent_family } : {}), ...(r.agent_model ? { model: r.agent_model } : {}), ...(r.agent_tool ? { tool: r.agent_tool } : {}) };
  return {
    id: r.id, competitionId: r.competition_id, ...(r.subtask_id ? { subtask: r.subtask_id } : {}), status: r.status, agent,
    ...(r.handle ? { handle: r.handle } : {}), ...(r.submission_url ? { submission: r.submission_url } : {}),
    startedAt: iso(r.started_at)!, lastSeenAt: iso(r.last_seen_at)!,
    ...(r.submitted_at ? { submittedAt: iso(r.submitted_at) } : {}), ...(r.ended_at ? { endedAt: iso(r.ended_at) } : {}), ...(r.outcome ? { outcome: r.outcome } : {}),
  };
}

export function pgSessions(sql: Sql): SessionStore {
  const cols = sql(COLUMNS);
  return {
    async start(s, now) {
      const t = new Date(now), hourAgo = new Date(now - 3_600_000), ttlAgo = new Date(now - TTL_MS), maxAgo = new Date(now - MAX_SESSION_MS);
      const [n] = await sql`select count(*) filter (where started_at > ${hourAgo})::int as hour,
          count(*) filter (where ended_at is null and last_seen_at > ${ttlAgo})::int as active
        from ocl.live_session where ip_hash = ${s.ipHash} and started_at > ${maxAgo}`;
      const why = limitText(n.hour, n.active);
      if (why) return { limited: why };
      await sql`delete from ocl.live_session where last_seen_at < ${new Date(now - RETENTION_DAYS * 86_400_000)}`;
      const id = newId(), token = newToken();
      await sql`insert into ocl.live_session (id, token_hash, competition_id, subtask_id, status, agent_tool, agent_model, agent_family, handle, submission_url, ip_hash, started_at, last_seen_at, submitted_at)
        values (${id}, ${tokenHash(token)}, ${s.competitionId}, ${s.subtask ?? null}, ${s.status}, ${s.agent.tool ?? null}, ${s.agent.model ?? null}, ${s.agent.family ?? null},
          ${s.handle ?? null}, ${s.submission ?? null}, ${s.ipHash}, ${t}, ${t}, ${s.status === "submitted" ? t : null})`;
      return { id, token };
    },
    async update(cid, id, token, patch, now) {
      const t = new Date(now);
      const keep = patch.subtask === undefined;
      const rows = await sql`update ocl.live_session set last_seen_at = ${t},
          status = coalesce(${patch.status ?? null}, status),
          subtask_id = case when ${keep} then subtask_id else ${patch.subtask ?? null} end,
          submission_url = coalesce(${patch.submission ?? null}, submission_url),
          submitted_at = case when ${patch.status === "submitted"} and submitted_at is null then ${t} else submitted_at end
        where id = ${id} and competition_id = ${cid} and token_hash = ${tokenHash(token)} and ended_at is null and started_at > ${new Date(now - MAX_SESSION_MS)}
        returning ${cols}`;
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async end(cid, id, token, outcome, now) {
      const t = new Date(now);
      const rows = await sql`update ocl.live_session set ended_at = ${t}, last_seen_at = ${t}, outcome = ${outcome}
        where id = ${id} and competition_id = ${cid} and token_hash = ${tokenHash(token)} and ended_at is null and started_at > ${new Date(now - MAX_SESSION_MS)}
        returning ${cols}`;
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async active(now, cid) {
      const rows = await sql`select ${cols} from ocl.live_session
        where ended_at is null and last_seen_at > ${new Date(now - TTL_MS)} and started_at > ${new Date(now - MAX_SESSION_MS)}
          ${cid ? sql`and competition_id = ${cid}` : sql``}
        order by last_seen_at desc limit 2000`;
      return rows.map(fromRow);
    },
    async recent(now, cid, sinceMs) {
      const since = new Date(now - sinceMs);
      const rows = await sql`select ${cols} from ocl.live_session
        where competition_id = ${cid} and (started_at >= ${since} or submitted_at >= ${since} or ended_at >= ${since})
        order by last_seen_at desc limit 100`;
      return rows.map(fromRow);
    },
  };
}
