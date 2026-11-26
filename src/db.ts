// The crawl's data in Supabase (Postgres), phase 0 of the move to a database: data/competitions.json, crawl-state.json,
// discovered.json, commit-dates.json, discoveries.json and agent-docs.json as rows in schema ocl (db/migrations). The crawler
// still reads and writes its files; after each run `scripts/db.ts sync` pushes them here and reads them back to check that
// nothing was lost. Curated inputs (corrections.json, social.json, seeds.json) stay in git, where they are reviewed.
//
// A field goes to its column only when it has the column's type; anything else, and any field without a column, goes to the
// row's `extra`, so files → rows → files gives back the same data (tests/db.test.ts runs it over the saved dataset).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import postgres from "postgres";
import type { Competition, CrawlResult, DiscoveredRepo, RecordEntry, RepoState } from "./types.js";
import { entryKey } from "./validation.js";

export type Sql = ReturnType<typeof postgres>;
type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;
type Kind = "text" | "num" | "bool" | "texts" | "json";
type Field = readonly [key: string, column: string, kind: Kind];

export const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));

/** Session pooler URL from Supabase → Connect (the direct host is IPv6-only, which GitHub's runners cannot reach) */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SUPABASE_DB_URL || env.POSTGRES_URL || undefined;
}

export function connect(url: string): Sql {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  // prepare: false works through Supabase's pooler in either mode (transaction mode has no prepared statements)
  return postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15, onnotice: () => {}, ssl: local ? false : "require" });
}

// ─── Files ⇄ rows ───────────────────────────────────────────────────────
const PG_TYPE: Record<Kind | "int", string> = { text: "text", num: "double precision", bool: "boolean", texts: "text[]", json: "jsonb", int: "integer" };
const FITS: Record<Kind, (v: unknown) => boolean> = {
  text: (v) => typeof v === "string",
  num: (v) => typeof v === "number" && Number.isFinite(v),
  bool: (v) => typeof v === "boolean",
  texts: (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
  json: (v) => v !== null && v !== undefined,
};

const COMPETITION: Field[] = [
  ["id", "id", "text"], ["name", "name", "text"], ["tagline", "tagline", "text"], ["description", "description", "text"], ["url", "url", "text"],
  ["repo", "repo", "json"], ["host", "host", "text"], ["status", "status", "text"], ["tags", "tags", "texts"], ["domain", "domain", "text"],
  ["images", "images", "texts"], ["organizer", "organizer", "json"], ["participation", "participation", "json"], ["venue", "venue", "json"],
  ["quickstart", "quickstart", "text"], ["links", "links", "json"], ["standard", "standard", "json"], ["agentPolicy", "agent_policy", "json"],
  ["agentDocs", "agent_docs", "json"], ["lastUpdated", "last_updated", "text"],
  ["participants", "participants", "json"], ["stats", "stats", "json"], ["agentStats", "agent_stats", "json"],
];
const PROBLEM: Field[] = [
  ["id", "id", "text"], ["name", "name", "text"], ["group", "grp", "text"], ["description", "description", "text"],
  ["metricName", "metric_name", "text"], ["metricUnit", "metric_unit", "text"], ["metricDirection", "metric_direction", "text"],
  ["baseline", "baseline", "num"], ["passMark", "pass_mark", "num"], ["isOpen", "is_open", "bool"], ["contested", "contested", "bool"],
];
const RECORD: Field[] = [
  ["date", "date", "text"], ["value", "value", "num"], ["contributor", "contributor", "text"], ["contributorKind", "contributor_kind", "text"],
  ["contributorUrl", "contributor_url", "text"], ["description", "description", "text"], ["submissionUrls", "submission_urls", "texts"],
  ["isCurrentBest", "is_current_best", "bool"], ["isBaseline", "is_baseline", "bool"], ["passed", "passed", "bool"],
];
const AGENT: Field[] = [
  ["family", "family", "text"], ["model", "model", "text"], ["tool", "tool", "text"], ["evidence", "evidence", "text"],
  ["confidence", "confidence", "text"], ["role", "role", "text"],
];
const REPO_STATE: Field[] = [
  ["pushedAt", "pushed_at", "text"], ["fingerprint", "fingerprint", "text"], ["verdict", "verdict", "text"], ["checkedAt", "checked_at", "text"],
  ["head", "head", "text"], ["sources", "sources", "texts"], ["live", "live", "bool"], ["liveFailedAt", "live_failed_at", "text"],
];
const DISCOVERED: Field[] = [
  ["owner", "owner", "text"], ["name", "name", "text"], ["url", "url", "text"], ["description", "description", "text"], ["stars", "stars", "num"],
  ["topics", "topics", "texts"], ["defaultBranch", "default_branch", "text"], ["pushedAt", "pushed_at", "text"], ["priority", "priority", "bool"],
];

// an own property even for "__proto__"
const put = (o: Row, k: string, v: unknown) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });

