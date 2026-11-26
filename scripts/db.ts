// The crawl's data in Supabase (src/db.ts). Needs SUPABASE_DB_URL: Supabase → Connect → Session pooler (the direct host is
// IPv6-only, which GitHub's runners cannot reach). The data workflows run `sync` after their commit step; until the secret is
// set it does nothing, and a failure never blocks a refresh.
//
//   npx tsx scripts/db.ts migrate        apply db/migrations
//   npx tsx scripts/db.ts sync [mode]    migrate, push data/*.json, read it back and compare
//   npx tsx scripts/db.ts push [mode]    push data/*.json (mode: live | full | priority | … , recorded in ocl.crawl_run)
//   npx tsx scripts/db.ts verify         compare the database with data/*.json
//   npx tsx scripts/db.ts pull           overwrite data/*.json with the database's copy
//   npx tsx scripts/db.ts status         row counts and the last push

import { execFileSync } from "node:child_process";
import { loadEnv } from "../src/env.js";
import { compare, connect, databaseUrl, load, migrate, push, readDataFiles, writeDataFiles, type Sql } from "../src/db.js";

loadEnv();
const [cmd = "status", mode = "manual"] = process.argv.slice(2);
const root = process.cwd();
const COMMANDS = ["migrate", "sync", "push", "verify", "pull", "status"];
if (!COMMANDS.includes(cmd)) { console.error(`usage: npx tsx scripts/db.ts ${COMMANDS.join(" | ")}`); process.exit(1); }

const url = databaseUrl();
if (!url) {
  if (cmd === "sync") { console.log("SUPABASE_DB_URL not set, nothing mirrored"); process.exit(0); }
  console.error("SUPABASE_DB_URL is not set (see .env.example)");
  process.exit(1);
}

const gitSha = () => { try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim(); } catch { return undefined; } };

async function pushFiles(sql: Sql) {
  const s = await push(sql, readDataFiles(root), { mode, gitSha: gitSha() });
  console.log(`pushed ${s.competitions} competitions, ${s.problems} problems, ${s.records} records, ${s.attributions} attributions${s.removed ? ` (${s.removed} rows removed)` : ""}`);
}
async function verify(sql: Sql): Promise<boolean> {
  const diff = compare(await load(sql), readDataFiles(root));
  console.log(diff ? `database and data/ differ at ${diff}` : "database matches data/");
  return !diff;
}

const sql = connect(url);
try {
  if (cmd === "migrate" || cmd === "sync") {
    const applied = await migrate(sql);
    console.log(applied.length ? `applied ${applied.join(", ")}` : "schema up to date");
  }
  if (cmd === "push" || cmd === "sync") await pushFiles(sql);
  if ((cmd === "verify" || cmd === "sync") && !(await verify(sql))) process.exitCode = 1;
  if (cmd === "pull") {
    const d = await load(sql);
    if (!d) throw new Error("nothing pushed yet");
    writeDataFiles(root, d);
    console.log(`wrote data/ from the push of ${d.result.crawledAt}: ${d.result.competitions.length} competitions`);
  }
  if (cmd === "status") {
    const [r] = await sql`select
      (select count(*) from ocl.competition)::int as competitions, (select count(*) from ocl.problem)::int as problems,
      (select count(*) from ocl.record)::int as records, (select count(*) from ocl.attribution)::int as attributions,
      (select count(*) from ocl.crawl_run)::int as pushes, (select max(pushed_at) from ocl.crawl_run) as last_push`;
    console.log(r);
  }
} catch (e) {
  // the message only: a connection error object carries the connection options
  console.error(`db ${cmd} failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
