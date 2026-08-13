---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/179
synthesized_into: []
doc_kind: decision
---

# Graphify artifacts and the tip-count disambiguation

Two recurring false alarms from the 2026-07-30 session are now codified as
`CLAUDE.md` Conventions entries, landed in PR #179. Both are the same shape
of problem: a number that looks contradictory on its face is actually
several different-but-correct numbers, and without a place to look them up,
every future reader — human or agent — re-raises the same alarm from
scratch. This page is the lens-facing digest; the full narrative sits in
the session retrospective at
[`docs/superpowers/retrospectives/2026-07-30-session-retrospective.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/retrospectives/2026-07-30-session-retrospective.md)
(not published to the docs site itself, since it carries machine-local
detail).

## "How many Boris tips?" — three correct answers

A `/graphify` extraction agent flagged the tip counts scattered across this
repo as a contradiction. They aren't — they're three counts of three
different things:

- **87** — the size of the upstream corpus advertised at
  howborisusesclaudecode.com. Cited in the `README.md` intro and the
  rubric-provenance line.
- **86** — how many numbered items the reference doc
  `docs/site-src/boris-tips-reference-2026-05-10.md` actually captures
  across its 10 threads.
- **75** — the tracked set this repo indexes in
  `app/data/boris-tip-index.json` and reports tracking status for. This is
  the only one of the three that's load-bearing for scoring:
  `app/data/rubric.json` next-actions currently cite 43 distinct
  `borisTip` numbers, a subset of the 75.

Before treating an apparent mismatch between two tip numbers as a bug, work
out which of the three a given sentence means. Re-deriving the wrong one
into a doc is how the numbers drift apart in the first place. A related,
deliberately-preserved gap: the classification doc's row numbers and the
reference doc's tip numbers diverge (row 44 is iMessage; reference tip 44
is Code Review), while `rubric.json` follows the reference numbering.

This joins an existing family of "name which count you mean" rules already
in `CLAUDE.md` — the probe-count Convention (catalog entries vs.
`satisfiedWhen` predicates vs. probes-page rows vs. tracker registry rows
vs. `signalsSummary` keys) is the closest precedent, and the same
discipline applies here: re-derive from the live file you actually mean,
never reuse one count where another was intended.

## `/graphify` structural artifacts on this repo

The same session ran the first `/graphify` knowledge-graph build of this
repo — 189 files, ~265k words, 4 parallel extraction agents, 450,179
tokens, landing at 1,424 nodes / 2,064 edges / 161 communities. Two of
those numbers are artifacts of this repo's data shape, not architecture
findings, and are now documented so a future build doesn't get
misdiagnosed:

- **Tip-index fragmentation inflates the community count.**
  `app/data/boris-tip-index.json` is an object of 75 uniform records; AST
  extraction fragments each record into its own 5-node community (`label`
  / `tab` / `topic` / `volume` + parent). That alone inflated the
  2026-07-30 build from roughly 87 real subsystems to 161 communities, and
  made the JSON's `tips` key the single largest node in the graph at 76
  edges — an artifact of the file's shape, not a hub in the codebase.
  Discount both before drawing conclusions, and treat that community
  family as one group rather than hand-naming 74 near-identical pieces of
  it.
- **Cross-chunk edges dangle and get silently dropped at build time.** The
  semantic (LLM) extraction pass runs one subagent per chunk, and agents
  freely emit edges pointing at concepts owned by a different chunk. The
  2026-07-30 build had 226 dangling-endpoint edges — about 10% of the
  2,309 raw edges extracted — all silently dropped by the time the graph
  was built (2,309 raw → 2,064 in the final `graph.json`). The health gate
  reports the dangling count at the extraction stage, while the built
  graph shows zero; the two numbers disagreeing is expected, not
  corruption. Treat graph edge counts as lossy-by-construction unless the
  corpus fits inside a single extraction chunk.

The same build also surfaced one edge worth naming as calibration rather
than a bug: an `OAuth Token Well-Formedness Assertion` ≈ `Posture vs Volume
Command Partition` similarity, flagged at INFERRED confidence and left in
the report deliberately — a nightly-workflow token gate and a
command-counting partition share no real problem domain, and it's a useful
data point for how much INFERRED noise to expect from future builds.

## Why this landed as a CLAUDE.md Convention rather than a one-off note

Both artifacts are specific to how this repo's data is shaped (a large
uniform JSON index; a corpus that doesn't fit in one extraction chunk), so
they'll reproduce on every future `/graphify` run against this repo, not
just the 2026-07-30 one. Writing them into `CLAUDE.md` Conventions — where
future readers, including automated ones, already look before raising an
"architecture finding" — closes the loop once instead of leaving it to be
rediscovered per build. The companion PR (#179) also corrected a stale
test-count fact in `CLAUDE.md` (564 tests / 39 files / ~5s → 695 tests / 48
files / ~3s), out of date after roughly 23% suite growth since it was last
written.
