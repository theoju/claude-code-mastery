---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Unblend the `/btw` usage metric (CCE-78)

PR #119 stopped `signalsSummary.btwCommandUses` from `Math.max`-blending a
cumulative all-time counter into a 30-day windowed one. If you're touching
`buildSignalsSummary` in `scripts/run-assessment.mjs` or adding a new field
to a ratio numerator anywhere in the scorer, read this first — it's the
reference case for the project's per-field semantic categorization rule.

## The bug

`btwCommandUses` feeds the Memory Execution scorer's ratio numerator (`/clear`
+ `/compact` + `/btw`, before CCE-79 narrowed it further). Before this fix,
`buildSignalsSummary` computed it as:

```js
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),   // 30-day windowed, transcript+history
  signals.settings?.cliBtwUseCount ?? 0, // lifetime invocation count
),
```

`maxProbe(signals, "btwCommandUses")` is a genuine 30-day windowed
session-coverage signal — how many sessions in the scoring window show at
least one `/btw`. `settings.cliBtwUseCount` is a different thing entirely:
`~/.claude.json`'s `btwUseCount`, a lifetime counter that only grows. Once an
account had used `/btw` 36 times ever, the `Math.max` pinned
`btwCommandUses` at 36 forever, regardless of whether the last 30 days
had any `/btw` usage at all. The windowed Memory Execution ratio's
numerator was silently overstating recent posture, and it would keep
drifting up with account age rather than reflecting actual practice.

This was added during the v0.9.15 runtime-adoption-probes cycle for
predicate ergonomics — `Math.max` reads as "take whichever source has
signal" and is an easy pattern to reach for. But it collapses two
independent axes onto one field:

| Axis              | `maxProbe(...)` (transcript + history) | `cliBtwUseCount` (`~/.claude.json`) |
| ----------------- | --------------------------------------- | ------------------------------------ |
| (a) Time window   | windowed (30-day, `--insights-lookback`) | cumulative (lifetime)                |
| (b) Counter class | session-coverage (deduped per session)   | raw invocation count                 |

Both axes differ. Per the project's per-field rule (see CLAUDE.md), that
means the two fields don't belong in the same `sum` — or, here, the same
`Math.max`.

## The fix

`btwCommandUses` now reads only the windowed signal:

```js
// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

The lifetime count is exposed on its own field instead of being deleted —
it's real signal, just the wrong shape for a windowed ratio. The rubric's
tip 33 next-action (`btw-side-channel`, Memory & Context) was rerouted to
read it directly:

```json
{
  "id": "btw-side-channel",
  "action": "Use /btw for side questions while Claude works — Boris tip 33+54",
  "satisfiedWhen": "cliBtwUseCountAllTime>=1",
  "borisTip": [33, 54]
}
```

That predicate wants "have you ever adopted this habit" semantics — a
one-time-ever check is exactly what the cumulative counter is for. Routing
it there instead of through the windowed `btwCommandUses` field means the
next-action correctly stays satisfied even in a 30-day window with zero
`/btw` calls, as long as the habit was adopted at some point.

`app/data/probe-catalog.json`'s `btwCommandUses` entry documents the
non-blend explicitly, and `cliBtwUseCountAllTime` got its own catalog entry
under the `runtime` source category so `/methodology/probes` doesn't lose
track of the cumulative signal.

## Consequences

- The Memory Execution ratio numerator no longer drifts upward purely from
  account age; `/btw` recency now reflects the scoring window like every
  other command counter in that sum.
- `scripts/__tests__/signals-summary.test.mjs` locks the split in with three
  cases: `btwCommandUses` ignores `cliBtwUseCount` even when the latter is
  large, `cliBtwUseCountAllTime` surfaces the cumulative value independently,
  and `cliBtwUseCountAllTime` defaults to `0` when `settings.cliBtwUseCount`
  is absent.
- This PR only unblends the field split. It does **not** change what feeds
  the Memory Execution ratio numerator itself — `/btw` was still in that sum
  after this PR landed (windowed, correctly this time). The follow-up
  redesign that removes `/btw` from the ratio numerator entirely (replacing
  it with cumulative evidence text) and re-derives the rubric target is
  **CCE-79**, tracked separately — see
  `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`.
- The general rule this PR reinforces: before summing or `Math.max`-ing a
  new field into an existing numerator, classify it on both axes — time
  window and counter class — against the fields already there. A mismatch
  on either axis means the new field needs its own surface (evidence text,
  a separate predicate, or a separate ratio with a matched denominator), not
  a blend into the existing one.
