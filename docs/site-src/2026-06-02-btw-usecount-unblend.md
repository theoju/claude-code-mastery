---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Un-blending `/btw`'s cumulative and windowed counters (CCE-78)

PR #119 fixes a signal-hygiene bug in the Memory Execution surface: the
`btwCommandUses` field in `signalsSummary` was silently blending a
cumulative all-time counter into what's supposed to be a 30-day windowed
signal. The Memory Execution **score** doesn't change (it stayed 16) —
the scorer body in `scripts/score.mjs` never consumed the blended field
directly. What changes is the honesty of the `signalsSummary` surface
that evidence text and rubric predicates read from.

## What was wrong

`scripts/run-assessment.mjs`'s `buildSignalsSummary()` is the pure
projection from raw `signals` into the flat scalar map the predicate
engine (`scripts/predicate.mjs`) evaluates. Most of the slash-command
counters in there follow the same shape —
`maxProbe(signals, "xCommandUses")` — which takes the max of the
transcript-JSONL count and the `~/.claude/history.jsonl` count for the
same 30-day window, because typed prompts land in `history.jsonl` too
and the JSONL scanner alone under-counts. That's a legitimate blend:
both inputs share the same time window and the same counter class
(session-coverage).

`btwCommandUses` used to go through the same `maxProbe` path, but one of
its two inputs wasn't actually windowed. `/btw` is a side-channel
command Boris tips 33/54 coach ("use `/btw` for side questions while
Claude works"), and the only reliable signal for it lived in
`~/.claude.json#btwUseCount` — a **lifetime** invocation counter, not a
30-day session-coverage count. Feeding that cumulative count into the
same `Math.max` as the windowed transcript signal meant `btwCommandUses`
silently stopped being "did you use `/btw` in the last 30 days" and
became "have you ever used `/btw`, ever, since account creation." Any
ratio scorer or evidence string reading `btwCommandUses` inherited the
drift without anyone changing its declared window.

CLAUDE.md now names this failure mode directly: a numerator field has to
be checked on two independent axes before it's summed or blended into
anything —

| Axis              | Possible classes                                       |
| ------------------ | ------------------------------------------------------- |
| (a) Time window    | windowed (e.g. 30-day) / cumulative (lifetime)           |
| (b) Counter class  | session-coverage (deduped per session) / raw invocation count |

`cliBtwUseCount` was cumulative + raw-invocation-count; every other
input in the `btwCommandUses` `maxProbe` blend was windowed +
session-coverage. Different class on both axes — it never belonged in
the same `Math.max`.

## The fix

`buildSignalsSummary()` now exposes the two signals separately:

```js
// scripts/run-assessment.mjs
// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` is windowed-only again. The lifetime count moved to its
own field, `cliBtwUseCountAllTime`, which is where a habit-adoption
predicate — "have you ever done this" rather than "did you do this in
the scoring window" — actually belongs.

The rubric's `btw-side-channel` next-action (Memory & Context Management,
Boris tip 33+54) was rerouted to read the cumulative field, since "adopt
the `/btw` reflex" is exactly a have-you-ever-adopted-it check:

```json
{
  "id": "btw-side-channel",
  "action": "Use /btw for side questions while Claude works — Boris tip 33+54",
  "effort": "5min",
  "satisfiedWhen": "cliBtwUseCountAllTime>=1",
  "borisTip": [33, 54]
}
```

(`app/data/rubric.json`, Memory & Context Management dimension.)

## What this doesn't fix

This PR is a signal-hygiene patch, not a scorer redesign. The Memory
Execution ratio's numerator today still sums `/clear` and `/compact`
session-coverage — it doesn't otherwise change shape because of this
fix, since the blended field was never wired into the scorer's math in
the first place, only into the `signalsSummary` surface (evidence
strings, predicates, the probes page). The broader per-field redesign of
the Memory Execution scorer — deciding, field by field, which counters
belong in a ratio numerator versus evidence text versus a standalone
predicate — is tracked separately as **CCE-79** and is out of scope
here.

## Why it matters beyond this one field

CLAUDE.md's hard-rule list treats this as the second occurrence of the
same failure class (the first was the original `/btw` blend itself,
closed by CCE-78's sibling fix at
`run-assessment.mjs:134-137` before this PR). The rule it produced —
classify every new numerator field on time-window and counter-class
before summing — is meant to catch the next one before it ships, not
just this one after the fact. If you're adding a field to any ratio
numerator in `scripts/run-assessment.mjs` or `scripts/score.mjs`, check
both axes against the existing inputs in that sum first.
