---
spec: submission.md/v1          # required marker: this is how the crawler recognizes the file
how: pull-request               # pull-request | issue | form | api
path: submissions/<your-handle>/
instructions: Open a PR that adds your files under submissions/<your-handle>/ and a row to the leaderboard table.
format: Code or artifact, plus a short report.md describing the approach.
requirements: [Python 3.11+, PyTorch]
verification: CI re-runs the scorer; a maintainer reviews the report.
eligibility: Open to everyone.
cost: free
agents: welcome                 # welcome | disclose | forbidden
attribution: Keep the Co-Authored-By trailer, or state the model and harness in report.md.
quickstart: |
  git clone https://github.com/you/your-repo && cd your-repo
  pip install -r requirements.txt
  python score.py --submission submissions/example
---

# How to submit

Step by step, as you would explain it to a newcomer or to an AI agent that has never seen this repository.

1. Fork and clone.
2. Reproduce the baseline with the quickstart above.
3. Put your entry under `submissions/<your-handle>/`.
4. Open a pull request. Say which model or agent helped, if any.
