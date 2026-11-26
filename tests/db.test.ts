import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, competitionRows, competitionsFromRows, connect, firstDifference, load, migrate, push, readDataFiles, recordId, writeDataFiles } from "../src/db.js";
import { pgSessions, TTL_MS, MAX_ACTIVE_PER_IP } from "../src/sessions.js";
import type { Competition } from "../src/types.js";
import { createAccountsHandler, gistDescription } from "../src/accounts.js";
import { connectAccounts, pgStore } from "../src/accountsDb.js";

const ROOT = process.cwd();
const saved = () => readDataFiles(ROOT);
const clone = <T>(v: T): T => structuredClone(v);

test("every saved competition comes back from its rows unchanged", () => {
  const { competitions } = saved().result;
  assert.deepEqual(competitionsFromRows(competitionRows(competitions)), competitions);
});

test("a field without a column, or with the wrong type for its column, survives in extra", () => {
  const [c] = clone(saved().result.competitions);
  const odd = { ...c, events: [{ name: "Brunch", date: "2026-12-01" }], tags: "not-a-list", __proto__x: 1 } as unknown as Competition;
  Object.defineProperty(odd, "__proto__", { value: { polluted: true }, enumerable: true });
  odd.problems[0].records[0] = { ...odd.problems[0].records[0], value: "n/a" as unknown as number, ...({ verifiedBy: "lean" } as object) };
  const rows = competitionRows([odd]);
  assert.deepEqual(rows.competitions[0].extra, { events: odd["events" as keyof Competition], tags: "not-a-list", __proto__x: 1, ["__proto__"]: { polluted: true } });
  assert.equal(rows.competitions[0].tags, undefined);
  assert.equal(rows.records[0].value, undefined);
  const back = competitionsFromRows(rows)[0];
  assert.deepEqual(back, odd);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("record ids are stable, unique, and tell identical rows apart by order", () => {
  const { competitions } = saved().result;
  const a = competitionRows(competitions).records.map((r) => r.rid), b = competitionRows(clone(competitions)).records.map((r) => r.rid);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
  const rec = { contributor: "alice", value: 1.5, date: "2026-11-01" };
  const c = { ...clone(competitions[0]), problems: [{ ...clone(competitions[0].problems[0]), records: [rec, { ...rec }, { ...rec, value: 1.4 }] }] };
  const rids = competitionRows([c]).records.map((r) => r.rid as string);
  assert.equal(rids[1], `${rids[0]}~1`);
  assert.equal(rids[0], recordId(c.id, c.problems[0].id, rec));
  assert.notEqual(rids[2], rids[0]);   // a new value is a new entry
});

test("a difference is reported by its path", () => {
  const d = saved(), changed = clone(d);
  const i = d.result.competitions.findIndex((c) => c.problems[0]?.records.length);
  changed.result.competitions[i].problems[0].records[0].value += 1;
  assert.equal(compare(d, d), null);
  assert.equal(compare(d, changed), `$.result.competitions.${i}.problems.0.records.0.value`);
  assert.equal(compare(null, d), "nothing in the database yet");
  assert.equal(firstDifference([1, 2], [1, 2, 3]), "$: 2 items vs 3");
  assert.equal(compare({ ...d, documents: { ...d.documents, "agent-docs.json": "{}\n" } }, d), "$.documents.agent-docs.json");
});

test("the data files are written back byte for byte", () => {
  const dir = mkdtempSync(join(tmpdir(), "ocl-data-"));
  try {
    cpSync(join(ROOT, "data"), join(dir, "data"), { recursive: true });
    writeDataFiles(dir, readDataFiles(dir));
    for (const f of ["competitions.json", "crawl-state.json", "discovered.json", "commit-dates.json", "discoveries.json", "agent-docs.json"]) {
      assert.equal(readFileSync(join(dir, "data", f), "utf-8"), readFileSync(join(ROOT, "data", f), "utf-8"), f);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Against a real Postgres: TEST_DATABASE_URL on this machine only, since the test drops schema ocl (CI: security.yml's service)
const DB = process.env.TEST_DATABASE_URL;
const local = !!DB && /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB);

test("push and load round-trip the saved data through Postgres", { skip: !local && "TEST_DATABASE_URL (localhost) not set" }, async () => {
  const sql = connect(DB!);
  try {
    await sql.unsafe("drop schema if exists ocl cascade");
    assert.deepEqual(await migrate(sql), ["0001_init.sql", "0002_accounts.sql", "0003_live_sessions.sql"]);
    assert.deepEqual(await migrate(sql), []);
    assert.equal(await load(sql), null);
    await sql`set extra_float_digits = 0`;   // as on Supabase (max: 1, so this session is every query's)

    const d = saved();
    const s = await push(sql, d, { mode: "test" });
    assert.equal(s.records, d.result.competitions.reduce((n, c) => n + c.problems.reduce((m, p) => m + p.records.length, 0), 0));
    assert.equal(compare(await load(sql), d), null);
    assert.equal((await load(sql))!.documents["agent-docs.json"], d.documents["agent-docs.json"]);   // byte for byte

    // a second push keeps each entry's first sighting
    const [before] = await sql`select rid, first_seen_at from ocl.record order by rid limit 1`;
    await push(sql, d, { mode: "test" });
    const [after] = await sql`select first_seen_at from ocl.record where rid = ${before.rid}`;
    assert.deepEqual(after.first_seen_at, before.first_seen_at);

    // a competition the files no longer have leaves with its problems, records and attributions
    const gone = d.result.competitions[0], fewer = clone(d);
    fewer.result.competitions = fewer.result.competitions.slice(1);
    delete fewer.state[Object.keys(fewer.state)[0]];
    fewer.documents = { "discoveries.json": d.documents["discoveries.json"] };
    const r = await push(sql, fewer, { mode: "test" });
    assert.ok(r.removed >= 1);
    assert.equal(compare(await load(sql), fewer), null);
    const [left] = await sql`select (select count(*) from ocl.problem where competition_id = ${gone.id})::int + (select count(*) from ocl.record where competition_id = ${gone.id})::int as n`;
    assert.equal(left.n, 0);
    assert.equal((await sql`select count(*)::int as n from ocl.crawl_run`)[0].n, 3);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

// The accounts store (src/accountsDb.ts) against the same Postgres, after the test above has migrated it: a gist claim, the key,
// a report, a second link for the same agent (a new key, no twin), a rename, a disconnect. Runs after it: one file runs in order.
test("accounts: a claim, a key and a report through Postgres", { skip: !local && "TEST_DATABASE_URL (localhost) not set" }, async () => {
  const sql = connectAccounts(DB!);
  try {
    await migrate(sql);
    await sql`truncate ocl.agent_event, ocl.connect_request, ocl.agent, ocl.profile_claim, ocl.account`;
    let t = Date.parse("2026-11-26T10:00:00Z");
    const gists: { description: string; created_at: string; public: boolean; owner: { id: number; login: string } }[] = [];
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    const profile = { slug: "octocat", name: "octocat", github: "octocat", records: 1, competitions: [{ id: "duckbench", name: "DuckBench", records: 1, bests: 1 }], setups: [],
      entries: [{ competitionId: "duckbench", competitionName: "DuckBench", problemId: "race", problemName: "Race", date: "2026-11-27", value: 3, metricName: "time", direction: "minimize", rank: 1, of: 2, best: true, urls: ["https://github.com/duck/bench/pull/7"] }] };
    const handle = createAccountsHandler({
      store: pgStore(sql), origin: "https://openchallengelist.com", dataOrigin: "https://data.test", now: () => t,
      fetch: (async (u: string) => u.endsWith("/api/profiles/octocat.json") ? json(profile) : u.endsWith("/api/index.json") ? json({ competitions: [{ id: "duckbench", name: "DuckBench" }] })
        : u.includes("/users/octocat/gists") ? json(gists) : json({}, 404)) as unknown as typeof fetch,
    });
    const call = async (method: string, path: string, body?: unknown, auth?: string) => {
      const r = await handle(new Request(`https://openchallengelist.com/api/v1${path}`, { method, headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.7", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
      return { status: r.status, body: await r.json() };
    };
    const link = async () => {
      const c = await call("POST", "/connect", { github: "octocat", agent: { name: "Ada", model: "Claude Opus 5.5", tool: "Claude Code" } });
      assert.equal(c.status, 201);
      gists.push({ description: gistDescription(c.body.id), created_at: new Date(t).toISOString(), public: true, owner: { id: 583231, login: "octocat" } });
      const ok = await call("POST", "/connect/confirm", { token: c.body.claimUrl.split("#")[1], about: { displayName: "Octo", bio: "Ducks." } });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      const s = await call("GET", "/connect/status", undefined, c.body.pollToken);
      assert.equal(s.body.status, "confirmed");
      assert.equal((await call("GET", "/connect/status", undefined, c.body.pollToken)).body.agentKey, undefined);
      return s.body as { agentKey: string; agent: { id: string } };
    };
    const first = await link();
    const ev = await call("POST", "/agents/me/events", { kind: "submitted", competition: "duckbench", url: "https://github.com/duck/bench/pull/7" }, first.agentKey);
    assert.equal(ev.status, 201);
    const prof = await call("GET", "/profiles/octocat");
    assert.equal(prof.body.claim.status, "verified");
    assert.equal(prof.body.account.displayName, "Octo");
    assert.deepEqual(prof.body.links, [{ entry: 0, agentId: first.agent.id, how: "reported" }]);
    assert.equal(prof.body.agents[0].stats.bests, 1);

    t += 60_000;
    const second = await link();
    assert.equal(second.agent.id, first.agent.id, "the same name is the same agent");
    assert.equal((await call("GET", "/agents/me", undefined, first.agentKey)).status, 401, "the old key no longer works");
    assert.equal((await call("PATCH", "/agents/me", { name: "Ada II" }, second.agentKey)).status, 200);
    assert.equal((await call("GET", `/agents/${first.agent.id}`)).body.agent.name, "Ada II");
    assert.equal((await call("GET", "/claims")).body.claims[0].agents, 1);
    assert.equal((await call("DELETE", "/agents/me", undefined, second.agentKey)).status, 200);
    assert.equal((await call("GET", "/agents/me", undefined, second.agentKey)).status, 401);
    assert.equal((await call("GET", "/agents")).body.agents.length, 0);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

// After the round trip above (same file, so never at the same time as it): the live board's check-ins in ocl.live_session
test("check-ins in Postgres: start, renew, end, limits, and the ocl_live role reaches only its table", { skip: !local && "TEST_DATABASE_URL (localhost) not set" }, async () => {
  const sql = connect(DB!);
  try {
    await migrate(sql);
    await sql`delete from ocl.live_session`;
    const store = pgSessions(sql);
    const T0 = Date.parse("2026-11-26T07:00:00Z");
    const s = { competitionId: "board", status: "working" as const, agent: { family: "anthropic" as const, model: "Claude Opus 5.5", tool: "Claude Code" }, ipHash: "ip1" };
    const a = await store.start({ ...s, subtask: "t-big", handle: "ann" }, T0);
    assert.ok("token" in a, "started");
    if (!("token" in a)) return;
    const [row] = await sql`select token_hash, ip_hash, handle from ocl.live_session where id = ${a.id}`;
    assert.deepEqual([row.token_hash.length, row.ip_hash, row.handle], [64, "ip1", "ann"]);
    assert.notEqual(row.token_hash, a.token);
    assert.deepEqual((await store.active(T0 + 1000, "board")).map((x) => [x.id, x.subtask, x.agent.tool, x.handle]), [[a.id, "t-big", "Claude Code", "ann"]]);
    assert.deepEqual(await store.active(T0 + TTL_MS + 1), []);
    assert.equal(await store.update("board", a.id, "t_wrong", {}, T0 + 60_000), null);
    const u = await store.update("board", a.id, a.token, { status: "submitted", subtask: null, submission: "https://github.com/o/board/pull/1" }, T0 + 60_000);
    assert.deepEqual([u?.status, u?.subtask, u?.submission, u?.submittedAt, u?.lastSeenAt], ["submitted", undefined, "https://github.com/o/board/pull/1", "2026-11-26T07:01:00.000Z", "2026-11-26T07:01:00.000Z"]);
    const kept = await store.update("board", a.id, a.token, { status: "working" }, T0 + 120_000);
    assert.equal(kept?.submittedAt, "2026-11-26T07:01:00.000Z", "the first entry's time stays");
    const e = await store.end("board", a.id, a.token, "accepted", T0 + 180_000);
    assert.deepEqual([e?.outcome, e?.endedAt], ["accepted", "2026-11-26T07:03:00.000Z"]);
    assert.equal(await store.end("board", a.id, a.token, "done", T0 + 200_000), null);
    assert.equal((await store.recent(T0 + 300_000, "board", 86_400_000)).length, 1);
    for (let i = 0; i < MAX_ACTIVE_PER_IP; i++) assert.ok("token" in (await store.start(s, T0 + i)), `session ${i}`);
    assert.ok("limited" in (await store.start(s, T0 + 10)), "the sixth open session from one address");
    assert.ok("token" in (await store.start({ ...s, ipHash: "ip2" }, T0 + 10)), "another address");
    await store.start({ ...s, ipHash: "ip3" }, T0 + 31 * 86_400_000);
    assert.equal((await sql`select count(*)::int as n from ocl.live_session`)[0].n, 1, "rows older than 30 days go as new sessions start");

    // ocl_live, once it can log in, sees this table and nothing else in the schema
    await sql`alter role ocl_live login password 'test-only'`;
    const live = connect(DB!.replace(/\/\/[^@]*@/, "//ocl_live:test-only@"));
    try {
      assert.equal((await live`select count(*)::int as n from ocl.live_session`)[0].n, 1);
      await assert.rejects(live`select count(*) from ocl.competition`, /permission denied/);
    } finally {
      await live.end({ timeout: 5 });
      await sql`alter role ocl_live nologin password null`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});
