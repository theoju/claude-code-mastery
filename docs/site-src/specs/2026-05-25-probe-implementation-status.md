---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
---

# Probe Implementation Status

The probe tracker is the single source of truth for which signals the
self-assessment reads, what each one covers, and which Boris tip it maps to.
This page summarises the tracker's current state. The full per-probe registry
lives at
[`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-25-probe-implementation-status.md).

## Coverage at a glance

The scorer reads **73 signals** across five source layers:

| Source layer                                                 | Signals | Axis |
| ------------------------------------------------------------ | ------: | ---- |
| Settings (`~/.claude/settings.json`, `~/.claude.json`)       |      23 | P    |
| Filesystem (`agents` / `commands` / `skills` / `projects`)   |      10 | P    |
| Plugins (`enabledPlugins`, PATH)                             |       6 | P    |
| Transcripts (`projects/*/*.jsonl`)                           |      21 | P\*  |
| Runtime (`~/.claude.json` behavioral-adoption flags)         |       3 | A    |
| Insights / cooked telemetry (`usage-data/`)                  |      11 | E    |
| **Total**                                                    |  **73** |      |

Of those 73, **48 are catalog-backed probes** (listed in
`app/data/probe-catalog.json`); **47 of them gate a `satisfiedWhen`
next-action predicate**. The 48th, `sessionsByKind`, is the
session-universe classifier — it populates the probes-page session census
but is not a predicate LHS.

## Axis legend

| Label           | Meaning                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P (config)**  | Settings / Filesystem / Plugins signal — "is it installed or configured?" Feeds `SCORERS` or a `satisfiedWhen` next-action gate.                  |
| **P\* (behavior)** | Transcript-derived usage signal that gates a Platform-Setup next-action or scorer — **not** an `EXECUTION_SCORERS` input.                      |
| **A (adoption)**   | Durable `~/.claude.json` behavioral-adoption flag — "has the user ever done X?" Feeds `EXECUTION_SCORERS` as adoption-credit, not a rate.     |
| **E**           | Cooked-telemetry (Insights) signal consumed directly by an `EXECUTION_SCORERS.<dim>` body.                                                        |
| **P+E**         | Scored on both the Platform Setup and Execution axes.                                                                                             |

## Tip coverage tally

The scorer covers **75 canonical tips** (keyed `"1"`–`"75"` in
`boris-tip-index.json`). The 87-tip figure that appears in some older docs
is an analytical superset; tips 76–87 were never added to the data files.

**75 tips = ✅ 53 · 📊 12 · 🗣 3 · ❌ 7**

| Status | Meaning                                                     | Count |
| ------ | ----------------------------------------------------------- | ----: |
| ✅     | Direct probe — isolated `satisfiedWhen` predicate or scorer |    53 |
| 📊     | Shared signal — fed by a generic scorer field               |    12 |
| 🗣     | Coaching-only — next-action card, no auto-detect            |     3 |
| ❌     | Untracked — no probe, no scorer signal                      |     7 |

Untracked tips (7): **12** (Bug Fixing), **21** (Sandboxing), **38**
(`--name`), **53** (Fork Sessions), **57** (`--bare`), **58** (`--add-dir`),
**70** (Recaps). Tips 12 and 57 are permanently blocked — the behaviors leave
no trace in any of the five layers. The rest await a matching settings key,
slash command, or session-meta field.

## Runtime-adoption signals (axis A)

The Runtime layer exposes **three** `~/.claude.json` behavioral-adoption
flags that compose into Execution scorers as capped adoption-credit bonuses:

| Signal                   | Tip  | What it detects                                                | Scorer effect                                            |
| ------------------------ | ---- | -------------------------------------------------------------- | -------------------------------------------------------- |
| `coworkDispatchAdopted`  | 50   | `hasUsedAgentsFleet` — ever dispatched a Cowork agent          | +15 adoption-credit in `parallel` Execution scorer       |
| `opus47AwarenessAdopted` | 74   | `lastReleaseNotesSeen` / launch counts — 4.6→4.7 awareness     | +8 awareness-proxy credit in `model-effort` Execution scorer |
| `cliBtwUseCountAllTime`  | 33   | `btwUseCount` — cumulative all-time `/btw` invocation counter  | Backs `cliBtwUseCountAllTime>=1` adoption predicate      |

### CCE-78: separating the `/btw` adoption signal from the Execution ratio

Before PR #119, `buildSignalsSummary` blended `btwUseCount` (a cumulative
all-time counter that grows monotonically with account age) directly into
`btwCommandUses` (a 30-day windowed session-coverage counter) via
`Math.max`. This corrupted the Memory Execution ratio: the numerator counted
sessions where `/btw` fired within the window, but the blended value could
exceed the windowed denominator as account age grew.

PR #119 (CCE-78) fixes this by separating the two signals:

- **`cliBtwUseCountAllTime`** — exposed as its own `signalsSummary` key;
  reads `~/.claude.json#btwUseCount` directly. The tip-33 predicate
  (`cliBtwUseCountAllTime>=1`) routes here for habit-adoption checks.
- **`btwCommandUses`** — now exclusively a 30-day windowed session-coverage
  counter; its value is never inflated by the all-time counter. The Memory
  Execution scorer's numerator draws from this field only.

**Before:** `btwCommandUses = Math.max(windowedCount, cumulativeCount)` →
ratio numerator could exceed denominator as account age grew.

**After:** `btwCommandUses` = windowed 30-day count only; `cliBtwUseCountAllTime`
= cumulative all-time count on a separate key. The ratio stays bounded; the
adoption predicate retains its ergonomics.

The probe catalog (`app/data/probe-catalog.json`) and rubric were updated in
the same PR to reflect the renamed predicate LHS. The five machine-enforced
header counts in the tracker (tips, dimensions, next-actions, probe-catalog
entries, `signalsSummary` keys) are validated by
`scripts/__tests__/tracker-counts.test.mjs`; no count changed.

## Five machine-enforced header counts

The tracker's header declares five counts that `tracker-counts.test.mjs`
re-derives from the live files on every CI run. A stale number fails the
build. Current values:

| Count                          | Value |
| ------------------------------ | ----: |
| Boris tips                     |    75 |
| Scored dimensions              |    12 |
| Rubric next-actions            |    48 |
| `probe-catalog.json` entries   |    48 |
| `signalsSummary` keys          |    72 |

When you add or remove a probe, update all five in the tracker header in the
same PR. Derive the `signalsSummary` count by invoking
`buildSignalsSummary(makeSignals())` and counting `Object.keys(...)` — never
by parsing the function source (shorthand property notation causes
under-counts).

## Related files

- **Living tracker (full per-probe registry):** `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
- **Probe page metadata:** `app/data/probe-catalog.json` → rendered at `/methodology/probes`
- **Scoring engine:** `scripts/score.mjs` (`SCORERS`, `EXECUTION_SCORERS`)
- **Signal readers:** `scripts/signals.mjs` (Platform Setup), `scripts/insights-signals.mjs` + `scripts/_usage-data.mjs` (Execution)
- **Predicate DSL:** `scripts/predicate.mjs` (canonical evaluator)
- **CI count guard:** `scripts/__tests__/tracker-counts.test.mjs`
