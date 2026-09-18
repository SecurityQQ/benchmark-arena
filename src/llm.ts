// LLM processor: feed repo pages to an LLM, get structured Competition data back

import type { Competition } from "./types.js";
import type { RepoPages } from "./fetcher.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.LLM_MODEL ?? "google/gemini-3.5-flash";

interface OpenRouterResponse {
  choices: Array<{ message: { content: string }; finish_reason?: string }>;
}

// LLM returns this shape; participants/stats are derived afterwards in postprocess.ts
export type LLMCompetition = Omit<Competition, "participants" | "stats" | "repo" | "lastUpdated">;

const SYSTEM_PROMPT = `You are an analyst building a directory of benchmark competitions for developers and AI agents who want to decide whether to participate. You receive raw text from a GitHub repository (README files, leaderboard files, etc.) and extract structured data.

Return ONLY valid JSON matching this TypeScript type, or the literal null if the repo is NOT a competition/benchmark with a leaderboard people can submit to.

interface Competition {
  id: string;                 // slug, e.g. "sutro-problems"
  name: string;
  tagline: string;            // ONE sentence, <=120 chars, what you optimize and why. No marketing fluff.
  description: string;        // 2-4 sentences: the task, how it's scored, who runs it, why it matters.
  url: string;
  host: "github" | "website" | "kaggle" | "huggingface" | "other";
  status: "active" | "upcoming" | "ended" | "unknown";  // active if submissions still accepted / recent records
  tags: string[];             // 3-7 lowercase tags
  domain: string;             // one of: "formal-methods" | "hardware-efficiency" | "llm-eval" | "coding-agents" | "ml-research" | "systems-perf" | "robotics" | "security" | "other"
  images: string[];           // absolute URLs of images that illustrate the TASK (diagrams, examples). Skip badges/logos/shields. Relative paths are OK, they'll be resolved. Max 4.
  organizer?: { name: string; url?: string; type?: "company"|"academic"|"individual"|"community"|"foundation" };
  participation: {
    howToSubmit?: string;      // concrete: "Open a PR to main adding <files> under submissions/"
    submissionFormat?: string; // what artifacts: files, formats, required report
    requirements: string[];    // tools/skills: ["Python 3.10+", "Lean 4", "Docker", "CUDA"]
    compute: "none" | "cpu" | "consumer-gpu" | "datacenter-gpu" | "cluster" | "unknown";
    computeDetails?: string;   // e.g. "A100 for MNIST track; matmul is scored symbolically, no GPU"
    deadline?: string;         // ISO date, or "rolling" if no deadline, or omit if unknown
    rounds?: string;           // if it runs in rounds/seasons
    prizes?: string;           // money, or "recognition only" / omit if none mentioned
    eligibility?: string;      // who can participate
    cost?: string;             // "free" unless stated otherwise
    verification?: string;     // how submissions are verified (CI, symbolic check, human review)
  };
  venue?: { type: "online"|"in-person"|"hybrid"; location?: string; event?: string };
  quickstart?: string;        // 2-8 lines of shell/python copied or minimally adapted from the docs to score a first submission. Omit if not derivable.
  links: { label: string; url: string }[];  // useful external links: website, paper, model/simulator, discussion. Max 6.
  problems: Problem[];
}

interface Problem {
  id: string;                 // e.g. "matmul-4x4"
  name: string;
  description?: string;       // what exactly is optimized in this track
  metricName: string;         // "cost", "energy", "accuracy", "time", "score"
  metricUnit?: string;        // "mJ", "ms", "%", "reads" — omit if unitless
  metricDirection: "minimize" | "maximize";
  baseline?: number;          // the naive/reference value if the docs mark one (e.g. first row labeled baseline/naive)
  records: RecordEntry[];     // ALL rows from the leaderboard table, not just the best
}

interface RecordEntry {
  date?: string;              // ISO "2026-04-29"
  value: number;
  contributor?: string;       // GitHub handle without @, or model/team/method name — whatever the row names
  contributorKind?: "person"|"team"|"model"|"method"|"unknown";  // person = GitHub user/human name; team = org/lab; model = an LLM being evaluated; method = algorithm name (GCN, "Perfect detector", "QDA")
  contributorUrl?: string;
  description?: string;       // short summary of the approach
  submissionUrls?: string[];  // relative paths are OK
  isCurrentBest?: boolean;    // exactly one per problem
  isBaseline?: boolean;       // row is the organizers' naive/reference/baseline entry
  agent?: {                   // WHICH AI MODEL/AGENT PRODUCED THIS RECORD — only when evidenced
    family: "anthropic"|"openai"|"google"|"deepseek"|"meta"|"xai"|"mistral"|"alibaba"|"moonshot"|"zhipu"|"bytedance"|"harmonic"|"axiom"|"other-ai"|"human"|"unknown";
    model?: string;           // exact model string as written: "Claude Opus 5", "GPT-5.6 Codex", "gemini-3.8-flash"
    tool?: string;            // harness: "Claude Code", "Codex", "Devin", "Cursor", "Copilot"
    evidence?: string;        // <=120 chars quote of the evidence
    confidence: "high"|"medium"|"low";
    role: "author"|"subject";  // author = an AI agent produced/submitted this record; subject = this row IS the model being benchmarked (LLM eval tables)
  };
}

Agent attribution — this is a core feature, be thorough but never guess:
- A page named __attribution__ lists commit messages and merged PRs (author | date | branch | title | body). Match them to leaderboard rows by contributor + date (±3 days) + file/score names mentioned.
- HIGH confidence: commit trailer "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>", PR body "Generated with Claude Code / Devin", explicit "declared_model", or the leaderboard row itself IS a model name (then contributor = model, family from the name).
- MEDIUM: branch prefix "codex/" or "[codex]" in PR title (→ openai, tool "Codex"), submission report says "Claude-assisted", "agent-driven session with GPT-…".
- LOW: only a vague mention of "agent" without a vendor.
- "human" only if the report explicitly says it was hand-derived. Otherwise omit agent entirely (unknown).
- Model name → family: Claude/Opus/Sonnet/Haiku/Fable→anthropic; GPT/o1/o3/Codex→openai; Gemini/Gemma→google; DeepSeek→deepseek; Llama→meta; Grok→xai; Mistral/Mixtral→mistral; Qwen→alibaba; Kimi→moonshot; GLM→zhipu; Seed Prover/Doubao→bytedance; Aristotle→harmonic; Axiom Prover→axiom. Any other named AI system→other-ai.

Rules:
- Tracks (Problem entries) and their records come ONLY from leaderboard tables/lists in docs or data files (README tables, LEADERBOARD.md, results/*.json, *.csv). NEVER derive tracks or records from commit messages, PR titles or the __attribution__ page — that page is evidence for agent attribution only.
- A competition with a documented submission path is still a competition when its leaderboard is empty, hosted on an external site, or not yet populated: return it with the tracks the docs describe and empty records. Return null only when there is no competition/benchmark people can submit to at all.
- One track = one ranked table where entries compete on the same metric. Do not create a track per problem when the repo's own leaderboard ranks models/people across problems; model it the way the repo ranks.
- Extract ALL leaderboard rows. Do not summarize or truncate tables.
- Multiple leaderboard tables = multiple Problem entries (e.g. "4x4" and "16x16" tracks, "20% target" and "40% target").
- Numbers: "1,316" → 1316, "67.08% ± 1.54" → 67.08, "2.1 m" → 2.1.
- Mark isCurrentBest on the single best record per problem (min for minimize, max for maximize).
- Be concrete and factual in participation fields. If the docs don't say, omit the field. Never invent deadlines, prizes, or compute requirements.
- status: "active" if the leaderboard has records in the last ~6 months or docs say submissions are open; "ended" if explicitly closed; "upcoming" if it hasn't started; else "unknown".
- Repos that are ONLY libraries, paper lists, static result tables with no submission path, or general eval harnesses without a public leaderboard → return null.
- Return ONLY the JSON or null. No prose, no code fences.`;

