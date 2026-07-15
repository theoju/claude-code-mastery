---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: stop blending `/btw`'s all-time count into the windowed Memory signal

**PR:** [#119](https://github.com/theoju/claude-code-self-assessment/pull/119)
**Touches:** `scripts/run-assessment.mjs` (`buildSignalsSummary`), `app/data/probe-catalog.json`, the tip-33 `satisfiedWhen` predicate

## What changed

`signalsSummary.btwCommandUses` no longer `Math.max`-blends the cumulative
all-time `/btw` invocation count (`~/.claude.json`'s `btwUseCount`) with the
30-day windowed transcript+history session-coverage signal that feeds the
Memory Execution scorer. The two counters are now kept apart:

- `btwCommandUses` — `maxProbe(signals, "btwCommandUses")`, 30-day windowed
  session-coverage only, MAX-merged across `history.jsonl` and transcripts
  the way the other side-channel command counters already are.
- `cliBtwUseCountAllTime` — a new field, `signals.settings?.cliBtwUseCount ?? 0`,
  the raw cumulative-forever counter Claude Code itself maintains in
  `~/.claude.json`.

The tip-33 `satisfiedWhen` predicate — the "have you ever used `/btw`" habit
check — was rerouted to read `cliBtwUseCountAllTime` instead of the blended
field, since that's the semantic it actually wants ("adopted, ever," not
"adopted, this window").

The Memory Execution score itself is unchanged by design. This is a
data-hygiene fix at the `signalsSummary` layer, not a rescoring — nothing in
`scripts/score.mjs`'s Memory Execution ratio moved.

## Why

`CLAUDE.md` already has a standing rule against exactly this shape of bug:
don't blend a cumulative all-time counter into a windowed ratio's numerator.
`btwCommandUses` was doing it anyway — `Math.max(maxProbe(signals,
"btwCommandUses"), cliBtwUseCount)` meant the 30-day session-coverage signal
could never read lower than the user's lifetime `/btw` count. Once that
lifetime count crossed the windowed one (which it will, for any account more
than a few weeks old), the "signal" stopped reflecting recent usage at all —
it just reported account age. A ratio built on top of it drifts upward the
longer the account exists, independent of whether the user touched `/btw`
this month.

Two axes were getting conflated in one `sum`/`max`, per the categorization
rule `CLAUDE.md` calls out explicitly:

| Axis              | `btwCommandUses` (correct)     | `cliBtwUseCount` (the contaminant) |
| ------------------ | ------------------------------- | ------------------------------------ |
| Time window        | 30-day windowed                | cumulative / lifetime                |
| Counter class       | session-coverage (deduped)      | raw invocation count                 |

Both axes differed from the rest of the numerator's inputs, which is the
project's bar for "this doesn't belong in the same sum" — so it was split
out.

## Tracking

Filed as **CCE-78**. The broader per-field redesign of the Memory Execution
scorer — restricting its ratio numerator to session-coverage signals only
(`/clear` + `/compact`) and moving `/btw` out entirely, surfaced instead as
cumulative evidence text — is the follow-up, filed separately as **CCE-79**.
`probe-catalog.json`'s `btwCommandUses` and `cliBtwUseCountAllTime` entries
already note both tickets so the catalog reads coherently across the two
landings.

## Where to look

- `scripts/run-assessment.mjs` — `buildSignalsSummary`, the `btwCommandUses`
  / `cliBtwUseCountAllTime` fields, with the CCE-78 comment inline.
- `app/data/probe-catalog.json` — `btwCommandUses` and `cliBtwUseCountAllTime`
  entries describe the split and cross-reference both tickets.
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — the
  living probe tracker, updated in the same PR per project convention.

This page is the docs site's own record of the change; it doesn't replace
the in-repo spec/tracker updates, which remain the source of truth for the
probe registry itself.
