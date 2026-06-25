---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Execution Scoring Architecture

The Execution axis answers one question: are you actually using the tools you've installed? It reads from `~/.claude/usage-data/{facets,session-meta}/*.json` (cooked telemetry) and, where cooked telemetry has no per-command breakdown, from transcript scanning of `~/.claude/projects/*/*.jsonl`.

This page describes the architecture governing all twelve Execution scorers as of CCE-76 (PR #116), when the last two stub (`noTelemetry()`) dimensions — Memory & Context Management and Terminal & Customization — were replaced with real ratio scorers.

## Two-axis model

Every scored dimension returns two independent numbers:

| Axis | Question | Primary source |
| ---- | -------- | -------------- |
| **Platform Setup** | Are the tools in place? | `~/.claude/settings.json`, `agents/`, `commands/`, `skills/`, `plans/`, MEMORY.md files |
| **Execution** | Are you using them? | `~/.claude/usage-data/` (cooked telemetry) + optional transcript scan |

The axes are never collapsed into a single composite. The diagnostic case is a high delta — every tool installed, none of them fired.

## Scorer anatomy

Each Execution scorer is built from three parts:

**Signal** — a named counter or ratio read from `insights-signals.mjs` or produced by `scanTranscriptInvocations` in `_usage-data.mjs`. Naming convention: `<thing>SessionCount` for per-session coverage counters, `<thing>CommandUses` for per-invocation counts.

**Gate** — declared on `withGates(...)` in `score.mjs`. Two independent gate dimensions:

- `transcripts: true` — scorer reads transcript-derived signals; requires `--include-transcripts` at run time
- `universe:` — the session set used as the ratio denominator (see below)

**Normalization** — `clamp(round(rawScore / target × 100))`. Raw values (`rawScore`, `rawTarget`, `executionRawScore`) are preserved in `assessment.json` for audit. Targets are set per-dimension in `app/data/rubric.json`.

## Universe options

The denominator universe is declared per-scorer and enforced at scorer construction time:

| Universe | Session kinds counted | Typical use |
| -------- | --------------------- | ----------- |
| `interactive_only` | `interactive_cli` | Posture signals the user controls directly |
| `interactive_or_unknown` | `interactive_cli ∪ unknown` | Posture-command coverage; required when the CCE-71 partition gates counting to `interactive_cli \| unknown` |
| `all_sessions` | All session kinds | Volume scorers (integrations, scheduled, remote) |

**Denominator hard rule (from PR #97):** a ratio's numerator must be a strict subset of its denominator's universe. If posture commands are counted only in `interactive_cli | unknown` sessions, the denominator must be `interactive_or_unknown`, not `interactive_only` — otherwise the ratio can exceed 100%. CCE-76 introduced `interactive_or_unknown` as an explicit named option to make the correct choice unambiguous for transcript-derived posture scorers.

## Signal sources

Three distinct sources feed Execution scoring.

### Cooked telemetry (`~/.claude/usage-data/`)

Loaded by `insights-signals.mjs` / `_usage-data.mjs`. Covers per-session metadata: session kinds, durations, multi-task flags, plan-mode usage, tool-call volumes. The scoring window defaults to 30 days (`--insights-lookback`).

Cooked telemetry has **no per-command breakdown** — it records that a session happened and its aggregate shape, not which slash commands fired inside it. This is why Memory & Context Management and Terminal & Customization required a different signal source.

### Transcript signals (`~/.claude/projects/*/*.jsonl`)

Loaded by `scanTranscriptInvocations` in `_usage-data.mjs`. Counts per-command invocations and collapses them to per-session coverage. Requires `--include-transcripts` at run time and `withGates({ transcripts: true })` at scorer declaration.

Transcript signals split across two partitions, enforced by `assertCommandPartition` at module load:

| Partition | Commands | Counting gate |
| --------- | -------- | ------------- |
| `POSTURE_COMMANDS` | `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` | `interactive_cli \| unknown` sessions only |
| `VOLUME_COMMANDS` | `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` | All session kinds |

Posture commands are filtered to `interactive_cli ∪ unknown` because they reflect deliberate user choices only when the user is driving the session. Volume commands count across all session kinds because autonomous-workflow signal is real regardless of how the session was classified.

### Behavioral markers in transcripts

Two behavioral signals scan transcript content rather than command invocations:

- **`★ Insight` banner** — presence of the learning-mode banner string (Learning scorer)
- **Worktree paths** — worktree-based project paths in the session file path (Parallel scorer)

## The transcript-signal pattern

Four scorers mix transcript signals into the Execution axis. All declare `withGates({ transcripts: true })`:

| Scorer | Signal | Universe | Introduced |
| ------ | ------ | -------- | ---------- |
| Learning | `★ Insight` banner presence | `interactive_only` | Pre-CCE-76 |
| Parallel | Worktree path detection | `interactive_only` | Pre-CCE-76 |
| Memory & Context Management | `/btw`, `/clear`, `/compact` session coverage | `interactive_or_unknown` | CCE-76 |
| Terminal & Customization | `/color`, `/voice`, `/focus` session coverage | `interactive_or_unknown` | CCE-76 |

The `interactive_or_unknown` universe was required for the two new scorers because the CCE-71 posture-command partition already gates counting to `interactive_cli | unknown` — using `interactive_only` as the denominator would exclude `unknown` sessions from the bottom while they appear in the top.

## All twelve Execution scorers

As of CCE-76, every dimension returns a numeric Execution score. No dimension routes to `noTelemetry()`:

| Dimension | Primary signal source | Notes |
| --------- | --------------------- | ----- |
| Automation | Cooked telemetry | Hook events, command invocations |
| Permissions & Safety | Cooked telemetry | Permission-prompt rates |
| Model & Effort Tuning | Cooked telemetry + transcripts | Opus usage from transcripts; effort level is settings-only (partially measured) |
| Parallelism | Transcripts | Worktree detection; `interactive_only` |
| Verification | Cooked telemetry | Tool-call patterns |
| Memory & Context Management | Transcripts | `/btw`, `/clear`, `/compact` session coverage; `interactive_or_unknown` — added CCE-76 |
| Planning | Cooked telemetry | Plan-mode × multi-task session intersection |
| Integrations | Cooked telemetry | MCP / plugin tool calls |
| Terminal & Customization | Transcripts | `/color`, `/voice`, `/focus` session coverage; `interactive_or_unknown` — added CCE-76 |
| Scheduled Work | Cooked telemetry | Scheduled session count |
| Remote / Mobile | Cooked telemetry | Remote session indicators |
| Learning | Transcripts | `★ Insight` banner; `interactive_only` |

The radar marks dims whose Execution score returns `gapReason !== null` with italic labels and a `¹` footnote. After CCE-76, only the effort-level half of Model & Effort Tuning remains partially measured — there is no Execution signal for the effort-level setting.

## Key invariants

**Numerator ⊆ denominator universe.** A ratio whose numerator counts only `interactive_cli | unknown` sessions must declare `universe: "interactive_or_unknown"`. Violated in PR #97 for the Planning scorer (yielded `105.88%`) and corrected there. The named `interactive_or_unknown` option introduced in CCE-76 makes the correct choice explicit rather than requiring the scorer author to remember the arithmetic.

**Per-field semantic classification before summing.** Before adding a counter to a ratio numerator, classify it on two independent axes: (a) time window (windowed vs. cumulative) and (b) counter class (per-session-coverage vs. raw invocation count). Fields with mismatched classes don't belong in the same sum — route them to evidence text, a binary predicate, or a separate ratio with a matched denominator. The Memory Execution scorer redesign (CCE-79) is the reference case: the original numerator mixed cumulative `/btw` counts with windowed `/clear` and `/compact` session-coverage, and was restricted to the two windowed session-coverage signals.

**Command partition stays disjoint.** `POSTURE_COMMANDS` and `VOLUME_COMMANDS` must remain disjoint; no command may be unclassified. `assertCommandPartition` runs at module load and fails loudly on any drift. If `npm run assess` exits non-zero with no `assessment.json` written, check stderr for partition errors before assuming an environmental issue.

**Never collapse the two axes.** Platform Setup and Execution are always presented separately on the dashboard, methodology page, console printer, and Slack post. The legacy `overall / 89` composite form is retired and its absence is enforced by a Slack regression test.

## What CCE-76 changed

Before PR #116:

- Memory & Context Management and Terminal & Customization Execution scorers returned `noTelemetry()` — shown as italic-unmeasured on the radar
- Real usage deficits in `/btw`, `/clear`, `/compact`, `/color`, `/voice`, `/focus` were invisible to Execution scoring
- `focusCommandUses` and `rewindCommandUses` were counted as per-message invocations rather than per-session coverage

After PR #116:

- Both dims have real ratio scorers backed by `scanTranscriptInvocations` output
- `focusCommandUses` and `rewindCommandUses` use per-session coverage counting, matching the pattern used for `/btw`, `/clear`, `/compact`
- `interactiveOrUnknownSessionsAnalyzed` is the shared denominator signal for all posture-command scorers
- 16 new tests cover the two new scorers; the full suite moved from 647 to 666 tests
- Execution overall dropped from 77 → 66 — this is correct behavior, not a regression; two previously-excluded dims now contribute at low raw scores and the number is lower because it's honest
