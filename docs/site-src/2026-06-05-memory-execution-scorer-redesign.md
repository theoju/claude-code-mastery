---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# Memory Execution scorer redesign: narrowing the numerator to `/clear` + `/compact`

**Ticket:** CCE-79 · **PR:** #128 · **Parent:** CCE-78 (interim `/btw` blend fix)

## What changed

The Memory Execution scorer (`scripts/score.mjs::memory`) used to sum four
slash-command counters into one numerator:

```js
const sum =
  btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses;
const ratio = Math.min(sum / interactiveOrUnknownSessionsAnalyzed, 1);
```

As of PR #128, the numerator is restricted to the two session-coverage
signals only:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const rawRatio = sum / denom;
const ratio = Math.min(rawRatio, 1);
```

`/btw`'s cumulative all-time count no longer touches the ratio at all. It's
surfaced as evidence text instead — conditionally appended when non-zero:

```js
const btwAllTime = s.signalsSummary?.cliBtwUseCountAllTime ?? 0;
const btwEvidence =
  btwAllTime > 0
    ? ` Plus ${btwAllTime} all-time /btw invocations (cumulative, not in ratio).`
    : "";
```

`/rewind` dropped out of the sum too, but its next-action probe
(`rewindCommandUses>=1`, Boris tip 62) stays in `rubric.json` untouched — the
redesign only affects the ratio, not the binary "have you ever used it"
check.

To keep the displayed score meaningful once the numerator narrowed, the
Memory dimension's rubric target dropped from 92 to 60
(`app/data/rubric.json`):

```diff
-      "target": 92,
+      "target": 60,
```

Both `scripts/score.mjs` and `app/data/rubric.json` on `main` already reflect
this shape — you can confirm at `scripts/score.mjs:977-1009` and
`app/data/rubric.json:226`.

## Why

The four fields being summed didn't share the same semantics. Two
independent axes were in play, and mixing classes on either one corrupts a
ratio:

| Field      | Time window                | Counter class                | Reliability                                        |
| ---------- | --------------------------- | ----------------------------- | --------------------------------------------------- |
| `/clear`   | 30-day windowed             | session-coverage (deduped)    | reliable                                            |
| `/compact` | 30-day windowed             | session-coverage (deduped)    | reliable                                            |
| `/btw`     | cumulative, all-time        | raw invocation count          | reliable for the count, wrong shape for a ratio      |
| `/rewind`  | 30-day windowed             | session-coverage (deduped)    | almost always zero (Esc-Esc shortcut, rarely typed)  |

`/btw` in particular was a repeat offender: CCE-78 had already fixed a
narrower version of this bug, where `cliBtwUseCount` (Platform Setup's
all-time counter) was being `Math.max`'d into the Execution numerator's
windowed `btwCommandUses`. That patch stopped the specific leak but left the
scorer still summing a cumulative-count field alongside three windowed
session-coverage fields inside one `sum`. CCE-79 is the design-level fix: any
user who ran `/btw` heavily over months, even without touching it in the
last 30 days, could inflate the Memory Execution ratio past what their
recent session behavior actually supported. `/rewind` wasn't distorting
anything numerically (it's near-zero in practice) but it was still the wrong
counter class to fold into the same sum on principle.

The fix follows the per-field semantic-categorization rule this cycle added
to CLAUDE.md: before summing a new field into a ratio numerator, classify it
on two independent axes — time window (windowed vs. cumulative) and counter
class (session-coverage vs. raw invocation count). If a field's class on
either axis differs from what's already in the sum, it doesn't belong there;
route it to evidence text, a separate binary predicate, or a separate ratio
with a matched denominator instead.

## What this means for your score

If your Memory Execution number moves after upgrading, it's the redesign
doing its job, not a regression:

- **The ratio now reflects only `/clear` + `/compact` session coverage.** If
  you leaned on `/btw` heavily but rarely ran `/clear` or `/compact`, your
  raw numerator shrinks — the old score was overcrediting you for a
  cumulative habit, not recent session hygiene.
- **`/btw` credit isn't gone, just relocated.** Look for "Plus N all-time
  `/btw` invocations (cumulative, not in ratio)" in the Memory dimension's
  evidence text.
- **The target dropped from 92 to 60**, so a given raw score normalizes
  higher than it would have pre-redesign
  (`clamp(round(rawScore / target × 100))`). A user sitting at raw 55
  scored `55/92 ≈ 60` before; the same raw score now normalizes to
  `55/60 ≈ 92`. That's an intentional recalibration to the narrowed
  numerator's realistic ceiling, not a change in underlying behavior — 60%
  session-coverage on two commands is a reasonable "mature usage" bar,
  where 92% across four commands (one of them near-zero) never was.
- **`/rewind` is still worth using.** It just counts toward its own
  next-action check (Boris tip 62), not toward the Memory Execution ratio.

## Non-goals

This redesign only touched the `memory` scorer. `customization`
(`/color` + `/voice` + `/focus`) sums three fields that are all
30-day-windowed session-coverage counts with reliable sources — no class
mismatch, so it was left alone. The per-field categorization table is now a
standing CLAUDE.md hard rule; any future Execution scorer redesign should
run the same two-axis check before adding a field to a `sum`.
