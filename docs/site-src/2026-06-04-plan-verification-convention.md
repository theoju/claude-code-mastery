---
title: "Plan-step verification must use the actual consumer tool"
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/127
synthesized_into: []
doc_kind: decision
---

# Plan-step verification must use the actual consumer tool

PR #127 landed a new cross-repo engineering convention in `CLAUDE.md`, under
**Hard rules**:

> Plan-step verification must use the actual consumer tool, not just
> filesystem checks. When a plan step produces a published artifact — a
> markdown link inside a built docs site, a TypeScript import, a JSON Schema
> reference, an OpenAPI route — the verification step must invoke the tool
> that consumes the artifact (`mkdocs build --strict`, `npx tsc --noEmit`,
> `ajv validate`, etc.), not `test -f`.

This is a documentation-only change — no code in this repo shipped alongside
it — so there's no architecture or operations page to update. It's captured
here as a decision record instead.

## Why

A filesystem path can resolve correctly on disk while still violating the
consumer tool's validity contract. `test -f docs/site-src/ops/runbook.md`
tells you the file exists. It does not tell you whether a link pointing at
that file will resolve once the docs site is built, whether an import
resolves under the project's `tsconfig`, or whether a schema `$ref` is valid
against the spec it's embedded in. Those are different questions, and only
the consumer tool can answer the second one.

The rule's root-cause incident is external to this repo: ADIS PR #411 broke
`docker-push` because a plan task verified a runbook's existence with
`test -f`, but the runbook's link from a docs page failed `mkdocs build
--strict` — the link target resolved on disk but sat outside `docs_dir`,
which strict mode rejects. The runbook existed; the artifact it was linked
from was still broken. PR #416 closed it.

## What changed

Any plan step that produces a published artifact must verify it with the
tool that will actually consume it, not a filesystem existence check:

| Artifact kind                          | Wrong verification | Right verification         |
| --------------------------------------- | ------------------- | --------------------------- |
| A markdown link inside a built docs site | `test -f target.md` | `mkdocs build --strict`     |
| A TypeScript import                     | `test -f module.ts` | `npx tsc --noEmit`          |
| A JSON Schema reference                 | `test -f schema.json` | `ajv validate`             |
| An OpenAPI route                        | `test -f openapi.yaml` | the OpenAPI validator/linter for the route |

The cost framing in the rule is explicit: running the real consumer tool in
a plan step is a one-off cost; a half-verified plan landing and breaking a
build later is not.

## Scope

The convention is written once and applied identically across three repos —
this one, `advanced-data-import-system`, and `engineering-docs-agent`. The
orchestrator verified the rule text is byte-identical across all three via a
three-way MD5 diff before landing it, so there's a single canonical wording
rather than three drifting copies.

Nothing in this repo's scoring model, scripts, or app changed. If you're
writing or reviewing a plan (via `/ship`, a design-doc plan file, or an
ad-hoc task list) and a step's output is something another tool will parse
or build — link it up to that tool in the verification step, not to `ls` or
`test -f`.
