// Deterministic builder for AMD's ROCm llama.cpp optimization challenge (rocm-challenge.amddev.ai, "modelbot").
// Kaihui-AMD/modelbot-cli, the repository the crawler finds, is the contestant CLI; the boards live on the site.
// Sources (public, no login; the same calls the CLI makes):
//   1. https://rocm-challenge.amddev.ai/problems            — each open problem: statement, base commit, gates, benchmark items with
//                                                             their fixed Vulkan baselines, scoring rule, deadline, whether it accepts submissions
//   2. https://rocm-challenge.amddev.ai/leaderboard/{name}  — each user's best submission, in two buckets: "qualified" (faster than
//                                                             Vulkan on every item) and "accuracy_passed" (the others whose accuracy passed)
// No LLM involved: every number is copied from the API. Patches are private (download needs the owner's token), so there is no
// evidence for agent attribution and records carry none. A submission of examples/noop.patch (it only adds a comment) measures
// the unmodified build: those rows are folded into one baseline row per track, not counted as contestants.

import type { LLMCompetition } from "../llm.js";
import type { Problem, RecordEntry } from "../types.js";
import { boundedFetch } from "../github.js";

export const SITE = "https://rocm-challenge.amddev.ai";
export const CLI_REPO = "https://github.com/Kaihui-AMD/modelbot-cli";
export const USER_AGENT = "openchallengelist-crawler (+https://openchallengelist.com)";
const NOOP_URL = `${CLI_REPO}/blob/main/examples/noop.patch`;
const MAX_PROBLEMS = 20, MAX_ROWS = 500, MAX_ITEMS = 16;

export interface RocmItem { name?: string; value?: number; baseline?: number; ratio?: number; passed?: boolean }
export interface RocmRow { rank?: number; user?: string; submission_id?: number; file_name?: string; submitted_at?: string; score?: number; cv?: number; items?: RocmItem[] }
export interface RocmBoard { problem?: string; version?: string; qualified?: RocmRow[]; accuracy_passed?: RocmRow[] }
export interface RocmBenchmark { name?: string; case?: number; vulkan_avg_ts?: number }
export interface RocmProblem {
  name: string; version?: string; deadline?: string; accepting?: boolean; description?: string;
  base?: { repo?: string; commit?: string }; image?: string; allowed_paths?: string[]; max_patch_bytes?: number; gpu_type?: string;
  tests?: unknown[]; accuracy?: { mode?: string; tolerance?: number }; benchmarks?: RocmBenchmark[];
  score?: { better?: string; method?: string; metric?: string };
}

