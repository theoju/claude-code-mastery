---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# Memory Execution scorer redesign (CCE-79)

PR #128 narrows the Memory Execution ratio's numerator to two
semantically-matched signals — `/clear` and `/compact` — and moves `/btw` and
`/rewind` out of the sum entirely. The rubric target for the dimension drops
from 92 to 60 to match the narrowed ceiling.

## What was wrong

The original scorer (`scripts/score.mjs::memory`, landed in CCE-76 / PR #116)
summed four slash-command counters as if they were fungible:

```js
const sum = btw + clear + compact + rewind;
const ratio = Math.min(sum / interactiveOrUnknownSessionsAnalyzed, 1);
```

They weren't. Per the per-field table in
`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
§Context:

| Field | Source | Counter class | Reliability |
| --- | --- | --- | --- |
| `/clear` | `history.jsonl` (per-session deduped) | session-coverage | reliable |
| `/compact` | `history.jsonl` (per-session deduped) | session-coverage | reliable |
| `/btw` | `~/.claude.json#btwUseCount` (`cliBtwUseCount`) | invocation-count, cumulative all-time | reliable for count, wrong shape for ratio |
| `/rewind` | `history.jsonl` / transcripts | session-coverage | almost always zero — it's the Esc-Esc keyboard shortcut, rarely typed as a slash command |

Blending `/btw`'s lifetime invocation count into a 30-day session-coverage
ratio is the same class of bug CCE-78 patched at the field level (the
`cliBtwUseCount` → `btwCommandUses` blend). CCE-79 is the design-level fix:
don't let a field into a `sum` unless it matches the existing inputs on both
axes — time window (windowed vs. cumulative) and counter class
(session-coverage vs. raw invocation count).

## What changed

`scripts/score.mjs::memory` now reads:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const rawRatio = sum / denom;
```

- **`/btw` dropped from the ratio**, surfaced instead as cumulative evidence
  text — `signalsSummary.cliBtwUseCountAllTime` renders as `"Plus N all-time
  /btw invocations (cumulative, not in ratio)."` when non-zero. Users who
  lean on `/btw` still see the count; it just no longer inflates a windowed
  ratio it was never shaped for.
- **`/rewind` dropped from the ratio too**, but the `rewindCommandUses>=1`
  next-action probe in `rubric.json` stays — it's still a valid binary
  "have you ever used `/rewind`" signal, just not a ratio input. Near-zero
  transcript counts made it dead weight in the sum anyway.
- **Gap text narrowed** from the old four-command enumeration to `"No
  /clear or /compact in any interactive session"`.
- **Rubric target: 92 → 60** (`app/data/rubric.json`, `memory.target`). With
  the numerator shrinking from four commands to two, hitting 92% session
  coverage stopped being a realistic ceiling. 60% represents mature usage of
  the narrowed set — most interactive sessions have at least one `/clear` or
  `/compact`.
- **Methodology page** (`app/methodology/page.tsx`) updated to describe the
  two-command numerator, the new target, and where `/btw`/`/rewind` now live.
- **Probe catalog** (`app/data/probe-catalog.json`) descriptions for
  `btwCommandUses`, `cliBtwUseCountAllTime`, and `rewindCommandUses` now
  cross-reference CCE-79 so a reader tracing "why isn't `/btw` in the memory
  ratio?" lands on the answer from the catalog entry itself.

The universe (`interactive_cli ∪ unknown`) and the numerator-subset-of-
denominator invariant are unchanged — only the set of commands feeding the
numerator moved.

## Why this matters beyond this one dimension

CCE-79 is the reference case for a new CLAUDE.md hard rule: **classify every
field on two axes before adding it to a ratio numerator** — (a) time window
(windowed vs. cumulative) and (b) counter class (session-coverage vs. raw
invocation count). If a candidate field's class differs from the numerator's
existing inputs on either axis, it doesn't belong in the same `sum`. Route it
instead to evidence text (cumulative), a separate binary predicate, or a
separate ratio with a matched denominator. The Customization scorer
(`/color` + `/voice` + `/focus`) was audited against the same table and found
clean — all three are session-coverage signals from the same source, so it
needed no change.

## Visible effect

Because the target dropped from 92 to 60, a user's Memory Execution radar
vertex will shift on the next `npm run assess` run even if their underlying
`/clear`/`/compact` usage hasn't changed — the normalization denominator
changed, not just the raw score. This is expected: the same raw session
coverage now maps to a higher normalized score because the ceiling is more
realistic, not because behavior improved. The PR body documents a
baseline-vs-post `assessment.json` diff for exactly this reason — check it
if a Memory score jump looks surprising.

## Source

- Spec: `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md`
- Scorer: `scripts/score.mjs::memory`
- Rubric: `app/data/rubric.json` (`memory.target`)
- Tests: `scripts/__tests__/memory-customization-execution-scorers.test.mjs`
