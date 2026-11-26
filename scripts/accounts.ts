// Claims a maintainer reviews (src/accounts.ts): a GPU MODE, DuckBench or bare name claimed by a GitHub account stays
// "pending" until approved here. Needs SUPABASE_DB_URL.
//
//   npx tsx scripts/accounts.ts pending          claims waiting for review, with who asked and when
//   npx tsx scripts/accounts.ts approve <slug>   the profile shows as theirs
//   npx tsx scripts/accounts.ts reject <slug>    the claim goes; the profile is unclaimed again
//   npx tsx scripts/accounts.ts stats            accounts, claims, agents, reports

import { loadEnv } from "../src/env.js";
import { databaseUrl } from "../src/db.js";
import { connectAccounts } from "../src/accountsDb.js";
import { SLUG } from "../src/profiles.js";

loadEnv();
const [cmd = "pending", slug] = process.argv.slice(2);
const url = databaseUrl();
if (!url) { console.error("SUPABASE_DB_URL is not set (see .env.example)"); process.exit(1); }
if ((cmd === "approve" || cmd === "reject") && !(slug && SLUG.test(slug))) { console.error(`usage: npx tsx scripts/accounts.ts ${cmd} <profile slug>`); process.exit(1); }

const sql = connectAccounts(url);
try {
  if (cmd === "pending") {
    const rows = await sql`select c.slug, a.login, c.created_at from ocl.profile_claim c join ocl.account a on a.id = c.account_id where c.status = 'pending' order by c.created_at`;
    if (!rows.length) console.log("nothing to review");
    for (const r of rows) console.log(`${r.slug}  claimed by @${r.login}  ${new Date(r.created_at).toISOString().slice(0, 16)}  https://openchallengelist.com/u/${r.slug}`);
  } else if (cmd === "approve") {
    const res = await sql`update ocl.profile_claim set status = 'verified', method = 'review', reviewed_at = now() where slug = ${slug} and status = 'pending'`;
    console.log(res.count ? `approved ${slug}` : `no pending claim on ${slug}`);
  } else if (cmd === "reject") {
    const res = await sql`delete from ocl.profile_claim where slug = ${slug} and status = 'pending'`;
    console.log(res.count ? `rejected ${slug}` : `no pending claim on ${slug}`);
  } else if (cmd === "stats") {
    const [r] = await sql`select (select count(*)::int from ocl.account) as accounts,
      (select count(*)::int from ocl.profile_claim where status = 'verified') as verified, (select count(*)::int from ocl.profile_claim where status = 'pending') as pending,
      (select count(*)::int from ocl.agent where revoked_at is null) as agents, (select count(*)::int from ocl.agent_event) as reports,
      (select count(*)::int from ocl.connect_request where status = 'open' and expires_at > now()) as open_links`;
    console.log(r);
  } else {
    console.error("usage: npx tsx scripts/accounts.ts pending | approve <slug> | reject <slug> | stats");
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`accounts ${cmd} failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
