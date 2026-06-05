---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/127
synthesized_into: []
---

# Plan-step verification must use the real consumer tool

When a plan step produces a published artifact — a markdown link inside a
built docs site, a TypeScript import, a JSON Schema reference, an OpenAPI
route — the verification step for that task must invoke the tool that
_consumes_ the artifact, not a bare filesystem check.

```bash
# Wrong: passes even when the published link is broken
test -f docs/site-src/ops/runbooks/deploy.md

# Right: fails if mkdocs strict-mode rejects the link target
mkdocs build --strict
```

## Why the filesystem check isn't enough

A file can exist on disk and still violate the consumer's validity contract.
`mkdocs build --strict` rejects link targets that fall outside `docs_dir`,
regardless of whether `test -f` passes. TypeScript's `--noEmit` catches missing
or mis-typed imports that `test -f` never sees. A JSON Schema `$ref` can point
to a real file that isn't valid under `ajv validate`.

The cost of running the real consumer in a plan step is a one-off. The cost of
a half-verified plan landing in `main` is a broken build or a deploy outage
that takes days to untangle.

**Reference incident.** ADIS PR #411 introduced a runbook and added a link to
it from `docs/site-src/ops/runbooks.md`. Task δ.2 verified the runbook existed
with `test -f`. `mkdocs build --strict` rejected the link because the target
resolved outside `docs_dir`. Docker-push broke for three days before PR #416
closed it. The fix added `mkdocs build --strict` as the verification step.

## The rule

> **When a plan step produces a published artifact, the verification step
> must invoke the tool that consumes that artifact.**

Consumer tool examples by artifact type:

| Artifact                              | Consumer verification                         |
| ------------------------------------- | --------------------------------------------- |
| mkdocs page / cross-doc link          | `mkdocs build --strict`                       |
| TypeScript import or type reference   | `npx tsc --noEmit`                            |
| JSON Schema `$ref`                    | `ajv validate -s <schema> -d <sample>`        |
| OpenAPI route referenced by a client  | `npx openapi-generator validate -i <spec>`    |
| npm package import in an app          | `npm run build` or `npx tsc --noEmit`         |

A plan step that only uses `test -f`, `ls`, or a `cat` to confirm an artifact
is incomplete. Add the consumer invocation as the final check.

## Scope

This convention applies to plan steps authored in:

- `~/.claude/plans/` (personal plans)
- `docs/superpowers/plans/` (project plans in this repo)
- Any inline plan block inside a task description

It's enforced by convention, not by CI. When you review a plan PR, treat a
`test -f`-only verification step as a finding.

## Cross-repo canonical status

The same rule is in effect in the sibling repos that share this docs infra:

| Repo                        | PR    |
| --------------------------- | ----- |
| claude-code-self-assessment | #127  |
| engineering-docs-agent      | #106  |
| ADIS                        | #417  |

All three copies are byte-identical (MD5-verified). If you need to update the
rule, update it in all three.
