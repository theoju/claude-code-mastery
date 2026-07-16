---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate DSL grammar + ranked next-actions

**Date:** 2026-06-01
**Triggering PR:** [#104](https://github.com/theoju/claude-code-self-assessment/pull/104)

## The bug

On 2026-05-31, a `/self-assessment` run reported `Start with one loop: /loop
30m /babysit` as a top-3 priority action — despite
`signalsSummary.loopCommandUses` sitting at `14`, comfortably past the
action's own `satisfiedWhen: "loopCommandUses>=1"` gate. The action was
already satisfied and should have been filtered out.

Root cause: `SKILL.md` told the model to "first filter, then rank" the
rubric's next-actions, but left the actual filtering to the model's own
judgment. The rubric encodes `satisfiedWhen` as a **string DSL**
(`"loopCommandUses>=1"`), not a structured object. The model running the
skill assumed a `{field, op, value}` shape, wrote a filter against that
assumption, and — since no field in the rubric ever matched that shape —
the filter silently matched nothing. Every action, satisfied or not, passed
through untouched.

## Decision: a two-PR sequence

Rather than patch the one-off bug, the fix is split into a tactical stopgap
and a structural rework, so the correct behavior lands immediately without
waiting on the larger refactor:

1. **PR 104 (tactical, this PR).** Document the `satisfiedWhen` grammar
   directly inline in `.claude/skills/self-assessment/SKILL.md`, underneath
   the existing "Top 3 priority actions" bullet, so a model reading the
   skill evaluates predicates correctly by hand. Docs-and-spec only — no
   scoring code changes.
2. **PR 2 (structural, follow-up).** Extract the canonical evaluator
   (`evaluatePredicate`, currently `app/lib/assessment.ts`-only and
   Next.js-coupled by location) into a Node-shareable
   `scripts/predicate.mjs`. Pre-compute the filtered-and-ranked top-N list
   once in `run-assessment.mjs` and write it to
   `assessment.json.rankedNextActions`. The skill becomes a trivial reader
   of that field instead of an evaluator, and the PR 104 grammar block is
   deleted as obsolete.

The grammar block in PR 104 is explicitly transitional. It exists to give
the skill correct behavior for the interval between "bug found" and
"structural fix shipped," not as a permanent home for the DSL spec.

## The grammar (as documented in PR 104)

Seven operator classes, evaluated against `signalsSummary`:

| Form | Meaning |
| --- | --- |
| `path` | truthy (non-null, non-zero, non-empty; the strings `"0"` and `"false"` are also falsy) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals (or equals one of) |
| `path!=v` | not equals |
| `path~regex` | array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Canonical implementation at the time of PR 104: `app/lib/assessment.ts:evaluatePredicate`.

Worked example, the exact case that motivated this doc: `loopCommandUses>=1`
against `signalsSummary.loopCommandUses = 14` evaluates to **true** — the
action is satisfied, so it must be filtered out and never surfaced as a
TODO.

## What changes structurally (PR 2, for context)

The follow-up plan (`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`)
moves the DSL off the "model reads the grammar and hand-evaluates it" path
entirely:

- `scripts/predicate.mjs` becomes the one canonical evaluator; `app/lib/assessment.ts`
  keeps `evaluatePredicate` only as a one-line passthrough re-export, pinned
  by a reference-equality test so a future contributor can't accidentally
  fork the implementation.
- `scripts/run-assessment.mjs` computes `rankNextActions(rubric, scoreMap,
  signalsSummary, limit=10)` once per run and writes the result to
  `assessment.json.rankedNextActions`. Ranking sorts by `weight × deficit`
  descending, tie-broken by axis (`platform` → `execution` → `either`),
  then `weight`, then `dimId`, then `actionId` — deterministic across runs
  on identical machine state.
- `SKILL.md` is rewritten to read `assessment.json.rankedNextActions[0..2]`
  verbatim instead of filtering anything itself, and the PR 104 grammar
  block is deleted.

This is the shape the repo has since settled on: `CLAUDE.md`'s hard rules
now state plainly that `scripts/predicate.mjs` is canonical and
`app/lib/assessment.ts:evaluatePredicate` must remain a passthrough, and
that the skill must read the pre-computed `rankedNextActions` field rather
than re-implementing the filter — surfacing a satisfied action as a TODO
again would be a regression in the data layer, not the report.

## Why this shape

The dashboard's `/methodology/probes` and `/dimensions/[id]` pages
continue to evaluate predicates fresh, at request time, for per-action
✓/✗ marks — those render paths aren't touched by either PR. The new
`rankedNextActions` field exists for the skill, and any future Slack-post
or console consumer, so those surfaces stop re-deriving filtering logic
from scratch and instead read a value that was computed once, correctly,
in one place.
