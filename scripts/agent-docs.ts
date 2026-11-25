// Finds the organizers' own instructions for agents and writes data/agent-docs.json (src/agentDocs.ts): per board, links to
// AGENTS.md, CLAUDE.md, llms.txt or llms-full.txt at the repository root (one GitHub call per repository) and to an llms.txt on
// the competition's own site. Runs in the live refresh (.github/workflows/live.yml) before the commit step. The file has no
// timestamp, so it changes, and gets committed, only when the docs did. A board whose source gave no answer keeps its last entry.
//
//   GITHUB_TOKEN=$(gh auth token) npx tsx scripts/agent-docs.ts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "../src/env.js";
import { publicDataset } from "../src/build.js";
import { AGENT_DOCS_PATH, collectAgentDocs, serializeAgentDocs, validAgentDocs, type AgentDocs } from "../src/agentDocs.js";

loadEnv();
const root = process.cwd();
const { competitions } = publicDataset(JSON.parse(readFileSync(join(root, "data", "competitions.json"), "utf-8")));
const path = AGENT_DOCS_PATH(root);
const before = existsSync(path) ? readFileSync(path, "utf-8") : "";
let previous: AgentDocs = new Map();
try { if (before) previous = validAgentDocs(JSON.parse(before)); }
catch { console.warn("agent docs: data/agent-docs.json is not valid JSON; starting from nothing"); }

const { docs, summary } = await collectAgentDocs(competitions, previous);
const after = serializeAgentDocs(docs);
if (after !== before) writeFileSync(path, after);
console.log(`${summary}${after === before ? ", unchanged" : ", written"}`);
