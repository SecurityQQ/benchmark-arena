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
organizer:
  name: Your lab or handle
  url: https://example.org

tracks:                         # what is measured; a submission reports a value for one or more of these ids
  - id: main
    name: Main track
    metric: validation loss
    unit: nats
    direction: minimize         # minimize | maximize
    baseline: 3.28              # the number to beat; omit if there is none yet
    description: What exactly is measured in this track.

submit:                         # how and where entries arrive
  how: pull-request             # pull-request | issue | form | api
  path: submissions/<handle>/   # one folder per entry; each folder holds a SUBMISSION.md
  format: Code or artifact, plus SUBMISSION.md with the approach and the scores.
  requirements: [Python 3.11+, PyTorch]
  verification: CI re-runs the scorer; a maintainer reviews the entry.
  eligibility: Open to everyone.
  cost: free
  agents: welcome               # welcome | disclose | forbidden
  attribution: State the model and harness in SUBMISSION.md; keep Co-Authored-By trailers.

quickstart: |
  git clone https://github.com/you/your-repo && cd your-repo
  pip install -r requirements.txt
  python score.py --submission submissions/example
---

# The problem

Describe the task in plain words: what goes in, what comes out, how a result is scored,
what is fixed (data, hardware, time budget) and what participants may change.

## Rules

- What counts as a valid entry.
- What is forbidden.
- How ties and re-submissions are handled.

## How to submit

1. Fork and clone. Reproduce the baseline with the quickstart.
2. Create `submissions/<your-handle>/` with your code or artifact.
3. Add `SUBMISSION.md` to that folder: the approach, and your score for each track you entered.
4. Open a pull request. The leaderboard is built from the SUBMISSION.md files.