function columnsOf(o: object, fields: Field[], nested: string[] = []): Row {
  const row: Row = {}, extra: Row = {};
  const byKey = new Map(fields.map((f) => [f[0], f]));
  for (const [k, v] of Object.entries(o)) {
    if (nested.includes(k) || v === undefined) continue;
    const f = byKey.get(k);
    if (f && FITS[f[2]](v)) row[f[1]] = v; else put(extra, k, v);
  }
  row.extra = extra;
  return row;
}
function objectOf(row: Row, fields: Field[]): Row {
  const o: Row = {};
  for (const [k, col] of fields) if (row[col] !== null && row[col] !== undefined) o[k] = row[col];
  for (const [k, v] of Object.entries((row.extra ?? {}) as Row)) put(o, k, v);
  return o;
}

/** A record's row id: what identifies the entry, hashed. The same entry keeps its row (and first_seen_at) across crawls. */
export function recordId(competitionId: string, problemId: string, r: RecordEntry): string {
  return createHash("sha256").update(JSON.stringify([competitionId, problemId, r.contributor ?? null, r.value, r.date ?? null, r.submissionUrls?.[0] ?? null])).digest("base64url").slice(0, 22);
}

export interface CompetitionRows { competitions: Row[]; problems: Row[]; records: Row[]; attributions: Row[] }

export function competitionRows(comps: Competition[]): CompetitionRows {
  const out: CompetitionRows = { competitions: [], problems: [], records: [], attributions: [] };
  comps.forEach((c, ci) => {
    out.competitions.push({ ...columnsOf(c, COMPETITION, ["problems"]), entry_key: entryKey(c), position: ci });
    c.problems.forEach((p, pi) => {
      out.problems.push({ ...columnsOf(p, PROBLEM, ["records"]), competition_id: c.id, position: pi });
      // identical rows (the same entry listed twice) are told apart by their order
      const seen = new Map<string, number>();
      p.records.forEach((r, ri) => {
        const base = recordId(c.id, p.id, r), n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const rid = n ? `${base}~${n}` : base;
        out.records.push({ ...columnsOf(r, RECORD, ["agent"]), rid, competition_id: c.id, problem_id: p.id, position: ri });
        if (r.agent) out.attributions.push({ ...columnsOf(r.agent, AGENT), rid });
      });
    });
  });
  return out;
}

const byPosition = (a: Row, b: Row) => Number(a.position) - Number(b.position);
const pair = (a: unknown, b: unknown) => `${a}\u0000${b}`;

export function competitionsFromRows(rows: CompetitionRows): Competition[] {
  const agents = new Map(rows.attributions.map((a) => [a.rid, objectOf(a, AGENT)]));
  const records = new Map<string, Row[]>();
  for (const r of [...rows.records].sort(byPosition)) {
    const rec = objectOf(r, RECORD), agent = agents.get(r.rid);
    if (agent) rec.agent = agent;
    const k = pair(r.competition_id, r.problem_id);
    records.set(k, [...(records.get(k) ?? []), rec]);
  }
  const problems = new Map<unknown, Row[]>();
  for (const p of [...rows.problems].sort(byPosition)) {
    problems.set(p.competition_id, [...(problems.get(p.competition_id) ?? []), { ...objectOf(p, PROBLEM), records: records.get(pair(p.competition_id, p.id)) ?? [] }]);
  }
  return [...rows.competitions].sort(byPosition).map((c) => ({ ...objectOf(c, COMPETITION), problems: problems.get(c.id) ?? [] }) as unknown as Competition);
}

// ─── The data directory ─────────────────────────────────────────────────
export interface DataFiles {
  result: CrawlResult;
  state: Record<string, RepoState>;
  discovered: DiscoveredRepo[];
  commitDates: Record<string, string | null>;
  documents: Record<string, string>;      // file name → its exact text
}
const DOCUMENTS = ["discoveries.json", "agent-docs.json"];

export function readDataFiles(root: string): DataFiles {
  const dir = join(root, "data");
  const json = <T>(file: string, fallback: T): T => (existsSync(join(dir, file)) ? JSON.parse(readFileSync(join(dir, file), "utf-8")) : fallback);
  const result = json<CrawlResult | null>("competitions.json", null);
  if (!result) throw new Error("data/competitions.json not found");
  return {
    result,
    state: json("crawl-state.json", {}),
    discovered: json("discovered.json", []),
    commitDates: json("commit-dates.json", {}),
    documents: Object.fromEntries(DOCUMENTS.filter((f) => existsSync(join(dir, f))).map((f) => [f, readFileSync(join(dir, f), "utf-8")])),
  };
}

