---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# Memory Execution scorer redesign (CCE-79)

PR #128 rewrites the numerator of the Memory & Context Management Execution
scorer (`scripts/score.mjs::memory`) and recalibrates its rubric target from
92 to 60. This is a follow-up to CCE-78, which patched the immediate `/btw`
blend but left the deeper problem in place: the scorer was still summing
four slash-command counters that don't share a counter class.

## What was wrong

The original numerator was:

```js
const sum =
  btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses;
const ratio = Math.min(sum / interactiveOrUnknownSessionsAnalyzed, 1);
```

Each of those four fields looks like "a slash command someone typed," but
they don't measure the same thing:

| Field      | Source                                          | Counter class                             |
| ---------- | ------------------------------------------------ | ------------------------------------------ |
| `/clear`   | `history.jsonl` (per-session deduped)             | session-coverage                           |
| `/compact` | `history.jsonl` (per-session deduped)             | session-coverage                           |
| `/btw`     | `~/.claude.json#btwUseCount` (`cliBtwUseCount`)   | invocation-count, cumulative all-time      |
| `/rewind`  | `history.jsonl` / transcripts                     | session-coverage, but almost always zero (it's a keyboard shortcut, Esc-Esc, rarely typed) |

`/btw`'s cumulative all-time count doesn't belong in a numerator whose
denominator is a 30-day windowed session count — the same mixing-time-windows
bug CCE-78 fixed at the field level (`cliBtwUseCount` leaking into
`btwCommandUses`), just one layer deeper. Summing it alongside two reliable
session-coverage fields inflated the ratio in a way that had nothing to do
with recent memory-hygiene behavior.

## What changed

The redesigned scorer restricts the numerator to the two fields that are
actually session-coverage: `clearCommandUses + compactCommandUses`. `/btw`
and `/rewind` are dropped from the sum entirely and routed to two different
surfaces instead of being deleted:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const rawRatio = sum / denom;
const ratio = Math.min(rawRatio, 1);
...
const btwAllTime = s.signalsSummary?.cliBtwUseCountAllTime ?? 0;
const btwEvidence =
  btwAllTime > 0
    ? ` Plus ${btwAllTime} all-time /btw invocations (cumulative, not in ratio).`
    : "";
```

- **`/btw`** now appears as cumulative evidence text on the dimension card
  (`"Plus N all-time /btw invocations (cumulative, not in ratio)"`) rather
  than as ratio input — the count is preserved for the user, it just no
  longer inflates the percentage.
- **`/rewind`** is dropped from the ratio but kept as a binary next-action
  probe: `rubric.json`'s `memory.rewind-reflex` next action still checks
  `rewindCommandUses>=1`. Near-zero signals are a fine one-time adoption
  check; they're a bad ratio input.
- The gap message narrows to match: `"No /clear or /compact in any
  interactive session"` (previously named all four commands).

## Rubric target: 92 → 60

Shrinking the numerator from four commands to two also shrinks the
realistic ceiling — hitting 92% session-coverage on two commands is a much
higher bar than hitting it across four. `app/data/rubric.json`'s `memory`
dimension target is now `60`, meant to represent "most sessions have at
least one `/clear` or `/compact`," not "some memory-hygiene command in
nearly every session."

Retuning the target is a real behavior change for existing users: someone
previously scoring 55 raw / 92 target = 60 normalized now scores
55 raw / 60 target = 92 normalized — a jump with no change in their actual
usage. That's expected and is the direct consequence of the numerator
shrinking; it isn't hidden anywhere except by reading `assessment.json`'s
`rawTarget` field, which still records 60.

## The general lesson

Before summing a new field into any ratio numerator, classify it on two
independent axes:

1. **Time window** — windowed (e.g. 30-day) or cumulative (lifetime)?
2. **Counter class** — session-coverage (deduped per session) or raw
   invocation count?

If the new field's class differs on either axis from the fields already in
the sum, it doesn't belong in that `sum`. Route it instead to evidence text
(cumulative), a separate next-action predicate (binary/near-zero), or a
separate ratio with a denominator that actually matches its time window.
This is now a hard rule in `CLAUDE.md`, and the Customization scorer
(`/color + /voice + /focus`) was audited against the same table as a
non-goal of this PR — all three fields there are session-coverage with
reliable sources, so it was left untouched.

## Verifying the change

`scripts/__tests__/memory-customization-execution-scorers.test.mjs` covers
both the regression path (`/clear` + `/compact` alone still scores and caps
correctly) and the new behavior:

- `btwCommandUses=100, rewindCommandUses=100, clearCommandUses=0,
compactCommandUses=0` scores **0** — neither excluded field can leak into
  the ratio anymore.
- `signalsSummary.cliBtwUseCountAllTime=42` produces evidence text matching
  `"Plus 42 all-time /btw invocations (cumulative, not in ratio)"`.
- The rubric's `memory.target` is asserted equal to `60` directly against
  `app/data/rubric.json`, so a future edit that forgets the retune fails CI.

## Non-goals

This PR does not touch the Memory **Platform Setup** scorer, `/btw`'s
Platform-side use of `cliBtwUseCount` (that one is a correct
presence/cumulative signal, not a ratio), or any of the other Execution
scorers. Auditing the remaining scorers (planning, parallel, scheduled,
remote, verification, integrations, learning, model-effort) against the
same per-field categorization table is filed as separate follow-up work,
not folded into CCE-79.
