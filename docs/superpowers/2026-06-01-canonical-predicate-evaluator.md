---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
---

# Canonical Predicate Evaluator and Pre-Computed Next-Actions

PR #106 collapses two recurring bug vectors — a duplicated `satisfiedWhen` evaluator and a hand-rolled ranking loop — into a single canonical path. This page documents the resulting contracts so future contributors know where to look and what not to duplicate.

## The problem it solves

Before this change, the `/self-assessment` skill hand-implemented the `satisfiedWhen` filter and the weight×deficit ranking. Any drift between that implementation and the rubric's DSL evaluation rules meant already-satisfied actions could surface as TODOs, and ranking order could differ from what the dashboard showed. Two independent implementations of the same logic is a maintenance debt with a known failure mode — it's also the class of inconsistency that's hardest to catch in review because the outputs look plausible.

---

## `scripts/predicate.mjs` — canonical evaluator

`scripts/predicate.mjs` is the single source of truth for the `satisfiedWhen` DSL. It is a byte-faithful port of the original `app/lib/assessment.ts:evaluatePredicate` function, promoted to a standalone `.mjs` module so both the Node scoring scripts and the Next.js app can import it without a dependency-direction conflict.

**Rule: edit the DSL grammar here and nowhere else.** When the `satisfiedWhen` grammar evolves, change `scripts/predicate.mjs` and update the rubric's `$schema` comment — never the TypeScript file.

`app/lib/assessment.ts` retains an `evaluatePredicate` named export, but it is now a 2-line passthrough re-export:

```ts
// app/lib/assessment.ts
export { evaluatePredicate } from "../../scripts/predicate.mjs";
```

The test at `app/lib/__tests__/predicate-passthrough.test.ts` asserts that the two are **reference-equal** (`expect(tsExport).toBe(mjsExport)`). A duplicate implementation — even a functionally identical one — fails CI. The failing test is your signal that you've copied logic that should stay in `predicate.mjs`.

---

## `scripts/rank-next-actions.mjs` — ranking API

```js
rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)
```

| Argument | Type | Description |
| --- | --- | --- |
| `rubric` | `object` | Parsed `app/data/rubric.json` |
| `scoreMap` | `object` | Dimension id → normalized score (0–100) |
| `signalsSummary` | `object` | Output of `buildSignalsSummary(signals)` |
| `limit` | `number` | Top-N cap; defaults to 10 |

Returns an array of next-action objects, filtered to entries whose `satisfiedWhen` predicate evaluates to `false` against `signalsSummary`, then sorted by `weight × (100 − score)` descending. Each entry includes the dimension id, action text, weight, deficit, and predicate result.

`scripts/run-assessment.mjs` calls this immediately after scoring and writes the result to `app/data/assessment.json` as `rankedNextActions`. That write happens on every `npm run assess` run; there is no separate step.

---

## `assessment.json.rankedNextActions` — consumer contract

After every `npm run assess` run, `app/data/assessment.json` contains a pre-computed `rankedNextActions` array. This is the only authoritative source. Consumers must read from it — they must never re-derive the list by filtering the rubric or implementing their own weight×deficit sort.

```json
{
  "rankedNextActions": [
    {
      "dimensionId": "automation",
      "action": "Author a personal /ship slash command",
      "weight": 3,
      "deficit": 72,
      "satisfied": false
    }
  ]
}
```

The `/self-assessment` skill was trimmed in this PR to read `rankedNextActions` from the written file and report it verbatim — no filter, no re-rank.

**Invariant:** every entry in `rankedNextActions` has `satisfied: false`. If you ever see a satisfied action in the list, the bug is in the data layer upstream (a stale `assessment.json`, or a scoring pipeline that skipped the `rankNextActions` step) — not in the consumer. Fix the data layer.

---

## Tests added

| Test file | What it covers |
| --- | --- |
| `scripts/__tests__/predicate.test.mjs` | DSL operator coverage: `gte`, `lt`, `eq`, `and`, `or`, `not`, `in` |
| `scripts/__tests__/rank-next-actions.test.mjs` | Ranking order, satisfied-action exclusion, limit cap |
| `app/lib/__tests__/predicate-passthrough.test.ts` | Reference equality of TS re-export and `.mjs` canonical |

---

## Hard rules (CLAUDE.md additions from this PR)

Two rules were added to `CLAUDE.md` in PR #106. They are reproduced here for discoverability:

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

> **Ranked next-actions live in `assessment.json.rankedNextActions`.** The self-assessment skill must NEVER hand-implement the satisfiedWhen filter or the weight×deficit ranking. Read the pre-computed top-10 from the written file. The 2026-05-31 cycle landed this contract; surfacing a satisfied action as a TODO again is a regression — fix the data layer, not the report.
