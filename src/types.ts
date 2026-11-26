// Data model extracted by LLM from competition pages

export type CompetitionStatus = "active" | "upcoming" | "ended" | "unknown";
export type ComputeTier = "none" | "cpu" | "consumer-gpu" | "datacenter-gpu" | "cluster" | "unknown";

export interface Organizer {
  name: string;
  url?: string;
  type?: "company" | "academic" | "individual" | "community" | "foundation";
}

export interface Participation {
  howToSubmit?: string;          // "Open a PR adding files under submissions/"
  submissionFormat?: string;     // "IR file + markdown report + python script"
  requirements: string[];        // ["Python 3.10+", "Lean 4", "Docker"]
  compute: ComputeTier;
  computeDetails?: string;       // "A100 40GB for MNIST track; CPU-only for matmul"
  deadline?: string;             // ISO date or free text ("rolling", "none")
  rounds?: string;               // "Runs in rounds; current round rebuilt on every change"
  prizes?: string;               // "$2M total" or "recognition only"
  eligibility?: string;          // "Open to everyone" / "University students only"
  cost?: string;                 // "free"
  verification?: string;         // "CI validates symbolically; maintainer review"
}

export interface Venue {
  type: "online" | "in-person" | "hybrid";
  location?: string;             // "Stockholm" / "Kaggle" / "GitHub"
  event?: string;                // "NeurIPS 2026 workshop"
}

export interface Participant {
  name: string;
  url?: string;
  submissions: number;
  bestRank?: number;             // 1 = holds a current record
  problems: string[];            // problem ids they submitted to
  lastActive?: string;
  profile?: string;              // published only: the person's profile, /u/{profile} (src/profiles.ts), when the name is one person
}

export interface Stats {
  totalRecords: number;
  uniqueParticipants: number;
  firstSubmission?: string;
  lastSubmission?: string;
  recordsLast30d: number;
  recordsLast90d: number;
}

export interface Competition {
  id: string;
  name: string;
  tagline: string;               // one-line summary
  description: string;           // 2-4 sentences
  url: string;
  repo?: { owner: string; name: string; branch?: string };
  host: "github" | "website" | "kaggle" | "huggingface" | "other";
  status: CompetitionStatus;
  tags: string[];
  domain: string;                // one of DOMAINS in domains.ts: "formal-methods" | "coding-agents" | "chip-design" | ...
  images: string[];              // absolute URLs
  organizer?: Organizer;
  participation: Participation;
  venue?: Venue;
  quickstart?: string;           // shell/code snippet to get started
  links: { label: string; url: string }[];
  problems: Problem[];
  participants: Participant[];   // derived
  stats: Stats;                  // derived
  agentStats: AgentStat[];       // derived: which model families produced records here
  standard?: { problem: boolean; submission: boolean; submissions: number; version: number; warnings: string[] };  // repo ships PROBLEM.md; entries carry SUBMISSION.md
  agentPolicy?: { agents?: string; attribution?: string };  // from SUBMISSION.md: are AI agents welcome, how to disclose them
  agentDocs?: AgentDoc[];        // the organizer's own instructions for agents (data/agent-docs.json, src/agentDocs.ts): linked, never copied
  importance?: Importance;       // how much it matters and why (data/frontier.json, src/frontier.ts); unrated boards have none
  lastUpdated: string;
}

// A board's rating (src/frontier.ts): three scores, their total, the frontier tier and one line on why it matters
export interface Importance { tier: "frontier" | "other"; score: number; stakes: number; open: number; verified: number; why: string }

// A link to an organizer's AGENTS.md, CLAUDE.md or llms.txt. The label is one of ours (src/agentDocs.ts), never the file's text.
export interface AgentDoc { label: string; url: string }

export type AgentFamily =
  | "anthropic" | "openai" | "google" | "deepseek" | "meta" | "xai" | "mistral" | "alibaba" | "moonshot" | "zhipu"
  | "bytedance" | "harmonic" | "axiom"
  | "other-ai" | "human" | "unknown";

export interface AgentAttribution {
  family: AgentFamily;
  model?: string;                // "Claude Opus 5", "GPT-5.6 Codex"
  tool?: string;                 // "Claude Code", "Codex", "Devin", "Cursor"
  evidence?: string;             // short quote: "Co-Authored-By: Claude Opus 5" / "branch codex/matmul-66300"
  confidence: "high" | "medium" | "low";
  role: "author" | "subject";    // author = the agent produced the submission; subject = the row benchmarks the model itself
}

export interface AgentStat {
  family: AgentFamily;
  records: number;
  currentBests: number;          // bests in contested tracks (≥2 distinct contributors)
  uncontestedBests?: number;     // "bests" in tracks with a single contributor — not a win, just a first entry
  models: string[];
  contributors: string[];
}

export interface Problem {
  id: string;
  name: string;
  group?: string;                // challenge the track belongs to, when the repo hosts several ("mnist", "matmul")
  description?: string;
  metricName: string;
  metricUnit?: string;
  metricDirection: "minimize" | "maximize";
  baseline?: number;             // naive/reference value, if known
  passMark?: number;             // graded tracks: a record closes the track only at or past this value (a rejected proof is not a solution)
  isOpen: boolean;               // derived: nobody beat the baseline yet (0 records, or only baseline rows), or nobody reached passMark
  contested?: boolean;           // derived: ≥2 distinct non-baseline contributors — only then does "current best" mean anything
  records: RecordEntry[];
}

export interface RecordEntry {
  date?: string;
  value: number;
  contributor?: string;
  contributorKind?: "person" | "team" | "model" | "method" | "unknown";  // what the contributor column actually names
  contributorUrl?: string;
  description?: string;
  submissionUrls?: string[];
  isCurrentBest?: boolean;
  isBaseline?: boolean;          // naive/reference row set by organizers
  passed?: boolean;              // graded tracks: the source's own verdict; false never closes the track, whatever the value (a geomean past 1 that is not faster on every item)
  agent?: AgentAttribution;
  profiles?: string[];           // published only: the profiles of the people this entry credits (src/profiles.ts)
}

export interface DiscoveredRepo {
  owner: string;
  name: string;
  url: string;
  description?: string;
  stars: number;
  topics: string[];
  defaultBranch: string;
  pushedAt?: string;             // last push, from the GitHub API: unchanged repos are not re-sent to the LLM
  priority?: boolean;            // ships PROBLEM.md / SUBMISSION.md: crawled first in the weekly run
}

// What the last LLM pass saw per repo (data/crawl-state.json). A repo with the same last push and the same prompts/model is not
// re-sent to the LLM: its previous entry is reused, or, if it was "not a competition", it stays rejected.
export interface RepoState {
  pushedAt: string;
  fingerprint: string;
  verdict: "competition" | "none";
  checkedAt: string;
  head?: string;                 // default-branch commit the files were read at: the live refresh diffs the branch against it
  sources?: string[];            // files the extractor read ("dir/" = anything under it): only a change to one of them re-extracts live
  live?: true;                   // written by a live re-extraction: the weekly crawl's fetch cache predates it
  liveFailedAt?: string;         // a live re-extraction failed or shrank the board: not retried live for a day
}

export interface CrawlResult {
  crawledAt: string;
  competitions: Competition[];
  errors: { repo: string; error: string }[];
}
