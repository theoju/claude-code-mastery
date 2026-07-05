---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate DSL grammar fix (PR #104)

## The bug

On 2026-05-31, a `/self-assessment` run reported `Start with one loop: /loop
30m /babysit` as a top-3 priority action — despite
`signalsSummary.loopCommandUses` being `14`, which should have satisfied that
action's `satisfiedWhen` predicate (`loopCommandUses>=1`) and dropped it from
the list entirely.

Root cause: `SKILL.md` instructed the model to "first filter, then rank" the
rubric's next-actions itself, but the canonical DSL evaluator
(`evaluatePredicate`) lived only in `app/lib/assessment.ts` — a TypeScript
file with no Node-side caller the skill could invoke. With no evaluator to
call, the model running the skill hand-wrote its own filter and got the shape
wrong: it assumed `satisfiedWhen` was a `{field, op, value}` object, when the
actual rubric encodes it as a compact string DSL (`"loopCommandUses>=1"`).
Every predicate silently evaluated to `null`, filtering no-opped across the
board, and an already-satisfied action surfaced as a TODO.

## The fix (this PR)

PR #104 is the **tactical** half of the fix: it inserts a 12-line grammar
block directly into `.claude/skills/self-assessment/SKILL.md`, beneath the
"Top 3 priority actions" instruction, documenting all seven operator classes
a `satisfiedWhen` string can use:

- `path` — truthy (non-null, non-zero, non-empty-string; the strings `"0"`
  and `"false"` are also treated as falsy)
- `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

The block points at the canonical implementation
(`app/lib/assessment.ts:evaluatePredicate`) and includes the worked example
that would have caught the original bug: `loopCommandUses>=1` against
`signalsSummary.loopCommandUses=14` evaluates to **true**, so the action must
be filtered out rather than surfaced.

This is documentation-only — no code changed, no tests were added, and the
underlying structural problem (no shared, Node-callable evaluator) is
untouched. It exists so a careful model reading the skill gets the grammar
right in the interim.

## Why this isn't the whole story

The design spec for the follow-up work
(`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`) frames PR
#104 explicitly as **PR 1 of 2** in a two-stage plan:

1. **Tactical (this PR):** document the grammar inline so the model stops
   guessing.
2. **Structural (follow-up):** extract `evaluatePredicate` into a
   Node-shareable `scripts/predicate.mjs`, pre-compute the filtered and
   ranked next-actions list once inside `run-assessment.mjs`, and write it to
   `assessment.json.rankedNextActions`. Once that field exists, the skill no
   longer evaluates predicates itself at all — it just reads
   `rankedNextActions[0..2]` — and the grammar block this PR adds becomes
   dead weight, to be deleted.

That follow-up has since landed. The evaluator now lives at
`scripts/predicate.mjs` as the single canonical source (`app/lib/assessment.ts`
re-exports it as a one-line passthrough, enforced by a reference-equality
test), and `.claude/skills/self-assessment/SKILL.md` reads pre-computed,
pre-filtered, pre-ranked entries straight out of
`assessment.json.rankedNextActions` rather than evaluating anything itself.
The grammar block this PR introduced is no longer in `SKILL.md` — it did its
job as a stopgap and was removed once the structural fix made it redundant.

## Why it's worth a page anyway

The bug class is the interesting part, not the one-file diff: asking a model
to reimplement a parser from memory, instead of giving it something to call,
is a reliable way to reintroduce exactly the parsing bugs the canonical
implementation already solved. The tactical/structural split here — ship a
correct-but-temporary fix immediately, then replace it with a shared-code fix
that makes the temporary one unnecessary — is a reusable pattern for any
"the skill re-derives logic that already exists in `scripts/`" bug.

## Related

- Design spec: `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`
- Hard rule: `scripts/predicate.mjs` is the canonical DSL evaluator; see the
  project's `CLAUDE.md` "DSL evaluator has one source" rule.
- Ranked next-actions contract: `CLAUDE.md`'s "Ranked next-actions live in
  `assessment.json.rankedNextActions`" rule.
