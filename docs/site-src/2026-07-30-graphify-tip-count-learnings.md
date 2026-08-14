---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/179
synthesized_into: []
doc_kind: decision
---

# 2026-07-30: `/graphify` artifacts and the Boris-tip count ambiguity

A single long-running session (opened 2026-07-25, closed 2026-07-30) ran the
full weekly `/insights` → `/refresh-insights` → `/self-assessment` chain,
built the first `/graphify` knowledge graph of this repo, and shipped two
PRs. The toolchain failure from that session (a Homebrew Intel→ARM PATH
break) is covered separately in `CLAUDE.md`'s Conventions section under the
"missing binary is a PATH bug" entry. This page covers the other durable
learnings: a stale fact that had drifted since it was first written, two
`/graphify` structural artifacts worth knowing before you trust a graph
extraction of this repo, and a recurring count ambiguity around "how many
Boris tips are there?"

## A stale fact, corrected

`CLAUDE.md`'s `## Tests` section had said **564 tests across 39 files,
~5s** since the line was first written. By 2026-07-30 the real numbers were
**695 tests across 48 files, ~3s** — about 23% suite growth that had
happened silently, PR by PR, while the doc kept quoting the original
snapshot. Nothing was wrong with the tests; the doc just hadn't been
re-derived. If you're updating a count like this in your own project memory,
re-run the command it claims to summarize (`npx vitest run`) rather than
trusting the line already there — the drift is invisible until someone
actually diffs the claim against reality.

## Two `/graphify` structural artifacts

The 2026-07-30 build ran `/graphify` against this repo for the first time:
189 files, ~265k words, 4 parallel extraction agents, 450,179 tokens,
producing 1,424 nodes, 2,064 edges, and 161 communities. Two of those numbers
are extraction artifacts, not architecture findings, and are now called out
explicitly in `CLAUDE.md`'s Conventions so a future `/graphify` run — or
anyone reading its output — doesn't mistake either for a real structural
signal in the codebase.

**Community fragmentation from a uniform-record JSON.** `app/data/boris-tip-index.json`
is an object of 75 uniform records (`label` / `tab` / `topic` / `volume` +
parent, per tip). AST extraction fragments each record into its own 5-node
community, which inflated the build from roughly 87 real subsystems to 161
communities and made the JSON's `tips` key the single highest-degree node in
the whole graph at 76 edges. That's the file's shape leaking into the graph,
not a hub in the codebase. Discount both numbers before drawing conclusions
about this repo's structure, and treat the 74 near-identical tip-record
communities as one group rather than hand-naming each.

**Dangling cross-chunk edges from per-chunk semantic extraction.** The
semantic (LLM) pass runs one subagent per chunk, and agents freely emit edges
pointing at concepts owned by a *different* chunk than the one they're
reading. The 2026-07-30 build produced 226 dangling-endpoint edges — about
10% of the 2,309 raw edges extracted — all silently dropped at build time
(2,309 → 2,064 in the final graph). The health gate reports the dangling
count at the extraction stage, while the built `graph.json` shows zero, so
those two numbers disagreeing is expected behavior, not corruption. Treat
edge counts from any `/graphify` run as lossy-by-construction unless the
whole corpus fits in a single chunk.

One more data point from the same build, useful for calibrating how much
noise to expect from the semantic layer rather than as a rule to codify: a
flagged `OAuth Token Well-Formedness Assertion` ≈ `Posture vs Volume Command
Partition` similarity at INFERRED confidence was spurious and left in the
report deliberately — a nightly-workflow token gate and a command-counting
partition share no problem domain. INFERRED-confidence edges need a human
sanity check before you act on them.

## "How many Boris tips are there?" — three correct answers

This had already caused one false-alarm triage — a `/graphify` extraction
agent flagged what looked like a self-contradicting corpus — before the
2026-07-30 session traced it to three numbers that are each correct about a
different thing:

| Number | What it counts | Where |
| --- | --- | --- |
| **87** | The upstream corpus advertised at [howborisusesclaudecode.com](https://howborisusesclaudecode.com) | `README.md` intro, rubric-provenance line |
| **86** | Numbered items actually captured across the reference doc's 10 threads | `docs/site-src/boris-tips-reference-2026-05-10.md` |
| **75** | The tracked set this repo indexes and reports scoring status for | `app/data/boris-tip-index.json` |

Only the 75 is load-bearing for scoring: `app/data/rubric.json` next-actions
currently cite 43 distinct `borisTip` numbers, a subset of the tracked 75.
Before "fixing" an apparent mismatch between two docs that each cite a tip
count, work out which of the three a given sentence means — re-deriving the
wrong one into a doc is how the numbers drift apart from each other in the
first place. One related gap is known and deliberately left unresolved: the
classification doc's row numbers and the reference doc's tip numbers diverge
(row 44 is iMessage, reference tip 44 is Code Review), while `rubric.json`
follows the reference doc's numbering. `CLAUDE.md`'s Conventions section
carries this as the canonical rule; this page is the narrative trail behind
it.

## Why this is worth a page instead of just a `CLAUDE.md` line

`CLAUDE.md` now carries terse, rule-shaped versions of both the `/graphify`
artifacts and the tip-count disambiguation, each anchored to this session as
the precedent incident. The rules are optimized for "don't repeat this
mistake"; this page is the fuller narrative — what ran, what it cost, what
was tried — for anyone who wants the context the rule form deliberately
leaves out.