const sortedKeys = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** The files as the crawler writes them (main.ts, commitDates.ts) */
export function writeDataFiles(root: string, d: DataFiles): void {
  const dir = join(root, "data");
  writeFileSync(join(dir, "competitions.json"), JSON.stringify(d.result, null, 2));
  writeFileSync(join(dir, "crawl-state.json"), JSON.stringify(sortedKeys(d.state), null, 2) + "\n");
  writeFileSync(join(dir, "discovered.json"), JSON.stringify(d.discovered, null, 2));
  writeFileSync(join(dir, "commit-dates.json"), JSON.stringify(sortedKeys(d.commitDates), null, 2) + "\n");
  for (const [file, text] of Object.entries(d.documents)) if (DOCUMENTS.includes(file)) writeFileSync(join(dir, file), text);
}

/** Where two datasets first differ ("$.result.competitions.3.problems.0.records.12.value"), or null when they are the same */
export function firstDifference(a: unknown, b: unknown, path = "$"): string | null {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== (b as unknown[]).length) return `${path}: ${a.length} items vs ${(b as unknown[]).length}`;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference((a as Row)[k], (b as Row)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return path;
}

export function compare(db: DataFiles | null, files: DataFiles): string | null {
  if (!db) return "nothing in the database yet";
  const { documents: a, ...restA } = db, { documents: b, ...restB } = files;
  const d = firstDifference(restA, restB);
  if (d) return d;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) return `$.documents.${k}`;
  return null;
}

// ─── SQL ────────────────────────────────────────────────────────────────
interface Table { name: string; fields: Field[]; keys: [string, keyof typeof PG_TYPE][]; conflict: string[]; touch?: string }
const T: Record<string, Table> = {
  competition: { name: "competition", fields: COMPETITION, keys: [["entry_key", "text"], ["position", "int"]], conflict: ["id"] },
  problem: { name: "problem", fields: PROBLEM, keys: [["competition_id", "text"], ["position", "int"]], conflict: ["competition_id", "id"] },
  record: { name: "record", fields: RECORD, keys: [["rid", "text"], ["competition_id", "text"], ["problem_id", "text"], ["position", "int"]], conflict: ["rid"], touch: "last_seen_at" },
  attribution: { name: "attribution", fields: AGENT, keys: [["rid", "text"]], conflict: ["rid"] },
  repo_state: { name: "repo_state", fields: REPO_STATE, keys: [["repo_key", "text"]], conflict: ["repo_key"] },
  discovered_repo: { name: "discovered_repo", fields: DISCOVERED, keys: [["position", "int"]], conflict: ["position"] },
};
const q = (c: string) => `"${c}"`;
const columns = (t: Table): [string, string][] => [...t.keys.map(([c, k]): [string, string] => [c, PG_TYPE[k]]), ...t.fields.map(([, c, k]): [string, string] => [c, PG_TYPE[k]]), ["extra", "jsonb"]];
const chunks = <X>(xs: X[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// One JSON parameter per batch, expanded by Postgres: no per-column parameters, and the column types come from the table spec
async function upsert(tx: Tx, t: Table, rows: Row[]): Promise<void> {
  const cols = columns(t), names = cols.map(([c]) => q(c)).join(", ");
  const set = [...cols.filter(([c]) => !t.conflict.includes(c)).map(([c]) => `${q(c)} = excluded.${q(c)}`), ...(t.touch ? [`${q(t.touch)} = now()`] : [])];
  const text = `insert into ocl.${t.name} (${names}) select ${names} from jsonb_to_recordset($1::text::jsonb) as x(${cols.map(([c, ty]) => `${q(c)} ${ty}`).join(", ")}) on conflict (${t.conflict.map(q).join(", ")}) do update set ${set.join(", ")}`;
  for (const batch of chunks(rows, 2000)) await tx.unsafe(text, [JSON.stringify(batch)]);
}
// Rows whose key is not in the pushed set go: the database mirrors the files
async function prune(tx: Tx, t: Table, rows: Row[]): Promise<number> {
  const keys = t.conflict, types = new Map(columns(t));
  const res = await tx.unsafe(`delete from ocl.${t.name} t where not exists (select 1 from jsonb_to_recordset($1::text::jsonb) as x(${keys.map((k) => `${q(k)} ${types.get(k)}`).join(", ")}) where ${keys.map((k) => `x.${q(k)} = t.${q(k)}`).join(" and ")})`, [JSON.stringify(rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]]))))]);
  return res.count;
}

