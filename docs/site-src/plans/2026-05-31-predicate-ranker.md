---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Predicate-ranker: implementation plan

Pre-compute ranked next-actions server-side so `/self-assessment` reads
the result rather than re-implementing the filter at report time.

Design spec:
[`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-31-predicate-ranker-design.md)

---

## Problem

`/self-assessment` was surfacing already-satisfied actions as top priorities.
Root cause: lacking access to the canonical TypeScript `evaluatePredicate`
implementation (which lives in `app/lib/assessment.ts` and runs in the Next.js
runtime), the model hand-wrote a substitute filter. That substitute silently
skipped string-form predicates — anything other than a plain boolean — and
promoted satisfied items into the output.

The stopgap (PR #104) embeds the full DSL grammar in `SKILL.md` so the model
can evaluate string predicates correctly. The structural fix (this plan)
eliminates the re-implementation entirely by moving evaluation upstream.

---

## Two-PR delivery

| PR | Scope | Status |
|----|-------|--------|
| #104 — stopgap | Embed DSL grammar in `.claude/skills/self-assessment/SKILL.md`; model evaluates predicates from the documented grammar rather than improvising | ✅ merged |
| PR 2 — structural fix | Extract evaluator to `scripts/predicate.mjs`; pre-compute `rankedNextActions` in `run-assessment.mjs`; skill reads the pre-computed list | planned |

---

## PR 2: structural fix

### What changes

**1. Extract `scripts/predicate.mjs`**

Pull `evaluatePredicate` out of `app/lib/assessment.ts` into a new
Node-importable module at `scripts/predicate.mjs`. The TS file becomes a
one-line re-export — no logic duplication, one canonical implementation.

```
scripts/predicate.mjs        ← new: DSL evaluator
app/lib/assessment.ts        ← re-exports from scripts/predicate.mjs
```

**2. Pre-compute in `run-assessment.mjs`**

After scoring, call `scripts/rank-next-actions.mjs` (new helper) with the
full rubric and signals snapshot. It applies `evaluatePredicate` against every
`satisfiedWhen` field, filters satisfied items out, ranks the remainder by
`weight × deficit`, and returns the top N.

Write the result into `assessment.json` as `rankedNextActions`:

```json
{
  "rankedNextActions": [
    { "id": "...", "title": "...", "weight": 3, "deficit": 42, "score": 126 }
  ]
}
```

**3. Update the skill**

Replace the filter-and-rank block in `SKILL.md` with a single step:

```
Read app/data/assessment.json → rankedNextActions[0..2]
Report the pre-ranked list verbatim.
```

The model stops evaluating predicates entirely. If `rankedNextActions` is
missing (old `assessment.json`), fall back to the DSL grammar documented in
the stopgap.

### Files touched

| File | Change |
|------|--------|
| `scripts/predicate.mjs` | new — canonical DSL evaluator |
| `scripts/rank-next-actions.mjs` | new — filter + rank helper |
| `app/lib/assessment.ts` | `evaluatePredicate` → 1-line re-export |
| `scripts/run-assessment.mjs` | call ranker, write `rankedNextActions` |
| `app/data/assessment.json` (schema) | add `rankedNextActions` array |
| `.claude/skills/self-assessment/SKILL.md` | replace filter block with read step |
| `scripts/__tests__/` | unit tests for `predicate.mjs` and ranker |

### Acceptance criteria

- `npm run assess:print` output includes at most N unsatisfied actions, each
  with its `satisfiedWhen` evaluating to `false` against the current signals.
- No satisfied action appears in the top-N output.
- `app/lib/assessment.ts` contains no copy of `evaluatePredicate` logic —
  only a re-export from `scripts/predicate.mjs`.
- A CI test asserts the two are reference-equal (prevents future drift).
- The skill's filter block is gone; `/self-assessment` reads
  `rankedNextActions` directly.

### Order of operations

1. Write `scripts/predicate.mjs` — copy the existing TS implementation,
   translate to ESM, verify against the existing DSL grammar in `SKILL.md`.
2. Update `app/lib/assessment.ts` to re-export from step 1; run `npx vitest run`
   — all predicate tests must still pass.
3. Write `scripts/rank-next-actions.mjs`; add unit tests covering: all
   satisfied → empty output; mixed satisfied/unsatisfied → correct order;
   `weight × deficit` tie-break; `satisfiedWhen` missing → treated as
   unsatisfied.
4. Wire into `run-assessment.mjs`; verify `assessment.json` gains
   `rankedNextActions` after `npm run assess`.
5. Update `SKILL.md` — remove filter block, add read step, keep DSL grammar as
   reference for the fallback path.
6. Add the reference-equality CI test.

---

## Non-goals for this plan

- Changing the DSL grammar itself. The evaluator is extracted, not redesigned.
- Adding new next-action fields. The `rankedNextActions` shape is the minimum
  the skill needs: `id`, `title`, `weight`, `deficit`, `score`.
- Changing how the radar or dimension pages consume next-actions. Those
  surfaces read the existing `nextActions` structure and are not touched here.
