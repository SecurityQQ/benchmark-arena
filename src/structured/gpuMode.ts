// Deterministic builder for GPU MODE kernel leaderboards (gpumode.com).
// Sources (public, no login):
//   1. https://www.gpumode.com/api/leaderboard-summaries — every leaderboard with deadline, GPUs, priority GPU, visibility
//   2. https://www.gpumode.com/api/leaderboard/{id}      — description and per-GPU rankings (best submission per user)
// No LLM involved: every number is copied from the official API. Submission code sits behind login,
// so there is no evidence for agent attribution and records carry none.

import type { LLMCompetition } from "../llm.js";
import type { Problem, RecordEntry } from "../types.js";
import { boundedFetch } from "../github.js";

const SITE = "https://www.gpumode.com";
const CONCURRENCY = 4;

export interface GpuModeSummary { id: number; name: string; deadline?: string; gpu_types?: string[]; priority_gpu_type?: string; visibility?: string }
export interface GpuModeRanking {
  rank: number; score: number; user_name: string; submission_time?: string; submission_count?: number; submission_id?: number; file_name?: string;
  validation_status?: string | null; validation_fully_validated?: boolean | null; validation_shapes_passed?: number | null; validation_shapes_total?: number | null;
}
export interface GpuModeBoard { name: string; description?: string; deadline?: string; gpu_types?: string[]; lang?: string; rankings?: Record<string, GpuModeRanking[]> }

