# CLAUDE.md audit — `commands` criterion redesign

**Status:** implemented · **Ticket:** CCE-161 · **Date:** 2026-08-20

## Context

`scripts/claude-md-audit.mjs` scores the `commands` criterion (20 of 100) as:

```js
const commandHits = (content.match(/```(?:bash|sh|zsh|console|shell)?[\s\S]*?(?:npm|...|gh)\b[\s\S]*?```/gi) || []).length;
const commands = Math.min(20, commandHits * 7);
```

Three defects, all surfaced by a real audit of the `advanced-data-importer`
CLAUDE.md on 2026-08-20 (scored **7/20**, dragging the file to 83/B):

1. **Counts fences, not commands.** Consolidating three command blocks into one
   well-organized block costs 14 points with the content unchanged. The metric
   rewards fragmentation.
2. **Ignores linked rule/doc files.** The auditor globs only `CLAUDE.md`,
   `.claude.md`, `.claude.local.md` (`FILE_NAMES`). Extracting commands into
   `.claude/rules/*.md` or `docs/*.md` — the practice this repo's own CLAUDE.md
   prescribes ("route new guidance to the narrowest tier") — zeroes the numerator.
   The ADIS file references 23 `.md` docs, all present on disk, all invisible.
3. **Tool list too narrow.** `uv`, `pytest`, `ruff`, `mypy`, `npx`, `git`,
   `alembic`, `prefect` were unrecognized, so Python-first repos scored near zero
   regardless of how well documented they were.

Net effect: the criterion penalized exactly the refactor that improves a
CLAUDE.md. It measured a proxy (fence count) rather than the property
("does this file tell an agent how to build, test, and run?").

## Design

### Own-file scoring

`countCommandLines(content)` walks the file, tracks fence state, and counts
lines that are inside a fence, non-blank, not a `#` comment, and contain a
known tool token. A leading `$ ` prompt is stripped.

`commands = min(20, ownLines × 4 + min(10, linkedLines × 2))`

- 5+ own command lines → full 20. Linear and monotonic: 1→4, 2→8, 3→12, 4→16.
- Fence count is irrelevant. One block of five commands scores the same as five
  blocks of one.

### Linked-doc credit

`extractDocRefs(content)` collects `.md` references from three syntaxes —
backticked paths (`` `docs/foo.md` ``), markdown links (`[x](docs/foo.md)`),
and `@docs/foo.md` imports. `auditTarget` resolves each against the CLAUDE.md's
directory then the target root, and sums their command lines.

Linked lines count at **half weight, capped at 10** — deliberately partial. An
agent that reads only CLAUDE.md does not see them, so indirection is genuinely
weaker than in-file commands, but it is not worthless.

Bounds: `.md` only · must resolve inside the target root (no `../` escape) ·
max 25 files · max 256 KB per file · missing/unreadable files ignored silently ·
files matching `FILE_NAMES` skipped (they are audited on their own).

Containment is checked textually via `relative()`, so symlinks are not resolved:
a symlink inside the root pointing outside it would be followed. Acceptable for a
report-only local auditor reading the user's own repos; revisit if this ever scores
untrusted trees.

### Compatibility

- `scoreFile(content, mtimeMs, now)` gains an optional 4th param
  `opts.linkedCommandLines` (default 0). Existing 3-arg callers and all 17
  existing tests keep working; the function stays pure.
- Link resolution lives in `auditTarget` (the only I/O boundary).
- Per-file results gain `linkedDocs` and `linkedCommandLines` for audit trail.

## Not in scope

No probe, predicate, or `signalsSummary` change. `claudeMdExists` is the only
probe-backed CLAUDE.md signal (`probe-catalog.json:108`,
`rubric.json:248`) and is untouched, so the probe-tracker sync rule does not
apply to this change.

## Verification

Unit tests in `scripts/__tests__/claude-md-audit.test.mjs` plus an independent
adversarial test pass authored by a subagent. Calibration against two real
files: ADIS 6 own command lines (was 7/20 → 20/20), claude-extensions 16 own
command lines (20/20, unchanged).
