---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: unblending the `/btw` counter

PR #119 removes a `Math.max` blend that had been quietly mixing a cumulative
counter into a windowed one, inside `buildSignalsSummary` in
`scripts/run-assessment.mjs`.

## What was blended

`btwCommandUses` is a 30-day, session-coverage counter: it comes out of
`maxProbe(signals, "btwCommandUses")`, which takes the max of the transcript
scanner's count and the `history.jsonl` side-channel count over the current
lookback window. `cliBtwUseCount`, by contrast, lives on `~/.claude.json` and
is a lifetime invocation count — it never resets and it isn't deduped per
session.

Before this PR, the tip-33/54 `satisfiedWhen` predicate effectively read the
`Math.max` of the two. That reads fine in isolation, but it conflates two
independent axes documented in this repo's hard rules:

- **time window** — windowed (30-day) vs. cumulative (all-time)
- **counter class** — per-session-coverage vs. raw invocation count

`btwCommandUses` and `cliBtwUseCount` differ on *both* axes, so summing or
`Math.max`-ing them into one field overstates recent session coverage and
drifts upward with account age rather than with actual recent posture — the
same failure shape CLAUDE.md already calls out for `hasUsedAgentsFleet`-style
lifetime flags.

## The fix

`buildSignalsSummary` now exposes the cumulative value on its own field,
`cliBtwUseCountAllTime`, straight off `signals.settings?.cliBtwUseCount`:

```js
// scripts/run-assessment.mjs
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` stays exactly what it was — a `maxProbe` read, nothing
blended in — so it's safe for any windowed Memory Execution ratio that uses
it as a numerator input. The tip 33/54 predicate, which asks "have you ever
adopted the `/btw` habit," is rerouted to check `cliBtwUseCountAllTime`
instead: that's a cumulative-semantic question, and a cumulative field is the
honest thing to check it against.

Worth being precise about the blast radius: the Memory Execution scorer body
itself reads `maxProbe` directly and was never touched by the blend — the
corruption was confined to the `signalsSummary` surface (i.e. anything
reading the predicate/rubric layer), not the scored ratio. A separate,
not-yet-landed follow-up, **CCE-79**, does a deeper per-field-semantics
redesign of the Memory Execution scorer itself; that's out of scope here.

## Guardrail added

CLAUDE.md now documents the two-axis categorization as a hard rule: before
summing or `Math.max`-ing a new field into an existing numerator, classify it
on both axes first. If either axis differs from what's already in the sum,
route the new field elsewhere — a separate cumulative-evidence surface, a
separate binary predicate, or a separate ratio with a matched denominator —
rather than folding it in for predicate ergonomics.

## Docs kept in sync

The probe tracker (`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`)
was updated in the same PR to reflect the new field: `signalsSummary` key
count moves 71→72, and the probe-catalog entry count moves 47→48 now that
`cliBtwUseCountAllTime` has its own catalog row. Per the CLAUDE.md rule on
keeping the tracker in sync, both counts were re-derived by invoking
`buildSignalsSummary(makeSignals())` and the probe catalog directly, not
guessed from a diff.
