// Vercel Function for the live board (vercel.json rewrites /api/live/:path* here, the rest of the path as ?path=): src/liveApi.ts.
// Environment: GITHUB_TOKEN (read-only, public repositories) to read open pull requests; LIVE_DB_URL, else SUPABASE_DB_URL or
// POSTGRES_URL, for check-ins (without one, check-ins answer 503 and the board is built from the other sources);
// LIVE_DATA_ORIGIN (else MCP_DATA_ORIGIN, else https://openchallengelist.com) for /api/live-base.json; LIVE_SALT for IP hashes.
import { createHash } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { createLiveHandler } from "../src/liveApi.js";
import { connect, liveDatabaseUrl } from "../src/db.js";
import { pgSessions } from "../src/sessions.js";

const db = liveDatabaseUrl();
const handle = createLiveHandler({
  origin: process.env.LIVE_DATA_ORIGIN || process.env.MCP_DATA_ORIGIN || undefined,
  githubToken: process.env.GITHUB_TOKEN || undefined,
  store: db ? pgSessions(connect(db, { max: 2, connectTimeout: 5, statementTimeoutMs: 4000, application: "ocl-live" })) : undefined,
  salt: process.env.LIVE_SALT || (db ? createHash("sha256").update(`live-salt\n${db}`).digest("hex") : undefined),
  log: (line) => console.log(line),
  waitUntil,
});

export const GET = handle, HEAD = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle, OPTIONS = handle;
