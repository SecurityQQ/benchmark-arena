import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";

const ThrottledOctokit = Octokit.plugin(throttling);

let _octokit: Octokit | null = null;

export function getOctokit(): Octokit {
  if (_octokit) return _octokit;
  const token = process.env.GITHUB_TOKEN;
  _octokit = new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, opts: any) => {
        console.warn(`Rate limit hit for ${opts.method} ${opts.url} — retrying after ${retryAfter}s`);
        return true;
      },
      onSecondaryRateLimit: (retryAfter: number, opts: any) => {
        console.warn(`Secondary rate limit for ${opts.method} ${opts.url} — retrying after ${retryAfter}s`);
        return true;
      },
    },
  });
  return _octokit;
}

/** Fetch a file's raw content from a GitHub repo. */
export async function fetchFile(owner: string, repo: string, path: string, branch?: string): Promise<string> {
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
    ...(branch ? { ref: branch } : {}),
  });
  if (Array.isArray(data)) throw new Error(`Expected file, got directory: ${path}`);
  if (data.type !== "file") throw new Error(`Unexpected type ${data.type} for ${path}`);
  // data.content is base64
  return Buffer.from(data.content, "base64").toString("utf-8");
}

/** List directory contents of a GitHub repo path. */
export async function listDir(owner: string, repo: string, path: string, branch?: string) {
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
    ...(branch ? { ref: branch } : {}),
  });
  if (!Array.isArray(data)) throw new Error(`Expected directory, got file: ${path}`);
  return data.map((item) => ({ name: item.name, path: item.path, type: item.type }));
}

/** Fetch raw file via raw.githubusercontent.com (no rate limit on content endpoint). */
export async function fetchRaw(owner: string, repo: string, path: string, branch = "main"): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

/** Get repo metadata (stars, description, updated_at). */
export async function getRepoInfo(owner: string, repo: string) {
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return {
    stars: data.stargazers_count,
    description: data.description,
    updatedAt: data.updated_at,
    url: data.html_url,
  };
}
