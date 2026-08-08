---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# `satisfiedWhen` predicate evaluator — one canonical source

`scripts/predicate.mjs` is the single implementation of the `satisfiedWhen`
string-DSL evaluator (`evaluatePredicate(expr, signals)`). Every consumer —
Node-side scripts and the Next.js dashboard alike — reads from this one
module. Before PR #106 that wasn't true, and the drift produced a real
scoring bug (see below). This page documents the current shape so the next
person extending the DSL edits the one file that matters.

## Grammar

The grammar lives as a comment at the top of `scripts/predicate.mjs` and
mirrors the `$schema` comment in `app/data/rubric.json`:

| Form              | Meaning                                                                          |
| ----------------- | --------------------------------------------------------------------------------- |
| `path`            | truthy check (non-null, non-zero, non-empty-string; the strings `"0"`/`"false"` are also falsy) |
| `!path`           | falsy check                                                                        |
| `path>=N` etc.    | numeric comparison (`>=`, `<=`, `>`, `<`) — operator matching is ordered so `>=` isn't mistaken for `>` |
| `path=v` / `path=v\|w\|x` | equals one of a pipe-separated literal list                              |
| `path!=v`         | not-equals                                                                         |
| `path~regex`      | array-of-strings element match — RHS is compiled as a case-insensitive `RegExp` and tested against each element of the (array) LHS; returns `false` (never throws) if the LHS isn't an array or the regex is unparseable |
| `A & B`           | AND of two or more atoms                                                          |

`path` is dot-notation into the `signals` object (`readPath`), and every
`rubric.json` next-action's `satisfiedWhen` string is evaluated against
`signalsSummary` — the flat scalar map `buildSignalsSummary()` builds in
`scripts/run-assessment.mjs`.

## One evaluator, one re-export

`app/lib/assessment.ts` does not implement its own copy. It imports directly:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

That's the whole definition on the TypeScript side — a one-line passthrough,
not a port. `app/lib/__tests__/predicate-passthrough.test.ts` enforces this
structurally rather than just by convention: it imports `evaluatePredicate`
from both `@/app/lib/assessment` and `@/scripts/predicate.mjs` and asserts
`fromTs` is reference-equal (`toBe`) to `fromMjs`. If a future edit
reintroduces a duplicate implementation on the TS side, this test fails even
if the duplicate happens to be behaviorally identical at write time — it
catches the *shape* of the mistake, not just its symptoms.

## Consumer: `rank-next-actions.mjs`

`scripts/rank-next-actions.mjs` (`rankNextActions()`) uses the canonical
evaluator to precompute a filtered, ranked next-actions list rather than
leaving that logic for downstream consumers to reimplement. For each
dimension's `nextActions`:

- Actions whose `satisfiedWhen` evaluates truthy against `signalsSummary`
  are dropped — they're already done.
- Each surviving action's `axis` defaults to `"platform"` when it carries a
  `satisfiedWhen` and `"either"` otherwise, and its deficit is
  `100 - score` (platform axis) or `100 - executionScore` (execution axis).
- `rank = weight * deficit`.
- The full list sorts by `rank` descending, then axis order (platform
  before execution before either), then `weight` descending, then `dimId`
  and `actionId` alphabetically as final tie-breakers, and is sliced to
  `limit` (default 10).

`scripts/run-assessment.mjs` calls `rankNextActions(rubric, scoreMap,
signalsSummary, 10)` once per assessment run and writes the result onto
`assessment.rankedNextActions`, which lands in the written `assessment.json`
alongside the rest of the scored snapshot.

## Why this shape: the bug it closes

On 2026-05-31, a prior cycle's next-actions ranking was hand-written rather
than routed through a shared evaluator, and it modeled `satisfiedWhen` as an
object shape (`{field, op, value}`) — but the rubric's `satisfiedWhen` is
always a string DSL expression (e.g. `"loopCommandUses>=1"`). The mismatched
evaluator silently returned `null` for every predicate, so nothing was ever
filtered as satisfied, and an already-satisfied action (`babysit-loop`)
surfaced as a top-3 priority despite the underlying signal already clearing
its threshold. A prior PR (#104) patched this tactically with a grammar note
in the self-assessment skill's `SKILL.md`. PR #106 is the structural fix: one
tested evaluator (`scripts/predicate.mjs`), a reference-equality test that
fails loudly if a second implementation reappears, and a precomputed
`rankedNextActions` output so no consumer needs to re-derive the filter or
the ranking on its own.

The self-assessment skill now reflects this contract directly — its
`SKILL.md` instructs reading `assessment.json.rankedNextActions[0..2]` for
top priority actions ("already filtered ... and ranked by `weight × deficit`
by `scripts/rank-next-actions.mjs`") rather than re-implementing the
filter/ranking logic. `CLAUDE.md`'s hard-rules section codifies the same
contract for future changes: "the self-assessment skill must NEVER
hand-implement the `satisfiedWhen` filter or the weight×deficit ranking."
