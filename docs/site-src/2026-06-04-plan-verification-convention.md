---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/127
synthesized_into: []
---

# Plan-step verification: use the consumer tool, not `test -f`

A standing convention, landed in PR #127, requires every plan step that
produces a published artifact to verify it with the actual consumer tool —
not a filesystem existence check.

## The rule

> When a plan step produces a published artifact — a markdown link inside
> a built docs site, a TypeScript import, a JSON Schema reference, an OpenAPI
> route — the verification step must invoke the tool that consumes the artifact
> (`mkdocs build --strict`, `npx tsc --noEmit`, `ajv validate`, etc.),
> not `test -f`.

A file can exist on disk and pass `test -f` while simultaneously violating
the consumer's validity contract. `mkdocs build --strict`, for example,
rejects link targets that fall outside `docs_dir` regardless of whether the
target path resolves on the filesystem.

## Why this was codified

ADIS PR #411 broke a docker-push pipeline for three days. A plan task
confirmed a runbook existed using `test -f`; the verification passed. The
published link to the same runbook — from `docs/site-src/ops/runbooks.md` in
the built docs site — failed `mkdocs build --strict` because the link target
was outside `docs_dir`. The breakage wasn't caught until the deploy.

This repo publishes the same class of artifact (an mkdocs site under
`docs/site-src/`), making the same failure mode possible here. PR #127 lands
the rule as a permanent convention identical across this repo and two
sibling repos, enforced by an orchestrator MD5 three-way diff so the text
stays in sync.

## What counts as a "consumer tool"

| Artifact type                   | Consumer tool to run                 |
| ------------------------------- | ------------------------------------ |
| Markdown link in a docs site    | `mkdocs build --strict`              |
| TypeScript import or type       | `npx tsc --noEmit`                   |
| JSON Schema reference           | `ajv validate`                       |
| OpenAPI route                   | OpenAPI validator of your choice     |

If your plan step produces something not in this table, ask: _what is the
tool that would fail if this artifact were malformed?_ Run that tool.

## Applying this to plan authoring

When you write a task in a plan that ends with "verify the file exists" or
"check the path resolves," replace it with the specific consumer-tool
invocation. The one-time cost of running the real validator in a plan step
is always cheaper than a half-verified plan landing and breaking a
downstream deploy.

The incident reference (ADIS PR #411 / #416), the design spec, and the
recovery notes are in the ADIS repo. The convention text in `CLAUDE.md`
under **Hard rules → Plan-step verification** is the authoritative form in
this repo.
