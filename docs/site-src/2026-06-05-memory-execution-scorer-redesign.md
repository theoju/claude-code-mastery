---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# Memory Execution scorer redesign (CCE-79)

PR #128 narrows the numerator of the Memory & Context Management Execution
scorer (`scripts/score.mjs::memory`) from four slash-command counters to two,
and drops the rubric target from 92 to 60 to match. This is a follow-up to
CCE-78, which patched the immediate symptom; CCE-79 fixes the underlying
design mistake.

## What was wrong

The scorer summed four command counters as if they were fungible:

```js
const sum =
  btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses;
const ratio = Math.min(sum / interactiveOrUnknownSessionsAnalyzed, 1);
```

They aren't. Each field has a **time window** (30-day windowed vs. cumulative
lifetime) and a **counter class** (per-session-coverage, deduped once per
session, vs. raw invocation count) — and this sum mixed three distinct
combinations into one numerator:

| Field | Source | Counter class | Reliability |
| --- | --- | --- | --- |
| `/clear` | `history.jsonl`, per-session deduped | session-coverage | reliable |
| `/compact` | `history.jsonl`, per-session deduped | session-coverage | reliable |
| `/btw` | `~/.claude.json#btwUseCount` (`cliBtwUseCount`) | invocation-count, cumulative all-time | reliable count, wrong shape for a windowed ratio |
| `/rewind` | `history.jsonl` / transcripts | session-coverage | almost always zero — `/rewind` is normally the Esc-Esc keyboard shortcut, rarely typed as a slash command |

Folding a cumulative all-time counter (`/btw`) into a 30-day windowed ratio's
numerator silently inflates the ratio as the account ages, independent of
recent behavior — the same class of bug CCE-78 patched at the field level
(`cliBtwUseCount` leaking into `btwCommandUses`). CCE-79 fixes it at the
design level instead of patching the next symptom.

## What changed

`scripts/score.mjs::memory` now sums only the two session-coverage signals:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const rawRatio = sum / denom;
const ratio = Math.min(rawRatio, 1);
```

The other two commands didn't disappear — they moved to more appropriate
surfaces:

- **`/btw`** now shows up only as cumulative evidence text, read from
  `signalsSummary.cliBtwUseCountAllTime` and appended to the evidence string
  when non-zero: `"Plus N all-time /btw invocations (cumulative, not in
  ratio)."` You still see your `/btw` usage; it just no longer inflates the
  ratio.
- **`/rewind`** is dropped from the numerator entirely. It's kept as a
  next-action probe (`rewindCommandUses>=1` in `rubric.json` satisfiedWhen) —
  a binary "have you ever used it" check, not a ratio contributor.

The gap text narrowed to match: `"No /clear or /compact in any interactive
session"` (previously enumerated all four commands).

`app/data/rubric.json`'s `memory` dimension target dropped from **92 to
60**. With the numerator shrinking from four commands to two, hitting 92%
session-coverage was no longer a realistic ceiling. 60% represents mature
usage of the narrowed set — most interactive sessions have at least one
`/clear` or `/compact`.

`app/methodology/page.tsx`'s Memory & Context Management section was updated
to describe the narrowed formula and the new target, and to explain the
`/btw`/`/rewind` reclassification. `app/data/probe-catalog.json` gained
one-line annotations on the `btwCommandUses`, `cliBtwUseCountAllTime`, and
`rewindCommandUses` entries pointing future readers at this redesign. Neither
change added or removed a catalog entry or a `signalsSummary` key, so the
probe tracker's machine-enforced header counts in
`docs/superpowers/specs/2026-05-25-probe-implementation-status.md` are
unchanged.

## What this means for your score

If your Memory & Context Management Execution score previously leaned on
`/btw` usage, expect it to drop — that inflation was the bug being fixed.
Conversely, because the rubric target also dropped (92 → 60), the same
underlying `/clear`/`/compact` behavior now normalizes to a noticeably higher
vertex score than before. Both moves land in the same PR because they're
coupled: the target recalibration only makes sense against the narrowed
numerator.

The `interactive_cli ∪ unknown` universe gating is unchanged — this redesign
only touches which command counters enter the numerator, not which sessions
are counted in the denominator.

## Why not just fix `/btw`'s window mismatch and keep summing?

Because `/rewind` was a second, independent violation of the same rule
(session-coverage class, but functionally always zero, so it was inert
padding rather than a real signal) — and because the deeper lesson is
general, not specific to `/btw`. This is why CLAUDE.md's hard rules now
include a standing "per-field semantic categorization" check: before adding
any field to a ratio numerator, classify it on both axes (time window,
counter class) and confirm it matches the other fields already in the sum.
If it doesn't, route it to a separate surface — evidence text, a standalone
predicate, or a separate ratio with a matched denominator — rather than
summing across classes.