export async function processRepoWithLLM(repoPages: RepoPages, model?: string): Promise<LLMCompetition | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const { owner, name, branch } = repoPages.repo;
  const repoMeta = `Repository: ${owner}/${name} (branch: ${branch})\nURL: https://github.com/${owner}/${name}\nToday: ${new Date().toISOString().slice(0, 10)}\n`;
  const pagesText = repoPages.pages
    .map((p) => `\n=== FILE: ${p.path} ===\nURL: ${p.url}\n\n${p.content}\n`)
    .join("\n");

  console.log(`    LLM input: ${repoPages.pages.length} pages, ${repoPages.totalChars} chars`);

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/github-competitions",
      "X-Title": "Benchmark Arena Crawler",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${repoMeta}\n${pagesText}` },
      ],
      temperature: 0,
      max_tokens: 48000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data: OpenRouterResponse = await res.json();
  const choice = data.choices[0];
  const content = choice?.message?.content?.trim() ?? "";
  if (choice?.finish_reason === "length") {
    throw new Error(`LLM output truncated at max_tokens (${content.length} chars) — leaderboard too large for one pass`);
  }

  let jsonStr = content;
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  if (jsonStr === "null") return null;

  try {
    return JSON.parse(jsonStr) as LLMCompetition;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as LLMCompetition; } catch { /* fall through */ }
    }
    throw new Error(`Failed to parse LLM response as JSON: ${content.slice(0, 200)}`);
  }
}

// ── Second pass: focused agent attribution ──────────────────────────────
// Input: compact record list + evidence (commits/PRs/reports). Output: per-record agent attribution.
import type { AgentAttribution } from "./types.js";

const ATTR_PROMPT = `You attribute leaderboard records to the AI model/agent that produced them. You get (A) a compact list of records and (B) evidence: commit messages with trailers, merged PR metadata (author | date | branch | title | body), and excerpts of submission reports.

