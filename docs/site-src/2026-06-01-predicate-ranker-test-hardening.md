---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/107
synthesized_into: []
doc_kind: decision
---

# Decision: predicate and ranker test hardening (PR #107)

**Date:** 2026-06-01  
**PR:** [#107](https://github.com/theoju/claude-code-self-assessment/pull/107)  
**Scope:** test-only — no production modules modified

## Context

PR #106 introduced the predicate DSL evaluator and the `rankNextActions` sorter. Its post-ship review flagged two contracts that were exercised in production but not pinned by any test: the cross-type coercion in the `=` operator, and the tier fallback in the internal `axisOrder()` mapping that drives next-action tie-breaking. Both were deferred at merge time as explicit review debt. This PR closes that debt.

## What changed

Two new test assertions were added across two existing test files. No production code was touched.

### 1. `=` operator cross-type coercion (`scripts/__tests__/predicate.test.mjs`)

The `=` operator in the predicate DSL compares via `String(value) === lit`, which means a numeric field value of `5` and the string `"5"` both satisfy `x=5`. The existing test suite covered string-to-string and number-to-literal equality but did not assert the string-input form:

```js
// scripts/__tests__/predicate.test.mjs — lines 38–43
it("= : exact equality (string and numeric, cross-type via String() coercion)", () => {
  expect(evaluatePredicate("x=foo", { x: "foo" })).toBe(true);
  expect(evaluatePredicate("x=foo", { x: "bar" })).toBe(false);
  expect(evaluatePredicate("x=5", { x: 5 })).toBe(true);
  expect(evaluatePredicate("x=5", { x: "5" })).toBe(true);   // ← new assertion
});
```

The new assertion locks the `String(value) === lit` contract so that a future migration to strict `===` fails loudly rather than silently breaking rubric predicates that compare enum-like string signals (e.g. effort level) against a numeric literal.

### 2. `axisOrder()` unknown-tier fallback (`scripts/__tests__/rank-next-actions.test.mjs`)

`rankNextActions` sorts tied entries by axis priority: `platform → execution → either`. The mapping is an internal `axisOrder()` helper. The spec says any axis value not in the known set falls to tier 2 (same bucket as `"either"`), placing it after `platform` and `execution` entries. Nothing previously asserted this:

```js
// scripts/__tests__/rank-next-actions.test.mjs — lines 170–193
it("axis ordering buckets unknown axis values with 'either' (tier 2)", () => {
  const fixture = {
    dimensions: [
      {
        id: "a",
        weight: 1,
        nextActions: [
          { id: "platform-action", action: "p", axis: "platform" },
          { id: "unknown-action", action: "u", axis: "novel-tier" },
        ],
      },
    ],
  };
  const scoreMap = new Map([["a", { score: 50, executionScore: 50 }]]);
  const result = rankNextActions(fixture, scoreMap, {}, 10);
  // Both rank = 1*50 = 50; axis tiebreak: platform(0) before novel-tier(2).
  expect(result.map((r) => r.actionId)).toEqual([
    "platform-action",
    "unknown-action",
  ]);
});
```

Without this pin, a future `axisOrder()` refactor that maps unknown values to tier 0 (ahead of `"platform"`) would silently reorder the dashboard's next-action list rather than failing CI.

## Decision rationale

Both contracts are behavioral properties of the scorer-to-UI pipeline that the dashboard relies on implicitly:

- If `=` coercion changes, rubric predicates comparing effort-level strings (e.g. `"effortLevel=max"`) could silently stop firing.
- If `axisOrder()` changes, the ranked next-action list the user sees in the dashboard changes order without any test failure.

Pinning with named regression tests is the lowest-cost defense: zero production risk, immediate CI signal on breakage.

## Affected files

| File | Change |
|---|---|
| `scripts/__tests__/predicate.test.mjs` | Extended `=` operator test with cross-type string-input assertion |
| `scripts/__tests__/rank-next-actions.test.mjs` | Added `axisOrder()` unknown-tier spec-pinning regression |
