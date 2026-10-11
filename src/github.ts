import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";

const ThrottledOctokit = Octokit.plugin(throttling);

export const MAX_FILE_BYTES = 1024 * 1024;
const MAX_API_BYTES = 8 * 1024 * 1024;

/** Bound decoded response bytes and the entire download, not just the headers. */
export async function boundedFetch(url: string | URL | Request, init?: RequestInit, maxBytes = MAX_FILE_BYTES, timeoutMs = 15000): Promise<Response> {
  let origin: URL;
  try { origin = new URL(url instanceof Request ? url.url : url); }
  catch { throw new Error("Invalid download URL"); }
  const headers = new Headers(init?.headers ?? (url instanceof Request ? url.headers : undefined));
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      (headers.has("authorization") && origin.origin !== "https://api.github.com" &&
        origin.href !== "https://openrouter.ai/api/v1/chat/completions")) {
    throw new Error("Download origin is not allowed");
  }
  const controller = new AbortController();
  const inputSignal = init?.signal ?? (url instanceof Request ? url.signal : undefined);
  const signal = inputSignal ? AbortSignal.any([inputSignal, controller.signal]) : controller.signal;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      reject(new Error("Download timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      let target = url;
      let current = origin;
      let response: Response;
      const method = init?.method ?? (url instanceof Request ? url.method : "GET");
      for (let redirects = 0; ; redirects++) {
        signal.throwIfAborted();
        response = await fetch(target, { ...init, method, headers, signal, redirect: "manual" });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        await response.body?.cancel();
        if (redirects >= 3) throw new Error("Download redirect limit exceeded");
        const location = response.headers.get("location");
        let next: URL;
        try { next = new URL(location ?? "", current); }
        catch { throw new Error("Download redirect is not allowed"); }
        if (!location || next.origin !== origin.origin || next.protocol !== "https:" || next.username || next.password || !/^(GET|HEAD)$/i.test(method)) {
          throw new Error("Download redirect is not allowed");
        }
        target = next;
        current = next;
      }
      signal.throwIfAborted();
      if (Number(response.headers.get("content-length")) > maxBytes) {
        void response.body?.cancel().catch(() => {});
        throw new Error("Download exceeds byte limit");
      }
      reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error("Download exceeds byte limit");
        chunks.push(value);
      }
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      const result = new Response(response.body ? Buffer.concat(chunks) : null, { status: response.status, statusText: response.statusText, headers: responseHeaders });
      Object.defineProperty(result, "url", { value: response.url });
      return result;
    })()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}

export function isPublicRepo(repo: { private?: boolean; visibility?: string }): boolean {
  return repo.private === false && (repo.visibility === undefined || repo.visibility === "public");
}

export async function assertPublicRepo(owner: string, repo: string): Promise<void> {
  const { data } = await getOctokit().rest.repos.get({ owner, repo });
  if (!isPublicRepo(data)) throw new Error("Repository must be public");
}

let _octokit: Octokit | null = null;

export function getOctokit(): Octokit {
  if (_octokit) return _octokit;
  const token = process.env.GITHUB_TOKEN;
  _octokit = new ThrottledOctokit({
    auth: token,
    log: {
      debug: () => {},
      info: () => {},
      warn: () => console.warn("GitHub API warning"),
      error: () => console.error("GitHub API request failed"),
    },
    request: { fetch: (url: string, init?: RequestInit) => boundedFetch(url, init, MAX_API_BYTES) },
    throttle: {
      onRateLimit: () => {
        console.warn("GitHub API rate limit reached; retrying");
        return true;
      },
      onSecondaryRateLimit: () => {
        console.warn("GitHub API secondary rate limit reached; retrying");
        return true;
      },
    },
  });
  return _octokit;
}

/** Fetch a file's raw content from a GitHub repo. */
export async function fetchFile(owner: string, repo: string, path: string, branch?: string): Promise<string> {
  await assertPublicRepo(owner, repo);
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
    ...(branch ? { ref: branch } : {}),
  });
  if (Array.isArray(data)) throw new Error(`Expected file, got directory: ${path}`);
  if (data.type !== "file") throw new Error(`Unexpected type ${data.type} for ${path}`);
  const encoded = data.content.replace(/\s/g, "");
  if (data.size > MAX_FILE_BYTES || encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw new Error("File exceeds byte limit");
  const content = Buffer.from(encoded, "base64");
  if (content.byteLength > MAX_FILE_BYTES) throw new Error("File exceeds byte limit");
  return content.toString("utf-8");
}

/** List directory contents of a GitHub repo path. */
export async function listDir(owner: string, repo: string, path: string, branch?: string) {
  await assertPublicRepo(owner, repo);
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
  const res = await boundedFetch(url);
  if (!res.ok) throw new Error("GitHub raw file request failed");
  return res.text();
}

/** Get repo metadata (stars, description, updated_at). */
export async function getRepoInfo(owner: string, repo: string) {
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.get({ owner, repo });
  if (!isPublicRepo(data)) throw new Error("Repository must be public");
  return {
    stars: data.stargazers_count,
    description: data.description,
    updatedAt: data.updated_at,
    url: data.html_url,
  };
}