async function getData<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(`${SITE}${path}`, { headers: { accept: "application/json" } }, 8 * 1024 * 1024, 30_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      const j: any = await r.json();
      if (j?.code !== 0 || j?.data == null) throw new Error("bad payload");
      return j.data as T;
    } catch {
      if (attempt >= 1) throw new Error("GPU MODE download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export const trackId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// scores are seconds (geometric mean of runtimes); µs reads better. Keep ns precision.
export const toMicros = (seconds: number) => Math.round(seconds * 1e9) / 1000;
const day = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined);

// First prose paragraph of the official description, markdown-light, bounded
export function summarize(description?: string, max = 420): string {
  const paras = (description ?? "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p && !/^(```|#|\|)/.test(p));
  const first = paras[0] ?? "";
  return first.length > max ? `${first.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : first;
}

export function boardToProblem(s: GpuModeSummary, board: GpuModeBoard, now = Date.now()): Problem {
  const gpu = s.priority_gpu_type ?? Object.keys(board.rankings ?? {})[0] ?? "GPU";
  const rows = [...(board.rankings?.[gpu] ?? [])].filter((r) => r && typeof r.score === "number" && Number.isFinite(r.score) && r.user_name).sort((a, b) => a.rank - b.rank || a.score - b.score);
  const deadline = s.deadline ?? board.deadline;
  const ended = !!deadline && Date.parse(deadline) < now;
  const open = s.visibility !== "closed" && !ended;
  const boardUrl = `${SITE}/leaderboard/${s.id}`;
  const records: RecordEntry[] = rows.map((r) => {
    const bits = [`rank ${r.rank} on ${gpu}`];
    if (r.submission_count) bits.push(`${r.submission_count} submission${r.submission_count === 1 ? "" : "s"}`);
    if (r.validation_status === "completed" && r.validation_shapes_total) bits.push(`re-validated ${r.validation_shapes_passed ?? 0}/${r.validation_shapes_total} shapes`);
    else if (r.validation_status === "failed") bits.push("re-validation failed");
    return {
      value: toMicros(r.score),
      date: day(r.submission_time),
      contributor: r.user_name,
      contributorKind: "person",
      // Discord / site handles, not GitHub logins: link the ranking instead of guessing a profile.
      // Submission code is behind login, so there is no per-row submission URL.
      contributorUrl: boardUrl,
      description: bits.join(" · "),
      isCurrentBest: r.rank === 1,
    };
  });
  const others = (s.gpu_types ?? board.gpu_types ?? []).filter((g) => g !== gpu);
  const when = deadline && !deadline.startsWith("2100") ? `${ended ? "Closed" : "Deadline"} ${deadline.slice(0, 10)}.` : "Open-ended.";
  return {
    id: trackId(board.name || s.name),
    name: `${board.name || s.name} · ${gpu}`,
    group: gpu,
    description: [summarize(board.description), `Ranked by runtime on ${gpu}${others.length ? ` (also run on ${others.join(", ")})` : ""}. ${when}${open ? "" : " Submissions no longer accepted."}`].filter(Boolean).join(" "),
    metricName: "runtime",
    metricUnit: "µs",
    metricDirection: "minimize",
    isOpen: records.length === 0,
    records,
  };
}

export async function buildGpuMode(): Promise<LLMCompetition> {
  const { leaderboards } = await getData<{ leaderboards: GpuModeSummary[] }>("/api/leaderboard-summaries");
  if (!Array.isArray(leaderboards) || !leaderboards.length) throw new Error("GPU MODE download failed");
  const summaries = leaderboards.filter((s) => Number.isSafeInteger(s?.id) && typeof s?.name === "string" && s.visibility !== "private").sort((a, b) => b.id - a.id);
  const boards = await mapLimit(summaries, CONCURRENCY, (s) => getData<GpuModeBoard>(`/api/leaderboard/${s.id}`));
  const now = Date.now();
  const seen = new Set<string>();
  const problems: Problem[] = [];
  summaries.forEach((s, i) => {
    const p = boardToProblem(s, boards[i], now);
    if (!p.id || seen.has(p.id)) return;
    seen.add(p.id); problems.push(p);
  });
  const users = new Set(problems.flatMap((p) => p.records.map((r) => r.contributor)));
  const records = problems.reduce((n, p) => n + p.records.length, 0);
  const openBoards = summaries.filter((s) => s.visibility !== "closed" && !(s.deadline && Date.parse(s.deadline) < now)).length;
  const gpus = [...new Set(summaries.flatMap((s) => s.gpu_types ?? []))];
  console.log(`    gpu-mode: ${problems.length} leaderboards (${openBoards} accepting submissions), ${records} ranked rows, ${users.size} users`);

  return {
    id: "gpu-mode",
    name: "GPU MODE Kernel Leaderboards",
    tagline: "Write the fastest correct GPU kernel for a fixed operator; ranked by measured runtime on real NVIDIA and AMD hardware.",
    description: `GPU MODE runs kernel-optimization competitions through KernelBot: each leaderboard fixes an operator (GEMM variants, attention decode, MoE, all-to-all, linear algebra, quantization, beginner primitives), a correctness checker, and a benchmark grid; submissions are timed on the organizers' GPUs and ranked by (geometric-mean) runtime. ${problems.length} leaderboards, ${records} ranked entries from ${users.size} users on ${gpus.join(", ")}; ${openBoards} currently accept submissions. Reference problems and evaluators live in gpu-mode/reference-kernels.`,
    url: `${SITE}/`,
    host: "website",
    status: openBoards > 0 ? "active" : "ended",
    tags: ["gpu", "cuda", "triton", "kernels", "hip", "leaderboard", "performance"],
    domain: "hardware-efficiency",
    images: [],
    organizer: { name: "GPU MODE", url: `${SITE}/`, type: "community" },
    participation: {
      howToSubmit: "Pick a leaderboard, start from its starter submission.py in gpu-mode/reference-kernels, and submit through KernelBot: popcorn-cli (`popcorn submit submission.py --leaderboard <name>`), the GPU MODE Discord, or the editor on gpumode.com. Each submission is checked for correctness and timed on the leaderboard's GPUs.",
      submissionFormat: "A single Python file (submission.py) defining custom_kernel(data); CUDA, Triton or HIP code is embedded or loaded inline.",
      requirements: ["gpumode.com / Discord registration", "Python", "PyTorch", "CUDA / Triton / HIP"],
      compute: "none",
      computeDetails: "Benchmarks run on GPU MODE's hardware (A100, H100, B200, L4, T4, MI300, MI300x8, MI355X); no local GPU is required, though one helps for iteration.",
      deadline: "per leaderboard; beginner v2 problems are open-ended",
      prizes: "varies by competition (sponsored rounds have prizes)",
      eligibility: "Open to everyone with an account.",
      cost: "free",
      verification: "Server-side correctness checks and timing; top submissions are re-validated against a stricter contract on some leaderboards.",
    },
    venue: { type: "online", location: "Discord / gpumode.com" },
    quickstart: "curl -fsSL https://raw.githubusercontent.com/gpu-mode/popcorn-cli/main/install.sh | bash\ncurl -O https://raw.githubusercontent.com/gpu-mode/reference-kernels/main/problems/linalg/cholesky_py/submission.py\n# make custom_kernel faster, then:\npopcorn submit submission.py --leaderboard cholesky --no-tui",
    links: [
      { label: "Leaderboards", url: `${SITE}/` },
      { label: "Reference kernels (problems + evaluators)", url: "https://github.com/gpu-mode/reference-kernels" },
      { label: "popcorn-cli", url: "https://github.com/gpu-mode/popcorn-cli" },
      { label: "Discord", url: "https://discord.gg/gpumode" },
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