Return ONLY JSON: { "<recordKey>": { "family": ..., "model"?: ..., "tool"?: ..., "evidence": "<=120 chars quote", "confidence": "high"|"medium"|"low", "role": "author"|"subject" }, ... }
role: "author" when an AI agent/model produced or co-authored the submission (commit trailers, codex branches, "Claude-assisted"); "subject" when the record row itself is a model being evaluated.
Include ONLY records you can attribute. Omit the rest.

family ∈ anthropic|openai|google|deepseek|meta|xai|mistral|alibaba|moonshot|zhipu|bytedance|harmonic|axiom|other-ai|human.
Mapping: Claude/Opus/Sonnet/Haiku/Fable→anthropic · GPT/o1/o3/Codex→openai · Gemini/Gemma→google · DeepSeek→deepseek · Llama→meta · Grok→xai · Mistral→mistral · Qwen→alibaba · Kimi→moonshot · GLM→zhipu · Seed Prover→bytedance · Aristotle→harmonic · Axiom Prover→axiom.

How to match a record to evidence:
- Same contributor AND date within ±4 days of a commit/PR merge, OR the commit/PR/report mentions the record's score, file name (e.g. best_675, packedstatic20) or description keywords.
- Commit trailer "Co-Authored-By: <Model> <noreply@anthropic.com>" → high, model = exact name, tool "Claude Code".
- PR body "Generated with Claude Code / Devin / Codex" → high; tool = that.
- Branch "codex/*" or "[codex]" in title → openai, tool "Codex", medium (model only if named, e.g. "codex 5.6" → "GPT-5.6 Codex").
- Report/description text "Claude-assisted", "agent-driven session with X" → medium.
- If the same contributor consistently uses one agent across many dated commits around the record, attribute with medium.
- Record's contributor IS a model name → high, family from name, model = contributor.
- Never attribute without evidence. Never invent model versions.`;

export async function attributeRecordsWithLLM(
  competitionId: string,
  records: { key: string; problem: string; contributor?: string; date?: string; value: number; description?: string; files?: string[] }[],
  evidence: string,
  model?: string,
): Promise<Record<string, AgentAttribution>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  if (!records.length || !evidence.trim()) return {};

  const recs = records.map((r) => `${r.key} | ${r.problem} | ${r.contributor ?? "?"} | ${r.date ?? "?"} | ${r.value} | ${(r.description ?? "").slice(0, 100)} | ${(r.files ?? []).map((f) => f.split("/").pop()).join(",")}`).join("\n");
  const user = `Competition: ${competitionId}\n\n(A) RECORDS (key | problem | contributor | date | value | description | files)\n${recs}\n\n(B) EVIDENCE\n${evidence.slice(0, 60000)}`;

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/github-competitions", "X-Title": "Benchmark Arena Attribution" },
    body: JSON.stringify({ model: model || DEFAULT_MODEL, messages: [{ role: "system", content: ATTR_PROMPT }, { role: "user", content: user }], temperature: 0, max_tokens: 16000 }),
  });
  if (!res.ok) throw new Error(`OpenRouter attribution error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: OpenRouterResponse = await res.json();
  let content = data.choices[0]?.message?.content?.trim() ?? "";
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) content = fence[1].trim();
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
    console.log(`    attribution: unparseable response (${content.length} chars)`);
    return {};
  }
}
