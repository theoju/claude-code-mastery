---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# CCE-79: Memory Execution scorer redesign

PR #128 narrows the Memory Execution scorer's ratio numerator to two
semantically-consistent signals — `/clear` and `/compact` — and moves
`/btw` and `/rewind` off the ratio entirely. It's a follow-up to CCE-78,
and it's the reference case for a new CLAUDE.md hard rule: **classify
every field on two axes before you sum it into a ratio numerator.**

## The bug this closes

`scripts/score.mjs::memory` used to sum four slash-command counters as if
they were fungible:

```js
const sum =
  btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses;
const ratio = Math.min(sum / interactiveOrUnknownSessionsAnalyzed, 1);
```

CCE-78 had already fixed the sharper version of this bug — `cliBtwUseCount`
(a cumulative, all-time invocation count from `~/.claude.json`) was leaking
into `btwCommandUses` (a 30-day windowed session-coverage count) via a
`Math.max` blend. That fix stopped the specific leak, but the scorer still
summed four fields that don't share a counter class:

| Field      | Source                                          | Counter class                             | Reliability                                                  |
| ---------- | ------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------- |
| `/clear`   | `history.jsonl` (per-session deduped)           | session-coverage                          | reliable                                                      |
| `/compact` | `history.jsonl` (per-session deduped)           | session-coverage                          | reliable                                                      |
| `/btw`     | `~/.claude.json#btwUseCount` (`cliBtwUseCount`) | invocation-count, cumulative all-time     | reliable for count, wrong shape for a windowed ratio          |
| `/rewind`  | `history.jsonl` / transcripts                   | session-coverage                          | almost always zero — `/rewind` is the Esc-Esc keyboard shortcut, rarely typed as a slash-command |

Summing across counter classes mixes "30-day per-session adoption" with
"lifetime invocation count" in the same numerator — the same class of bug
CCE-78 patched at the field level, just one layer deeper. CCE-79 fixes it
at the design level instead of patching the next symptom.

## What changed

`scripts/score.mjs::memory` now sums only `clearCommandUses +
compactCommandUses` — both session-coverage signals sourced from
`history.jsonl`, matching the windowed `interactiveOrUnknownSessionsAnalyzed`
denominator:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const rawRatio = sum / denom;
const ratio = Math.min(rawRatio, 1);
```

The other two fields didn't disappear — they moved to the surface that
actually matches their semantics:

- **`/btw`** now shows up as cumulative evidence text, sourced from
  `signalsSummary.cliBtwUseCountAllTime`, only when it's non-zero:

  ```js
  const btwAllTime = s.signalsSummary?.cliBtwUseCountAllTime ?? 0;
  const btwEvidence =
    btwAllTime > 0
      ? ` Plus ${btwAllTime} all-time /btw invocations (cumulative, not in ratio).`
      : "";
  ```

  Users who use `/btw` heavily don't lose the signal — it's still visible
  on the dimension card — but it no longer inflates a 30-day ratio with a
  lifetime count.

- **`/rewind`** drops out of the ratio entirely but keeps its standalone
  next-action probe (`rewindCommandUses>=1`) in `app/data/rubric.json`.
  It was already a near-zero contributor in practice, so the ratio loses
  almost nothing quantitatively — but it was still the wrong shape to be
  in a `sum`.

The zero-signal gap text narrows to match:
`"No /clear or /compact in any interactive session"` (was: a four-command
enumeration).

## Rubric target: 92 → 60

With the numerator narrowed from four commands to two, hitting 92%
session-coverage is a materially harder bar. `app/data/rubric.json`'s
`memory` dimension target drops to 60, representing mature usage of the
narrowed set — most interactive sessions have at least one `/clear` or
`/compact`. This recalibration is deliberate and disclosed: without it, the
Memory radar vertex would silently jump for users who previously scored,
say, `55/92 → 60` and now score `55/60 → 92` on unchanged underlying
behavior. The PR's baseline-vs-post `assessment.json` diff makes that shift
visible rather than letting it land as an unexplained overnight score
change.

The methodology page (`app/methodology/page.tsx`, Memory & Context
Management section) and the probe tracker
(`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`) were
updated in the same PR to describe the narrowed formula and the new target
— per the CLAUDE.md rule that the probe tracker must stay in sync with any
probe-affecting change in the same PR.

## The generalized rule

This is now a standing CLAUDE.md hard rule, not a one-off fix: **before
adding a field to a ratio numerator (or summing multiple fields into one),
classify each field on two independent axes:**

1. **Time window** — windowed (e.g., 30-day) vs. cumulative (lifetime).
2. **Counter class** — session-coverage (deduped per session) vs. raw
   invocation count.

If a new field's class differs from the existing numerator inputs on
either axis, it doesn't belong in the same `sum`. Route it instead to a
separate surface: evidence text (cumulative), a standalone predicate
(binary), or a separate ratio with a matched denominator
(windowed-but-different-class). CCE-79 is the worked example — see the
per-field table above and
`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
§Context for the full reasoning.

## Explicitly out of scope

- **The Customization scorer** (`/color + /voice + /focus`) wasn't
  touched — all three fields are session-coverage with reliable sources,
  so there's no class mismatch to fix. Worth a brief audit later, but
  filed as a separate followup, not folded into this PR.
- **`/btw`'s PLATFORM scoring** is unchanged — `cliBtwUseCount` is used
  correctly there as a presence/cumulative signal. Only the EXECUTION
  ratio had the mixed-class bug.
- **The `rewindCommandUses>=1` next-action probe** stays in
  `rubric.json` — only the ratio aggregation dropped `/rewind`, not the
  binary "have you ever used it?" check.
- Auditing the remaining Execution scorers (planning, parallel, scheduled,
  remote, verification, integrations, learning, model-effort) against the
  same two-axis test is flagged as a followup, not done here.
