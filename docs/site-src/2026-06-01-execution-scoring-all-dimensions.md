---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/117
synthesized_into: []
doc_kind: architecture
---

# Execution scoring: all 12 dimensions

As of v0.9.18, every scored dimension has a live Execution scorer. The "Are you
using it?" axis no longer has any `noTelemetry()` stubs. This page documents
the completed model: how each scorer is structured, which session universe it
operates against, and the two cross-cutting contracts that keep the data clean.

## Two axes, never collapsed

The dashboard separates **Platform Setup** (is the infrastructure in place?)
from **Execution** (are you actually using it?). Each dimension is scored
independently on each axis; the radar marks honestly-unmeasured Execution dims
with italic labels and a `¹` footnote — not silently-zero.

The diagnostic case is a high Δ: every tool installed, none of them fired.
Collapsing the two into a single composite score would hide that signal, which
is exactly the failure state these tools are meant to surface.

## The `withGates` wrapper

Every Execution scorer in `scripts/score.mjs` is wrapped with `withGates()`.
The wrapper handles three data-availability checks before the scorer body runs:

1. **Insights present** — `s.insights` must exist; absent means `/insights` hasn't
   populated `~/.claude/usage-data/` yet.
2. **Transcripts scanned** — opt-in flag; some scorers require it via
   `opts.transcripts: true`.
3. **Sessions in window** — the denominator must be non-zero. If
   `opts.requireSessions: false` is set, the scorer gates internally on its own
   sub-denominator instead.

If any required gate fails, `withGates` returns `unavailable(reason)` rather
than scoring a misleading zero.

### Universe declaration (mandatory)

`withGates` requires an explicit `universe` on every scorer. The universe
selects the denominator:

| Universe | Denominator field | When to use |
| --- | --- | --- |
| `interactive_only` | `interactiveSessionsAnalyzed` | User-posture signals — permissions, plan mode, learning, model choice. Only count sessions where the user's choices are meaningful; SDK/observer sessions run with defaults and would dilute the numerator. |
| `interactive_or_unknown` | `interactiveOrUnknownSessionsAnalyzed` | Transcript-gated posture signals where session classification may be ambiguous — memory hygiene, customization commands. The `unknown` fallback is conservative but prevents under-counting CLI sessions that lack classification metadata. |
| `all_sessions` | `sessionsAnalyzed` | Volume scorers — integrations, scheduled work, remote triggers. Autonomous-workflow signal is real regardless of who fired it. |

The declared universe is stored as `wrapped.__universe` so tests and the
methodology page can audit the contract without parsing the scorer body.

**Corollary: the numerator must be a subset of the denominator's universe.**
A numerator that counts across more session kinds than the denominator produces
ratios above 100%. This was the root cause of the `planModeSessionCount /
multiTaskSessionCount = 105%` regression in v0.9.17 — fixed by introducing
`planModeMultiTaskSessionCount` (interactive ∩ multi_task ∩ plan_mode) as the
narrower numerator.

## Per-scorer reference

| Dimension | Universe | Transcripts required | Signal |
| --- | --- | --- | --- |
| `permissions` | `interactive_only` | Yes | auto-mode session ratio minus bypass penalty |
| `verification` | `all_sessions` | No | exponential decay on friction-event rate |
| `parallel` | `interactive_only` | No (worktree half needs transcripts) | subagent dispatch ratio + worktree bonus |
| `planning` | `interactive_only` | Yes | plan-mode rate within multi-task sessions |
| `automation` | `interactive_only` | No | hook-fire count per session; null → `unavailable` |
| `integrations` | `all_sessions` | No | plugin tool calls per session vs. calibration target of 2 |
| `scheduled` | `all_sessions` | No | presence-and-intensity: 0 invocations → 0, 1 → 50, ≥3 → 100 |
| `remote` | `all_sessions` | No | presence-and-intensity: same curve as scheduled |
| `model-effort` | `interactive_only` | Yes | Opus-dominant session ratio |
| `memory` | `interactive_or_unknown` | Yes | `/clear` + `/compact` session-coverage hits / denominator |
| `customization` | `interactive_or_unknown` | Yes | `/color` + `/voice` + `/focus` session-coverage hits / denominator |
| `learning` | `interactive_only` | Yes | `★ Insight` banner session ratio |

### Memory and Customization: the last two scorers

`memory` and `customization` replaced `noTelemetry()` stubs in v0.9.18. Both
use `interactive_or_unknown` as their universe and count session-coverage hits
— each command contributes at most 1 per session, regardless of how many times
it appears in that session's transcript.

**Memory numerator:** `/clear` + `/compact`. These are the two
session-coverage signals whose semantics are unambiguous (windowed,
per-session-coverage). `/btw` is a cumulative all-time counter from
`~/.claude.json` and is surfaced as evidence text only — not in the ratio
numerator. `/rewind` is a near-zero binary signal retained only as a
next-action probe.

