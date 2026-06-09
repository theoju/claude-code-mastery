---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/127
synthesized_into: []
doc_kind: decision
---

# Convention: verify plan steps with the actual consumer tool

**Adopted:** 2026-06-04  
**Applies to:** this repo, `theoju/advanced-data-import-system`, `theoju/engineering-docs-agent`

When a plan step produces a published artifact — a markdown link inside a built
docs site, a TypeScript import, a JSON Schema reference, an OpenAPI route — the
verification step must invoke the tool that **consumes** the artifact, not a
bare filesystem check.

```bash
# ✗ wrong — proves only that a file exists on disk
test -f docs/site-src/ops/runbooks/docker-push.md

# ✓ right — proves the artifact is valid from the consumer's perspective
mkdocs build --strict
```

## Why the filesystem check isn't enough

`test -f` passes as soon as the file exists. It doesn't know whether:

- the file's path is reachable from `docs_dir` (mkdocs strict mode rejects links
  outside the configured docs root, regardless of what's on disk),
- the TypeScript import resolves under the compiler's module resolution settings,
- the JSON Schema reference is actually valid under the configured `$schema`, or
- the OpenAPI route matches what the router registers at startup.

These mismatches are invisible to `test -f` and only surface when the consuming
tool runs — which, in a CI pipeline, is often not until a deploy job fails.

## The incident that prompted this rule

**ADIS PR #411** (2026 May, `theoju/advanced-data-import-system`) broke
docker-push for three days. Task δ.2 in the implementation plan verified a
runbook with `test -f`. The runbook existed on disk; the plan step passed. But
the published link to it from `docs/site-src/ops/runbooks.md` targeted a path
outside `docs_dir`, which `mkdocs build --strict` rejects. The deploy failed.
ADIS PR #416 closed the gap. PR #127 propagated the rule to this repo and to
`theoju/engineering-docs-agent` as a byte-identical CLAUDE.md addition,
verified by MD5 and three-way diff.

## What "actual consumer tool" means per artifact type

| Artifact type                     | Wrong check    | Right check                          |
| --------------------------------- | -------------- | ------------------------------------ |
| mkdocs link / published page      | `test -f`      | `mkdocs build --strict`              |
| TypeScript import / re-export     | `test -f`      | `npx tsc --noEmit`                   |
| JSON Schema reference (`$ref`)    | `test -f`      | `ajv validate -s schema.json …`      |
| OpenAPI route                     | `test -f`      | `npx swagger-cli validate openapi.yml` |
| Next.js page / API route          | `test -f`      | `npm run build`                      |

The pattern generalizes: if a downstream tool owns the validity contract, run
that tool. A filesystem check only satisfies the filesystem's contract.

## Applying this to plan authoring

When writing an implementation plan step whose output will be consumed by a
build or validation tool:

1. Name the consumer tool explicitly in the verification criteria — not
   "check that the file exists" but "run `mkdocs build --strict` and confirm
   exit 0."
2. Add the consumer tool invocation to the plan's verification checklist, not
   just the implementation step.
3. If the consumer tool isn't available in the environment (e.g., it's a
   deploy-only tool), note the gap and add a CI job that catches it instead of
   skipping verification.

The one-off cost of running the consumer tool in a plan step is low. The cost
of a half-verified plan landing is a deploy outage and a follow-up PR to
reopen already-closed work.
