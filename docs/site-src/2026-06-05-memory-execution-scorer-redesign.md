---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# Memory Execution scorer redesign (CCE-79)

PR #128 narrows the Memory Execution scorer's ratio numerator from four
slash-command counters to two, and drops the `memory` dimension's rubric
target from 92 to 60 to match. This is a follow-up to CCE-78, which fixed
the immediate `/btw` cumulative-vs-windowed blend; CCE-79 generalizes that
fix into a rule and applies it across the whole numerator.

## What changed

`scripts/score.mjs`'s `memory` Execution scorer used to sum four fields:

```js
const sum = btw + clear + compact + rewind;
```

It now sums two:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
```

`/btw` and `/rewind` are gone from the ratio, but neither signal is thrown
away:

- **`/btw`** now surfaces as evidence text — `signalsSummary.cliBtwUseCountAllTime`
  is appended to the scorer's evidence string as *"Plus N all-time /btw
  invocations (cumulative, not in ratio)"* whenever that count is greater
  than zero.
- **`/rewind`** is dropped from the sum entirely but remains a binary
  next-action probe in `app/data/rubric.json` (`rewindCommandUses>=1`,
  Boris tip 62) — unchanged from before.

`app/data/rubric.json`'s `memory` dimension `target` moved from `92` to
`60`. With the numerator narrowed from four commands to two, hitting a
92%-of-sessions coverage rate is no longer a realistic ceiling; 60%
represents mature usage of the narrowed set ("most interactive sessions
have at least one `/clear` or `/compact`").

The methodology page (`app/methodology/page.tsx`), the probe-implementation
tracker (`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`),
and the memory-scorer test fixtures were all updated in the same PR to keep
the docs and the CI-enforced tracker counts in sync with the new formula.

## Why

The old numerator mixed three semantically incompatible field classes into
one `sum`:

| Field      | Time window                  | Counter class                       |
| ---------- | ----------------------------- | ------------------------------------ |
| `/clear`   | 30-day windowed               | session-coverage (deduped per session) |
| `/compact` | 30-day windowed               | session-coverage (deduped per session) |
| `/btw`     | **cumulative, all-time**      | **raw invocation count**              |
| `/rewind`  | 30-day windowed                | session-coverage, but near-zero (it's the Esc-Esc keyboard shortcut, rarely typed as a slash command) |

Summing a cumulative all-time counter into a 30-day windowed ratio's
numerator silently overstates coverage and drifts upward with account age
rather than with recent behavior — the exact failure mode CCE-78 patched
for `/btw` at the field level, back when it was being blended into
`btwCommandUses` from a different source. CCE-79 is the design-level fix:
a per-field semantic categorization step now runs *before* any field is
allowed into a ratio numerator, and it's documented as a hard rule in
CLAUDE.md so future scorer authors don't reintroduce the same class of
bug elsewhere.

## Consequence for existing scores

Anyone relying on `/btw` volume to inflate their Memory Execution score
will see that dimension's `executionScore` fall — that's the intended
correction, not a regression. The evidence string still reports the
all-time `/btw` count, so nothing about the underlying behavior is hidden;
it's just no longer double-counted into a ratio it doesn't belong in.

Separately, the target drop (92 → 60) means the same raw session-coverage
number now normalizes to a higher radar-vertex score than it did before
the rubric change — a real behavior gap can look partially closed purely
because the ceiling moved. Both effects land in the same PR, so a
before/after diff of `assessment.json`'s `memory` block is the only way to
tell which one moved a given user's number.

## Non-goals

- The Customization Execution scorer (`/color` + `/voice` + `/focus`) was
  reviewed against the same per-field categorization and found clean — all
  three inputs are 30-day windowed session-coverage counters. It was left
  untouched.
- The Platform Setup side of `/btw` scoring (`scripts/score.mjs`'s
  `automation` scorer, which uses `cliBtwUseCount` as a presence/cumulative
  signal) is correct as-is and was not touched.
- No per-month or per-week normalization was introduced for cumulative
  counters. If `/btw`'s all-time count is ever folded into a ratio, that
  would need its own normalization design — out of scope here.

## Reference

- Design: `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md`
- CLAUDE.md hard rule: "Per-field semantic categorization before adding to
  any numerator" (§Hard rules)
- Parent ticket: CCE-78 (the original `/btw` cumulative-vs-windowed fix)
