---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/127
synthesized_into: []
---

# Plan verification: use the consumer tool, not `test -f`

When a plan step produces a published artifact, the verification step must invoke the tool that *consumes* that artifact — not a filesystem existence check.

## The rule

If a plan step's output will be consumed by a build tool, compiler, or validator, the verification step must run that tool in its normal (or strict) mode. A file path can resolve correctly on disk while still violating the consumer's validity contract.

| Artifact type | Wrong verification | Right verification |
| --- | --- | --- |
| Markdown link in a mkdocs site | `test -f docs/site-src/ops/runbook.md` | `mkdocs build --strict` |
| TypeScript import | `test -f src/lib/foo.ts` | `npx tsc --noEmit` |
| JSON Schema `$ref` | `test -f schemas/widget.json` | `ajv validate -s schemas/widget.json -d sample.json` |
| OpenAPI route | `test -f openapi.yaml` | `npx @stoplight/spectral-cli lint openapi.yaml` |

## Why this exists

ADIS PR #411 broke docker-push for three days. A plan task (δ.2) verified a runbook existed on disk with `test -f`; the real consumer — `mkdocs build --strict` — rejected the published link from `docs/site-src/ops/runbooks.md` as pointing outside `docs_dir`. The file was real. The link was broken. The plan's verification step checked the wrong thing, and CI didn't catch it until deploy time.

ADIS PR #416 closed the incident. The convention landed as a hard rule in `CLAUDE.md` for this repo, the advanced-data-import-system repo, and the engineering-docs-agent repo — verified byte-identical across all three.

Since this repo publishes a mkdocs site under `docs/site-src/`, the same class of plan-verification bug is possible here.

## What counts as a "consumer tool"

Any tool that transforms or validates your artifact as part of a build or publish step:

- **mkdocs / Sphinx** — docs site builders; use `--strict` to surface broken link targets as hard errors rather than warnings
- **TypeScript compiler** — `npx tsc --noEmit` catches import resolution failures without emitting any output files
- **JSON Schema validators** — `ajv`, `jsonschema`, or similar; exercise the full `$ref` graph, not just top-level file existence
- **OpenAPI linters** — Spectral, `swagger-validate`; surface cross-file `$ref` failures and invalid path shapes
- **Bundlers** — `next build`, `vite build`; catch missing modules that `test -f` won't

If you're unsure which tool to use, ask: _"What fails in CI or at deploy time if this file disappears?"_ That's the tool to run in the verification step.

## Cost

Running `mkdocs build --strict` takes a few seconds inline. A broken link that reaches `main` can block deploys for hours and require a hotfix PR. The verification cost is a one-off per plan step; the remediation cost is not.

## Scope

This rule applies to artifacts with a **published consumer** — something downstream that will compile, link, or build against the file. Pure runtime data files (JSON config read at application startup, log files, scratch state) don't have a build-time consumer and a filesystem check is sufficient.

If the artifact is wired into a build step, run the build step.