/** Applies db/migrations/*.sql that have not run yet, in name order. Returns the ones it applied. */
export async function migrate(sql: Sql, dir = MIGRATIONS_DIR): Promise<string[]> {
  await sql.unsafe("create schema if not exists ocl; create table if not exists ocl.schema_migrations (version text primary key, applied_at timestamptz not null default now())").simple();
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('ocl:migrate'))`;
    const done = new Set((await tx`select version from ocl.schema_migrations`).map((r) => r.version as string));
    for (const file of readdirSync(dir).filter((f) => /^\d+_[\w-]+\.sql$/.test(f)).sort()) {
      if (done.has(file)) continue;
      await tx.unsafe(readFileSync(join(dir, file), "utf-8")).simple();
      await tx`insert into ocl.schema_migrations (version) values (${file})`;
      applied.push(file);
    }
  });
  return applied;
}

export interface PushSummary { competitions: number; problems: number; records: number; attributions: number; removed: number }

/** Writes the files' data in one transaction; rows the files no longer have are deleted. */
export async function push(sql: Sql, d: DataFiles, run: { mode: string; gitSha?: string }): Promise<PushSummary> {
  const rows = competitionRows(d.result.competitions);
  const states = Object.entries(d.state).map(([repo_key, s]) => ({ ...columnsOf(s, REPO_STATE), repo_key }));
  const discovered = d.discovered.map((r, position) => ({ ...columnsOf(r, DISCOVERED), position }));
  const dates = Object.entries(d.commitDates).map(([sha, day]) => ({ sha, day }));
  let removed = 0;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('ocl:push'))`;
    // parents first: a child row needs its parent, and a parent that goes takes its children with it
    await upsert(tx, T.competition, rows.competitions); removed += await prune(tx, T.competition, rows.competitions);
    await upsert(tx, T.problem, rows.problems); removed += await prune(tx, T.problem, rows.problems);
    await upsert(tx, T.record, rows.records); removed += await prune(tx, T.record, rows.records);
    await upsert(tx, T.attribution, rows.attributions); removed += await prune(tx, T.attribution, rows.attributions);
    await upsert(tx, T.repo_state, states); await prune(tx, T.repo_state, states);
    await upsert(tx, T.discovered_repo, discovered); await prune(tx, T.discovered_repo, discovered);
    await tx.unsafe(`insert into ocl.commit_date (sha, day) select sha, day from jsonb_to_recordset($1::text::jsonb) as x(sha text, day text) on conflict (sha) do update set day = excluded.day`, [JSON.stringify(dates)]);
    await tx.unsafe(`delete from ocl.commit_date t where t.sha not in (select jsonb_array_elements_text($1::text::jsonb))`, [JSON.stringify(dates.map((r) => r.sha))]);
    for (const [key, body] of Object.entries(d.documents)) {
      await tx`insert into ocl.document (key, body) values (${key}, ${body}::text::json) on conflict (key) do update set body = excluded.body, updated_at = now() where document.body::text is distinct from excluded.body::text`;
    }
    await tx`delete from ocl.document where key <> all(${Object.keys(d.documents)}::text[])`;
    await tx`insert into ocl.crawl_run (mode, crawled_at, errors, competitions, records, git_sha)
      values (${run.mode}, ${d.result.crawledAt}, ${JSON.stringify(d.result.errors ?? [])}::text::jsonb, ${rows.competitions.length}, ${rows.records.length}, ${run.gitSha ?? null})`;
  });
  return { competitions: rows.competitions.length, problems: rows.problems.length, records: rows.records.length, attributions: rows.attributions.length, removed };
}

/** The data as of the last push, read in one snapshot; null when nothing was pushed yet. */
export async function load(sql: Sql): Promise<DataFiles | null> {
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    // float8 comes back as text: Supabase sessions run with extra_float_digits = 0, which rounds it to 15 digits; above 0 it is
    // the shortest text that parses back to the same number
    await tx`set local extra_float_digits = 3`;
    const [run] = await tx`select crawled_at, errors from ocl.crawl_run order by id desc limit 1`;
    if (!run) return null;
    const competitions = await tx`select * from ocl.competition order by position`;
    const problems = await tx`select * from ocl.problem order by competition_id, position`;
    const records = await tx`select * from ocl.record order by competition_id, problem_id, position`;
    const attributions = await tx`select * from ocl.attribution`;
    const states = await tx`select * from ocl.repo_state order by repo_key`;
    const discovered = await tx`select * from ocl.discovered_repo order by position`;
    const dates = await tx`select sha, day from ocl.commit_date order by sha`;
    const docs = await tx`select key, body::text as body from ocl.document order by key`;
    return {
      result: { crawledAt: run.crawled_at, competitions: competitionsFromRows({ competitions, problems, records, attributions }), errors: run.errors },
      state: Object.fromEntries(states.map((s) => [s.repo_key, objectOf(s, REPO_STATE)])) as unknown as Record<string, RepoState>,
      discovered: discovered.map((r) => objectOf(r, DISCOVERED)) as unknown as DiscoveredRepo[],
      commitDates: Object.fromEntries(dates.map((r) => [r.sha, r.day])),
      documents: Object.fromEntries(docs.map((r) => [r.key, r.body])),
    } satisfies DataFiles;
  });
}
