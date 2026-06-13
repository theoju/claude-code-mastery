---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# satisfiedWhen DSL grammar

`satisfiedWhen` predicates are string expressions evaluated against `signalsSummary` to decide whether a next-action has already been met. When a predicate evaluates to `true`, the action is filtered out and never surfaced as a TODO.

## Background: the bug that exposed the gap

On 2026-05-31 a model running `/self-assessment` hand-wrote a filter that expected `satisfiedWhen` to be an object `{field, op, value}`. The rubric stores string predicates — e.g. `"loopCommandUses>=1"` — so the filter returned `null` for every entry, disabling filtering entirely. The result: the `/loop /babysit` action surfaced as a top-3 priority despite `signalsSummary.loopCommandUses = 14` satisfying its predicate outright.

The immediate fix (PR #104) added the grammar block below to the skill. The structural fix — extracting the canonical evaluator to `scripts/predicate.mjs` and pre-computing `assessment.json.rankedNextActions` so no model ever needs to re-implement the filter — is documented in the [predicate-ranker design spec](../superpowers/specs/2026-05-31-predicate-ranker-design.md).

## Grammar reference

All predicates are evaluated against `signalsSummary` (a flat-ish object of scored signals). `path` may use dot notation to reach nested fields.

| Form | Meaning |
|------|---------|
| `path` | Truthy: non-null, non-zero, non-empty-string. Strings `"0"` and `"false"` are also falsy. |
| `!path` | Falsy: the negation of the truthy check above. Missing field → `true` (path is falsy). |
| `path>=N` / `path<=N` / `path>N` / `path<N` | Numeric comparison. Missing signal treated as `0`. |
| `path=v` | String or numeric equality. |
| `path=v\|w\|x` | Equals one of. Whitespace around `\|` is stripped. |
| `path!=v` | Not equals. |
| `path~regex` | Array-of-strings: at least one element matches `regex` (case-insensitive). Non-array LHS → `false`. Unparseable regex → `false`. |
| `A & B` | AND of two or more atoms (arbitrary count, space-separated around `&`). |

Operator precedence: `&` is the only combinator; there is no `|` / `||` / `OR` at the expression level (use `path=v|w|x` for multi-value equality).

## Worked example

```
satisfiedWhen: "loopCommandUses>=1"
signalsSummary.loopCommandUses = 14
```

`loopCommandUses>=1` → `14 >= 1` → **true** → the action is filtered out. Do not surface as a TODO.

Contrast with a compound predicate:

```
satisfiedWhen: "skillCount>=3 & hasHooksDefined"
```

Both atoms must hold. If `skillCount = 5` but `hasHooksDefined = false`, the whole predicate is `false` and the action stays in the list.

## Canonical implementation

`app/lib/assessment.ts:evaluatePredicate` is the canonical evaluator as of PR #104. Once [PR 2 of 2](../superpowers/specs/2026-05-31-predicate-ranker-design.md) lands, the canonical location moves to `scripts/predicate.mjs` (a pure-ESM module with no Next.js coupling); `app/lib/assessment.ts` becomes a 1-line re-export passthrough.

**Hard rule:** never copy `evaluatePredicate` — the single-source-of-truth constraint is enforced by a reference-equality test (`app/lib/__tests__/predicate-passthrough.test.ts`). Any divergence fails CI.

## What changes in PR 2

Once `scripts/rank-next-actions.mjs` and `assessment.json.rankedNextActions` land:

- `npm run assess` writes a pre-computed, filtered, ranked top-10 list to `assessment.json.rankedNextActions`. Each entry carries `dimId`, `actionId`, `axis`, `weight`, `deficit`, `rank`, `action`, `effort`, `borisTip`, and `satisfiedWhen`.
- The `/self-assessment` skill reads `rankedNextActions[0..2]` directly. No model-side predicate evaluation is needed.
- The grammar block in `SKILL.md` (the PR #104 tactical stop-gap) is deleted as obsolete.

Until then, any code or skill that filters next-actions must use the grammar above verbatim — not infer the shape from field names or prior knowledge of predicate formats.

## Error handling

| Case | Behavior |
|------|----------|
| Unknown operator or parse error | `evaluatePredicate` returns `false` → action stays (conservative) |
| Signal field missing from `signalsSummary` | Treated as `0` / `false` → action stays |
| Regex unparseable on `~` | Atom returns `false` |
| Empty or whitespace-only expression | Returns `false` |
