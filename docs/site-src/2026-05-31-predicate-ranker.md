---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate evaluator extraction and ranked next-actions (PR #104)

## Problem

The `/self-assessment` skill instructs the model to filter satisfied
next-actions before ranking. Doing that correctly requires evaluating
`satisfiedWhen` predicates — string expressions like `loopCommandUses>=1` —
against the current signals snapshot.

Because the canonical evaluator lived only in TypeScript inside the Next.js
app, no Node-side caller existed. Models running the skill guessed the schema.
The most common guess was an object form:

```js
// what the model assumed
{ field: "loopCommandUses", op: ">=", value: 1 }
```

The actual format is a plain string:

```
"loopCommandUses>=1"
```

The evaluator returned `null` for every predicate. With all filtering
suppressed, already-satisfied actions surfaced as top-three priorities. In one
observed instance, the babysit-loop action appeared as high-priority despite
`loopCommandUses=14` — clearly above threshold. The skill produced confident
but wrong output on every run.

## Why the evaluator lived only in TypeScript

`satisfiedWhen` was added as a rubric field evaluated at dashboard render time.
No one needed to call it outside the browser, so no separate module was
created. The skill was written later and assumed the evaluator was accessible
— it wasn't.

## Fix: two parts

### Part 1 — tactical (ships in PR #104)

`SKILL.md` now documents the DSL grammar inline:

- Supported operators: `>=`, `<=`, `>`, `<`, `===`, `!==`, `==`, `!=`
- Format: `"<field><op><value>"` — always a string, never an object
- Example: `"loopCommandUses>=1"`, `"hookCount>=3"`

This lets a model evaluate predicates correctly while the structural fix is in
progress. It is a stopgap, not the durable solution.

### Part 2 — structural (design in PR #104, implementation follows)

Two changes eliminate the re-implementation risk permanently:

1. **Extract `scripts/predicate.mjs`** — the evaluator becomes a Node-importable
   CommonJS/ESM module that both the Next.js app and the scorer can call. The
   TypeScript side becomes a one-line re-export; a passthrough test asserts
   reference equality so divergence fails CI.

2. **Pre-compute `assessment.json:rankedNextActions`** — `run-assessment.mjs`
   runs the filter-and-rank pass at score time and writes the top-N list to the
   generated file. The skill reads the pre-computed list instead of
   re-implementing the ranking logic.

After this lands, the skill is a reader: `npm run assess` → read
`rankedNextActions[0..2]` from `assessment.json`. No predicate evaluation in
the skill layer, no schema guessing.

## Invariants established

- `scripts/predicate.mjs` is the single canonical evaluator. The TypeScript
  re-export must not duplicate the implementation.
- `assessment.json` is the source of truth for the ranked list. The skill must
  never hand-implement the `satisfiedWhen` filter or the weight×deficit ranking.
- Surfacing a satisfied action as a TODO is a regression — fix the data layer,
  not the skill.

## Files changed

| File | Change |
| ---- | ------ |
| `.claude/skills/self-assessment/SKILL.md` | Inline DSL grammar documentation (Part 1 stopgap) |
| `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md` | Structural design spec |
| _(implementation PR TBD)_ | `scripts/predicate.mjs`, scorer integration, `rankedNextActions` in `assessment.json` |
