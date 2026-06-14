---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Unblend `btwCommandUses` from Cumulative Counter

**PR #119 · shipped v0.9.18**

## What changed

`buildSignalsSummary` (in `scripts/run-assessment.mjs`) previously contained a `Math.max` blend at the `/btw` field:

```js
// BEFORE (removed in CCE-78)
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),   // 30-day windowed session-coverage
  signals.settings?.cliBtwUseCount ?? 0  // cumulative all-time invocation count
)
```

That one-liner silently mixed two fields that live on different semantic axes:

| Field | Time window | Counter class |
|---|---|---|
| `btwCommandUses` (transcript + history probe) | 30-day windowed | per-session-coverage (deduped) |
| `settings.cliBtwUseCount` (from `~/.claude.json`) | cumulative all-time | raw invocation count |

The fix splits them into two separate fields:

```js
// AFTER (CCE-78)
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` is now purely the 30-day windowed session-coverage signal. `cliBtwUseCountAllTime` carries the cumulative all-time count without contaminating any windowed ratio.

The Boris tips 33 and 54 predicates, which need "have you ever adopted this habit" semantics, were rerouted from `btwCommandUses >= 1` to `cliBtwUseCountAllTime >= 1`. That is the correct field for an adoption binary check.

## Why the blend was wrong

The blend was introduced in the v0.9.15 cycle for predicate ergonomics: tips 33 and 54 check `/btw` adoption, and `~/.claude.json`'s `cliBtwUseCount` was the only reliable signal for that (the session JSONL never sees `/btw` typed at the prompt — it's a side-channel command). The intent was sound; the implementation was wrong.

`Math.max(windowed, cumulative)` produces a number that grows with account age, not with recent posture. If you used `/btw` 400 times over two years but haven't touched it in six months, the blend reported 400 against a denominator of your last-30-day session count. The resulting ratio drifts permanently upward regardless of current behavior — exactly the failure mode the **per-field semantic categorization rule** in CLAUDE.md is designed to prevent.

The Memory Execution scorer body used `maxProbe` directly rather than pulling from `signalsSummary.btwCommandUses`, so the live score was not corrupted. The bug was latent in the `signalsSummary` surface, where a future scorer or dashboard query could have picked up the inflated value.

## Scope and non-impact

Memory Execution score is **unchanged by design** (was 16, stays 16). The scorer's numerator already bypassed `signalsSummary.btwCommandUses` and called `maxProbe` directly. CCE-78 restores correctness to the summary surface without touching scorer arithmetic.

The deeper redesign of the Memory Execution numerator — per-field semantic categorization of `/btw`, `/clear`, `/compact`, `/rewind` — is filed separately as **CCE-79**.

## What was added

- **`cliBtwUseCountAllTime`** — new `signalsSummary` key exposing the cumulative all-time count independently. Defaults to `0` when `settings.cliBtwUseCount` is absent.
- **Three tests** in `scripts/__tests__/signals-summary.test.mjs` assert the partition:
  - `btwCommandUses` takes the MAX of transcript and history probes only — `cliBtwUseCount` must not bleed in.
  - `cliBtwUseCountAllTime` receives the cumulative source independently.
  - `cliBtwUseCountAllTime` defaults to `0` when the settings field is missing.
- **Probe and `signalsSummary` tracker counts updated**: probes 47 → 48, `signalsSummary` keys 71 → 72.
- **CLAUDE.md hard rule added**: codifies the cumulative-vs-windowed counter partition and the per-field semantic-categorization requirement for any future scorer author adding fields to a ratio numerator.

## The rule this encodes

Before adding a field to any ratio numerator (or summing multiple fields), classify it on two independent axes:

1. **Time window** — windowed (e.g. 30-day) vs. cumulative (lifetime)
2. **Counter class** — per-session-coverage (deduped) vs. raw invocation count

If a new field differs from existing numerator inputs on either axis, it doesn't belong in the same sum. Route it to a separate surface: a standalone evidence field (cumulative), a binary predicate (adoption check), or a ratio with a matched denominator.

The `btwCommandUses` blend violated both axes simultaneously: cumulative mixed into windowed, raw invocation count mixed into session-coverage. `cliBtwUseCountAllTime` on a binary predicate (`>= 1`) is the correct shape for an adoption check — it makes no ratio claim and carries no denominator assumption.
