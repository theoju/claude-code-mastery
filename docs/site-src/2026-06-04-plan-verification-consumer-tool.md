---
title: "Plan-step verification must use the actual consumer tool"
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
route — the verification step for that plan task must invoke the tool that
actually consumes the artifact, not a filesystem existence check.

Concretely: run `mkdocs build --strict`, `npx tsc --noEmit`, `ajv validate`,
or whatever the real consumer is. Don't settle for `test -f`.

This landed as a new convention bullet in `CLAUDE.md`, and it's not local to
this repo — the same rule landed byte-identically (MD5-verified) across three
sibling repos in the same cycle: advanced-data-import-system (PR #417),
engineering-docs-agent (PR #106), and this one (PR #127). No application code
changed in any of the three; each PR touched only its repo's own `CLAUDE.md`.
All three publish artifacts whose validity a filesystem check can't see, so
keeping the wording identical across repos matters — it's a shared planning
convention, not three independent decisions that happen to agree.

## Why

`test -f` answers "does the file exist at this path." That's not the question
a plan step usually needs answered. It needs to know whether the artifact is
*valid to its consumer* — and a path can resolve cleanly on disk while
failing the consumer's actual contract.

The reference incident is from ADIS (PR #411): a plan task's verification
step confirmed a runbook file existed on disk via `test -f`, but the runbook
was linked to from a docs page, and that link's real consumer was
`mkdocs build --strict` — which rejects link targets outside `docs_dir`
regardless of whether the file is present somewhere on the filesystem. The
filesystem check passed; the site build didn't. The break wasn't caught until
someone tried to push docker images off the back of that build, three days
later. It was closed out by a follow-up PR.

This repo has the identical exposure surface. `docs/site-src/` is built by
[`docs-agent-pages.yml`](https://github.com/theoju/claude-code-self-assessment/blob/main/.github/workflows/docs-agent-pages.yml)
and checked on every PR by
[`docs-build-check.yml`](https://github.com/theoju/claude-code-self-assessment/blob/main/.github/workflows/docs-build-check.yml).
A plan step that adds or moves a page and verifies it with `test -f` would
have the same blind spot ADIS hit: a link that resolves on disk but that
`mkdocs build --strict` would reject.

## What this means for plan authors

Match the verification tool to the artifact's actual consumer, not to what's
convenient to shell out to:

| Artifact                              | Wrong verification | Right verification         |
| -------------------------------------- | ------------------- | --------------------------- |
| Docs-site link (`docs/site-src/**.md`) | `test -f`            | `mkdocs build --strict`     |
| TypeScript import                      | `test -f`            | `npx tsc --noEmit`          |
| JSON Schema reference                  | `test -f`            | `ajv validate`              |
| OpenAPI route                          | `test -f`            | the spec's own validator    |

The cost of running the real consumer tool in a plan step is a one-off. The
cost of a half-verified plan landing — as in the ADIS case — is a deploy
outage discovered days later, once someone downstream tries to use the
broken artifact for something else.

## Scope note

This is a process-only change: no runtime code in this repo was touched.
`CLAUDE.md` is project memory, not docs-site content, so there's no
mkdocs-rendered page that mirrors it verbatim — this page exists to give the
decision a citable, indexed home in the published docs.
