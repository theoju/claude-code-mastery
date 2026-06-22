---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78 — Scoring counter semantics: windowed vs. cumulative fields

**PR:** [#119](https://github.com/theoju/claude-code-self-assessment/pull/119)
**Scope:** `scripts/run-assessment.mjs` (`buildSignalsSummary`), `CLAUDE.md` hard rules

## The problem

Every field that feeds a ratio numerator in the scoring layer sits on two
independent semantic axes:

| Axis | Classes |
|------|---------|
| **(a) Time window** | windowed (e.g., 30-day session coverage) / cumulative (lifetime) |
| **(b) Counter class** | per-session-coverage (deduped per session) / raw invocation count |

`signalsSummary.btwCommandUses` is a **30-day windowed, per-session-coverage**
counter. `~/.claude.json#btwUseCount` is a **cumulative all-time, raw invocation
count**. Before CCE-78, `buildSignalsSummary` blended the two into a single
field via `Math.max(maxProbe(signals, "btwCommandUses"), signals.settings.cliBtwUseCount)`.

The blend was introduced during the v0.9.15 runtime-adoption-probes cycle as a
predicate-ergonomics shortcut for Boris tip 33 — `/btw` lands in
`~/.claude/history.jsonl` but not in session JSONLs, so the transcript scanner
underreports it. The `Math.max` was intended to recover that missing signal.
The side-effect was silently corrupting the windowed surface: `btwCommandUses`
could now drift upward with account age regardless of recent posture, because
`btwUseCount` is a lifetime counter that only grows.

Any ratio scorer that read `btwCommandUses` as a numerator against a 30-day
windowed denominator could produce a ratio that climbed over time without
reflecting any change in real practice.

## The fix

CCE-78 removes the `Math.max` blend and separates the two sources:

```js
// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`maxProbe` takes the MAX of `signals.transcriptInvocations.btwCommandUses` and
`signals.historyInvocations.btwCommandUses` — both 30-day windowed counters from
the same session universe. The cumulative lifetime counter is forwarded on its
own field, `cliBtwUseCountAllTime`.

The `btw-side-channel` rubric predicate (Boris tips 33 and 54) is rerouted from
`btwCommandUses >= 1` to `cliBtwUseCountAllTime >= 1`. That predicate asks "have
you ever adopted this habit?" — a binary, lifetime-scoped question — and the
cumulative field is the correct source. Ratio numerators that want
session-coverage stay on `btwCommandUses`.

## Memory Execution score: unchanged by design

The Memory Execution scorer's numerator was already using `maxProbe` directly
on the `clearCommandUses` and `compactCommandUses` fields (CCE-79 later narrowed
the numerator to exactly those two). The corrupted `signalsSummary.btwCommandUses`
surface was never read by the scorer body, only by the predicate. Memory
Execution scores were not affected; they stay as-is after this PR.

## Two-axis classification rule

CCE-78 adds a hard rule to `CLAUDE.md`: before adding any field to a ratio
numerator — or summing multiple fields into one — classify each field on both
axes:

1. **Time window**: windowed (e.g., 30-day) vs. cumulative (lifetime)
2. **Counter class**: session-coverage (deduped per session) vs. raw invocation count

If the new field's class on either axis differs from the existing numerator
inputs, it belongs on a separate surface:

- **Cumulative** adoption signals → evidence text or a separate binary predicate,
  routed at a `*AllTime` field
- **Different counter class** → a separate ratio with a matched denominator
- **Both axes mismatched** → always separate

The `/btw` case is the canonical reference: lifetime all-time invocation count
(`cliBtwUseCountAllTime`) answers "have you adopted this habit?"; 30-day
windowed session-coverage (`btwCommandUses`) answers "are you doing it recently?"
They are different questions and must live on different fields.

## Tests

Three tests in `scripts/__tests__/signals-summary.test.mjs` lock the new
behaviour:

- `btwCommandUses takes MAX of transcript and history only — NOT cliBtwUseCount (CCE-78)`:
  given `historyInvocations.btwCommandUses = 5` and `settings.cliBtwUseCount = 36`,
  asserts `btwCommandUses === 5`.
- `exposes cliBtwUseCountAllTime separately for habit predicates (CCE-78)`:
  given `historyInvocations.btwCommandUses = 0` and `settings.cliBtwUseCount = 36`,
  asserts `btwCommandUses === 0` and `cliBtwUseCountAllTime === 36`.
- `cliBtwUseCountAllTime defaults to 0 when settings.cliBtwUseCount is missing`.

The stable-key snapshot in `scripts/__tests__/build-signals-summary.test.mjs`
also records `cliBtwUseCountAllTime` as a named key in the output contract,
locking the field into `buildSignalsSummary`'s public shape.

## Probe tracker update

The probe implementation status tracker at
`docs/superpowers/specs/2026-05-25-probe-implementation-status.md` was updated
in this PR: probe count 47 → 48, `signalsSummary` key count 71 → 72 (the new
`cliBtwUseCountAllTime` field). The tracker's five CI-enforced header counts
were re-derived and updated to pass `scripts/__tests__/tracker-counts.test.mjs`.

## Follow-on work

CCE-79 (separate PR) redesigns the Memory Execution scorer's numerator along
the same per-field-semantics principle: it restricts the numerator to the two
genuine 30-day windowed session-coverage signals (`/clear` + `/compact`),
exposes `/btw` as cumulative evidence text only, demotes `/rewind` to a
next-action probe, and recalibrates the rubric target from 92 to 60 to match
the narrowed realistic ceiling. CCE-78 is a prerequisite — it cleans up the
corrupted `btwCommandUses` field before CCE-79 can safely use the narrowed set.
