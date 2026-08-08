---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# Memory Execution scorer redesign (CCE-79)

PR #128 narrows the Memory & Context Management Execution scorer's ratio
numerator from four slash-command counters to two, and lowers the
dimension's rubric target to match. It's a follow-up to CCE-78, which
patched a single field-level blend bug but left the deeper problem in
place: the numerator was summing counters that don't share a counter
class.

## What was wrong

`EXECUTION_SCORERS.memory` in `scripts/score.mjs` used to sum four
memory-hygiene command counters into one numerator:

```js
const sum = btw + clear + compact + rewind;
const ratio = Math.min(sum / interactiveOrUnknownSessionsAnalyzed, 1);
```

That looks like a single homogeneous signal, but it wasn't. `/clear` and
`/compact` are 30-day windowed, per-session-deduped counts — genuine
session-coverage. `/btw` (`btwCommandUses`) is sourced from
`~/.claude.json`'s cumulative-all-time invocation count. `/rewind` is
almost always zero in practice, because `/rewind` is normally triggered
by the Esc-Esc keyboard shortcut rather than typed as a slash command.
Summing all four meant a user's lifetime `/btw` count could silently
inflate a 30-day ratio, and `/rewind` contributed a near-dead signal that
added noise without adding information. CLAUDE.md now names this pattern
directly: **classify every numerator field on two axes — time window
(windowed vs. cumulative) and counter class (session-coverage vs. raw
invocation count) — before summing it with existing fields.**

## What changed

The redesigned scorer (`scripts/score.mjs::EXECUTION_SCORERS.memory`)
restricts the numerator to the two fields that actually share a counter
class:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
```

`/btw` and `/rewind` didn't disappear from scoring — they moved to
surfaces that match their actual shape:

- **`/btw`** now shows up as cumulative evidence text only, driven by
  `signalsSummary.cliBtwUseCountAllTime`: `"Plus N all-time /btw
  invocations (cumulative, not in ratio)."` — appended to the evidence
  string only when the count is greater than zero.
- **`/rewind`** is dropped from the ratio entirely but stays as a binary
  next-action probe in `app/data/rubric.json` (the `rewind-reflex`
  action, `satisfiedWhen: "rewindCommandUses>=1"`, Boris tip 62) — "have
  you ever used it" is still a meaningful signal even though it's too
  sparse for a session-coverage ratio.

The gap text narrowed to match: a zero-signal session now reports `"No
/clear or /compact in any interactive session"` instead of enumerating
all four commands.

## Rubric target: 92 → 60

Shrinking the numerator from four commands to two also shrinks the
realistic ceiling, so `app/data/rubric.json`'s `memory` dimension target
dropped from 92 to 60. Since the dashboard normalizes every raw
Execution score against its rubric target
(`clamp(round(rawScore / target × 100))`, in `normalize()`), leaving the
target at 92 after narrowing the numerator would have made hitting a
respectable score on `/clear` + `/compact` alone nearly impossible. 60
represents "most interactive sessions have at least one `/clear` or
`/compact`" as mature usage of the narrowed set — not the old bar of
covering four commands' worth of hygiene per session.

One side effect worth calling out: a user who was previously scoring, say,
55/92 (~60 normalized) under the old four-command numerator will not
necessarily land at the same normalized score post-redesign, because the
raw numerator itself changed shape (it no longer includes their `/btw`
and `/rewind` counts) — the target change and the numerator change move
together, not independently.

## Where this shows up

- `scripts/score.mjs::EXECUTION_SCORERS.memory` — the scorer itself.
- `app/data/rubric.json` — `memory.target` is now `60`.
- `app/methodology/page.tsx` — the Memory & Context Management formula
  block describes the narrowed `/clear` + `/compact` numerator, the new
  target, and explains where `/btw` and `/rewind` now surface.
- `app/data/probe-catalog.json` — the `btwCommandUses`,
  `cliBtwUseCountAllTime`, and `rewindCommandUses` entries carry
  descriptions pointing at this redesign.
- `scripts/__tests__/memory-customization-execution-scorers.test.mjs` —
  covers the narrowed numerator (Tests 4, 6, 8–11, 12d, 12e), the `/btw`
  evidence-text path (Tests 12b, 12c), `/rewind`'s exclusion (Test 7,
  12a), and the rubric target (Test 12f).

The Customization scorer (`/color` + `/voice` + `/focus`) was
deliberately left untouched — all three of its inputs are session-coverage
counters from the same window, so there's no class mismatch to fix there.
