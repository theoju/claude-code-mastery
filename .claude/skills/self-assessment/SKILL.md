---
name: self-assessment
description: Score Claude Code usage on two axes (Platform Setup vs Execution) using the 12-dimension Self-Assessment rubric. Trigger on "score me", "self-assessment audit", "self-assessment", "rate my setup", "audit my claude code", "self-assessment score", "how am I doing with claude code", "am I improving", "/self-assessment".
---

# self-assessment

Deterministic self-assessment scorer. Real signals from `~/.claude/settings.json`, `~/.claude/{agents,commands,skills,projects/*/memory}`, installed plugins, and (opt-in) 30-day transcripts. Same machine state → same number.

## What to do

If `assessment.config.json` is missing, read `setup.md` and walk the user through the first-run flow before scoring.

Otherwise: run `npm run assess -- $ARGUMENTS`, then report back with:

- **Platform Setup** and **Execution** scores out of 100, plus the Δ between them. A high Δ is the diagnostic case — every tool installed, none of them fired.
- Dimensions that moved (↗ ↘ → ✦) since the last snapshot.
- Top 3 priority actions, noting which axis each falls on. **First filter** out every action whose `satisfiedWhen` predicate evaluates true against `signalsSummary` (a satisfied action is not a TODO — surfacing one as a priority is a reporting bug). Then rank the remainder by `weight × deficit`. Unpredicated actions stay in the pool — they're behavioral coaching that can't be auto-detected.

  **`satisfiedWhen` DSL grammar** (string predicates evaluated against `signalsSummary`):
  - `path` — truthy (non-null, non-zero, non-empty-string; strings `"0"` and `"false"` are also falsy)
  - `!path` — falsy
  - `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
  - `path=v` or `path=v|w|x` — equals (or equals one of)
  - `path!=v` — not equals
  - `path~regex` — array-of-strings element matches regex (case-insensitive)
  - `A & B` — AND of two or more atoms

  Canonical implementation: `app/lib/assessment.ts:evaluatePredicate`. Example: `loopCommandUses>=1` with `signalsSummary.loopCommandUses=14` evaluates to **true** → filter the action out, do not surface as a TODO.

- CLAUDE.md aggregate health if configured (totals/averages/grade distribution only — **never** project names, paths, or per-file issues).
- The dashboard URL from `assessment.config.json#publish.publicUrl` (or http://localhost:3737 if `npm run dev` is up).

If `slack.enabled: true` but `SLACK_WEBHOOK_URL` is missing, surface a single line: "Set SLACK_WEBHOOK_URL in `.env.local` (see `.env.example`) to enable Slack posts." Don't over-explain.

## Spokes (read on demand)

- `gotchas.md` — failure modes and their fixes. Read when scoring behaves unexpectedly or the user reports something off.
- `signals.md` — what gets read, what gets written, and how behavioral signals + anti-gaming gates work. Read when the user asks why a dimension didn't move or wants to understand a specific score.
- `setup.md` — first-run config flow. Read if `assessment.config.json` is missing or the user is configuring Slack/CLAUDE.md targets for the first time.

## Pointers

- Tune at `app/data/rubric.json` (titles, weights, targets, noise floors, next-action lists).
- Scoring logic: `scripts/score.mjs`. Explainer copy: `app/lib/dimension-explainer.ts` → renders at `/dimensions/<id>` on the dashboard.
- Cloud routine (07:15 daily run): `ROUTINE.md`.
- Human-facing user guide: `docs/self-assessment.md`.
- Companion slash command: `/refresh-insights` (`.claude/commands/refresh-insights.md`) — files the markdown that Claude Code's `/insights` already produced into the dashboard's narrative section. Pair them as the daily workflow: `/refresh-insights && /self-assessment ...`.
