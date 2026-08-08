---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory & Terminal/Customization now have real Execution scorers (CCE-76)

Before PR #116, two of the twelve rubric dimensions — **Memory & Context
Management** and **Terminal & Customization** — had no real Execution signal.
Their `EXECUTION_SCORERS` entries were stubs that always routed to
`unavailable(...)`, so the radar rendered them italic and unmeasured
regardless of how the user actually behaved. This was a real gap, not a
cosmetic one: cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`)
never breaks down individual command invocations, and CLAUDE.md had
previously routed both dimensions to `noTelemetry()` on that basis. CCE-76
closes the gap by recognizing that "cooked telemetry" and "Execution" aren't
the same thing — `learning` (the `★ Insight` banner scan) and `parallel`
(worktree-usage scan) already mixed transcript signals into Execution scoring
via `withGates({ transcripts: true, ... })`. Memory and Customization now
follow the same pattern.

With this change, **all twelve scored dimensions have Execution scorers**.
Model & Effort Tuning remains the only *partially* measured dimension — Opus
usage is scored from transcripts (`EXECUTION_SCORERS["model-effort"]` in
`scripts/score.mjs`), but effort level (`xhigh` / `max` / etc.) is never
written to session-meta, so that half stays settings-only on the Platform
Setup axis.

## Where the signal comes from

Both scorers consume **transcript-derived posture-command coverage
counters** — the same `interactive_cli ∪ "unknown"`-gated counters
introduced by CCE-71's per-command partition. `scanTranscriptInvocations` in
`scripts/_usage-data.mjs` walks `~/.claude/projects/*/*.jsonl` and, for each
session, classifies it via `classifySessionKind`. Only sessions classified
`interactive_cli` or the conservative `"unknown"` fallback count toward
`POSTURE_COMMANDS` signals (`/color`, `/voice`, `/focus`, `/btw`, `/clear`,
`/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`) — the
`allowPosture` gate inside the file's session loop. Observer and
SDK-orchestrated sessions frequently echo a primary session's
`<command-name>` markup without the user having typed anything, so those
kinds are excluded from posture counting; `VOLUME_COMMANDS` (`/loop`,
`/schedule`, `/babysit`, `/go`, `/batch`) stay unconditional because
autonomous-workflow volume is real regardless of which session emitted it.
`assertCommandPartition` runs at module load and fails loudly if the two sets
ever overlap or drift out of sync with `TARGET_COMMANDS`.

Two of the affected counters — `focusCommandUses` and `rewindCommandUses` —
previously incremented **per message** rather than per session, unlike the
other five posture counters. This PR unified them: `scanTranscriptInvocations`
now sets a per-session `sessionHasFocus` / `sessionHasRewind` flag on first
sighting and increments the counter once per session, matching the
session-coverage semantics `/btw`, `/clear`, `/compact`, `/voice`, and
`/color` already used. This mattered before the scorers could be written at
all: summing counters of two different classes (per-message vs. per-session)
into one ratio numerator would have silently corrupted the math, the same
failure mode CLAUDE.md's per-field semantic categorization rule exists to
prevent.

## The new `interactive_or_unknown` universe

`withGates` in `scripts/score.mjs` gates every Execution scorer on a
`universe` option that selects the session-count denominator: strict
`interactive_only`, broad `all_sessions`, or — new in this PR —
`interactive_or_unknown`. The posture-command counters are gated to
`interactive_cli ∪ "unknown"`, but the existing `interactive_only` universe
(`s.insights.interactiveSessionsAnalyzed`) is strict `interactive_cli`. Using
`interactive_only` as the denominator for these two scorers would have let a
session classified `"unknown"` land in the numerator without landing in the
denominator — exactly the numerator-broader-than-denominator shape that
produced the `Plan mode: 36/34 multi-task sessions (105.88%)` bug from PR
#97. `gatherInsightsSignals` in `scripts/insights-signals.mjs` now computes
and returns `interactiveOrUnknownSessionsAnalyzed` as
`sessionsByKind.interactive_cli + sessionsByKind.unknown`, and `withGates`
routes to it when `universe: "interactive_or_unknown"` is declared. Both new
scorers declare it, so their numerator's session universe is a strict subset
of their denominator's — the invariant CLAUDE.md's hard rule requires.

## The scorers, as they stand today

`EXECUTION_SCORERS.customization` (`scripts/score.mjs`) sums session-coverage
hits across `/color`, `/voice`, and `/focus`, read via `maxProbe` — which
takes the max of the transcript-scanned count and the `~/.claude/history.jsonl`
side-channel count, since each source has better fidelity for different
commands:

```
sum = maxProbe(s, "colorCommandUses")
    + maxProbe(s, "voiceCommandUses")
    + maxProbe(s, "focusCommandUses")
ratio = min(sum / interactiveOrUnknownSessionsAnalyzed, 1)
score = round(ratio * 100)
```

`EXECUTION_SCORERS.memory` sums `/clear` and `/compact` the same way. Note
that this is narrower than CCE-76 originally shipped it: the initial version
summed `/btw`, `/clear`, `/compact`, and `/rewind` together, but `/btw`'s
counter is cumulative all-time (not 30-day windowed) and `/rewind` is a
near-zero keyboard-shortcut signal — mixing them into one session-coverage
ratio violated the per-field semantic categorization CLAUDE.md now requires
before any field joins a numerator sum. That follow-up redesign (CCE-79)
restricted the Memory Execution numerator to the two genuinely
session-coverage, 30-day-windowed signals (`/clear` + `/compact`), surfaces
`/btw`'s cumulative count as evidence text only
(`s.signalsSummary?.cliBtwUseCountAllTime`), keeps `/rewind` as a
binary next-action probe rather than a ratio input, and lowered
`memory.target` in `app/data/rubric.json` from 92 to 60 to match the
narrowed realistic ceiling. The `memory` and `customization` scorer bodies in
`scripts/score.mjs` are the reference implementation for both PRs' combined
result.

Both scorers cap the ratio at 1.0 with `Math.min(rawRatio, 1)` — a session
that fires more than one covered command still only contributes once per
command to the sum, so a heavy `/clear`-and-`/compact` session can push
`rawRatio` past 1. When that happens, the evidence string surfaces it rather
than silently rounding to a clean 100:

```
Memory hygiene commands: 23 session-coverage hits across 120
interactive_cli∪unknown sessions (19.17%) — capped from … (multiple
memory commands per session)
```

## What this means for the radar

`app/components/RadarChart.tsx` renders a dimension's Execution vertex
italic and at reduced opacity only when that dimension's `gapReason` is
non-null. Both scorers set `gapReason: null` on every success path, so the
italic-unmeasured styling for Memory and Customization disappears
automatically once a user has `usage-data/` populated and runs with
`--include-transcripts` — no dashboard-side change was needed for this PR.
If transcripts weren't scanned at all, `withGates({ transcripts: true, ... })`
still routes to `unavailable(GAP_REASONS.NO_TRANSCRIPTS)`, and the vertex
stays italic with that reason surfaced — the two dimensions are measured,
not unconditionally scored.

## Net effect

- `scripts/insights-signals.mjs`: new `interactiveOrUnknownSessionsAnalyzed`
  field on the returned signals object.
- `scripts/score.mjs`: `withGates` accepts a third `universe` value;
  `EXECUTION_SCORERS.memory` and `EXECUTION_SCORERS.customization` replaced
  their `noTelemetry()`-style stubs with real ratio scorers.
- `scripts/_usage-data.mjs`: `focusCommandUses` and `rewindCommandUses`
  counting unified from per-message to per-session, matching the other five
  posture counters.
- Twelve of twelve rubric dimensions now carry a measured Execution score;
  Model & Effort Tuning is the sole partially-measured dimension.

No probe-catalog entries, `satisfiedWhen` predicates, or `signalsSummary`
keys were added by this change — `interactiveOrUnknownSessionsAnalyzed` lives
in the cooked-telemetry `insights` block, not `signalsSummary`, so it does
not move any of the five machine-enforced tracker header counts in
`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`.
