---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/179
synthesized_into: []
doc_kind: decision
---

# Graphify tip-count learnings

On 2026-07-30 a `/graphify` extraction agent building the first knowledge
graph of this repo flagged the "how many Boris tips does this project
track?" numbers as a live contradiction, and separately produced two
misleading structural artifacts in the graph itself. Neither was a bug.
[PR #179](https://github.com/theoju/claude-code-self-assessment/pull/179)
captures both as durable project memory in `CLAUDE.md` so the same false
alarm doesn't get re-raised, and fixes a test-count claim that had drifted
stale in the same file.

## "How many Boris tips?" has three correct answers

The apparent contradiction was three different, individually correct
numbers being compared as if they measured the same thing:

| Number | What it counts | Where it comes from |
| --- | --- | --- |
| **87** | The upstream corpus advertised at howborisusesclaudecode.com | `README.md` intro and the rubric-provenance line |
| **86** | Numbered items actually captured across the 10 threads of the reference doc | `docs/site-src/boris-tips-reference-2026-05-10.md` |
| **75** | The tracked set this repo indexes and reports status for | `app/data/boris-tip-index.json` |

Only the 75 is load-bearing for scoring — `app/data/rubric.json`
next-actions currently cite 43 distinct `borisTip` numbers, a subset of
that 75. Before treating a tip-count mismatch as a bug, work out which of
the three a given sentence means; re-deriving the wrong one into a doc is
how the numbers drift apart in the first place. This joins an existing
family of "which count did you mean?" questions already documented in
`CLAUDE.md` — probe counts and test counts both have the same shape (a
single English phrase mapping onto several structurally different
numbers), and the fix is always the same: name which one, don't average
them into a rounder-sounding wrong answer.

A related, deliberately unresolved gap: the tip classification doc's row
numbers and the reference doc's tip numbers diverge — row 44 in the
classification doc is iMessage, while reference tip 44 is Code Review.
`app/data/rubric.json` follows the reference numbering, not the
classification doc's row numbers.

## Two known `/graphify` structural artifacts

The same session ran the first full `/graphify` build of this repo — 189
files, ~265k words, 4 parallel extraction agents. Two of its outputs are
artifacts of how the extraction pass handles this repo's shape, not
findings about the codebase's architecture:

**Uniform-JSON fragmentation.** `app/data/boris-tip-index.json` is an
object of 75 uniform records. AST extraction fragments each one into its
own five-node community (`label` / `tab` / `topic` / `volume` + parent),
which inflated that build from roughly 87 real subsystems to 161
communities and made the file's `tips` key the single largest node in the
graph at 76 edges. That's the file's shape leaking into the graph, not a
hub in the running code. Read graphs of this repo with that discount
applied, and treat the 74 near-identical tip-record communities as one
family rather than hand-naming each.

**Dangling cross-chunk edges.** The semantic (LLM) extraction pass runs
one subagent per chunk, and agents freely emit edges pointing at concepts
owned by a different chunk than the one they're reading. That build
produced 226 dangling-endpoint edges — about 10% of the 2,309 raw edges
extracted — which are silently dropped at build time (2,309 raw → 2,064 in
the built graph). The health gate reports the dangling count at the
extraction stage while the built `graph.json` shows zero, so those two
numbers disagreeing is expected, not corruption. Treat edge counts as
lossy-by-construction unless the whole corpus fits in a single extraction
chunk.

One flagged similarity edge in that build is worth naming as the opposite
case — genuinely spurious, and left in the report on purpose rather than
filed as a third artifact: an OAuth-token-well-formedness check and the
posture-vs-volume command partition were linked at INFERRED confidence
despite sharing no problem domain. It's useful calibration for how much
INFERRED-confidence noise a `/graphify` report can carry, but it isn't a
recurring structural pattern the way the two artifacts above are, so it
wasn't added to `CLAUDE.md` as a convention.

## Test-count correction

The same PR fixed a stale claim in `CLAUDE.md`'s `## Tests` section: it
still read "564 tests / 39 files / ~5s," about 23% out of date against the
actual suite. Current: **695 tests across 48 files, ~3s** via
`npx vitest run`. If you're citing the suite size from memory rather than
a fresh run, re-run it — this is the second time the number has drifted
silently between doc updates.

## Source

Full session write-up, including the assessment run and the toolchain
failure diagnosed the same day, is in
`docs/superpowers/retrospectives/2026-07-30-session-retrospective.md`
(not published to this site — it's machine-local detail). The durable
rules themselves live in the `## Conventions` section of `CLAUDE.md`.
