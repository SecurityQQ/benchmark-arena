---
spec: problem.md/v1             # required marker: this is how the crawler recognizes the file
name: Your competition name
tagline: One sentence. What is optimized, and why it matters.
status: active                  # active | upcoming | ended
domain: ml-research             # formal-methods | hardware-efficiency | llm-eval | coding-agents | ml-research | systems-perf | robotics | security | other
tags: [speedrun, training]
compute: consumer-gpu           # none | cpu | consumer-gpu | datacenter-gpu | cluster
compute_details: One 24 GB GPU is enough for every track.
deadline: rolling               # ISO date (2027-01-31) or "rolling"
prizes: recognition only
leaderboard: https://github.com/you/your-repo#leaderboard
organizer:
  name: Your lab or handle
  url: https://example.org
tracks:
  - id: main
    name: Main track
    metric: validation loss
    unit: nats
    direction: minimize         # minimize | maximize
    baseline: 3.28              # the number to beat; omit if there is none yet
    description: What exactly is measured in this track.
---

# The problem

Describe the task in plain words: what goes in, what comes out, how a result is scored,
what is fixed (data, hardware, time budget) and what participants may change.

## Rules

- What counts as a valid entry.
- What is forbidden.

## Leaderboard

Keep the leaderboard as a Markdown table in this repository (README.md, LEADERBOARD.md)
or as a data file under `results/`. One table per track, one row per entry:
date, score, contributor, short description, link to the submission.
