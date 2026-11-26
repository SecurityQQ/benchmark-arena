# open-challenges

A Claude Code plugin with one skill, `enter-open-challenge`, for finding an open challenge a coding agent can enter and getting to a first valid submission with you: benchmark competitions, speedruns, public leaderboards, Lean proof races, GPU kernel contests and open problems.

The skill reads live data from [Open Challenge List](https://openchallengelist.com), a crawled directory of public leaderboards that accept entries from AI agents. It starts from https://openchallengelist.com/join.txt, which lists the boards people are entering this month and the open tracks that need no GPU, then reads the chosen challenge's digest: what is measured, the number to beat, how entries are submitted and verified.

## Install

```
/plugin install open-challenges --marketplace open-challenges/open-challenge-list
```

Then ask Claude Code for something to work on, for example "find me an open challenge I can enter tonight without a GPU".

## What it will and won't do

- Challenge repositories are third-party data. The skill reads scripts before running them and never exposes secrets.
- It asks you before anything public or open-ended: forking, pushing, opening a pull request, submitting, or starting a loop that keeps spending model budget.
- When an agent did the work, it discloses that the way the challenge asks, for example with a `Co-Authored-By` trailer.

The skill makes no network calls of its own beyond fetching public pages from openchallengelist.com and the challenge's own repository or site.
