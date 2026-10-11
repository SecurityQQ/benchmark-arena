// Ingest an approved "Add competition" issue into data/seeds.json.
// All issue content arrives through environment variables and is treated as untrusted text:
// it is only ever matched against strict patterns, never evaluated or passed to a shell.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const { ISSUE_BODY = "", ISSUE_NUMBER = "", ISSUE_USER = "", GITHUB_TOKEN = "", GITHUB_OUTPUT } = process.env;
const out = (k, v) => { if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `${k}=${String(v).replace(/[\r\n]+/g, " ")}\n`); console.log(`${k}: ${v}`); };
const fail = (msg) => { out("status", "rejected"); out("message", msg); process.exit(0); };
if (Buffer.byteLength(ISSUE_BODY) > 65536) fail("Issue body is too large.");

const section = (title) => { const m = ISSUE_BODY.match(new RegExp(`###\\s*${title}\\s*\\n+([^\\n#]+)`, "i")); return m ? m[1].trim() : ""; };
const repoLine = section("Repository") || ISSUE_BODY;
const m = repoLine.match(/https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?=[\s/#?)]|$)/);
if (!m) fail("No valid https://github.com/<owner>/<repo> URL found under “Repository”.");
const owner = m[1], name = m[2].replace(/\.git$/, "");
if (!name || name === "." || name === "..") fail("Invalid repository name.");

const lb = section("Leaderboard or website");
const leaderboardUrl = /^https?:\/\/[^\s<>"]{4,300}$/.test(lb) ? lb : undefined;

let res, meta;
const controller = new AbortController();
let timer;
try {
  await Promise.race([new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("Download timed out")); }, 15000);
  }), (async () => {
    const signal = controller.signal;
    let url = new URL(`https://api.github.com/repos/${owner}/${name}`);
    for (let redirects = 0; ; redirects++) {
      signal.throwIfAborted();
      res = await fetch(url, { signal, redirect: "manual", headers: { Accept: "application/vnd.github+json", ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}) } });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      await res.body?.cancel();
      if (redirects >= 3) throw new Error("Redirect limit exceeded");
      const location = res.headers.get("location");
      const next = new URL(location ?? "", url);
      if (!location || next.origin !== "https://api.github.com" || next.protocol !== "https:" || next.username || next.password) throw new Error("Redirect is not allowed");
      url = next;
    }
    signal.throwIfAborted();
    const limit = 1024 * 1024;
    if (Number(res.headers.get("content-length")) > limit) { await res.body?.cancel(); throw new Error("Response is too large"); }
    let bytes = 0;
    const chunks = [];
    for await (const chunk of res.body ?? []) {
      bytes += chunk.byteLength;
      if (bytes > limit) throw new Error("Response is too large");
      chunks.push(chunk);
    }
    if (res.ok) meta = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  })()]);
} catch { fail("Unable to safely read GitHub repository metadata."); }
finally { clearTimeout(timer); controller.abort(); }
if (res.status === 404) fail("Repository does not exist or is private.");
if (!res.ok) fail("GitHub repository metadata request failed.");
if (meta?.private !== false || (meta.visibility !== undefined && meta.visibility !== "public")) fail("Repository must be public.");
if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(meta.owner?.login ?? "") || !/^[A-Za-z0-9._-]{1,100}$/.test(meta.name ?? "")) fail("Invalid GitHub repository metadata.");
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
