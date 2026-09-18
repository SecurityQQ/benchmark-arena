// Fetch relevant pages from a GitHub repo: README + leaderboard-ish files

import { fetchRaw, listDir, getOctokit } from "./github.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = join(process.cwd(), "cache");

function cacheKey(owner: string, name: string, path: string): string {
  return `${owner}__${name}__${path.replace(/\//g, "_")}`;
}

function cacheGet(key: string): string | null {
  const p = join(CACHE_DIR, `${key}.txt`);
  if (existsSync(p)) return readFileSync(p, "utf-8");
  return null;
}

function cacheSet(key: string, content: string): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, `${key}.txt`), content);
}

export interface FetchedPage {
  path: string;
  content: string;
  url: string;
}

export interface RepoPages {
  repo: { owner: string; name: string; branch: string };
  pages: FetchedPage[];
  totalChars: number;
}

// Files that often contain leaderboards
const LEADERBOARD_FILENAMES = [
  "README.md", "README.MD", "readme.md",
  "LEADERBOARD.md", "leaderboard.md",
  "SCORES.md", "scores.md",
  "RESULTS.md", "results.md",
  "docs/leaderboard.md",
  "docs/README.md",
];

// Dirs to skip when looking for sub-problem READMEs
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".github", "docs", "src", "test", "tests",
  "scripts", "lib", "bin", "vendor", "dist", "build", "out",
  ".vscode", ".idea", "assets", "images", "img",
]);

/**
 * Fetch README + discover leaderboard-like files in a repo.
 * Returns up to maxPages pages, total content capped at maxChars.
 */
export async function fetchRepoPages(
  owner: string,
  name: string,
  branch: string,
  maxPages = 45,
  maxChars = 160000,
): Promise<RepoPages> {
  const pages: FetchedPage[] = [];
  let totalChars = 0;

  const addPage = (path: string, content: string) => {
    if (pages.length >= maxPages || totalChars >= maxChars) return false;
    const truncated = content.slice(0, maxChars - totalChars);
    pages.push({
      path,
      content: truncated,
      url: `https://github.com/${owner}/${name}/blob/${branch}/${path}`,
    });
    totalChars += truncated.length;
    return true;
  };

  // 1. Fetch known filenames (README, LEADERBOARD.md, etc.)
  for (const filename of LEADERBOARD_FILENAMES) {
    if (totalChars >= maxChars) break;
    const key = cacheKey(owner, name, filename);
    let content = cacheGet(key);
    if (content === null) {
      try {
        content = await fetchRaw(owner, name, filename, branch);
        cacheSet(key, content);
      } catch { continue; }
    }
    if (content) addPage(filename, content);
  }

  // 2. List root directory
  let rootEntries: { name: string; path: string; type: string }[] = [];
  try {
    rootEntries = await listDir(owner, name, "", branch);
  } catch { /* ignore */ }

  // 3. Fetch leaderboard-ish files from root
  for (const entry of rootEntries) {
    if (totalChars >= maxChars) break;
    if (entry.type !== "file") continue;
    if (pages.some((p) => p.path === entry.name)) continue;
    const lower = entry.name.toLowerCase();
    if (lower.includes("leaderboard") || lower.includes("results") ||
        lower.includes("scores") || lower.includes("records")) {
      const key = cacheKey(owner, name, entry.path);
      let content = cacheGet(key);
      if (content === null) {
        try {
          content = await fetchRaw(owner, name, entry.path, branch);
          cacheSet(key, content);
        } catch { continue; }
      }
      if (content) addPage(entry.path, content);
    }
  }

  // 4. Fetch subdirectory READMEs (problem dirs like matmul/, mnist/, etc.)
  //    Prioritize: fetch ALL subdirectory READMEs, not just first few
  for (const entry of rootEntries) {
    if (totalChars >= maxChars) break;
    if (entry.type !== "dir") continue;
    if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
    const subPath = `${entry.path}/README.md`;
    const key = cacheKey(owner, name, subPath);
    let content = cacheGet(key);
    if (content === null) {
      try {
        content = await fetchRaw(owner, name, subPath, branch);
        cacheSet(key, content);
      } catch { continue; }
    }
    // Only include if it has substantial content (likely has leaderboard)
    if (content && content.length > 100) {
      if (!addPage(subPath, content)) break;
    }
  }

  // 4b. Machine-readable leaderboard data: results/, leaderboard/, data/, submissions/ (json/csv/yaml/tsv/md)
  const DATA_DIRS = new Set(["results", "leaderboard", "leaderboards", "data", "submissions", "scores", "records"]);
  let dataChars = 0;
  for (const entry of rootEntries) {
    if (entry.type !== "dir" || !DATA_DIRS.has(entry.name.toLowerCase())) continue;
    if (totalChars >= maxChars || dataChars > 60000) break;
    let sub: { name: string; path: string; type: string }[] = [];
    try { sub = await listDir(owner, name, entry.path, branch); } catch { continue; }
    const files = sub.filter((f) => f.type === "file" && /\.(json|csv|tsv|ya?ml|md)$/i.test(f.name) && !/^(readme|contributing|license)/i.test(f.name)).slice(0, 12);
    for (const f of files) {
      if (totalChars >= maxChars || dataChars > 60000) break;
      const key = cacheKey(owner, name, f.path);
      let content = cacheGet(key);
      if (content === null) { try { content = await fetchRaw(owner, name, f.path, branch); cacheSet(key, content); } catch { continue; } }
      if (!content || content.length < 40) continue;
      const excerpt = content.slice(0, 12000);
      dataChars += excerpt.length;
      if (!addPage(f.path, excerpt)) break;
    }
    // one level deeper: submissions/<entry>/README.md
    for (const d of sub.filter((f) => f.type === "dir").slice(0, 15)) {
      if (totalChars >= maxChars || dataChars > 60000) break;
      const p = `${d.path}/README.md`;
      const key = cacheKey(owner, name, p);
      let content = cacheGet(key);
      if (content === null) { try { content = await fetchRaw(owner, name, p, branch); cacheSet(key, content); } catch { cacheSet(key, ""); continue; } }
      if (!content || content.length < 100) continue;
      const excerpt = content.slice(0, 2500);
      dataChars += excerpt.length;
      if (!addPage(p, excerpt)) break;
    }
  }

  // 5. Submission reports linked from leaderboard tables (often name the model/agent used)
  const reportLinks = new Set<string>();
  for (const pg of pages) {
    const dir = pg.path.includes("/") ? pg.path.slice(0, pg.path.lastIndexOf("/")) : "";
    for (const m of pg.content.matchAll(/\]\(((?!https?:)[^)\s]+\.md)\)/g)) {
      const rel = m[1].replace(/^\.\//, "");
      const full = dir ? `${dir}/${rel}` : rel;
      if (!pages.some((p) => p.path === full)) reportLinks.add(full);
    }
  }
  let reportChars = 0;
  for (const path of [...reportLinks].slice(0, 20)) {
    if (totalChars >= maxChars || reportChars > 25000) break;
    const key = cacheKey(owner, name, path);
    let content = cacheGet(key);
    if (content === null) {
      try { content = await fetchRaw(owner, name, path, branch); cacheSet(key, content); } catch { continue; }
    }
    if (!content) continue;
    const excerpt = content.slice(0, 1500);
    reportChars += excerpt.length;
    addPage(path, excerpt);
  }

  // 6. Attribution evidence: commit trailers + PR titles/bodies (Co-Authored-By: Claude, codex/ branches, "Generated with Devin"…)
  const attribution = await fetchAttributionEvidence(owner, name);
  if (attribution) {
    // always include — this is the primary evidence for model attribution
    pages.push({ path: "__attribution__", content: attribution, url: `https://github.com/${owner}/${name}/pulls?q=is:merged` });
    totalChars += attribution.length;
  }

  return {
    repo: { owner, name, branch },
    pages,
    totalChars,
  };
}

