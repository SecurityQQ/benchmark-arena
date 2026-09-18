// Ingest an approved "Add competition" issue into data/seeds.json.
// All issue content arrives through environment variables and is treated as untrusted text:
// it is only ever matched against strict patterns, never evaluated or passed to a shell.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const { ISSUE_BODY = "", ISSUE_NUMBER = "", ISSUE_USER = "", GITHUB_TOKEN = "", GITHUB_OUTPUT } = process.env;
const out = (k, v) => { if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `${k}=${String(v).replace(/[\r\n]+/g, " ")}\n`); console.log(`${k}: ${v}`); };
const fail = (msg) => { out("status", "rejected"); out("message", msg); process.exit(0); };

const section = (title) => { const m = ISSUE_BODY.match(new RegExp(`###\\s*${title}\\s*\\n+([^\\n#]+)`, "i")); return m ? m[1].trim() : ""; };
const repoLine = section("Repository") || ISSUE_BODY;
const m = repoLine.match(/https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?=[\s/#?)]|$)/);
if (!m) fail("No valid https://github.com/<owner>/<repo> URL found under “Repository”.");
const owner = m[1], name = m[2].replace(/\.git$/, "");

const lb = section("Leaderboard or website");
const leaderboardUrl = /^https?:\/\/[^\s<>"]{4,300}$/.test(lb) ? lb : undefined;

const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers: { Accept: "application/vnd.github+json", ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}) } });
if (res.status === 404) fail(`Repository ${owner}/${name} does not exist or is private.`);
if (!res.ok) fail(`GitHub API returned ${res.status} while checking ${owner}/${name}.`);
const meta = await res.json();
const canonical = { owner: meta.owner.login, name: meta.name };

const path = "data/seeds.json";
const seeds = JSON.parse(readFileSync(path, "utf8"));
const key = (s) => `${s.owner}/${s.name}`.toLowerCase();
if (seeds.some((s) => key(s) === key(canonical))) { out("status", "duplicate"); out("message", `${key(canonical)} is already queued.`); process.exit(0); }

seeds.push({ ...canonical, leaderboardUrl, addedBy: /^[A-Za-z0-9-]{1,39}$/.test(ISSUE_USER) ? ISSUE_USER : undefined, issue: Number(ISSUE_NUMBER) || undefined, addedAt: new Date().toISOString().slice(0, 10) });
writeFileSync(path, JSON.stringify(seeds, null, 2) + "\n");
out("status", "queued");
out("repo", `${canonical.owner}/${canonical.name}`);
out("message", `${canonical.owner}/${canonical.name} is queued for the next crawl.`);
