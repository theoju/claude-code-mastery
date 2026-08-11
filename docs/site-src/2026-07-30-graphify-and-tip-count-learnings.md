---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/179
synthesized_into: []
doc_kind: decision
---

# Graphify and tip-count learnings (2026-07-30)

A `/graphify` knowledge-graph build of this repo on 2026-07-30 surfaced one
false alarm and two structural artifacts worth codifying so they don't get
re-flagged as bugs the next time someone runs the extraction — or re-litigated
by a future count audit. All three are now captured as `CLAUDE.md`
Conventions entries; this page gives them room to be explained properly. The
session narrative itself (scores, graph stats, a toolchain failure) lives in
a separate retrospective, `docs/superpowers/retrospectives/2026-07-30-session-retrospective.md`,
which is source-tree content, not part of the published docs site.

## "How many Boris tips?" has three correct answers

A `/graphify` extraction agent flagged the tip count as an internal
contradiction across the repo's docs. It isn't one — three different numbers
are each correct about a different corpus, and the fix was to name which
corpus each sentence means rather than force them to agree:

- **87** — the size of the *upstream corpus* advertised at
  howborisusesclaudecode.com. `README.md`'s intro and its rubric-provenance
  line cite this number because they're describing the source material, not
  this repo's coverage of it.
- **86** — how many *numbered items* the reference doc actually captures.
  `docs/site-src/boris-tips-reference-2026-05-10.md` transcribes 86 items
  across its 10 threads — one short of 87, because the reference doc is a
  transcription, not a re-count.
- **75** — the *tracked set* this repo indexes and reports status for, in
  `app/data/boris-tip-index.json`. This is the only one of the three that's
  load-bearing for scoring: `rubric.json` next-actions currently cite 43
  distinct `borisTip` numbers, a subset of the 75.

Before treating an apparent mismatch between these numbers as a bug, work out
which of the three a given sentence is describing — re-deriving the wrong one
into a doc is exactly how the numbers drift apart in the first place. A
related, deliberately unresolved gap: the classification doc's row numbers
and the reference doc's tip numbers diverge (row 44 is iMessage, reference
tip 44 is Code Review), while `rubric.json` follows the reference numbering.

## Two `/graphify` artifacts that aren't architecture findings

The same 2026-07-30 build — 1,424 nodes, 2,064 edges, 161 communities across
189 files — produced two shapes that read like real findings on first glance
and are actually artifacts of how the extraction handles this repo's file
layout.

**Tip-index fragmentation.** `app/data/boris-tip-index.json` is an object of
75 uniform records. AST extraction fragments each record into its own
5-node community (`label` / `tab` / `topic` / `volume` + parent), which
alone inflated the community count from roughly 87 real subsystems to 161,
and made the JSON's `tips` key the single largest node in the graph at 76
edges. That's an artifact of the file's shape — one object with 75
similarly-structured children — not a hub in the codebase's actual
dependency structure. Discount it accordingly, and label that family of
communities as one group rather than hand-naming 74 of them individually.

**Dangling semantic edges.** The semantic (LLM) extraction pass runs one
subagent per chunk, and agents freely emit edges pointing at concepts owned
by other chunks they never saw. The 2026-07-30 build had 226
dangling-endpoint edges out of 2,309 raw edges extracted — about 10% — all
silently dropped at build time (2,309 → 2,064 in the final `graph.json`).
The extraction-stage health gate reports the dangling count; the built graph
shows zero of them. Those two numbers disagreeing is expected, not a sign of
corruption partway through the build. Treat graph edge counts as
lossy-by-construction on any corpus that doesn't fit in a single extraction
chunk.

## What this changed

The corresponding `CLAUDE.md` PR (#179) also corrected a stale test-count
line in the project-memory header — 564 tests / 39 files / ~5s had drifted
to 695 tests / 48 files / ~3s as the suite grew, and the two Conventions
entries above were added alongside the fix. Narrative detail — the session's
Platform 92 / Execution 64 read, the graph build stats, and a Homebrew
toolchain failure that cost most of an afternoon — was kept out of
`CLAUDE.md` and moved to the dedicated retrospective instead; a terse rule
list is the wrong place for a session's blow-by-blow.