const AGENT_RX = /co-authored-by|generated with|claude|codex|devin|copilot|cursor|gpt|gemini|openai|anthropic|deepseek|qwen|llama|grok|mistral|kimi|glm|agent/i;

async function fetchAttributionEvidence(owner: string, name: string): Promise<string | null> {
  const key = cacheKey(owner, name, "__attribution__");
  const cached = cacheGet(key);
  if (cached !== null) return cached || null;

  const octokit = getOctokit();
  const lines: string[] = [];
  try {
    const commits = await octokit.paginate(octokit.rest.repos.listCommits, { owner, repo: name, per_page: 100 }, (r, done) => { if (r.data.length < 100 || /page=(1[0-9]|[2-9][0-9])\b/.test(r.url)) done(); return r.data; });
    lines.push("## Recent commits (author | date | message incl. trailers)");
    for (const c of commits) {
      const msg = c.commit.message.replace(/\s+/g, " ").trim();
      if (!AGENT_RX.test(msg)) continue;
      lines.push(`- ${c.author?.login ?? c.commit.author?.name ?? "?"} | ${c.commit.author?.date?.slice(0, 10)} | ${msg.slice(0, 300)}`);
    }
  } catch { /* ignore */ }
  try {
    const prs = await octokit.paginate(octokit.rest.pulls.list, { owner, repo: name, state: "closed", per_page: 100, sort: "created", direction: "desc" }, (r, done) => { if (r.data.length < 100 || /page=(1[0-9]|[2-9][0-9])\b/.test(r.url)) done(); return r.data; });
    lines.push("", "## Merged pull requests (author | merged | branch | title | body excerpt)");
    for (const pr of prs) {
      if (!pr.merged_at) continue;
      const body = (pr.body ?? "").replace(/\s+/g, " ").trim();
      const text = `${pr.head.ref} ${pr.title} ${body}`;
      if (!AGENT_RX.test(text)) continue;
      lines.push(`- ${pr.user?.login} | ${pr.merged_at.slice(0, 10)} | ${pr.head.ref} | ${pr.title} | ${body.slice(0, 400)}`);
    }
  } catch { /* ignore */ }

  const out = lines.length > 2 ? lines.join("\n").slice(0, 80000) : "";
  cacheSet(key, out);
  return out || null;
}
