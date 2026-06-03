---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/117
synthesized_into: []
---

# v0.9.18 release digest

v0.9.18 is a version-stamp release — `package.json` is the only file that changed. All feature work landed across 13 constituent PRs on `main` between the v0.9.17 tag (2026-05-26) and this cut. The sections below cover the five headline changes.

---

## All twelve dimensions now have Execution scorers

**CCE-76 / PR #116**

Memory & Context Management and Terminal & Customization were the last two dimensions without an Execution scorer. Both now have one, sourced from transcript-derived posture-command coverage signals (the `interactive_cli ∪ unknown`-gated counters introduced in CCE-71). The session universe for these two dims is `interactive_or_unknown` — `sessionsByKind.interactive_cli + sessionsByKind.unknown` — which matches the `interactive_cli` posture-ratio precedent set by permissions, planning, and model/effort tuning.

Radar consequence: the italic "unmeasured" label and `¹` footnote now only appear on dims where the Execution scorer returns `gapReason !== null` (e.g. zero interactive sessions in the scoring window). If you have any interactive activity in the last 30 days, those two dims will render scored, not greyed.

---

## POSTURE / VOLUME command partition

**CCE-71 / PR #110**

Before this change, all transcript-scanned command invocations were aggregated the same way, regardless of session kind. That produced a silent error: posture commands counted from `sdk_orchestrated`, `observer`, and `subagent` sessions inflated the numerator of posture ratios whose denominator was `interactive_cli` only.

The fix is a hard partition in `scripts/_usage-data.mjs`:

- **`POSTURE_COMMANDS`** (`/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`) — counted only when `classifySessionKind` returns `interactive_cli` or `unknown`.
- **`VOLUME_COMMANDS`** (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`) — counted across every session kind. Autonomous-workflow signal is real regardless of which session emitted it.

A fail-loud `assertCommandPartition` runs at module load and catches any future drift (disjointness violations, missing classifications, dead classifications). If `npm run assess` exits non-zero with no `assessment.json` written, check stderr for partition errors before assuming an environmental issue.

---

## /ship Stage 2/3 credit across all journal-format generations

**CCE-72 / PR #113**

The ship-journal counter that awards `/ship` Stage 2 (verify-agent) and Stage 3 (simplify) credit now uses `stageRanInEntry()` — the canonical multi-format detector that handles all three journal generations: singular `entry.stage`, legacy-numeric `stages_run`, and the current string-array `stages_run`. Before this fix, journals written by older `/ship` versions underreported Stage 2/3 execution and suppressed next-action credit for engineers who'd been running `/ship` since before the journal format stabilized.

---

## Canonical predicate evaluator and pre-computed next-actions

**PR #106**

`scripts/predicate.mjs` is now the single source for the satisfiedWhen DSL evaluator. `app/lib/assessment.ts:evaluatePredicate` is a 1-line passthrough re-export; a test (`app/lib/__tests__/predicate-passthrough.test.ts`) asserts the two are reference-equal and fails CI if a duplicate implementation appears.

The ranked next-actions list is pre-computed on every `npm run assess` run and written to `assessment.json` as `rankedNextActions` (top 10, sorted by `weight × deficit`). The `/self-assessment` slash command reads from that field directly — no re-implementation of the filter or ranking logic in the skill.

---

## Telemetry-dated detectors on the /progression timeline

**CCE-33 / PR #108**

`scripts/progression.mjs` now includes telemetry-dated milestone detectors for dimensions that previously had no detector — meaning heavy real usage in those dims produced no timeline entry and the `/progression` page looked frozen past the first-run wall. Detectors read `start_time` from session-meta to self-date each milestone over full history (independent of `--insights-lookback`), so April activity shows on a timeline running under a 30-day scoring window.

Config milestones (`scripts/config-progression.mjs`) continue to stamp `firstSeenAt` at the first run that observes the signal. The first-run caveat still applies: any already-satisfied config signal gets the dashboard's first-run date, not a back-dated mtime.
