import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, competitionRows, competitionsFromRows, connect, firstDifference, load, migrate, push, readDataFiles, recordId, writeDataFiles } from "../src/db.js";
import type { Competition } from "../src/types.js";

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
    assert.deepEqual(await migrate(sql), ["0001_init.sql"]);
    assert.deepEqual(await migrate(sql), []);
    assert.equal(await load(sql), null);

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
