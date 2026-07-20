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
route — the verification step for that plan step must invoke the tool that
actually consumes the artifact, not a filesystem existence check.

Concretely: `mkdocs build --strict`, `npx tsc --noEmit`, `ajv validate`, and
equivalents in that family — not `test -f`.

This convention now lives in this repo's `CLAUDE.md`, byte-identical to the
same addition landing in the sibling `advanced-data-import-system` and
`engineering-docs-agent` repos.

## Why

A filesystem path can resolve correctly on disk while still violating the
consumer's validity contract. `test -f docs/site-src/ops/runbooks.md` passes
whether or not the link that points at it is actually valid mkdocs input —
mkdocs strict-mode rejects link targets outside `docs_dir` regardless of
whether the file exists somewhere on disk.

That gap is exactly what broke in the sibling ADIS repo: PR #411 broke
docker-push because a plan step verified a docs link target only via `test -f`
on disk. The link's real consumer, `mkdocs build --strict`, rejected the
target — three days of docker-push failures on `main` before the gap was
caught and closed by ADIS PR #416.

This repo also publishes an mkdocs site (`docs/site-src/`, built by
`.github/workflows/docs-agent-pages.yml`, verified on every PR by
`.github/workflows/docs-build-check.yml`), so the same class of
plan-verification bug is possible here. The rule is added proactively, ahead
of an actual incident in this repo, to guide future plan authors before it
happens rather than after.

## What this looks like in practice

If a plan step:

- adds or edits a markdown link inside `docs/site-src/` → verify with
  `mkdocs build --strict`, not `test -f <target>`.
- adds a TypeScript import → verify with `npx tsc --noEmit`, not a grep for
  the file's existence.
- adds or edits a JSON Schema reference → verify with a schema validator
  (`ajv validate` or equivalent), not a manual read-through.
- adds an OpenAPI route → verify with whatever tool actually resolves and
  lints the spec, not a check that the route's file exists.

The cost of running the real consumer tool in a plan step is a one-off; the
cost of a half-verified plan landing — as in the ADIS incident — is a deploy
outage.

## Where the rule lives

The canonical rule text is the "Plan-step verification must use the actual
consumer tool, not just filesystem checks" bullet under `## Conventions` in
this repo's `CLAUDE.md`. The underlying spec and plan that motivated the
original fix live in the sibling `advanced-data-import-system` repo and are
out of scope here; this page documents the convention as adopted in this
repo's workflow, not the ADIS incident's full remediation.
