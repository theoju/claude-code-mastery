---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/127
synthesized_into: []
doc_kind: decision
---

# Decision: plan-step verification must use the consumer tool, not `test -f`

## The rule

When a plan step produces a **published or consumed artifact** — a markdown
link inside a built docs site, a TypeScript import, a JSON Schema reference,
an OpenAPI route — the verification step for that task must invoke the tool
that actually **consumes** the artifact, not a filesystem-only check.

Concretely: `mkdocs build --strict`, `npx tsc --noEmit`, `ajv validate` — not
`test -f`.

This repo publishes its docs site via mkdocs (see the "Docs site (mkdocs)"
section of `CLAUDE.md`), so the failure class below applies here directly:
any plan that adds a page under `docs/site-src/` and links to it from
elsewhere in the site should have its link verified with `mkdocs build
--strict`, not a bare existence check.

## Why

A filesystem path can resolve correctly on disk while still violating the
consuming tool's validity contract. `test -f some/path.md` only proves the
file exists — it says nothing about whether the *link* to it is valid inside
the built site, whether an import resolves under the project's `tsconfig`
module rules, or whether a `$ref` matches the schema's actual shape.

mkdocs strict mode is the concrete case that forced this rule: it rejects
link targets that fall outside `docs_dir`, independent of whether the target
file exists somewhere in the repo. A plan step that checks the file is on
disk can pass while the actual publish step (`mkdocs build --strict` in
`.github/workflows/docs-build-check.yml`) fails.

## Reference incident

ADIS PR #411 broke `docker-push` because a plan task's verification step
ran `test -f` against a runbook file to confirm it existed, instead of
building the docs site. The runbook existed on disk, so the check passed —
but the published link to it from the docs source failed mkdocs's
strict-mode build. The break went undetected until someone tried to push a
docker image, three days of failing `docker-push` runs later. It was closed
by ADIS PR #416.

## Where this is codified

The rule is now a standing convention in `CLAUDE.md`, byte-identical across
three sibling repos — this one, `advanced-data-import-system`, and
`engineering-docs-agent`:

> Plan-step verification must use the actual consumer tool, not just
> filesystem checks. When a plan step produces a published artifact — a
> markdown link inside a built docs site, a TypeScript import, a JSON
> Schema reference, an OpenAPI route — the verification step must invoke
> the tool that consumes the artifact (`mkdocs build --strict`, `npx tsc
> --noEmit`, `ajv validate`, etc.), not `test -f`.

Applied to this repo's own plans: any task that adds or edits a
`docs/site-src/**` page and links to it should verify with
`mkdocs build --strict` (the same build `.github/workflows/docs-build-check.yml`
runs on every PR) before the task is marked done — not a `test -f` against
the new file's path.

## Takeaway for future plan authors

The cost of running the real consumer tool in a plan step is a one-off. The
cost of a half-verified plan landing — as in the ADIS incident — is a
production outage discovered downstream of the change that actually caused
it.
