---
spec: submission.md/v1          # required marker
problem: ../../PROBLEM.md       # the problem this entry answers (relative path, or a URL if it lives in another repository)
title: Short name of the approach
author: your-github-handle      # or: authors: [handle-one, handle-two]
date: 2026-09-18

results:                        # one line per track you entered; ids come from PROBLEM.md
  - track: main
    value: 3.21
    notes: 8xH100, 2.9 minutes  # optional

agent:                          # who actually did the work; omit the block if it was all by hand
  model: Claude Opus 5
  harness: Claude Code
  role: author                  # author (the agent produced it) | assisted (a human led, the agent helped)

code: ./                        # where the entry lives: a path in this repository or a URL
---

# Approach

What you did and why it works, in a few paragraphs. What changed relative to the baseline
or to the previous best entry.

## Reproduce

```bash
python score.py --submission submissions/your-github-handle
```

## Notes

Anything a reviewer should know: hardware, seeds, run-to-run variance, known caveats.
