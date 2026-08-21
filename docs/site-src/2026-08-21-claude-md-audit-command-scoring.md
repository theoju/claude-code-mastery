---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/196
synthesized_into: []
doc_kind: architecture
---

# CLAUDE.md audit: how the `commands` criterion scores

The CLAUDE.md health auditor (`scripts/claude-md-audit.mjs`) grades a
CLAUDE.md file against six weighted criteria that mirror the
claude-md-improver rubric — commands, architecture, patterns, conciseness,
currency, actionability, 20/20/15/15/15/15 out of 100. This page covers
`commands` (20 points), which was reworked in PR #196 / CCE-161 because the
old version measured the wrong thing.

## What it used to do, and why that was wrong

The previous scorer counted fenced code blocks that contained a recognized
tool keyword and paid 7 points per block, capped at 20. That rewarded the
wrong axis: consolidating three command blocks into one well-organized block
cost 14 of 20 points with the underlying content unchanged, so the metric
penalized exactly the refactor that makes a CLAUDE.md better. It also only
ever looked inside the CLAUDE.md file itself — commands documented in a
linked `.md` doc (the `.claude/rules/*.md` or `docs/*.md` indirection this
repo's own CLAUDE.md recommends via "route new guidance to the narrowest
tier") were invisible to the scorer no matter how thorough they were. A real
audit of an external repo's CLAUDE.md hit both problems at once: it scored
7/20 on commands, dragging the file to 83/B, despite documenting build/test/
run commands thoroughly in one well-organized fence plus 23 linked docs the
auditor never read.

## What it does now

`countCommandLines()` walks the file's fenced code blocks and counts actual
executable command lines — not fences. A line counts if it's inside a fence,
non-blank, not a `#` comment, and matches a known tool token (a leading `$ `
prompt is stripped before the check). The recognized token list
(`TOOL_TOKEN` in `scripts/claude-md-audit.mjs`) was also broadened in the
same PR to cover Python-first tooling — `uv`, `pytest`, `ruff`, `mypy`,
`alembic`, `prefect` — alongside the existing JS/Docker/git tokens, so a
Python repo documenting `uv run pytest` scores the same as a Node repo
documenting `npm test`.

Own-file command lines are worth 4 points each. Separately,
`extractDocRefs()` scans the CLAUDE.md for references to sibling `.md`
files, recognizing three syntaxes: a backticked path, a markdown link, and
an `@import`. `resolveLinkedCommands()` resolves each reference (first
against the CLAUDE.md's own directory, then against the target root),
reads the file if it exists, and runs it through the same
`countCommandLines()`. Linked command lines are worth half as much as
in-file ones — 2 points each — capped at 10 of the 20 possible points. The
half weight is deliberate: an agent that reads only CLAUDE.md never sees
what's in a linked doc, so the indirection is genuinely weaker than writing
the command in-file, but it's not worthless either.

The combined formula:

```
commands = min(20, ownLines × 4 + min(10, linkedLines × 2))
```

Own lines saturate the criterion at 5 (1→4, 2→8, 3→12, 4→16, 5+→20).
Fence count is irrelevant — one block of five commands scores identically
to five blocks of one command each, which is the fix for the fragmentation
problem described above.

Link resolution is bounded, since it's the one place this scorer does I/O
beyond the target file itself: `.md` files only, must resolve inside the
target root (no `../` escape — checked via `relative()` against the root),
at most 25 linked docs, at most 256 KB per doc, and files matching the
CLAUDE.md filename set (`CLAUDE.md`, `.claude.md`, `.claude.local.md`) are
skipped because they're audited in their own pass. A missing or unreadable
linked file is silently skipped rather than erroring — no credit, no crash.
Containment is checked textually, so a symlink inside the root that points
outside it would still be followed; that's an accepted tradeoff for a
report-only local auditor reading your own repos, not something meant to
withstand an untrusted tree.

## Where this plugs in

`resolveLinkedCommands()` runs at the I/O boundary in `auditTarget()`, which
computes `linkedCommandLines` per file and passes it into `scoreFile()` as
`opts.linkedCommandLines` — the function's new, optional 4th parameter
(default `0`). `scoreFile()` itself stays pure: it takes content, mtime,
and now, and returns a score. Every pre-existing 3-arg call site is
unaffected by the new parameter. Per-file results also carry `linkedDocs`
(how many linked files were actually read) and `linkedCommandLines` for
audit-trail purposes, alongside the existing `commandLines` field for
own-file count.

Calibrating against real files: the external repo whose CLAUDE.md motivated
this change went from 7/20 to 20/20 on the commands criterion (6 own
command lines) and 83/B to 96/A overall; this repo's own CLAUDE.md, which
already consolidated commands into one block (16 own command lines), scored
20/20 both before and after — the redesign doesn't regress a
well-documented file, it stops penalizing one.

## What didn't change

No probe, predicate, or `signalsSummary` field changed as part of this
work. `claudeMdExists` remains the only probe-backed CLAUDE.md signal, and
it's untouched — so this isn't a probe-tracker-sync change. The auditor
also remains report-only: it never writes to a CLAUDE.md file, regardless
of what `commands`, `architecture`, or any other criterion scores.

## Test coverage

Contract tests for this criterion live in
`scripts/__tests__/claude-md-audit-commands.test.mjs`, covering
`countCommandLines`, `extractDocRefs`, `resolveLinkedCommands`, and the
combined `scoreFile` formula — including the one-block-vs-five-blocks
equivalence and the linked-doc half-weight cap.
