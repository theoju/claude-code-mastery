---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/127
synthesized_into: []
doc_kind: decision
---

# Plan-step verification: use the real consumer tool, not a filesystem check

## The rule

`CLAUDE.md` now carries a Conventions entry that applies to every plan you write
against this repo:

> Plan-step verification must use the actual consumer tool, not just filesystem
> checks. When a plan step produces a published artifact — a markdown link
> inside a built docs site, a TypeScript import, a JSON Schema reference, an
> OpenAPI route — the verification step must invoke the tool that consumes the
> artifact (`mkdocs build --strict`, `npx tsc --noEmit`, `ajv validate`, etc.),
> not `test -f`.

The text is byte-identical across three sibling repos — this one, ADIS
(advanced-data-import-system), and engineering-docs-agent — verified by MD5
and a three-way diff before it landed. That's deliberate: this is a
cross-project convention, not a one-off local fix, and the wording is meant to
travel unchanged.

## Why it exists

The rule is a direct response to an incident in ADIS, not something local to
this repo. ADIS PR #411 broke docker-push because a plan step verified a docs
link target with `test -f` — the path existed on disk, so the check passed.
The link's actual consumer was `mkdocs build --strict`, and mkdocs strict mode
rejects link targets outside its configured `docs_dir` regardless of whether
the file is physically present. The build failed for three days before anyone
caught it. The fix landed in ADIS PR #416; the convention that would have
caught it earlier got propagated here.

The reasoning generalizes past mkdocs: `test -f` (or any filesystem-existence
check) only proves a path resolves on disk. It says nothing about whether the
artifact is *valid* to the tool that will actually consume it — a build system
with a `docs_dir` boundary, a TypeScript compiler resolving an import, a
JSON Schema validator checking a `$ref`, an OpenAPI spec checking a route
against its own document. A plan step that only runs `test -f` can pass while
the published artifact is broken.

## Why it's relevant here

This repo publishes its own mkdocs site from `docs/site-src/`, built by
`.github/workflows/docs-agent-pages.yml` and verified on every PR by
`.github/workflows/docs-build-check.yml`. Any plan step that adds or edits a
docs-site page — including this one — and touches a cross-page link is exactly
the class of change the ADIS incident describes. `test -f target-file.md`
would confirm the file exists; only an `mkdocs build --strict` (or equivalent)
run confirms the link resolves within `docs_dir` the way the published site
actually needs it to.

## What this means when you write a plan step

If a plan step's output is a **published artifact** — something another tool
will parse, resolve, or build against — the verification step for that plan
task should invoke the consumer directly:

| Artifact type                          | Verify with                |
| --------------------------------------- | --------------------------- |
| Docs-site link (mkdocs)                 | `mkdocs build --strict`     |
| TypeScript import                       | `npx tsc --noEmit`          |
| JSON Schema reference                   | `ajv validate`              |
| OpenAPI route                           | the spec's own build/lint tool |

A filesystem check (`test -f`, `ls`, path existence in general) is not a
substitute for any of these — it verifies a weaker property than the one that
actually matters to the published artifact. The cost of running the real
consumer tool in a plan step is a one-off; per `CLAUDE.md`, the cost of a
half-verified plan landing is a deploy outage — which is exactly what happened
upstream in ADIS before this convention existed.