**Customization numerator:** `/color` + `/voice` + `/focus`. The ratio is
capped at 1.0; multiple commands in the same session stack in the numerator
but cannot produce a ratio above 100%.

Both scorers use `maxProbe(s, field)` to read from whichever of
`transcriptInvocations` and `historyInvocations` saw the command — history has
higher fidelity for side-channel commands that never reach the session JSONL.

## The POSTURE/VOLUME partition

Observer and SDK-orchestrated sessions replay the primary session's
`<command-name>` markup, which means a naïve scan of all session files would
count posture commands (e.g. `/compact`, `/voice`) as if the user typed them.
The per-command partition in `scripts/_usage-data.mjs` prevents this:

**`POSTURE_COMMANDS`** — counted only when `classifySessionKind` returns
`interactive_cli` or `unknown`:

```
/color  /voice  /focus  /btw  /clear  /compact  /simplify  /rewind
/fewer-permission-prompts
```

**`VOLUME_COMMANDS`** — counted across every scanned session kind, because
autonomous-workflow signal is real regardless of who fired it:

```
/loop  /schedule  /babysit  /go  /batch
```

The partition is enforced at module load by `assertCommandPartition()`, which
throws on three drift cases:

1. `POSTURE_COMMANDS ∩ VOLUME_COMMANDS ≠ ∅` — overlap between the two sets.
2. A command is in `TARGET_COMMANDS` but not in either partition — uncategorized
   new command.
3. A command is in the partition but not in `TARGET_COMMANDS` — dead
   classification pointing at a removed command.

If `npm run assess` exits non-zero with no `assessment.json` written, check
stderr for a partition assertion error before assuming an environmental issue.

**Historical context:** v0.9.17 attempted a blanket "exclude observer/SDK/subagent
from `scanTranscriptInvocations`" fix, which regressed the `scheduled` dimension
from 75→63 by deleting genuine autonomous-workflow signal. The reverted fix and
the per-command partition landed in its place (PR #110).

## Numerator semantics: two axes before you add a field

Before adding any signal to a ratio numerator, classify it on two independent
axes:

| Axis | Possible classes |
| --- | --- |
| (a) Time window | windowed (e.g. 30-day) / cumulative (lifetime) |
| (b) Counter class | session-coverage (deduped per session) / raw invocation count |

If the new field's class on either axis differs from the existing numerator
inputs, it doesn't belong in the same sum. Route it to a separate surface:
evidence text (for cumulative signals), a binary next-action probe, or a
separate ratio with a matched denominator.

The canonical failure case is the Memory Execution numerator before CCE-79:
it summed `/btw` (cumulative all-time) + `/clear` + `/compact`
(windowed session-coverage) + `/rewind` (near-zero binary). Three distinct
classes in one sum. The fix narrowed the numerator to `/clear + /compact`
only and recalibrated the target from 92 → 60 to match the realistic ceiling.

## The canonical predicate evaluator

`scripts/predicate.mjs` is the single implementation of the `satisfiedWhen`
DSL. `app/lib/assessment.ts:evaluatePredicate` is a one-line passthrough
re-export — never a copy of the implementation. A CI test
(`scripts/__tests__/predicate-passthrough.test.ts`) asserts the two are
reference-equal; a duplicate implementation fails the suite.

When the DSL grammar evolves, edit `scripts/predicate.mjs` only. The
`$schema` comment in `app/data/rubric.json` tracks the grammar version.
Pre-computed `rankedNextActions` in `assessment.json` are generated from
the same evaluator at scoring time; the dashboard reads them directly rather
than re-evaluating predicates at render time.

## Gap reasons and the "italic radar" contract

When a scorer cannot produce a score — missing insights, transcripts disabled,
zero sessions — it returns `{ score: null, gapReason: "<reason>" }`. The radar
renders those dims with italic labels and 0.65 opacity; the footnote explains
why the vertex is absent rather than scored zero.

`GAP_REASONS` in `score.mjs` is the canonical set of reason strings:

| Key | Meaning |
| --- | --- |
| `NO_INSIGHTS` | `s.insights` absent — run `/insights` |
| `NO_TRANSCRIPTS` | `scoring.includeTranscripts` not enabled |
| `NO_SESSIONS` | Denominator is zero in the lookback window |
| `NO_MULTI_TASK` | Planning scorer: no multi-task sessions |
| `NO_PLUGINS` | Integrations scorer: zero plugins installed |
| `NO_HOOK_FIRE_DATA` | Automation scorer: `hook-fires.jsonl` absent (not emitted by default) |

A dim returns `gapReason: null` when it produces a real score, even if that
score is 0. The italic-unmeasured label applies only to dims whose scorer
returns a non-null `gapReason`.
