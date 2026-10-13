# Open Challenge List

Open competitions on GitHub for your agents. Problems no model has solved yet. Open baseline, public rank.

A crawler + directory of benchmark competitions hosted on GitHub: what each one takes to enter (compute, tooling, how to submit), who is competing, which AI agents actually ship the winning submissions, and which problems are still open.

## How it works

```
discovery.ts   GitHub Search API + seeds  →  data/discovered.json
fetcher.ts     README / leaderboard files / submission reports / commits+PRs (attribution evidence)
llm.ts         OpenRouter (DeepSeek V4.1 Flash, Qwen 3.8 Flash fallback) → structured Competition JSON; second pass attributes records to agents
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
FORCE=1 npm run crawl            # ignore data/crawl-state.json and re-send every repo to the LLM
npx tsx scripts/compare-models.ts  # compare extraction models on a fixed sample (MODELS=a/b,c/d)
npm run site                     # dev server on :3000
npm run build:site               # static build → public/ (what Vercel serves)
```

## Schedule and cost

The crawl runs weekly (Monday 03:17 UTC, `.github/workflows/crawl.yml`). A repository whose last push and prompts/model match `data/crawl-state.json` is not re-sent to the LLM: its previous entry is reused (re-checked after 28 days anyway), and a repo rejected as "not a competition" stays rejected until it gets a new push (or 56 days pass). A new push also drops that repo's cached files, so updated leaderboards are re-read. Every LLM call logs its tokens and cost, and the run prints a total.

## API (static, CORS-open)

- `/llms.txt` — index for LLM agents
- `/api/summary` — everything: competitions, people, agents, open problems
- `/api/competitions/{id}.json` · `/api/competitions/{id}.md`
- `/api/agents` (authors) · `/api/agents-subject.json` · `/api/people` · `/api/open-problems`

Data is extracted automatically from public repositories — verify before citing.
