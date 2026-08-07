---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/179
synthesized_into: []
doc_kind: decision
---

# 2026-07-30: `/graphify` artifacts and the tip-count ambiguity

PR #179 is the companion to PR #178 (toolchain gotchas from the same
2026-07-25 → 2026-07-30 session). Where #178 covered the Homebrew PATH
failure, #179 closes out the remaining learnings: one stale fact and two
durable conventions worth keeping around so nobody re-derives them.

## The stale fact

`CLAUDE.md`'s `## Tests` section had drifted: it read 564 tests across 39
files at ~5s. The actual suite had grown to **695 tests across 48 files,
~3s**. Small thing, but a wrong test count in project memory is worse than no
test count — it looks authoritative right up until someone runs
`npx vitest run` and gets a different number. Fixed in place.

## Two `/graphify` artifacts, not architecture findings

The 2026-07-30 session ran the first `/graphify` build of this repo — 189
files, ~265k words, 4 parallel extraction agents, 450,179 tokens, landing at
1,424 nodes / 2,064 edges / 161 communities (see
`docs/superpowers/retrospectives/2026-07-30-session-retrospective.md` for the
full run). Two things fell out of that build that read like structural
findings but aren't:

1. **`app/data/boris-tip-index.json` fragments into inflated community
   counts.** It's an object of 75 uniform records, and AST extraction turns
   each into its own 5-node community (`label` / `tab` / `topic` / `volume` +
   parent). That alone inflated the build from ~87 real subsystems to 161
   communities, and made the file's `tips` key the single largest node in the
   graph at 76 edges. It's an artifact of the JSON's shape, not a hub in the
   codebase — discount it, and treat the 74 fragmented tip communities as one
   family rather than hand-naming each.
2. **Semantic-pass edges pointing at concepts owned by other chunks get
   silently dropped at build time.** The LLM pass runs one subagent per
   chunk, and agents freely emit edges toward things another chunk owns. That
   build had ~226 dangling-endpoint edges (~10% of 2,309 raw), all dropped
   before the final `graph.json` (2,309 → 2,064). The health gate reports the
   dangling count at the extraction stage while the built graph shows zero —
   the two numbers disagreeing is expected, not corruption. Treat edge counts
   as lossy-by-construction unless the corpus fits in a single chunk.

Both are now codified as `/graphify`-specific entries in `CLAUDE.md`'s
Conventions section, next to the existing probe-count and Boris-tip-count
disambiguation entries — same shape of problem: a tool's numbers need a
"what does this actually count" gloss before they're usable.

## "How many Boris tips?" — three correct answers

A `/graphify` extraction agent flagged the tip counts in this repo as
internally contradictory. They aren't — they're three different counts of
three different things, and the fix was to write down which sentence means
which number, the same way `CLAUDE.md` already disambiguates "how many
probes?":

- **87** — the upstream corpus size advertised at
  howborisusesclaudecode.com. This is the number in `README.md`'s intro and
  the rubric-provenance line.
- **86** — how many numbered items the reference doc
  `docs/site-src/boris-tips-reference-2026-05-10.md` actually captures across
  its 10 threads.
- **75** — the tracked set this repo indexes in
  `app/data/boris-tip-index.json` and reports tracking status for. This is
  the only one of the three that's load-bearing for scoring:
  `app/data/rubric.json` next-actions currently cite 43 distinct `borisTip`
  numbers, a subset of the 75.

Before treating an apparent mismatch between these as a bug, work out which
of the three a given sentence means. A related, deliberately-unresolved gap:
the classification doc's row numbers and the reference doc's tip numbers
diverge (row 44 is iMessage; reference tip 44 is Code Review), while
`rubric.json` follows the reference numbering. Re-deriving the wrong number
into a doc is exactly how these drift apart in the first place — this entry
exists so that doesn't happen again.

## Where the rest of the session lives

The scoring read (Platform 92 / Execution 64, Δ 28), the toolchain failure
diagnosis, and the follow-ups not taken are narrative context that doesn't
belong in a hard rule — they're in
`docs/superpowers/retrospectives/2026-07-30-session-retrospective.md`, which
is not published to this site (mkdocs builds from `docs/site-src/` only) but
is worth reading if you're trying to reconstruct what actually happened that
week.
