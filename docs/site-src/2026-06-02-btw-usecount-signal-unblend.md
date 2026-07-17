---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Un-blending the `/btw` usage signal (CCE-78)

`signalsSummary.btwCommandUses` used to be a `Math.max` blend of two counters
that don't share a time window. PR #119 splits them back apart.

## The bug

`buildSignalsSummary()` in `scripts/run-assessment.mjs` derives the flat
scalar map that both the Memory Execution scorer and the rubric's
`satisfiedWhen` predicates read. Most slash-command counters in that
function follow the same shape — `maxProbe(signals, "xCommandUses")`,
which MAX-merges a 30-day windowed transcript scan with a 30-day windowed
`~/.claude/history.jsonl` scan. `/btw` is a side-channel command that rarely
lands in the session JSONL, so `history.jsonl` was already doing most of the
work there.

The original tip-33 predicate work (v0.9.15, runtime-adoption-probes) needed
`btwCommandUses` to also reflect **whether the user has ever used `/btw` at
all**, so it additionally `Math.max`'d in `signals.settings.cliBtwUseCount`
— the cumulative, all-time invocation counter Claude Code itself maintains
in `~/.claude.json`. That's a different counter on both axes CLAUDE.md now
names explicitly:

| Axis              | `btwCommandUses` (windowed) | `cliBtwUseCount` (blended in) |
| ------------------ | ---------------------------- | ------------------------------ |
| Time window        | 30-day                       | cumulative / all-time          |
| Counter class       | session-coverage (deduped)   | raw invocation count           |

Blending a lifetime counter into a 30-day ratio's numerator means the ratio
drifts upward with account age, not with recent posture — the same failure
mode CLAUDE.md's "Don't blend cumulative all-time counters into windowed
ratio surfaces" rule was written to name. `btwCommandUses` still feeds the
Memory Execution scorer's session-coverage ratio, so the blend was silently
corrupting that number even though nobody had touched `/btw` in the current
30-day window.

## The fix

`btwCommandUses` is now `maxProbe(signals, "btwCommandUses")` only — the
transcript+history MAX-merge, nothing else. The cumulative counter is
exposed on its own field:

```js
// scripts/run-assessment.mjs
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

The rubric's `btw-side-channel` next-action (Boris tip 33/54, dimension
`memory`) is rerouted to read the cumulative field instead of the windowed
one, since "have you ever adopted this habit" is exactly the semantics
`cliBtwUseCountAllTime` is suited for:

```json
// app/data/rubric.json
{
  "id": "btw-side-channel",
  "satisfiedWhen": "cliBtwUseCountAllTime>=1",
  "borisTip": [33, 54]
}
```

`app/data/probe-catalog.json` gets a matching `cliBtwUseCountAllTime` entry
(`source: runtime`, path `~/.claude.json → btwUseCount`), and the
`btwCommandUses` entry's description now calls out explicitly that it is
*not* blended with the all-time counter.

## What didn't change

The Memory Execution score itself is unchanged by this PR — the scorer
already read `btwCommandUses` through a path that bypassed the blended
summary field, so the corrupted number was live in `signalsSummary` (and
therefore in the probe-catalog/tracker surfaces) without ever reaching the
score a user sees. This PR corrects the surface, not the arithmetic. Test
coverage for the split lives in
`scripts/__tests__/signals-summary.test.mjs` — three cases: the max-merge
excludes `cliBtwUseCount`, `cliBtwUseCountAllTime` is exposed independently,
and it defaults to `0` when `settings.cliBtwUseCount` is absent.

The deeper redesign — restricting the Memory Execution numerator to
per-field semantic classes rather than a fungible sum of everything that
looks like a `/command` counter — is deferred to **CCE-79** and is not part
of this change.

## Why it matters beyond `/btw`

CLAUDE.md now documents this as a general rule for anyone adding a field to
a ratio numerator: classify the field on two independent axes — time window
(windowed vs. cumulative) and counter class (session-coverage vs. raw
invocation count) — before summing or blending it with existing numerator
inputs. If either axis differs from what's already in the sum, route the
new field to a separate surface instead: evidence text, a standalone binary
predicate, or a separate ratio with a matched denominator. `/btw` is the
reference case cited in that rule.
