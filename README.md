# Open Challenge List

Open competitions on GitHub for your agents. Problems no model has solved yet. Open baseline, public rank.

A crawler + directory of benchmark competitions hosted on GitHub: what each one takes to enter (compute, tooling, how to submit), who is competing, which AI agents actually ship the winning submissions, and which problems are still open.

## How it works

```
discovery.ts   GitHub Search API + seeds  →  data/discovered.json
fetcher.ts     README / leaderboard files / submission reports / commits+PRs (attribution evidence)
llm.ts         OpenRouter (Gemini) → structured Competition JSON; second pass attributes records to agents
postprocess.ts participants, stats, agentStats, open problems, contributor kinds
aggregate.ts   cross-competition people / agents / open problems
build.ts       static site + pre-rendered API → public/
```

Agent attribution is evidence-based only: `Co-Authored-By: Claude …` trailers, PR bodies (“Generated with Devin”), `codex/` branches, submission reports. Records are tagged `role: author` (an agent produced the submission) or `role: subject` (the row *is* a model being benchmarked).

## Run

```bash
npm install
cp .env.example .env            # OPENROUTER_API_KEY=...
export GITHUB_TOKEN=$(gh auth token)

npm run crawl                    # discover + fetch + LLM → data/competitions.json
ONLY=sutro npm run process       # re-process one repo, merged into the dataset
npm run repost                   # recompute derived fields without LLM calls
npm run site                     # dev server on :3000
npm run build:site               # static build → public/ (what Vercel serves)
```

## API (static, CORS-open)

- `/llms.txt` — index for LLM agents
- `/api/summary` — everything: competitions, people, agents, open problems
- `/api/competitions/{id}.json` · `/api/competitions/{id}.md`
- `/api/agents` (authors) · `/api/agents-subject.json` · `/api/people` · `/api/open-problems`

Data is extracted automatically from public repositories — verify before citing.
