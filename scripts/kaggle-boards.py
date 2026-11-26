"""Read two public Kaggle boards into runner-local files for the competition crawler."""
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

BOARDS = {
    "squares-in-squares": ("minimize", "CSV of square placements", ["geometry", "optimization", "math"]),
    "google-verifiable-quantum-circuit-compilation": (
        "maximize", "ZIP archive of circuits and factorization data", ["quantum-computing", "optimization"]
    ),
}


def build(api, slug, now):
    url = f"https://www.kaggle.com/competitions/{slug}"
    # Metadata search can return loosely related competitions. Only accept the exact URL.
    search = "Verifiable Quantum Circuit Compilation" if slug.startswith("google-") else "Squares in Squares"
    response = api.competitions_list(group="all", search=search)
    competition = next(c for c in response.competitions if c.ref.rstrip("/") == url)
    deadline = competition.deadline
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    entry_deadline = getattr(competition, "new_entrant_deadline", None)
    eligibility = "Review eligibility on the competition rules page."
    if entry_deadline:
        if entry_deadline.tzinfo is None:
            entry_deadline = entry_deadline.replace(tzinfo=timezone.utc)
        eligibility = f"New entrants must accept the rules by {entry_deadline.isoformat()}."
    direction, file_format, tags = BOARDS[slug]
    # Ask for the public standings explicitly once a competition has ended.
    # While entries are open the default standings are already public.
    if now <= deadline:
        rows = api.competition_leaderboard_view(slug, page_size=20)
    else:
        from kagglesdk.competitions.types.competition_api_service import ApiGetLeaderboardRequest

        request = ApiGetLeaderboardRequest()
        if not hasattr(type(request), "override_public"):
            raise ValueError("SDK cannot select the archived public leaderboard")
        request.competition_name = slug
        request.page_size = 20
        request.override_public = True
        with api.build_kaggle_client() as client:
            rows = client.competitions.competition_api_client.get_leaderboard(request).submissions
    records = []
    for row in rows or []:
        name = (row.team_name or "").strip()
        score = float(row.score)
        if not name or not math.isfinite(score):
            raise ValueError("Invalid leaderboard row")
        record = {"value": score, "contributor": name, "contributorKind": "team"}
        if row.submission_date:
            record["date"] = row.submission_date.date().isoformat()
        records.append(record)
    if not records:
        raise ValueError("Empty leaderboard")
    board_id = f"kaggle-{slug}"
    return {
        "id": board_id, "name": competition.title, "url": url, "host": "kaggle",
        "status": "active" if now <= deadline else "ended", "tags": tags,
        "domain": "other", "tagline": getattr(competition, "description", None) or competition.title,
        "description": "The top 20 teams on Kaggle’s public leaderboard. "
                       "The competition page lists entry requirements and dates.",
        "participation": {
            "requirements": ["Kaggle account", "Accept the organizer’s competition rules"],
            "compute": "unknown", "submissionFormat": file_format,
            "howToSubmit": "Review the rules and entry deadline on Kaggle, then submit through the competition page.",
            "deadline": deadline.astimezone(timezone.utc).isoformat(), "eligibility": eligibility,
        },
        "links": [{"label": "Rules", "url": url + "/rules"}, {"label": "Public leaderboard", "url": url + "/leaderboard"}],
        "problems": [{
            "id": "public-leaderboard", "name": "Public leaderboard", "metricName": "Kaggle score",
            "metricDirection": direction, "records": records,
        }],
    }


def main():
    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    api.authenticate()
    directory = Path(os.environ["RUNNER_TEMP"]) / "open-challenge-kaggle"
    directory.mkdir(exist_ok=True)
    for slug in BOARDS:
        path = directory / f"{slug}.json"
        path.unlink(missing_ok=True)
        try:
            board = build(api, slug, datetime.now(timezone.utc))
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(board, allow_nan=False), encoding="utf-8")
            temporary.replace(path)
            print(f"Kaggle {slug}: {len(board['problems'][0]['records'])} public leaderboard rows")
        except Exception as exc:
            # Report the call site without logging exception text or request headers.
            import traceback

            frames = traceback.extract_tb(exc.__traceback__)
            line = next(frame.lineno for frame in reversed(frames) if frame.filename == __file__)
            print(f"::warning::Kaggle {slug} unavailable ({type(exc).__name__}, importer line {line})")


if __name__ == "__main__":
    main()
