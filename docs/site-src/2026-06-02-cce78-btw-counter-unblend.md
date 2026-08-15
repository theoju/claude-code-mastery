---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: unblending the `/btw` counter

PR #119 fixes a `signalsSummary` bug in the Memory Execution scorer: the
30-day windowed `btwCommandUses` field was silently absorbing a cumulative
all-time counter via `Math.max`. The fix splits the two into separate
fields and reroutes the rubric predicate that wanted the cumulative one.
No dimension score moved — the Memory Execution number stayed 16 — because
the scorer body already read the correct field directly. Only the
`signalsSummary` surface (and anything downstream that trusted it, like the
`btw-side-channel` next-action) was wrong.

## The blend

`buildSignalsSummary` in `scripts/run-assessment.mjs` builds the flat map
that both the scorers and the rubric's `satisfiedWhen` predicates read.
Several slash-command counters in that function take the max of a
transcript-derived count and a `~/.claude/history.jsonl`-derived count,
because side-channel commands like `/btw` are typed as plain input and
sometimes never land in the session JSONL that the transcript scanner
reads — `history.jsonl` catches what the transcript scan misses. That
MAX-merge pattern is correct for `btwCommandUses` itself: both operands are
30-day windowed session-coverage counts, so taking the max just recovers
signal without changing what's being measured.

The bug, introduced during the v0.9.15 runtime-adoption-probes cycle, was
blending a third, structurally different source into the same field:
`~/.claude.json`'s `btwUseCount`, a cumulative all-time invocation counter
maintained by Claude Code itself. That value has no window — it never
resets — so folding it into a 30-day ratio's numerator via `Math.max`
meant the "windowed" count could jump to reflect months of `/btw` habit
that happened well outside the scoring window, corrupting whatever ratio
consumed it.

## The fix

`btwCommandUses` now stays a pure 30-day windowed session-coverage count
(the existing transcript ∪ `history.jsonl` MAX-merge, via `maxProbe`). The
cumulative `~/.claude.json` counter is exposed as its own field,
`cliBtwUseCountAllTime`, sourced straight from `signals.settings.cliBtwUseCount`:

```
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`app/data/probe-catalog.json` documents the split under both catalog
entries — `btwCommandUses` now notes explicitly that it is *not* blended
with `cliBtwUseCountAllTime`, and `cliBtwUseCountAllTime` is filed under
the `runtime` source category (the same category as `coworkDispatchAdopted`
and `opus47AwarenessAdopted` — durable "have you ever adopted this" flags
that feed Execution adoption credit, not Platform Setup).

The rubric's `btw-side-channel` next-action (memory dimension, Boris tip
33/54) wanted exactly the "have you ever used `/btw`" semantics that the
cumulative field actually carries, so `app/data/rubric.json` reroutes its
`satisfiedWhen` from the windowed field to the cumulative one:

```
"satisfiedWhen": "cliBtwUseCountAllTime>=1"
```

That's a strictly better match for the action's intent — "use `/btw` for
side questions" is a habit you either have or don't, not something that
should stop being satisfied because you didn't happen to type it in the
last 30 days.

## Why it matters

This is the corruption pattern CLAUDE.md's hard rule on numerator fields
now names directly: don't blend cumulative all-time counters into windowed
ratio surfaces. Two independent axes have to match before two fields can
share a `sum` or a `Math.max`:

- **Time window** — windowed (e.g. 30-day) vs. cumulative (lifetime).
- **Counter class** — deduped per-session coverage vs. raw invocation count.

`btwCommandUses` and `cliBtwUseCountAllTime` differ on the first axis, so
they don't belong in the same field — full stop, regardless of how
tempting the `Math.max` looked for predicate ergonomics. The original
blend read as ergonomic precisely because it "just" recovered more signal;
the corruption was invisible until someone traced a ratio numerator back
to its sources.

## Related: CCE-79

CCE-78 only unblends the `signalsSummary` surface. The deeper question —
whether `/btw` (of any counter class) belongs in the Memory Execution
ratio's numerator at all — is the separate, broader Memory Execution
scorer redesign tracked as CCE-79. That redesign has since landed: the
ratio numerator in `app/data/rubric.json`'s `memory` dimension now targets
60 (down from the original 92) to match a numerator restricted to the two
session-coverage signals `/clear` and `/compact`, with the cumulative
`/btw` count surfaced only as evidence text and `/rewind` kept as a
binary next-action probe rather than a ratio input — see
`app/data/probe-catalog.json`'s `btwCommandUses` and `rewindCommandUses`
entries for the current numerator shape.
