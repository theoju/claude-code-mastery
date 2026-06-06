---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Predicate-ranker structural fix — design spec (2026-05-31)

Two-PR fix for a class of `/self-assessment` skill bugs where the model
re-implements the `satisfiedWhen` DSL filter instead of delegating to the
canonical evaluator, producing wrong top-N next-actions.

---

## The incident

On 2026-05-31 a model running `/self-assessment` hand-wrote a
`satisfiedWhen` filter that expected an object shape
`{ field, op, value }` instead of the string DSL (e.g.
`"loopCommandUses>=1"`). `evaluatePredicate` returned `null` for every
predicate, which the filter treated as unsatisfied — bypassing all
filtering entirely. Result: the already-satisfied `babysit-loop` action
surfaced as a top-3 priority despite `loopCommandUses = 14`.

This is a recurring bug class: the DSL is a compact string grammar, not
a structured object. Any consumer that hand-implements the filter is one
shape-mismatch away from the same failure.

---

## The DSL

`satisfiedWhen` predicates are strings. The canonical evaluator lives at
`app/lib/assessment.ts:evaluatePredicate` (a 1-line passthrough re-export
of `scripts/predicate.mjs`). Seven operator classes:

| Class          | Example                          | Meaning                               |
| -------------- | -------------------------------- | ------------------------------------- |
| `>=N`          | `loopCommandUses>=1`             | numeric field ≥ N                     |
| `>N`           | `hookEvents>0`                   | numeric field > N                     |
| `<=N`          | `permissionPrompts<=2`           | numeric field ≤ N                     |
| `<N`           | `gapDays<7`                      | numeric field < N                     |
| `==N` / `===N` | `activeAgents==3`                | numeric equality                      |
| `==true`       | `hasShipCommand==true`           | boolean / truthy field                |
| `==false`      | `autoApproveEnabled==false`      | boolean falsy / absent                |

**Worked example.** Given `signalsSummary.loopCommandUses = 14` and
predicate `"loopCommandUses>=1"`, the evaluator parses the field name,
operator, and threshold from the string, looks up `14` in the signals
object, and returns `true`. Any consumer that splits the predicate string
at the operator boundary and reads the left side as a key gets the right
answer; any consumer that expects `{ field: "loopCommandUses", op: ">=",
value: 1 }` will never find a matching key and will return `null`.

---

## Fix — two PRs

### PR #104 (tactical, docs-only) — shipped

Added a 12-line DSL grammar block to
`.claude/skills/self-assessment/SKILL.md` documenting all seven operator
classes with a canonical-implementation pointer to
`app/lib/assessment.ts:evaluatePredicate` and the worked example above.

This is a **stopgap**. It tells the model exactly what shape the DSL is
and where the evaluator lives, reducing the probability that the model
re-implements it incorrectly. It does not prevent a future mis-read.

The grammar block is explicitly temporary and will be removed when PR #2
lands and the skill degrades to a trivial reader.

### PR #105 (structural) — forthcoming

Move the filter and ranking logic out of the skill entirely:

1. **Extract `scripts/predicate.mjs`** as the single canonical DSL
   evaluator — the `app/lib/assessment.ts` re-export already points here;
   the `scripts/` side just needs to be the named source of truth.
2. **Pre-compute `assessment.json.rankedNextActions`** in
   `scripts/run-assessment.mjs`. The top-N filtered, weighted,
   deficit-ranked list is written into the assessment snapshot at score
   time, not reconstructed at read time inside the skill.
3. **Degrade the `/self-assessment` skill to a reader.** The skill reads
   `app/data/assessment.json.rankedNextActions` and formats the output.
   No filter, no ranking math, no predicate parsing — nothing the model
   can get wrong.

After PR #2 the grammar block in SKILL.md becomes dead documentation and
can be deleted. The DSL contract is still enforced at
`scripts/predicate.mjs` (and backed by unit tests), but the skill never
touches it.

---

## Why the root cause matters

The failure mode is **premature root-cause commitment** in the filter
layer: the model saw `satisfiedWhen` fields, assumed a structured-object
shape without reading the evaluator, and hard-coded that assumption into
the filter. The `/insights` report for this session called out exactly
this pattern.

The grammar block (PR #104) adds a speed bump. The pre-computed list
(PR #105) removes the surface entirely — a skill that reads a list can't
mis-implement a filter it never runs.

---

## Status

| Step                                   | Status        |
| -------------------------------------- | ------------- |
| Grammar block in SKILL.md              | ✅ Shipped — PR #104 |
| `scripts/predicate.mjs` extraction     | 🔜 PR #105    |
| `assessment.json.rankedNextActions`    | 🔜 PR #105    |
| Skill degraded to reader               | 🔜 PR #105    |
| Grammar block removed from SKILL.md   | 🔜 Post PR #105 |
