// Vercel Function for /api/v1/* (vercel.json rewrites /api/v1/{path} here as ?path={path}): accounts, claims and agents
// (src/accounts.ts). Needs SUPABASE_DB_URL; GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET turn on "Sign in with GitHub" on the
// claim page (a GitHub OAuth app whose callback is {origin}/api/v1/auth/github/callback); without them the gist proof works.
import { createAccountsHandler } from "../src/accounts.js";
import { connectAccounts, pgStore } from "../src/accountsDb.js";

const db = process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;
const id = process.env.GITHUB_CLIENT_ID, secret = process.env.GITHUB_CLIENT_SECRET;

const handle = createAccountsHandler({
  store: db ? pgStore(connectAccounts(db)) : null,
  origin: process.env.SITE_ORIGIN || "https://openchallengelist.com",
  dataOrigin: process.env.MCP_DATA_ORIGIN || undefined,
  github: id && secret ? { clientId: id, clientSecret: secret } : null,
  githubToken: process.env.GITHUB_GIST_TOKEN || undefined,
  log: (line) => console.log(line),
});

export const GET = handle, HEAD = handle, POST = handle, PATCH = handle, DELETE = handle, OPTIONS = handle;
