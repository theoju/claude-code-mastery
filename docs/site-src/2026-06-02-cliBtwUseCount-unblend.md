---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: un-blending `/btw`'s cumulative and windowed counts

PR #119 fixed a bug in the Memory Execution scorer: the 30-day windowed
`btwCommandUses` signal was silently absorbing a lifetime, all-time counter
via `Math.max`, which inflated the Memory Execution ratio's numerator every
time the scorer ran against an account with any `/btw` history at all — not
just recent history.

## What was blended

`/btw` is a side-channel command (ask Claude a side question while it keeps
working) that rarely lands in the session JSONL transcript, so
`scripts/_usage-data.mjs` falls back to `~/.claude/history.jsonl` to catch it.
That's a legitimate MAX-merge — history.jsonl and transcripts are two
observations of the *same* windowed signal, and taking the max of the two
just means "recover count the JSONL scanner missed."

The bug was a second `Math.max` layered on top, in
`scripts/run-assessment.mjs`'s `buildSignalsSummary`, that pulled in
`signals.settings.cliBtwUseCount` — a cumulative all-time invocation counter
Claude Code itself maintains in `~/.claude.json`. That field has no 30-day
window at all; it only grows. Feeding it into the same `Math.max` as the
windowed `btwCommandUses` meant the "windowed" signal would permanently pin
itself to the account's all-time `/btw` count the moment that number exceeded
whatever showed up in the last 30 days of history — and then never reflect
recent behavior again.

## The two axes that were conflated

CLAUDE.md's hard-rules section names this failure mode generically now:
before summing or `Math.max`-ing a new field into an existing numerator,
classify it on two independent axes:

| Axis | Classes |
| --- | --- |
| (a) Time window | windowed (30-day) vs. cumulative (lifetime) |
| (b) Counter class | session-coverage (deduped per session) vs. raw invocation count |

`btwCommandUses` is windowed session-coverage. `cliBtwUseCount` is cumulative
raw-invocation. They differ on axis (a) — that's disqualifying on its own;
they don't belong in the same `sum` or `Math.max`, regardless of how
convenient blending them is for predicate authoring.

## The fix

`buildSignalsSummary` in `scripts/run-assessment.mjs` now exposes the
cumulative counter on its own field instead of blending it in:

```js
// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` stays a clean windowed signal, safe to sum into any
30-day-windowed ratio numerator. `cliBtwUseCountAllTime` carries the
cumulative signal for the one thing it's actually good for: a binary "have
you ever adopted this habit" predicate, which doesn't care about windows.

The rubric's `btw-side-channel` next-action (Boris tips 33+54, in the
`memory` dimension of `app/data/rubric.json`) was rerouted to read the
cumulative field:

```json
{
  "id": "btw-side-channel",
  "action": "Use /btw for side questions while Claude works — Boris tip 33+54",
  "satisfiedWhen": "cliBtwUseCountAllTime>=1",
  "borisTip": [33, 54]
}
```

`cliBtwUseCountAllTime>=1` is the right predicate for that action — "have you
ever used `/btw`" is exactly a lifetime question, and now it's backed by a
field whose semantics actually match.

`app/data/probe-catalog.json` documents both fields with the CCE-78
cross-reference so a future reader hitting either one in
`/methodology/probes` gets the "don't blend these" warning inline, not just
in CLAUDE.md.

## Why this matters beyond `/btw`

The failure predates this fix by one cycle: the *original* v0.9.15 blend was
added for predicate ergonomics — it's genuinely convenient to have one field
answer both "recent coverage" and "ever adopted" questions. That convenience
is exactly what made the bug easy to introduce and hard to notice: nothing
about a `Math.max` call site looks wrong in isolation, and the ratio still
produces a plausible-looking number — it's just quietly wrong, drifting
upward with account age rather than tracking recent posture.

CLAUDE.md's hard-rules section captures the general form of this class of
bug (see "Don't blend cumulative all-time counters into windowed ratio
surfaces" and "Per-field semantic categorization before adding to any
numerator") so the next windowed-ratio addition gets checked against both
axes before the `sum` or `Math.max` call is written, rather than after a
scorer silently corrupts itself.

## Tests and tracking updated in the same PR

- `scripts/__tests__/build-signals-summary.test.mjs` and
  `scripts/__tests__/signals-summary.test.mjs` assert `btwCommandUses` and
  `cliBtwUseCountAllTime` are populated from distinct sources and stay
  independent under `Math.max`-style inputs.
- `app/lib/__tests__/rubric-predicates.test.ts` covers the rerouted
  `btw-side-channel` predicate against `cliBtwUseCountAllTime`.
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` (the
  living probe tracker) and `app/data/probe-catalog.json` were updated in
  the same PR to reflect the new field and the reroute — per the
  "keep the probe tracker in sync with every probe change" rule.

The follow-up narrowing of the Memory Execution ratio's numerator itself
(removing `/btw` from the sum entirely, not just fixing which `/btw` field
feeds it) is tracked separately as CCE-79.
