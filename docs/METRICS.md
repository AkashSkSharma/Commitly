# Metrics — what's tracked and why

The goal is signals a manager can act on, not a single vague "score."
Everything below is a real number pulled from GitHub, shown per
developer, per time window (7/30/90 days on the dashboard).

| Metric | What it is | Why it matters |
|---|---|---|
| PRs opened / merged | Count of pull requests | Raw throughput — how much shipped work is flowing |
| Avg time to merge | Hours/days from PR opened → merged | Flags PRs that stall — could be reviewer bottleneck OR PR too large/unclear |
| Avg PR size (lines changed) | Additions + deletions per PR | Very large PRs are harder to review well and riskier to ship |
| Reviews given | Count of reviews a dev submitted on others' PRs | Collaboration/mentorship signal — not just "how much did I ship" |
| Review comments given | Count of PR comments authored | Depth of review engagement |
| Avg review turnaround | Hours from PR opened → first review | How fast a dev's PRs get looked at (or, for reviewers, how responsive they are) |
| Testing/QA comments | Comments matching testing-related keywords | Approximates "testing/QA feedback," which you specifically asked to track |
| Commits / active days | Commit count and distinct days with commits | Baseline activity pulse |
| Needs attention (PR list, not per-dev) | Open PRs stale ≥7 days, or unreviewed ≥2 days | Surfaces what's actually stuck *right now*, separate from historical metrics — this is the first thing a manager should look at |

## Deliberately not shown (yet)

A single composite "performance score" is left out on purpose — a
weighted number that mixes throughput, review activity, and testing
tends to hide *why* someone's number moved, and it's easy to read as
"ranking people" rather than "seeing where things are stuck." If you
still want one later, it belongs as a secondary, clearly-labeled
number next to the raw metrics — not the headline.

## Feature ideas to add incrementally

- Trend charts per developer (this dashboard already logs history in
  `pull_requests`/`commits`, so a sparkline per metric is mostly a UI
  addition)
- Review-load imbalance (who's reviewing everything vs. nobody)
- Slack/email digest of the weekly numbers and the Needs Attention list
- Configurable staleness thresholds per org (currently fixed at 7
  days / 2 days unreviewed in `getNeedsAttention`)
- CI pass-rate per PR (the `ci_conclusion` column is already in the
  schema, just needs the sync script to pull check-run status)
- Filter/segment by `team` (column already exists on `developers`)
- Per-repo breakdown, not just per-developer
- Manager notes/annotations on a developer's page (e.g. "on leave
  March 1–15" so a quiet period isn't misread)
