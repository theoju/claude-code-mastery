---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory & Customization: real Execution scorers (CCE-76 / PR #116)

**Decision date:** 2026-06-01  
**Ticket:** [CCE-76](https://designitright.atlassian.net/browse/CCE-76)  
**PR:** [#116](https://github.com/theoju/claude-code-self-assessment/pull/116)  
**Status:** Shipped — all twelve scoring dimensions now have live Execution scorers.

## What changed

PR #116 replaced the `noTelemetry()` stub scorers for the **Memory & Context
Management** and **Terminal & Customization** Execution vertices with real
`withGates({ transcripts: true, universe: "interactive_or_unknown" })` ratio
scorers. The two italic-unmeasured vertices on the radar become solid, scored
vertices.

The change spans four files:

| File | What changed |
| --- | --- |
| `scripts/_usage-data.mjs` | `focusCommandUses` and `rewindCommandUses` unified from per-message invocation counts to per-session coverage counts (matching the canonical pattern for the other five posture counters). |
| `scripts/insights-signals.mjs` | New `interactiveOrUnknownSessionsAnalyzed = sessionsByKind.interactive_cli + sessionsByKind.unknown` field added and forwarded through the return value. |
| `scripts/score.mjs` | `withGates` extended with a new `"interactive_or_unknown"` universe option and matching denom branch; `EXECUTION_SCORERS.memory` and `.customization` bodies replace `noTelemetry()`. |
| `scripts/__tests__/memory-customization-execution-scorers.test.mjs` | 17 net-new tests covering scorer behavior, the `__universe` contract, and the numerator-subset-of-denominator invariant. |

Five machine-enforced header counts (75/12/48/47/71) are unchanged — no new
probes, no new catalog entries, no new `signalsSummary` keys were added. The
new `interactiveOrUnknownSessionsAnalyzed` lives in the cooked-telemetry
insights block, not in `signalsSummary`.

## Why now

Before this PR, Memory & Context Management and Terminal & Customization were
the only two of twelve dimensions that returned `noTelemetry()` — a stub that
produces `gapReason !== null`, which causes the radar to render those vertices
in italic with a footnote. The two-axis dashboard was honestly unmeasured in
those dims; the Execution score for both was blank rather than scored zero.

The preconditions for trustworthy posture-command scorers arrived with
CCE-71 (the per-command partition gating). After CCE-71:

- Seven posture commands (`/btw`, `/clear`, `/compact`, `/rewind`, `/color`,
  `/voice`, `/focus`) were already counted from transcripts, filtered to the
  `interactive_cli ∪ "unknown"` session universe via `allowPosture`.
- Observer/SDK echo inflation — the main reason posture counters weren't
  previously trustworthy — was already eliminated.
- Precedent from the `learning` (★ Insight banner scan) and `parallel`
  (worktree-usage scan) scorers showed that `withGates({ transcripts: true, … })`
  is an established pattern for transcript-backed Execution scoring.

## Counter-class unification

Before this PR, `focusCommandUses` and `rewindCommandUses` incremented per
message inside `scanTranscriptInvocations`, while the other five posture
counters (`btw`, `clear`, `compact`, `color`, `voice`) incremented once per
session. The mismatch was an artifact of when each counter was added (Bucket
B detection, PR #40) vs. the later posture-counter pattern.

PR #116 retrofits `focusCommandUses` and `rewindCommandUses` to the
session-coverage pattern:

```js
// before — per-message increment
if (found.has("focus") && allowPosture) counts.focusCommandUses++;
if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;

// after — per-session flag, emitted once after the session drain
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
// ... (after the session drain loop)
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

The `let sessionHasFocus = false; let sessionHasRewind = false;` flags are
hoisted into the per-session reset block alongside the existing `sessionHasBtw`
et al. (lines 308–316 of `_usage-data.mjs`). After the unification, all seven
posture counters have uniform units: one hit = one session that used that
command at least once.

**Predicates are invariant** under either counting class (both `rewindCommandUses>=1`
and `focusCommandUses>=1` hold whenever the counter is ≥1 regardless of how
many times in a session the command appeared). One test assertion changes:
`scan-transcript-invocations.test.mjs:247`, which wrote a single session with
two `/rewind` messages and asserted `toBe(2)`, becomes `toBe(1)` under
session-coverage counting.

## Closing the numerator/denominator universe gap

The CLAUDE.md hard rule from PR #97 / v0.9.17 requires that a ratio's
**numerator must be a subset of its denominator's universe**. Before this
PR, the seven posture counters were gated to `interactive_cli ∪ "unknown"` via
`allowPosture`, but the only available Execution denominator was
`interactiveSessionsAnalyzed = sessionsByKind.interactive_cli` (strict
`interactive_cli`). A scorer using that denominator would violate the rule:
any `"unknown"` session contributes to the numerator but not the denominator,
allowing the ratio to exceed 100%.

The fix is a new field in `insights-signals.mjs`:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

And a new universe option in `withGates`:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed   // NEW
      : s.insights.sessionsAnalyzed;
```

The `"unknown"` bucket exists because `classifySessionKind` returns `"unknown"`
for sessions whose transcript shape is truncated, legacy-format, or not yet
recognizable (new Claude Code format versions). CCE-71 deliberately included
these in `allowPosture` as a conservative fallback — tightening the partition
to strict `interactive_cli` would under-count for users with non-standard
transcript shapes. Widening the denominator to match is the principled fix and
the smaller diff.

## Scorer design

Both scorers follow the same shape: `withGates({ transcripts: true, universe: "interactive_or_unknown" }, (s) => { … })`.

### Memory Execution

Inputs: session-coverage hits for `/btw`, `/clear`, `/compact`, `/rewind` —
all MAX-merged from `transcriptInvocations` and `historyInvocations` to pick
up whichever source captured more usage. (`/rewind` is transcript-only because
`HISTORY_COMMAND_LIST` in `_history-data.mjs` excludes it — it's a keyboard
shortcut, never typed; the merge is kept uniform and the history side always
reads 0.)

```
ratio = min((btw + clear + compact + rewind) / interactiveOrUnknownSessionsAnalyzed, 1)
rawScore = round(ratio × 100)
displayed = normalize(rawScore, target=92)
```

The cap at 1.0 is intentional: a single session that uses all four memory
commands still contributes 4 to the numerator but only 1 to the denominator.
When `rawRatio > 1`, the evidence string surfaces "capped from N%" so the
over-use isn't silently hidden behind a clean 100/100.

### Customization Execution

Inputs: session-coverage hits for `/color`, `/voice`, `/focus` — also
MAX-merged from both transcript and history sources.

```
ratio = min((color + voice + focus) / interactiveOrUnknownSessionsAnalyzed, 1)
rawScore = round(ratio × 100)
displayed = normalize(rawScore, target=80)
```

Same cap and evidence-string surfacing as the memory scorer.

## Data flow

```
~/.claude/projects/*/*.jsonl  (transcripts)
   │
   ▼  scanTranscriptInvocations
      allowPosture: sessionKind ∈ {interactive_cli, "unknown"}
   │
   ▼  session-coverage counters
      btw, clear, compact, rewind, color, voice, focus
      (incremented once per session, not per message)
   │
   │  MAX-merge with historyInvocations for btw/clear/compact/color/voice/focus
   │  (rewind stays transcript-only)
   │
   ▼  EXECUTION_SCORERS.memory  /  .customization
      denom = interactiveOrUnknownSessionsAnalyzed
      ratio = min(sum / denom, 1)
      rawScore = round(ratio × 100)
   │
   ▼  normalize(rawScore, d.target)
      → Execution vertex on the radar  (italic dropped, gapReason = null)
```

## Empirical baseline (author's environment)

From `npm run assess --include-transcripts --insights-lookback 30` at the time
of the PR:

| Counter | Value | Counter | Value |
| --- | --- | --- | --- |
| `btwCommandUses` | 39 | `colorCommandUses` | 3 |
| `clearCommandUses` | 15 | `voiceCommandUses` | 0 |
| `compactCommandUses` | 8 | `focusCommandUses` | 1 |
| `rewindCommandUses` | 0 (in-window) | | |

`interactiveOrUnknownSessionsAnalyzed` ≈ 120+ (interactive_cli + unknown tail).

- **Memory Execution**: `(39+15+8+0)/120 = 0.517` → rawScore 52 → `normalize(52, 92)` = **~57/100**
- **Customization Execution**: `(3+0+1)/120 = 0.033` → rawScore 3 → `normalize(3, 80)` = **~4/100**

Both directions are honest. The prior unmeasured state was hiding both pieces
of signal behind italic vertices.

## What this PR does not change

- **No new probe-catalog entries.** The seven command counters already had
  Platform Setup predicates from CCE-71. `satisfiedWhen` predicates
  (`rewindCommandUses>=1`, `focusCommandUses>=1`, etc.) are invariant — the
  session-coverage unification doesn't change whether these fire.
- **No target tuning.** The existing `memory.target = 92` and
  `customization.target = 80` rubric values are left in place. Calibration
  based on observed post-PR values is explicitly deferred to a subsequent PR.
- **No UI changes.** `app/components/RadarChart.tsx` renders italic vertices
  whenever `gapReason !== null`. The scorers now return `gapReason: null`, so
  both vertices automatically become solid — no UI code change needed.
- **No methodology-page formula deep-dive.** The Memory and Customization
  sections in `app/methodology/page.tsx` are updated to reflect "measured"
  rather than "unmeasured", but a full formula breakdown matching other
  dims' depth is queued for a follow-up.

## Tests added

17 net-new tests in `scripts/__tests__/memory-customization-execution-scorers.test.mjs`:

| Test | What it covers |
| --- | --- |
| 1–3 | `unavailable` for missing insights, `transcriptsScanned: false`, zero-denom |
| 4–5 | Memory: perfect ratio; cap fires and evidence says "capped from N%" |
| 6–7 | History MAX-merge contributes; `/rewind` is transcript-only (history side = 0) |
| 8–11 | Memory: zero-signal gap message; realistic mixed input; boundary at denom; partial |
| 12–14 | Customization: perfect ratio; cap fires; zero-signal gap |
| 15 | Customization: realistic mixed input |
| 16 | Both scorers' `__universe === "interactive_or_unknown"` |
| 17 | `interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed` for all fixtures (the CLAUDE.md hard-rule machine guard) |

Each test uses a hand-built `signals` literal — no fixture-file dependency.

## Related

- **CCE-71** — per-command partition gating (`allowPosture`); the infrastructure
  that makes these counters trustworthy.
- **CCE-72 / PR #113** — ship-journal stage credit (same transcript-signal-into-Execution
  pattern; precedent for this PR).
- **PR #97 / v0.9.17** — the planning denominator-semantics fix that established
  the numerator-subset-of-denominator hard rule this PR honors.
- **CCE-79** — subsequent redesign of the Memory scorer's numerator: `/btw`
  (cumulative all-time, not 30-day windowed) separated from the ratio and shown
  only as evidence text; `/rewind` (keyboard shortcut, near-zero signal) dropped
  from the ratio. CCE-79 narrowed the Memory numerator to `/clear + /compact`
  only after the per-field semantic classification rule caught the `/btw` blending
  problem.
