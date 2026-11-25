// Organizer instructions written for agents: AGENTS.md, CLAUDE.md or llms.txt at the repository root, or an llms.txt on the
// competition's own site. scripts/agent-docs.ts finds them (data/agent-docs.json) and the build attaches them to their boards,
// so an agent on /c/{id}, its digest, /api/index.json or join.txt goes to the organizer's own instructions first.
// We only link: no third-party file content reaches our pages, and the labels are ours.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDoc, Competition } from "./types.js";
import { getOctokit } from "./github.js";

export type { AgentDoc };
export type AgentDocs = Map<string, AgentDoc[]>;

// Root files in the order a board lists them. The name matches ignoring case; the URL keeps the repository's spelling.
export const REPO_DOCS = ["AGENTS.md", "CLAUDE.md", "llms.txt", "llms-full.txt"] as const;
export const SITE_DOC = "llms.txt (site)";
const LABELS = new Set<string>([...REPO_DOCS, SITE_DOC]);
// A platform's /llms.txt describes the platform, not the organizer of one board on it
const PLATFORM = /(^|\.)(github\.com|huggingface\.co|kaggle\.com)$/i;
// what may become a link in our Markdown and HTML
const SAFE_URL = /^https:\/\/[^\s()<>"'`\\]+$/;
// "@AGENTS.md", "See AGENTS.md", a symlink: a root file this small beside a real one only points at it
const POINTER_BYTES = 64;
export const SITE_TIMEOUT_MS = 8000;
const UA = "openchallengelist.com agent-docs check (+https://openchallengelist.com)";

export const AGENT_DOCS_PATH = (root: string) => join(root, "data", "agent-docs.json");

export function validAgentDocs(raw: unknown): AgentDocs {
  const boards = (raw as { boards?: unknown })?.boards;
  const out: AgentDocs = new Map();
  if (!boards || typeof boards !== "object" || Array.isArray(boards)) return out;
  for (const [id, list] of Object.entries(boards as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const docs = list.filter((d): d is AgentDoc => typeof d?.label === "string" && LABELS.has(d.label) && typeof d.url === "string" && SAFE_URL.test(d.url))
      .map((d) => ({ label: d.label, url: d.url }));
    if (docs.length) out.set(id, docs);
  }
  return out;
}

// Missing file: no board has agent docs
export function loadAgentDocs(root: string): AgentDocs {
  const path = AGENT_DOCS_PATH(root);
  return existsSync(path) ? validAgentDocs(JSON.parse(readFileSync(path, "utf-8"))) : new Map();
}

export function withAgentDocs(comps: Competition[], docs: AgentDocs): Competition[] {
  return comps.map((c) => (docs.get(c.id)?.length ? { ...c, agentDocs: docs.get(c.id) } : c));
}

// Stable bytes: sorted board ids, no timestamp, so the live refresh commits only when the docs changed
export function serializeAgentDocs(docs: AgentDocs): string {
  const boards: Record<string, AgentDoc[]> = {};
  for (const id of [...docs.keys()].sort()) if (docs.get(id)!.length) boards[id] = docs.get(id)!.map((d) => ({ label: d.label, url: d.url }));
  return JSON.stringify({ boards }, null, 2) + "\n";
}

// ─── Finding them ───

type Outcome = { docs: AgentDoc[] } | { error: string };
const message = (e: unknown) => {
  const s = (e as { status?: number }).status, cause = (e as { cause?: { code?: string } }).cause?.code;
  return s ? `HTTP ${s}` : `${String((e as Error)?.message ?? e).slice(0, 120)}${cause ? ` (${cause})` : ""}`;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One call: the root listing. 404 (gone, private, empty) is an answer; anything else gets one retry, then counts as no answer.
export async function repoDocs(owner: string, name: string, wait = sleep): Promise<Outcome> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await getOctokit().rest.repos.getContent({ owner, repo: name, path: "" });
      if (!Array.isArray(data)) return { error: "root is not a directory" };
      const found = REPO_DOCS.flatMap((label) => {
        const f = data.find((x) => x.name.toLowerCase() === label.toLowerCase() && (x.type === "file" || x.type === "symlink"));
        return f ? [{ label, name: f.name, size: f.size ?? 0 }] : [];
      });
      const real = found.some((f) => f.size >= POINTER_BYTES);
      const docs = found.filter((f) => !real || f.size >= POINTER_BYTES)
        .map((f) => ({ label: f.label, url: `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/HEAD/${encodeURIComponent(f.name)}` }))
        .filter((d) => SAFE_URL.test(d.url));
      return { docs };
    } catch (e) {
      if ((e as { status?: number }).status === 404) return { docs: [] };
      if (attempt >= 1) return { error: message(e) };
      await wait(2000);
    }
  }
}

