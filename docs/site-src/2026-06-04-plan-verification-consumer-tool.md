---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/127
synthesized_into: []
doc_kind: decision
---

# Plan-step verification must use the actual consumer tool

## Decision

When a plan step produces a published artifact — a markdown link inside a
built docs site, a TypeScript import, a JSON Schema reference, an OpenAPI
route — the verification step must invoke the tool that actually consumes
that artifact (`mkdocs build --strict`, `npx tsc --noEmit`, `ajv validate`,
etc.), not a filesystem check like `test -f`.

This repo publishes its own mkdocs site under `docs/site-src/` (built by
`.github/workflows/docs-agent-pages.yml`, verified on every PR by
`.github/workflows/docs-build-check.yml`), so the same failure class applies
here. The rule is now recorded in this repo's `CLAUDE.md` under `## Hard
rules`, and is byte-identical (MD5-verified) to matching rules landed in two
sibling repos — this is a shared convention across the toolchain, not a
one-off local fix.

## Why

A filesystem path can resolve correctly on disk while still violating the
consuming tool's validity contract. `test -f some/path.md` only tells you the
file exists; it says nothing about whether a link *to* that file is valid
inside the tool that will actually render it.

The reference incident is in a sibling repo (ADIS PR #411): a plan step
verified a runbook link with `test -f`, which passed. The link's real
consumer — `mkdocs build --strict` — rejected it because the target sat
outside `docs_dir`. That one gap between "exists on disk" and "valid to the
consumer" broke docker-push on `main` for three days before the root cause
was found. It was closed by PR #416.

The asymmetry is the whole lesson: the cost of running the real consumer
tool in a plan-verification step is a one-off — a build command, a type
check, a schema validation. The cost of a half-verified plan landing is a
broken build on `main`.

## What this means in practice

- Docs-site links: verify with `mkdocs build --strict` (or the equivalent
  strict-mode build for whatever static-site generator is in play), not
  `test -f`.
- TypeScript imports: verify with `npx tsc --noEmit`, not a glob check that
  the imported file exists.
- JSON Schema references (e.g. this repo's `$schema` comment in
  `scripts/predicate.mjs`, or `app/data/rubric.json`'s schema-shaped
  contract): verify with a schema validator (`ajv validate` or equivalent),
  not a manual read-through.
- Anywhere else a plan step claims "this artifact is now valid" — ask which
  tool is the actual consumer of that artifact, and run that tool as the
  verification step.

## Status

This is a preemptive addition, not a response to an incident in *this*
repo — the failure hasn't happened here. It's recorded now because this
repo has the same shape of exposure (a built, strict-mode docs site) as the
sibling repo where the incident occurred, and the fix costs nothing to apply
ahead of time.

## Sources

- PR #127 (this repo): added the convention to `CLAUDE.md`.
- Reference incident: ADIS PR #411 (regression), closed by PR #416.
