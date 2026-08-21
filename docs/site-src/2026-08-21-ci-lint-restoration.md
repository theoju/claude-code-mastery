---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/197
synthesized_into: []
doc_kind: decision
---

# CI and lint restoration (CCE-162)

Until PR #197, this repo had no CI gating code changes. The three docs-agent
workflows are path-gated to `docs/site-src/**`, so a PR touching `scripts/` or
`app/` merged with zero automated verification — confirmed empirically: PR
#196 landed with no checks at all. Separately, lint had been dead since the
Next 16 upgrade: `next lint` was removed from Next 16 with no replacement
wired up, so nothing in CI (because there was no CI) or locally ever caught
it.

## What shipped

`.github/workflows/ci.yml` adds a single `verify` job that runs on every pull
request and every push to `main`:

```
Install (npm ci) → Lint → Typecheck (tsc --noEmit) → Test (npm test) → Build (next build)
```

A `concurrency` group (`ci-${{ github.ref }}`) cancels superseded runs on the
same ref, and the job requests only `contents: read`. The install step relies
on `scripts/snapshot-boris-tips.mjs` being network-free: with no
`~/.claude/skills/boris/SKILL.md` present in the CI runner, it writes an empty
stub and exits `0`, so a fresh clone installs cleanly without needing a real
`~/.claude`. The test step likewise doesn't depend on a real `~/.claude` —
integration tests build their own temp `HOME` via
`scripts/__tests__/integration/_tmpHome.mjs`.

Restoring lint took more than pointing CI at an existing script, because
there wasn't one to point at:

- Added `eslint@^9.39.5` and `eslint-config-next@^16.3.1` as devDependencies —
  neither was previously installed.
- Added a flat `eslint.config.mjs` (Next 16's flat-config convention, since
  the old `next lint` subcommand is gone) that spreads
  `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`,
  and excludes build/vendor output (`.next/**`, `node_modules/**`,
  `coverage/**`, `out/**`, `build/**`, `dist/**`, `playwright-report/**`,
  `test-results/**`, `graphify-out/**`, `app/data/*.json`) plus non-source
  trees (`.claude/**`, `site/**`, `.venv*/**`, `*.min.js`).
- Repointed the `lint` script in `package.json` from the dead `next lint` to
  `eslint .`.
- Fixed the small number of real lint findings that surfaced once the
  ignore set excluded vendored/build directories.
- Fixed two pre-existing TypeScript errors that `next build` doesn't catch on
  its own — these had been sitting in the tree silently because nothing ran
  `tsc --noEmit` before this PR either.

The PR also updated this repo's own `CLAUDE.md` and several test files to
match the newly-clean lint/typecheck baseline; those are implementation
details of the same restoration, not separate changes.

## Why this shape

The workflow deliberately runs all four checks (lint, typecheck, test, build)
in one job rather than splitting them across jobs or making any of them
advisory. The point of CCE-162 was that a PR touching `scripts/` or `app/`
previously merged with *zero* automated verification of any kind — a partial
gate (say, tests only) would have left the exact failure mode (dead lint,
uncaught type errors) that motivated the ticket only half-fixed.

## What's still open

Landing `ci.yml` makes the checks run; it does not yet make them
*required*. The PR description notes a follow-up — adding a branch
protection rule that requires the new `verify` check before merge — as not
yet implemented. Until that rule exists, a PR can still merge on a red CI
run.