// The competition's own site, when it has one (not GitHub or another platform)
export function siteOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !PLATFORM.test(u.hostname) ? u.origin : null;
  } catch { return null; }
}

async function readStart(res: Response, bytes = 4096): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    while (n < bytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); n += value.byteLength;
    }
  } finally { void reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).subarray(0, bytes).toString("utf-8");
}

// GET {origin}/llms.txt. Only a text file counts: a single-page app answers every path with index.html and a 200, so an HTML
// content type or a body that starts with "<" is "no llms.txt". 404/410 is an answer; any other status, a timeout or a network
// error is not.
export async function siteDocs(origin: string, timeoutMs = SITE_TIMEOUT_MS): Promise<Outcome> {
  // a timer of our own, not AbortSignal.timeout: that one does not keep the process alive while a request hangs
  const controller = new AbortController(), signal = controller.signal;
  const timer = setTimeout(() => controller.abort(new Error("timed out")), timeoutMs);
  try {
    let url = new URL("/llms.txt", origin);
    for (let hops = 0; ; hops++) {
      const res = await fetch(url, { redirect: "manual", signal, headers: { accept: "text/plain, text/markdown;q=0.9, */*;q=0.1", "user-agent": UA } });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        void res.body?.cancel().catch(() => {});
        const next = new URL(res.headers.get("location") ?? "", url);
        if (hops >= 3 || next.protocol !== "https:" || next.username || next.password) return { error: "redirect not followed" };
        url = next;
        continue;
      }
      if (res.status === 404 || res.status === 410) { void res.body?.cancel().catch(() => {}); return { docs: [] }; }
      if (res.status !== 200) { void res.body?.cancel().catch(() => {}); return { error: `HTTP ${res.status}` }; }
      const html = /^\s*(text\/html|application\/xhtml\+xml)/i.test(res.headers.get("content-type") ?? "");
      const start = html ? "" : (await readStart(res)).replace(/^\uFEFF/, "").trim();
      if (html) void res.body?.cancel().catch(() => {});
      if (html || !start || start.startsWith("<") || !SAFE_URL.test(url.href)) return { docs: [] };
      return { docs: [{ label: SITE_DOC, url: url.href }] };
    }
  } catch (e) {
    return { error: signal.aborted ? "timed out" : message(e) };
  } finally {
    clearTimeout(timer);
  }
}

export interface BoardResult { id: string; docs: AgentDoc[]; failed: string[]; kept: AgentDoc[] }

// A source that gave no answer keeps what it found last time: a GitHub 5xx or a slow site must not take links off a board.
export async function checkBoard(c: Pick<Competition, "id" | "url" | "repo">, previous: AgentDoc[] = [], o: { wait?: (ms: number) => Promise<unknown>; timeoutMs?: number } = {}): Promise<BoardResult> {
  const origin = siteOrigin(c.url);
  const [repo, site] = await Promise.all([
    c.repo ? repoDocs(c.repo.owner, c.repo.name, o.wait) : Promise.resolve<Outcome>({ docs: [] }),
    origin ? siteDocs(origin, o.timeoutMs) : Promise.resolve<Outcome>({ docs: [] }),
  ]);
  const failed: string[] = [], kept: AgentDoc[] = [];
  const pick = (r: Outcome, source: string, mine: (d: AgentDoc) => boolean) => {
    if ("docs" in r) return r.docs;
    failed.push(`${source}: ${r.error}`);
    kept.push(...previous.filter(mine));
    return previous.filter(mine);
  };
  const docs = [...pick(repo, "github", (d) => d.label !== SITE_DOC), ...pick(site, "site", (d) => d.label === SITE_DOC)];
  return { id: c.id, docs, failed, kept };
}

export async function collectAgentDocs(comps: Pick<Competition, "id" | "url" | "repo">[], previous: AgentDocs, o: { concurrency?: number; wait?: (ms: number) => Promise<unknown>; timeoutMs?: number; log?: (line: string) => void } = {}) {
  const log = o.log ?? console.log;
  const results: BoardResult[] = new Array(comps.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 6, comps.length) }, async () => {
    while (next < comps.length) { const i = next++; results[i] = await checkBoard(comps[i], previous.get(comps[i].id), o); }
  }));
  const docs: AgentDocs = new Map();
  let kept = 0;
  for (const r of results) {
    if (r.docs.length) docs.set(r.id, r.docs);
    if (r.failed.length) {
      kept++;
      log(`agent docs: ${r.id}: no answer (${r.failed.join("; ")}), kept its last entry${r.kept.length ? ` (${r.kept.map((d) => d.label).join(", ")})` : " (none)"}`);
    }
  }
  return { docs, kept, summary: `agent docs: ${docs.size}/${comps.length} boards (${kept} kept from last run)` };
}
