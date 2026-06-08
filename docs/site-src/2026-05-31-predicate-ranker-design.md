---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Predicate DSL and ranked next-actions — design note (2026-05-31)

**Problem class:** a model running `/self-assessment` mis-evaluated the
`satisfiedWhen` predicate format, surfaced already-satisfied next-actions as
top priorities, and gave the engineer a wrong to-do list.

This page documents what went wrong, the short-term guard shipped in PR #104,
and the structural fix that eliminates the class of error.

---

## What went wrong

The `/self-assessment` skill reads `assessment.json` and filters
`rubric.json`'s `nextActions` to find the highest-weight unsatisfied items.
To decide "satisfied or not," it evaluates each action's `satisfiedWhen`
field.

The model expected `satisfiedWhen` to be a structured object like
`{ field: "loopCommandUses", op: ">=", value: 1 }`. The rubric encodes it as
a **string expression**: `"loopCommandUses>=1"`. The evaluator received a
string, returned `null` for every predicate (treating every action as
unsatisfied), and the skill reported `babysit-loop` as a top-3 priority even
though the engineer had 14 loop command uses recorded in `assessment.json`.

The failure was silent: no parse error, no schema violation — just a wrong
output.

---

## The DSL format

Every `satisfiedWhen` value in `app/data/rubric.json` is a string expression.
The canonical evaluator is `app/lib/assessment.ts:evaluatePredicate` (or
its Node-side twin after PR 2 lands at `scripts/predicate.mjs`).

The grammar covers 7 operator classes:

| Class           | Example                                 | Meaning                                     |
| --------------- | --------------------------------------- | ------------------------------------------- |
| Numeric `>=`    | `"loopCommandUses>=1"`                  | field ≥ value                               |
| Numeric `>`     | `"sessionCount>5"`                      | field > value                               |
| Numeric `<=`    | `"permissionPromptRate<=0.1"`           | field ≤ value                               |
| Boolean true    | `"hasCustomAgents"`                     | field is truthy                             |
| Boolean false   | `"!hookEvents"`                         | field is falsy                              |
| Equality `===`  | `"effortLevel===max"`                   | field strictly equals value                 |
| Array includes  | `"enabledPlugins includes github"`      | array field contains the named element      |

A worked example: given `satisfiedWhen: "loopCommandUses>=1"` and
`assessment.json` containing `"loopCommandUses": 14`, the evaluator returns
`true` → the action is satisfied and must **not** appear in the ranked list.

---

## Short-term fix: grammar block in SKILL.md (PR #104)

PR #104 added a 12-line DSL reference block directly to
`.claude/skills/self-assessment/SKILL.md`. The block documents all 7
operator classes, points to `app/lib/assessment.ts:evaluatePredicate` as
the canonical implementation, and includes the worked example above.

This is a **temporary guard**. The grammar block will be removed once PR 2
ships the structural fix, because the skill will no longer need to
re-evaluate predicates at runtime.

---

## Structural fix design (PR 2)

The root cause is that the skill's model re-implements predicate evaluation at
runtime — which means it can drift from the canonical evaluator. The fix
removes that runtime re-evaluation entirely.

**Three changes:**

1. **Extract `evaluatePredicate` to `scripts/predicate.mjs`.** This makes the
   evaluator importable by Node scripts without pulling in the Next.js app
   boundary. `app/lib/assessment.ts:evaluatePredicate` becomes a 1-line
   passthrough re-export — same identity, no duplicate logic.

2. **Pre-compute the ranked list in `run-assessment.mjs`.** After scoring,
   `run-assessment.mjs` filters and sorts `rubric.json`'s `nextActions` using
   `evaluatePredicate` against the freshly computed `assessment.json` signals.
   The ranking formula is `weight × (1 − satisfiedRatio)` — highest-deficit
   first. The result is written to `assessment.json.rankedNextActions` (top N,
   default 10).

3. **Skill reads the pre-computed list.** The `/self-assessment` skill reads
   `rankedNextActions` directly from `assessment.json` instead of
   re-evaluating predicates. A satisfied action can never appear there because
   the scorer already filtered it out before writing the file.

**Contract after PR 2:**

```
assessment.json
└── rankedNextActions        ← top-N, pre-filtered, weight×deficit sorted
    └── [{ id, title, why, weight, satisfiedWhen, ... }, ...]
```

The skill must read `rankedNextActions` verbatim. Hand-implementing the
`satisfiedWhen` filter or the weight×deficit ranking in the skill is a
regression against this contract.

---

## Files

| Path | Role |
| ---- | ---- |
| `scripts/predicate.mjs` | Canonical DSL evaluator (Node-importable). PR 2. |
| `app/lib/assessment.ts:evaluatePredicate` | 1-line re-export of the above. |
| `app/data/rubric.json` | Source of `satisfiedWhen` expressions per next-action. |
| `scripts/rank-next-actions.mjs` | Filtered + sorted top-N builder; writes to `assessment.json`. |
| `.claude/skills/self-assessment/SKILL.md` | Temporary grammar block (removed in PR 2). |

---

## Related

- PR #104 — grammar guard + spec/plan for structural fix
- `app/data/rubric.json` — `satisfiedWhen` fields
- CLAUDE.md §Hard rules — "Ranked next-actions live in `assessment.json.rankedNextActions`"
