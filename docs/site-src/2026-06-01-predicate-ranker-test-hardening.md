---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/107
synthesized_into: []
---

# Predicate & ranker test hardening (PR #107)

Pure test-hardening pass over the predicate evaluator and next-action ranker.
No production code was touched — all changes are inside `scripts/__tests__/`.
All 619 tests pass.

## What changed

**`axisOrder()` regression test.** The ranker's `axisOrder()` helper assigns
sort tiers to the axis values (`"platform"`, `"execution"`, `"either"`).
Previously there was no assertion on what tier an _unknown_ axis value receives,
so a future refactor could silently move unknown axes ahead of `"platform"` in
the sort order — subtly reordering dashboard entries with no test failure to
catch it. The new test pins the contract: an unknown axis sorts at tier 2
(adjacent to `"either"`), never ahead of `"platform"` (tier 0).

**`=` predicate cross-type coercion test.** The `=` equality predicate
evaluates as `String(value) === lit` to tolerate LHS values that arrive as
strings after a JSON round-trip or query-string parse. The existing test only
covered the case where both sides were already the same type. The extended
test exercises the coercion path directly, so a future switch to strict `===`
cannot silently break predicates whose numeric or boolean LHS values are
stringified by the time the evaluator runs.

**Stale stash entry removed.** A Tier-2 `satisfiedWhen` WIP stash entry was
superseded by PRs #104 and #106; it was dropped to keep the test file free of
dead scaffolding.

## Why it matters

Both findings were named explicitly in the post-PR-#106 review cycle and
intentionally deferred at ship time. Closing them here means:

- A ranker refactor that touches `axisOrder()` breaks loudly rather than
  producing a wrong-but-passing sort.
- A DSL grammar change that tightens `=` equality breaks loudly rather than
  silently mismatching string-typed signal values from JSON.
