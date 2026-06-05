# Spec: CCE-79 Memory Execution Scorer Redesign

**Date:** 2026-06-04
**Status:** Approved (design decisions locked via AskUserQuestion 2026-06-04)
**Tracker:** CCE-79
**Parents:** CCE-76 (original Memory Execution scorer, v0.9.18 PR #116), CCE-78 (interim `/btw` blend asymmetry fix)

## Context

The Memory Execution scorer (`scripts/score.mjs::memory`, lines 977–1003) sums four slash-command counters as fungible numerator inputs:

```js
const sum =
  btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses;
const ratio = Math.min(sum / interactiveOrUnknownSessionsAnalyzed, 1);
```

CCE-78 fixed the immediate `/btw` blend asymmetry (Direction A — `cliBtwUseCount` no longer leaks into `btwCommandUses`). CCE-79 addresses the deeper semantic problem: these four commands don't share a counter class.

**Per-field source semantics:**

| Field      | Source                                          | Counter class                             | Reliability                                                  |
| ---------- | ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `/clear`   | `history.jsonl` (per-session deduped)           | session-coverage                          | reliable                                                     |
| `/compact` | `history.jsonl` (per-session deduped)           | session-coverage                          | reliable                                                     |
| `/btw`     | `~/.claude.json#btwUseCount` (`cliBtwUseCount`) | **invocation-count, cumulative all-time** | reliable for count, wrong shape for ratio                    |
| `/rewind`  | `history.jsonl` / transcripts                   | session-coverage                          | almost always zero (keyboard shortcut Esc-Esc, rarely typed) |

Summing across counter classes silently mixes "30-day per-session adoption" with "lifetime invocation count" — the same class of bug CCE-78 patched at the field level. CCE-79 fixes it at the design level.

## Goals

1. **Redesigned `memory` Execution scorer** with semantically-consistent numerator: only session-coverage signals (`clearCommandUses + compactCommandUses`).
2. **`/btw` surfaces as cumulative evidence text only** in the EXECUTION evidence array (e.g., `"Plus 8 all-time /btw invocations (cumulative, not in ratio)"`), preserving credit without polluting the ratio.
3. **`/rewind` dropped from the ratio numerator** but retained as a binary next-action probe (`rewindCommandUses>=1` predicate in rubric stays).
4. **Rubric Memory target lowered from 92 → 60** to reflect the realistic-ceiling shift when the numerator shrinks from 4 commands to 2.
5. **CLAUDE.md updated** with the per-field semantic categorization (Source / Counter class / Reliability table) so future scorer authors don't re-make the same mistake.
6. **Live verification:** baseline-vs-post `assessment.json` diff documented in the PR.

## Non-goals

- **Don't touch the Customization scorer** (`scripts/score.mjs` lines 1005-1023). It sums `/color + /voice + /focus` which are all session-coverage with reliable sources — no asymmetry. Different ticket if Customization needs review.
- **Don't change the `/btw` PLATFORM scoring** (`scripts/score.mjs:813-816`). PLATFORM uses `cliBtwUseCount` correctly as a presence/cumulative signal; only EXECUTION had the mixed-class bug.
- **Don't remove the `rewindCommandUses>=1` next-action probe** in `rubric.json`. The binary "have you ever used /rewind?" signal is still valuable as a satisfiedWhen check; only the ratio aggregation drops it.
- **Don't introduce a new counter class.** No per-month or per-week normalization on cumulative counters in this PR — that's complexity for marginal signal.
- **Don't refactor the universe-gating boilerplate.** The `withGates({ transcripts: true, universe: "interactive_or_unknown" })` wrapper is shared infrastructure; leave it untouched.

## Components

### Component A — Scorer redesign

**File:** `/Users/theo/Projects/claude-extensions/scripts/score.mjs`
**Lines:** 977–1003 (current `memory` scorer block)

**Current code:**

```js
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const btw = maxProbe(s, "btwCommandUses");
    const clear = maxProbe(s, "clearCommandUses");
    const compact = maxProbe(s, "compactCommandUses");
    const rewind = maxProbe(s, "rewindCommandUses");
    const sum = btw + clear + compact + rewind;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
    const capSuffix =
      rawRatio > 1
        ? ` — capped from ${pct(rawRatio * 100)}% (multiple memory commands per session)`
        : "";
    const evidence = [
      `Memory hygiene commands: ${sum} session-coverage hits across ${denom} interactive_cli∪unknown sessions (${pct(ratio * 100)}%)${capSuffix}`,
    ];
    const gaps = [];
    if (sum === 0) {
      gaps.push(
        "No /btw, /clear, /compact, or /rewind in any interactive session",
      );
    }
    return { score, evidence, gaps, gapReason: null };
  },
),
```

**Redesigned code (target):**

```js
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    // CCE-79: numerator restricted to session-coverage signals only.
    // /btw (cumulative all-time) shown as evidence text, not in ratio.
    // /rewind (keyboard-shortcut, near-zero signal) dropped from ratio;
    // kept as a binary next-action probe via rubric satisfiedWhen.
    const clear = maxProbe(s, "clearCommandUses");
    const compact = maxProbe(s, "compactCommandUses");
    const sum = clear + compact;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
    const capSuffix =
      rawRatio > 1
        ? ` — capped from ${pct(rawRatio * 100)}% (multiple memory commands per session)`
        : "";
    const btwAllTime = s.signalsSummary?.cliBtwUseCountAllTime ?? 0;
    const btwEvidence =
      btwAllTime > 0
        ? ` Plus ${btwAllTime} all-time /btw invocations (cumulative, not in ratio).`
        : "";
    const evidence = [
      `Memory hygiene commands: ${sum} session-coverage hits across ${denom} interactive_cli∪unknown sessions (${pct(ratio * 100)}%)${capSuffix}.${btwEvidence}`,
    ];
    const gaps = [];
    if (sum === 0) {
      gaps.push(
        "No /clear or /compact in any interactive session",
      );
    }
    return { score, evidence, gaps, gapReason: null };
  },
),
```

**Key changes:**

- `btwCommandUses` removed from the numerator
- `rewindCommandUses` removed from the numerator
- New `btwEvidence` string conditionally appended to the evidence message when `cliBtwUseCountAllTime > 0`
- Gap text updated to reflect the narrowed numerator (no more "/btw" or "/rewind" mention)

### Component B — Rubric target

**File:** `/Users/theo/Projects/claude-extensions/app/data/rubric.json`
**Lines:** ~226 (the `"target": 92` line for the memory dimension)

Change:

```diff
-      "target": 92,
+      "target": 60,
```

Justification: with 2 commands instead of 4 in the numerator, hitting 92% session-coverage is significantly harder. 60% represents mature usage of the narrowed set ("most sessions have at least one /clear OR /compact").

### Component C — Methodology page narrative

**File:** `/Users/theo/Projects/claude-extensions/app/methodology/page.tsx`
**Lines:** ~188–215 (the Memory & Context Management `<li>` block)

Update the formula description to reflect the narrowed numerator:

- Replace `min(sum / interactiveOrUnknownSessionsAnalyzed, 1) × 100` description's enumeration of commands (`/btw`, `/clear`, `/compact`, `/rewind`) with just (`/clear` and `/compact`)
- Update the rubric-target reference from 92 to 60
- Add a sentence explaining that `/btw` (cumulative) and `/rewind` (binary next-action) are now surfaced separately rather than in the ratio
- The "Universe: interactive_cli ∪ unknown" tail stays as-is (universe is unchanged)

### Component D — dimension-explainer

**File:** `/Users/theo/Projects/claude-extensions/app/lib/dimension-explainer.ts`
**Lines:** ~82–92 (the `memory` block)

The dimension-explainer describes the PLATFORM half (memory files, CLAUDE.md, plans, plugin support) and is not directly affected by the EXECUTION-ratio change. However, if there's any reference to memory hygiene commands in the EXECUTION narrative within this file, update it. Read the file fully first to confirm scope of edit.

### Component E — Test fixtures

**File:** `/Users/theo/Projects/claude-extensions/scripts/__tests__/_fixtures.mjs`
**Lines:** ~52, ~54, ~56, ~94, ~96 (rewind/btw/clear/compact fixture defaults)

The fixtures define `rewindCommandUses`, `btwCommandUses`, `clearCommandUses`, `compactCommandUses`. Don't remove them — they're still scanned by other places. But ensure fixtures provide `signalsSummary.cliBtwUseCountAllTime` so the new evidence-text path is exercised.

### Component F — New / updated tests

**File:** `/Users/theo/Projects/claude-extensions/scripts/__tests__/score.test.mjs` (or wherever memory-scorer tests live; locate via grep)

New / updated test cases:

1. **Test: numerator excludes /btw and /rewind.** Fixture with `btwCommandUses=100, rewindCommandUses=100, clearCommandUses=0, compactCommandUses=0` → score 0 (because numerator is only clear+compact, both zero).
2. **Test: /btw cumulative surfaces as evidence text.** Fixture with `signalsSummary.cliBtwUseCountAllTime=42` → evidence contains `"Plus 42 all-time /btw invocations"`.
3. **Test: target lowered to 60 in rubric.** Read `rubric.json`, find `memory.target`, assert equal to 60.
4. **Test: gap text no longer mentions /btw or /rewind.** Fixture with all zeros → gap is `"No /clear or /compact in any interactive session"` (not the old 4-command form).
5. **Test (regression): /clear + /compact in numerator.** Fixture with `clearCommandUses=5, compactCommandUses=3, denom=10` → ratio 0.8, score 80.
6. **Test (regression): cap behavior preserved.** Fixture with `clearCommandUses=15, compactCommandUses=15, denom=10` → ratio capped at 1.0, score 100, `capSuffix` present in evidence.

### Component G — CLAUDE.md hard-rule update

**File:** `/Users/theo/Projects/claude-extensions/CLAUDE.md`
**Anchor:** the existing CCE-78 hard rule about "Don't blend cumulative all-time counters into windowed ratio surfaces"

Add a paragraph (or a follow-up bullet) documenting the per-field semantic categorization pattern with the four-row table from this spec's §Context. The lesson: before adding a new field to a ratio numerator, classify it on TWO axes — (a) time window (windowed vs cumulative), (b) counter class (per-session-coverage vs raw invocation count). If the new field's class differs from existing numerator inputs, it doesn't belong in the same `sum`.

## Data flow

```
                      ┌──────────────────────────┐
                      │   signalsSummary         │
                      │   - clearCommandUses     │
                      │   - compactCommandUses   │
                      │   - btwCommandUses ◄────┐│  (still computed,
                      │   - rewindCommandUses   ││   but no longer
                      │   - cliBtwUseCountAllTime│   in numerator)
                      └────────────┬─────────────┘
                                   │
                                   ▼
                      ┌──────────────────────────┐
                      │  score.mjs::memory       │
                      │                          │
                      │  sum = clear + compact   │
                      │  ratio = sum / denom     │
                      │  evidence:               │
                      │   "...{sum} hits...      │
                      │    Plus {btwAllTime}..." │
                      └────────────┬─────────────┘
                                   │
                                   ▼
                      ┌──────────────────────────┐
                      │  assessment.json         │
                      │  dimensions.memory       │
                      │   .executionScore        │
                      └──────────────────────────┘
```

## Error handling

- If `cliBtwUseCountAllTime` is missing from `signalsSummary`, default to 0 (no evidence-text addition).
- If `interactiveOrUnknownSessionsAnalyzed` is 0, the existing `withGates` handling already produces an unmeasured result; no change.
- If `clearCommandUses` or `compactCommandUses` is missing from `signalsSummary`, `maxProbe` returns 0. Sum still works.

## Testing strategy

- **TDD pattern:** for each new test case (Component F #1–#6), write the test, run it expecting RED, then apply the scorer change, run it expecting GREEN.
- **Full suite:** `npx vitest run` — must pass at 564+ tests (current baseline). Memory-scorer tests added; nothing else weakened.
- **Live baseline-vs-post diff:** before the implementation, run `npm run assess --print --no-slack > /tmp/baseline.txt`; after, run the same to `/tmp/post.txt`; diff the Memory dimension's executionScore. Document the delta in the PR body.
- **Manual: rubric target change.** Confirm `assessment.json` shows the Memory rawTarget at 60, and the executionScore normalization uses 60 as the denominator.

## Acceptance criteria

1. `scripts/score.mjs::memory` numerator is `clearCommandUses + compactCommandUses` (no `btw`, no `rewind`).
2. Evidence string conditionally appends "Plus N all-time /btw invocations" when `cliBtwUseCountAllTime > 0`.
3. Gap text reflects the narrowed numerator.
4. `rubric.json` memory dim `target` is 60 (was 92).
5. `methodology/page.tsx` Memory section narrative reflects the new formula + target.
6. CLAUDE.md updated with the per-field semantic categorization pattern.
7. All test cases in Component F pass; full vitest suite green (≥ 564 tests).
8. Live baseline-vs-post `assessment.json` diff documented in PR body, with explicit note of Memory executionScore delta.
9. Jira CCE-79 transitioned to Done with close-out comment referencing the PR + delta.

## Risk surface

- **Risk: rubric target drop to 60 makes the Memory radar vertex score JUMP up overnight for existing users.** A user previously at executionScore 55 / 92 = 60 normalized would now be 55 / 60 = 92. That's a +32 vertex jump for the same raw behavior. **Mitigation:** PR body must include the baseline-vs-post snapshot so the change is visible. Optional: include a one-sentence note in the dimension card narrative explaining the recalibration.
- **Risk: dropping /btw from EXECUTION ratio drops users who relied on /btw to inflate their Memory score.** Their EXECUTION dim falls. **Mitigation:** this is the CORRECT scoring outcome (the inflation was the bug). The evidence text retains the /btw count so users see they're not "losing credit," just having it accounted properly.
- **Risk: a downstream test fixture or app component reads `btwCommandUses` and breaks.** Confirmed by `grep -rn "btwCommandUses" .` before the edit; any consumer that expected it in `sum` may show stale results. **Mitigation:** the field stays computed in `signalsSummary` (only the scorer drops it from `sum`). Downstream consumers reading `signalsSummary.btwCommandUses` directly are unaffected.

## Followups (out of scope)

- **Customization scorer review.** If the same per-field-semantic categorization process is applied to Customization (`/color + /voice + /focus`), no asymmetry expected, but worth a brief audit. File as a follow-up.
- **Other Execution scorers with mixed counter classes.** Audit the remaining Execution scorers (planning, parallel, scheduled, remote, verification, integrations, learning, model-effort) using the per-field-categorization process from §Context. File any drift as separate tickets.
- **Long-term: per-month normalization for cumulative counters.** If `/btw`'s cumulative count is ever to enter a ratio, it would need a per-month normalization (e.g., `cliBtwUseCountAllTime / monthsAccountAge`). Out of scope for CCE-79.

## Decisions locked

| Decision            | Choice                                               | Source                          |
| ------------------- | ---------------------------------------------------- | ------------------------------- |
| `/rewind` in scorer | DROP from ratio, KEEP as next-action probe           | User AskUserQuestion 2026-06-04 |
| `/btw` placement    | DROP from ratio, surface as cumulative evidence text | User AskUserQuestion 2026-06-04 |
| Rubric target       | Drop 92 → 60                                         | User AskUserQuestion 2026-06-04 |
