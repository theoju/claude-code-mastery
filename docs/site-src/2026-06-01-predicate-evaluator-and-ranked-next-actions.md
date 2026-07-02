---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# Predicate evaluator and ranked next-actions

`satisfiedWhen` strings in `app/data/rubric.json` are a small DSL, not a
convenience field a caller can eyeball. On 2026-05-31 a model dispatched to
draft a next-action summary hand-wrote its own ranker instead of calling the
real evaluator, misread `satisfiedWhen: "loopCommandUses>=1"` as if it were an
object shape, and the check silently no-opped. The result: `babysit-loop`
surfaced as a top-priority action even though `loopCommandUses` was 14 —
already satisfied, several times over. PR #104 was the tactical fix (a
grammar doc). PR #106 is the structural close-out: collapse the DSL to one
canonical implementation and stop asking callers to reimplement the filter
at all.

## One evaluator, one source of truth

`scripts/predicate.mjs` is now the canonical `evaluatePredicate(expr,
signals)`. It's pure ESM with no dependencies, and it recognizes exactly six
shapes:

```
path                — truthy (non-null, non-zero, non-empty-string; "0"/"false" also falsy)
!path                — falsy
path>=N / <=N / >N / <N — numeric comparison
path=v / path=v|w|x  — equals (or equals one of, pipe-delimited)
path!=v              — not equals
path~regex           — array-of-strings element matches regex (case-insensitive)
A & B                — AND of two or more atoms
```

`path` is dot-delimited into the flat `signalsSummary` object built by
`buildSignalsSummary()` in `scripts/run-assessment.mjs` — there's no nested
traversal beyond simple `key.key` chains, and a missing key reads as
`undefined`, which is falsy everywhere the DSL cares. Comparison operators are
matched longest-first (`>=` before `>`) so the regex doesn't misparse a
two-character operator as its one-character prefix. The evaluator never
throws: an unparseable regex on the RHS of `~`, a non-array LHS, or a
non-numeric comparison all resolve to `false` rather than raising.

`app/lib/assessment.ts` used to carry its own copy of this logic. It's now a
one-line re-export:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

`app/lib/__tests__/predicate-passthrough.test.ts` asserts the TS export and
the `.mjs` export are `toBe` — reference-equal, not just behaviorally
equivalent. A future contributor who "helpfully" pastes the implementation
back into the TS file to avoid a cross-directory import breaks this test
immediately. Per CLAUDE.md: when the DSL grammar evolves, edit
`scripts/predicate.mjs` (and the rubric's `$schema` comment) — never the TS
file.

## Ranking moved server-side

The second half of PR #106 is `scripts/rank-next-actions.mjs`, which exports
`rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)`. For every
`nextAction` on every rubric dimension, it:

1. Skips the action if it has no `action` text (malformed entries are dropped
   silently — the `remote` dimension's `missing-action-text` fixture case is
   the regression test for this).
2. Skips the action if `satisfiedWhen` is set and
   `evaluatePredicate(na.satisfiedWhen, signalsSummary)` returns `true` — the
   already-satisfied filter, now backed by the one real evaluator instead of
   a hand-rolled reimplementation.
3. Otherwise computes `rank = weight × deficit`, where `weight` comes from
   the dimension and `deficit` is `100 - score` (platform axis) or
   `100 - executionScore` (execution axis), whichever `axis` the action
   declares. An action with no `axis` field defaults to `"platform"` if it
   has a `satisfiedWhen` (config-checkable) and `"either"` if it doesn't
   (pure coaching, like "try the iOS app").

The full list is then sorted by a deterministic tie-break chain: `rank` desc
→ axis order (`platform` → `execution` → everything else, including unknown
axis strings) → `weight` desc → `dimId` alphabetical → `actionId`
alphabetical. `scripts/__tests__/rank-next-actions.test.mjs` pins every step
of this chain, including the named regression
(`loopCommandUses=14 excludes babysit-loop action`) and a determinism check
that running the ranker twice on identical inputs produces `toEqual` output.

`scripts/run-assessment.mjs` calls it once per `npm run assess`:

```js
rankedNextActions: rankNextActions(rubric, scoreMap, signalsSummary, 10),
```

The top-10 result is written straight into `assessment.json`, exposed on the
TS side as `Assessment.rankedNextActions: RankedNextAction[]`. Each entry
carries `dimId`, `actionId`, `axis`, `weight`, `deficit`, `rank`, `action`,
`effort`, `borisTip`, and `satisfiedWhen` (the raw predicate string, or
`null` for unpredicated coaching actions) — everything a downstream consumer
needs without re-deriving anything.

## What consumers do now

The `/self-assessment` SKILL.md no longer describes a filter-and-rank
algorithm at all. It just says: read `assessment.json.rankedNextActions[0..2]`
— "already filtered (satisfied actions dropped) and ranked by
`weight × deficit`." That's the whole instruction. There is no longer a code
path where a model (or a future contributor) can plausibly reimplement the
DSL and get the grammar wrong, because there's nothing left to reimplement —
the ranked, filtered, tie-broken list already exists on disk by the time
anything reads it.

`scripts/__tests__/run-assessment-ranking.test.mjs` covers the integration
seam directly: it runs `buildSignalsSummary` → `scoreAll` → `rankNextActions`
against the shared test fixtures (`makeSignals`/`makeRubric`) and asserts the
output is well-formed and stable across repeated calls — not just that the
unit-level ranker behaves, but that the whole pipeline from real signals to
a written `rankedNextActions` array holds together.

## Why this is the structural fix, not just a patch

The 2026-05-31 incident wasn't really a bug in the evaluator — the evaluator
was correct. It was a duplication problem: the DSL had one written
specification (the rubric's `$schema` comment) but no single enforced
implementation, so a caller under pressure could write something that looked
plausible and shipped wrong. PR #106 removes the duplication at both layers
that mattered: one evaluator (`scripts/predicate.mjs`, TS side proven
reference-equal by test) and one ranking pass (`rank-next-actions.mjs`, run
once server-side, consumed as pre-computed data everywhere else). Surfacing
an already-satisfied action as a next-action again would now require a bug in
`scripts/predicate.mjs` or `scripts/rank-next-actions.mjs` themselves — both
of which carry their own regression suites — rather than a bug in whichever
caller last needed a priority list.