async function getJson(path: string, maxBytes: number): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await boundedFetch(`${SITE}${path}`, { headers: { accept: "application/json", "user-agent": USER_AGENT } }, maxBytes, 30_000);
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("rejected"); }
      return await r.json();
    } catch {
      if (attempt >= 1) throw new Error("ROCm challenge download failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ─── Third-party text ───────────────────────────────────────────────────
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : undefined);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
// A plain string with control and bidi characters dropped, markup brackets removed, whitespace collapsed, clipped
export function str(v: unknown, n: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(CONTROL, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return s ? clip(s, n) : undefined;
}
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const day = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return undefined;
  const d = v.slice(0, 10), t = Date.parse(d);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : undefined; // the validator rejects a non-date, and with it the whole build
};
const PROBLEM_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ITEM_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$/;
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/; // a GitHub login
const COMMIT = /^[0-9a-f]{40}$/;
const PATH = /^[A-Za-z0-9_.-]{1,40}\/?$/;
// "W7900D" → "AMD Radeon PRO W7900D (gfx1100 / RDNA3)"; another GPU is named as the API gives it
const gpuLabel = (gpu?: string) => (gpu === "W7900D" ? "AMD Radeon PRO W7900D (gfx1100 / RDNA3)" : gpu);
const rocmOf = (p: RocmProblem) => (typeof p.image === "string" ? p.image.match(/\brocm(\d{1,2}(?:\.\d{1,2}){1,2})\b/i)?.[1] : undefined);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const allowedPaths = (p: RocmProblem) => list<unknown>(p.allowed_paths).filter((x): x is string => typeof x === "string" && PATH.test(x)).slice(0, 8);
const patchLimit = (p: RocmProblem) => (Number.isSafeInteger(p.max_patch_bytes) && p.max_patch_bytes! > 0
  ? (p.max_patch_bytes! % 1048576 === 0 ? `${p.max_patch_bytes! / 1048576} MiB` : `${Math.round(p.max_patch_bytes! / 1024)} KiB`) : undefined);

// examples/noop.patch only adds a comment: its score is the unmodified build's, not a contestant's
export const isNoop = (fileName: unknown) => typeof fileName === "string" && /^no-?op\.(?:patch|diff)$/i.test(fileName.trim());

// The model the problem is about, from its statement's first line ("… backend run Qwen3.8-27B Q4_K_M faster than the Vulkan backend …")
export function modelOf(description: unknown): string | undefined {
  const first = str(typeof description === "string" ? description.split(/\n\s*\n/)[0] : undefined, 600);
  const m = first?.match(/\bbackend (?:run|decode|prefill|serve) ([A-Za-z0-9][\w.+-]*(?: [\w.+-]+){0,4}) faster than\b/);
  return m && m[1].length <= 80 ? m[1] : undefined;
}

interface Item { name: string; ratio: number; passed: boolean }
function itemsOf(row: RocmRow): Item[] {
  return list<RocmItem>(row.items).slice(0, MAX_ITEMS).flatMap((i) => {
    const it = obj(i);
    return it && typeof it.name === "string" && ITEM_NAME.test(it.name) && finite(it.ratio) ? [{ name: it.name, ratio: it.ratio, passed: it.passed === true }] : [];
  });
}
const validRow = (r: unknown): r is RocmRow => !!obj(r) && finite((r as RocmRow).score) && !!str((r as RocmRow).user, 40);

// ─── Tracks ─────────────────────────────────────────────────────────────
// One problem → one track. Contestants: each user's best submission (the site keeps one per user), qualified ones first.
// The noop.patch runs become one baseline row: the median score of the unmodified build and its spread.
export function problemToTrack(p: RocmProblem, board: RocmBoard, now = Date.now()): Problem {
  const name = p.name;
  const benches = list<RocmBenchmark>(p.benchmarks).slice(0, MAX_ITEMS).map((b) => obj(b)).filter((b): b is RocmBenchmark => !!b && typeof b.name === "string" && ITEM_NAME.test(b.name));
  const n = benches.length;

  const seen = new Set<string>();
  const contestants: { row: RocmRow; qualified: boolean }[] = [];
  const noops: RocmRow[] = [];
  for (const [bucket, qualified] of [["qualified", true], ["accuracy_passed", false]] as const) {
    const rows = list<unknown>(board[bucket]).slice(0, MAX_ROWS).filter(validRow)
      .map((row, i) => ({ row, i })).sort((a, b) => (finite(a.row.rank) && finite(b.row.rank) ? a.row.rank - b.row.rank : 0) || a.i - b.i).map((x) => x.row);
    for (const row of rows) {
      const who = str(row.user, 40)!.toLowerCase();
      if (isNoop(row.file_name)) { noops.push(row); continue; }
      if (seen.has(who)) continue; // the site lists each user once; a repeat is not a second entry
      seen.add(who);
      contestants.push({ row, qualified });
    }
  }

  const records: RecordEntry[] = contestants.map(({ row, qualified }, idx) => {
    const user = str(row.user, 40)!;
    const items = itemsOf(row);
    const faster = items.filter((i) => i.passed).length;
    const slower = items.filter((i) => !i.passed).map((i) => i.name);
    const bits = [
      `${qualified ? "qualified" : "accuracy passed"}${finite(row.rank) && Number.isSafeInteger(row.rank) ? ` (rank ${row.rank})` : ""}`,
      items.length ? (qualified || !slower.length ? `faster than Vulkan on all ${items.length} items` : `faster than Vulkan on ${faster} of ${items.length} items; slower on ${slower.slice(0, 6).join(", ")}${slower.length > 6 ? ", …" : ""}`) : "",
      finite(row.cv) ? `mean cv ${round(row.cv)}` : "",
      Number.isSafeInteger(row.submission_id) ? `submission #${row.submission_id}` : "",
    ];
    return {
      value: round(row.score!),
      date: day(row.submitted_at),
      contributor: user,
      contributorKind: "person",
      // the site's accounts are GitHub accounts with the same user name (modelbot-cli README: "Your modelbot account is your GitHub account")
      contributorUrl: HANDLE.test(user) ? `https://github.com/${user}` : `${SITE}/`,
      description: bits.filter(Boolean).join(" · "),
      isBaseline: false,
      isCurrentBest: idx === 0,
      passed: qualified, // a geometric mean of 1 or more is not enough: only a qualified entry (faster on every item) closes the track
    };
  });

  let baseline: number | undefined;
  if (noops.length) {
    const scores = noops.map((r) => r.score!);
    baseline = round(median(scores));
    const accounts = new Set(noops.map((r) => str(r.user, 40)!.toLowerCase())).size;
    const dates = noops.map((r) => day(r.submitted_at)).filter((d): d is string => !!d).sort();
    const perItem = benches.map((b) => {
      const ratios = noops.flatMap((r) => itemsOf(r).filter((i) => i.name === b.name).map((i) => i.ratio));
      return ratios.length ? `${b.name} ×${round(median(ratios), 3)}` : "";
    }).filter(Boolean);
    records.push({
      value: baseline,
      contributor: "unmodified build (noop.patch)", // not "llama.cpp": postprocess would read the word as a Meta model being benchmarked
      contributorKind: "method",
      description: [
        `the unmodified ROCm build: median of ${noops.length} noop.patch run${noops.length === 1 ? "" : "s"} by ${accounts} account${accounts === 1 ? "" : "s"}${dates.length ? ` (${dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`})` : ""}`,
        noops.length > 1 ? `range ${round(Math.min(...scores))}–${round(Math.max(...scores))}` : "",
        perItem.length ? `per item, ROCm ÷ Vulkan: ${perItem.join(", ")}` : "",
      ].filter(Boolean).join(" · "),
      submissionUrls: [NOOP_URL],
      isBaseline: true,
    });
  }

  const deadline = typeof p.deadline === "string" && Number.isFinite(Date.parse(p.deadline)) ? new Date(Date.parse(p.deadline)) : undefined;
  const open = p.accepting === true && (!deadline || deadline.getTime() > now);
  const commit = typeof p.base?.commit === "string" && COMMIT.test(p.base.commit) ? p.base.commit : undefined;
  const paths = allowedPaths(p);
  const tol = finite(p.accuracy?.tolerance) && p.accuracy!.tolerance! > 0 && p.accuracy!.tolerance! < 1 ? round(p.accuracy!.tolerance! * 100, 2) : undefined;
  const runs = list(p.tests).length;
  const gpu = str(p.gpu_type, 40);
  const summary = str(typeof p.description === "string" ? p.description.split(/\n\s*\n/)[0] : undefined, 420);
  const version = str(p.version, 40);
  const model = modelOf(p.description);
  return {
    id: name,
    name: model ? `${name} · ${model}` : name,
    description: [
      summary ?? "",
      `Score: the geometric mean over ${n} llama-bench item${n === 1 ? "" : "s"} of ROCm tokens/s divided by the item's fixed Vulkan baseline${n ? ` (${benches.map((b) => `${b.name} ${finite(b.vulkan_avg_ts) ? `${b.vulkan_avg_ts} t/s` : ""}`.trim()).join(", ")})` : ""}, higher is better.`,
      "Qualified means faster than Vulkan on every item, which is stricter than a geometric mean of 1 or more: the track stays open until an entry qualifies.",
      `Gates before scoring: the patch applies to llama.cpp${commit ? ` ${commit.slice(0, 8)}` : ""}${paths.length ? ` and touches only ${paths.join(" and ")}` : ""}, builds for ROCm${runs ? `, and ${runs} llama-perplexity run${runs === 1 ? "" : "s"} on wikitext-2 stay${runs === 1 ? "s" : ""} within ${tol ?? "the tolerance"}${tol ? "%" : ""} of the unmodified build` : ""}.`,
      `Scored on ${gpu ? `one ${gpuLabel(gpu)}` : "the organizers' GPU"}${rocmOf(p) ? ` with ROCm ${rocmOf(p)}` : ""}${version ? `, problem version ${version}` : ""}.`,
      open ? (deadline ? `Deadline ${deadline.toISOString().slice(0, 16).replace("T", " ")} UTC.` : "") : "Submissions closed.",
    ].filter(Boolean).join(" "),
    metricName: "speedup vs Vulkan (geomean)",
    metricUnit: "×",
    metricDirection: "maximize",
    ...(baseline !== undefined ? { baseline } : {}),
    passMark: 1,
    isOpen: true,
    records,
  };
}

// The site scores "geomean_ratio_to_baseline", higher is better; another rule would make this track's metric a lie
const scoredAsExpected = (p: RocmProblem) => p.score?.method === "geomean_ratio_to_baseline" && p.score?.better === "higher";

export async function buildRocmChallenge(): Promise<LLMCompetition> {
  const all = list<unknown>(await getJson("/problems", 2 * 1024 * 1024)).slice(0, MAX_PROBLEMS)
    .map((x) => obj(x) as RocmProblem | undefined).filter((p): p is RocmProblem => !!p && typeof p.name === "string" && PROBLEM_NAME.test(p.name));
  const seen = new Set<string>();
  const specs = all.filter((p) => !seen.has(p.name) && !!seen.add(p.name));
  if (!specs.length || !specs.every(scoredAsExpected)) throw new Error("ROCm challenge download failed");
  const problems: Problem[] = [];
  const now = Date.now();
  for (const p of specs) {
    const board = obj(await getJson(`/leaderboard/${encodeURIComponent(p.name)}`, 4 * 1024 * 1024)) as RocmBoard | undefined;
    if (!board || board.problem !== p.name) throw new Error("ROCm challenge download failed");
    problems.push(problemToTrack(p, board, now));
  }

  const entries = problems.flatMap((t) => t.records.filter((r) => !r.isBaseline));
  const users = new Set(entries.map((r) => r.contributor));
  const qualified = entries.filter((r) => r.passed).length;
  const accepting = specs.filter((p) => p.accepting === true && !(typeof p.deadline === "string" && Date.parse(p.deadline) <= now));
  const deadlines = [...new Set(accepting.map((p) => (typeof p.deadline === "string" && Number.isFinite(Date.parse(p.deadline)) ? new Date(Date.parse(p.deadline)).toISOString().slice(0, 16).replace("T", " ") : "")).filter(Boolean))];
  const first = specs[0];
  const commit = typeof first.base?.commit === "string" && COMMIT.test(first.base.commit) && specs.every((p) => p.base?.commit === first.base!.commit) ? first.base.commit : undefined;
  const gpu = str(first.gpu_type, 40), rocm = rocmOf(first);
  const paths = allowedPaths(first).join(" and ") || "the allowed paths";
  const limit = patchLimit(first);
  const baselines = problems.filter((t) => t.baseline !== undefined).map((t) => `${t.baseline} on ${t.id}`);
  console.log(`    rocm-challenge: ${problems.length} problems (${accepting.length} accepting), ${entries.length} contestant entries (${qualified} qualified) from ${users.size} users; unmodified build ${baselines.join(", ") || "not measured"}`);

  return {
    id: "rocm-llamacpp-challenge",
    name: "ROCm llama.cpp Challenge",
    tagline: `Make llama.cpp's ROCm (HIP) backend faster than its Vulkan backend${gpu ? ` on an ${gpuLabel(gpu)!.replace(/ \(.*\)$/, "")}` : ""}; patches are built, accuracy-checked and benchmarked on the organizers' GPU.`,
    description: [
      `AMD's ROCm llama.cpp optimization challenge (rocm-challenge.amddev.ai): on the same GPU${gpu ? ` (${gpu})` : ""}, llama.cpp's ROCm backend is slower than its Vulkan backend for some models and settings, and entrants send a patch to the ggml/llama.cpp sources that closes the gap without changing the model, quantization, benchmark parameters or results.`,
      `${problems.length} problem${problems.length === 1 ? "" : "s"}, one model each (${problems.map((t) => t.name).join("; ")}), each with its own leaderboard.`,
      "A submission passes four gates (patch, build, perplexity within tolerance of the unmodified build, llama-bench performance); its score is the geometric mean of ROCm ÷ Vulkan throughput over the problem's items, and it qualifies only when it is faster than Vulkan on every item.",
      entries.length ? `${entries.length} contestant entr${entries.length === 1 ? "y" : "ies"} from ${users.size} user${users.size === 1 ? "" : "s"}, ${qualified} qualified.` : "No contestant entries yet.",
      baselines.length ? `The unmodified build (examples/noop.patch, which only adds a comment) scores ${baselines.join(", ")}: a baseline row on each track, not an entry.` : "",
      "Patches are private, so records carry no agent attribution.",
    ].filter(Boolean).join(" "),
    url: `${SITE}/`,
    host: "website",
    status: accepting.length ? "active" : "ended",
    tags: ["gpu", "amd", "rocm", "hip", "llama.cpp", "ggml", "kernels", "inference", "performance", "leaderboard"],
    domain: "hardware-efficiency",
    images: [],
    organizer: { name: "AMD (modelbot)", url: `${SITE}/`, type: "company" },
    participation: {
      howToSubmit: `Install the modelbot CLI (pip install git+${CLI_REPO}), sign in with GitHub (modelbot register github), make a patch against llama.cpp${commit ? ` ${commit.slice(0, 8)}` : ""} that touches only ${paths}, and send it with modelbot submit my.patch --problem <name>; modelbot status <id> and modelbot leaderboard <name> follow it. The patch is checked, built and benchmarked on the organizers' GPU. Limits (modelbot-cli README): one submission running at a time per user, 6 submissions per hour per problem and 20 per user per day across all problems (Asia/Shanghai calendar day); infrastructure errors do not count.`,
      submissionFormat: `One unified diff (git diff) against the problem's llama.cpp base commit that touches only ${paths}${limit ? `, at most ${limit}` : ""}; no binaries, symlinks or submodules.${commit ? " All problems share the base commit, so one patch can be sent to several." : ""}`,
      requirements: ["GitHub account (sign-in)", "Python 3.9+ (modelbot CLI)", "llama.cpp checkout at the base commit", "HIP / ROCm kernel work in ggml"],
      compute: "none",
      computeDetails: `Every submission is built and benchmarked on the organizers' ${gpu ? gpuLabel(gpu) : "AMD GPU"}${rocm ? ` with ROCm ${rocm}` : ""}; no local GPU is required, though ${gpu === "W7900D" ? "an RDNA3 card" : "a similar AMD GPU"} helps for iteration.`,
      deadline: deadlines.length === 1 ? `${deadlines[0]} UTC` : deadlines.length ? `per problem: ${deadlines.map((d) => `${d} UTC`).join(", ")}` : "submissions closed",
      prizes: "Not stated; the problem statements rank qualified submissions for a \"bonus-point evaluation\".",
      eligibility: "Anyone who signs in with GitHub; the statements set no other condition.",
      cost: "free",
      verification: "Server-side, in a pinned ROCm image: the patch must apply and build, each llama-perplexity run on wikitext-2 must stay within the tolerance of the unmodified build, then llama-bench throughput is compared with fixed Vulkan baselines measured on the same GPU. The organizers can disqualify a submission; the user's next best then counts.",
    },
    venue: { type: "online", location: "rocm-challenge.amddev.ai" },
    quickstart: [
      `pip install git+${CLI_REPO}`,
      "modelbot register github",
      `modelbot problems ${first.name}        # base commit, gates, items and their Vulkan baselines`,
      `git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp${commit ? ` && git checkout ${commit}` : ""}`,
      "# edit files under ggml/ and src/ only, then:",
      "git diff > ../my.patch",
      `modelbot submit ../my.patch --problem ${first.name} --base .`,
    ].join("\n"),
    links: [
      { label: "Leaderboards", url: `${SITE}/` },
      { label: "modelbot CLI (how to enter)", url: CLI_REPO },
      { label: "Problem statements", url: `${CLI_REPO}/tree/main/problem` },
      { label: "examples/noop.patch (measures the unmodified build)", url: NOOP_URL },
      { label: "Problems (JSON)", url: `${SITE}/problems` },
      ...(commit ? [{ label: "llama.cpp base commit", url: `https://github.com/ggml-org/llama.cpp/commit/${commit}` }] : []),
    ],
    problems,
    agentStats: [],
  } as LLMCompetition;
}
