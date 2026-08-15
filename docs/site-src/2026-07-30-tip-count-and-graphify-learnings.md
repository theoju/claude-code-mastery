---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/179
synthesized_into: []
doc_kind: decision
---

# Tip count and `/graphify` learnings — 2026-07-30

A 2026-07-30 `/graphify` run against this repo surfaced two things worth
writing down once so they stop looking like new bugs every time someone reruns
the tool: a tip-count discrepancy that reads as a contradiction until you name
which count you mean, and two structural artifacts of running graph extraction
against this repo's particular data shapes. Both are now codified as
Conventions entries in `CLAUDE.md`; this page restates them for readers
working from the docs site rather than repo memory.

## "How many Boris tips?" has three correct answers

Directly analogous to the repo's existing "how many probes?" disambiguation —
several numbers are all correct about different things, and treating one as
the answer to a question that meant another is how a doc drifts into
apparent self-contradiction.

| Count  | What it measures                                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| **87** | The *upstream corpus* advertised at howborisusesclaudecode.com — cited in the README intro and the rubric-provenance line. |
| **86** | How many *numbered items* the reference doc `docs/site-src/boris-tips-reference-2026-05-10.md` actually captures across its 10 threads. |
| **75** | The *tracked set* this repo indexes in `app/data/boris-tip-index.json` and reports tracking status for.                     |

Only the 75 is load-bearing for scoring: `app/data/rubric.json` next-actions
currently cite 43 distinct `borisTip` numbers, a subset of it. Before
"fixing" an apparent mismatch between these numbers, work out which of the
three a given sentence means — re-deriving the wrong one into a doc is how
they drift apart in the first place.

There's a related, deliberately unresolved gap worth knowing about if you're
cross-referencing tip numbers by hand: the classification doc's row numbers
and the reference doc's tip numbers diverge (row 44 is iMessage, reference
tip 44 is Code Review), while `rubric.json` follows the reference numbering.

## Two `/graphify` artifacts on this repo, not architecture findings

Running `/graphify` against this repo's own data files produces two
structural artifacts that look like real findings on first read and aren't.
Both are now flagged so a future extraction doesn't get re-investigated from
scratch.

**`boris-tip-index.json` inflates the community count and produces a false
hub.** The file is an object of 75 uniform records, and AST extraction
fragments each record into its own five-node community (`label` / `tab` /
`topic` / `volume` + parent). That inflated the 2026-07-30 build from roughly
87 real subsystems to **161 communities**, and made the file's `tips` key the
**#1 "god node" at 76 edges** — an artifact of the JSON's shape, not a hub in
the codebase. Discount both numbers, and treat that whole community family as
one group rather than hand-naming 74 near-identical entries.

**Roughly 10% of extracted edges are dangling by construction, and get
silently dropped at build time.** The semantic (LLM) extraction pass runs one
subagent per chunk, and agents freely emit edges pointing at concepts owned by
a *different* chunk. The 2026-07-30 build produced 226 dangling-endpoint
edges out of 2,309 raw (about 10%), all dropped when the graph is assembled
(2,309 → 2,064). The health gate reports the dangling count at the extraction
stage, while the built `graph.json` shows zero — the two numbers disagreeing
is expected, not corruption. Treat `/graphify` edge counts as lossy-by-
construction on any corpus that doesn't fit in a single extraction chunk.

## Housekeeping: test-suite count in `CLAUDE.md`

While auditing the two items above, `CLAUDE.md`'s test-suite reference was
also caught stale — it cited 564 tests across 39 files, which predated the
suite's growth to its current **695 tests across 48 files**
(`npx vitest run`). The command reference in `CLAUDE.md` now reflects the
current count.

## Why this is worth a page

None of this changes scoring behavior — no scorer, predicate, or rubric
target moved. The value is purely in not re-litigating the same two false
alarms the next time someone runs `/graphify` on this repo, or the same
"which 87/86/75 do you mean" thread the next time a tip number looks off.
Both are recorded as Conventions entries in `CLAUDE.md` for contributors
working in-repo; this page exists so the same context is reachable from the
docs site without needing local repo memory.
