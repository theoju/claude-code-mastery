---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
---

# Predicate evaluator & ranked next-actions

PR #106 closes a recurring bug class where the `/self-assessment` model
hand-re-implemented the `satisfiedWhen` filter logic and silently failed
to exclude already-satisfied actions from the priority list. The fix is
structural: one canonical evaluator in a Node-shareable module, one
pre-computed ranked list written to `assessment.json`, no in-skill
re-implementation possible.

## The bug that triggered this

Running `/self-assessment` reported _"Start with one loop: `/loop 30m /babysit`"_
as a top-3 priority even though `signalsSummary.loopCommandUses` was `14` —
satisfying the `satisfiedWhen: "loopCommandUses>=1"` predicate outright.

Root cause: the `satisfiedWhen` predicate DSL is a plain string
(`"loopCommandUses>=1"`). The skill instructed the model to "filter, then
rank," but the only evaluator that existed was
`app/lib/assessment.ts:evaluatePredicate` — TypeScript, Next.js-coupled by
location, unreachable from Node scripts. The model running the skill
hand-wrote a filter that expected an object shape instead of a string, fell
through every string predicate without evaluating it, and surfaced every
action as unsatisfied regardless of the actual signal values.

This is the `babysit-loop` named regression. The 30 new tests added in this
PR include a named regression test for it.

## What changed

### `scripts/predicate.mjs` — canonical evaluator

The evaluator is extracted from the TypeScript implementation into a pure
ESM module at `scripts/predicate.mjs`. It is the **single source of truth**
for the `satisfiedWhen` DSL. The full grammar it handles:

| Form              | Meaning                                               |
| ----------------- | ----------------------------------------------------- |
| `path`            | Truthy (non-null, non-zero, non-empty; `"0"` / `"false"` are falsy) |
| `!path`           | Falsy                                                 |
| `path>=N` / `<=N` / `>N` / `<N` | Numeric comparison           |
| `path=v` or `path=v\|w\|x`      | Equals one of                |
| `path!=v`         | Not equals                                            |
| `A&&B`            | Both operands true (evaluated recursively)            |
| `A\|\|B`           | Either operand true (evaluated recursively)           |
| `exists:path`     | Key is present and non-null in the signals object     |

Nothing in the grammar changed with this PR. The extraction is purely
structural.

### `app/lib/assessment.ts` — passthrough re-export

`evaluatePredicate` in `app/lib/assessment.ts` is collapsed to a one-line
re-export from `scripts/predicate.mjs`. The function signature is unchanged:
`evaluatePredicate(expr: string, signals: Record<string, unknown>): boolean`.

A CI equivalence test (`app/lib/__tests__/predicate-passthrough.test.ts`)
asserts that the TS re-export and the canonical ESM export are reference-equal.
A duplicate implementation fails CI.

### `scripts/rank-next-actions.mjs` — pre-computed ranker

A new module filters and ranks next-actions entirely on the Node side:

1. **Filter:** evaluate each next-action's `satisfiedWhen` against the current
   `signalsSummary` via the canonical evaluator. Drop satisfied actions.
2. **Rank:** sort the remainder by `weight × (target − score)` descending,
   i.e. high-weight dimensions with large deficits surface first.
3. **Tie-break:** a deterministic 5-tier tie-break (dimension weight →
   dimension id → action id → score deficit → action index) ensures the
   output is stable across runs with identical signals.
4. **Truncate:** emit the top 10 as `rankedNextActions`.

### `scripts/run-assessment.mjs` — wired in

Every `npm run assess` now calls the ranker after scoring and writes the
result to `assessment.json` as a top-level `rankedNextActions[10]` array.
The field is stable: no existing fields were changed.

### `app/lib/assessment.ts` — TypeScript interface

The `Assessment` interface gains a `RankedNextAction` type. It is threaded
through `loadAssessment` so the dashboard can consume the pre-computed list
if it chooses; today's dashboard render paths still evaluate predicates
fresh for per-action ✓/✗ marks on `/methodology/probes` and
`/dimensions/[id]` — that behaviour is unchanged.

### `.claude/skills/self-assessment/SKILL.md` — simplified

The skill's `Top 3 priority actions` section previously instructed the model
to filter and rank manually. That section is replaced with a direct read from
`assessment.json.rankedNextActions`. The model's job is now:

```
Read assessment.json → report rankedNextActions[0..2]
```

No filtering. No ranking. No DSL evaluation. The work is already done.

## Contract (CLAUDE.md hard rules)

Two hard rules are now pinned in CLAUDE.md:

> **Ranked next-actions live in `assessment.json.rankedNextActions`.** The
> self-assessment skill must NEVER hand-implement the `satisfiedWhen` filter or
> the weight×deficit ranking. Read the pre-computed top-10 from the written
> file.

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
> `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough
> re-export — never copy the implementation.

Surfacing a satisfied action as a TODO is a data-layer regression; fix
`rank-next-actions.mjs` or the underlying signal, not the skill.

## Files touched

| File | Change |
| ---- | ------ |
| `scripts/predicate.mjs` | **New** — canonical DSL evaluator (pure ESM) |
| `scripts/rank-next-actions.mjs` | **New** — filter + rank + truncate |
| `scripts/run-assessment.mjs` | Calls ranker; writes `rankedNextActions` to output |
| `app/lib/assessment.ts` | `evaluatePredicate` collapsed to 1-line re-export; `RankedNextAction` type added |
| `app/lib/__tests__/predicate-passthrough.test.ts` | **New** — CI equivalence test |
| `.claude/skills/self-assessment/SKILL.md` | Removes manual filter instructions; reads pre-computed list |
| `CLAUDE.md` | Two new hard rules pinning the contract |

30 new tests were added across the scorer and ranker, including the named
`babysit-loop` regression.

## See also

- Design spec: [`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-31-predicate-ranker-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-05-31-predicate-ranker.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/plans/2026-05-31-predicate-ranker.md)
- Probe coverage tracker: [`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-25-probe-implementation-status.md)
- Skill hub: [`.claude/skills/self-assessment/SKILL.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/.claude/skills/self-assessment/SKILL.md)
