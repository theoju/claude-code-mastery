---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/127
synthesized_into: []
---

# Plan-step verification: use the real consumer tool

When a plan step produces a published artifact — a docs-site link, a
TypeScript import, a JSON Schema reference, an OpenAPI route — the
verification step must invoke the tool that actually _consumes_ that
artifact, not just check that the file exists on disk.

```bash
# Wrong — passes even when the link is outside docs_dir
test -f docs/site-src/ops/runbooks.md && echo ok

# Right — the publisher rejects the broken link
mkdocs build --strict
```

```bash
# Wrong — file present, but the import may be invalid
test -f src/lib/client.ts && echo ok

# Right
npx tsc --noEmit
```

## Why the rule exists

ADIS PR #411 broke `docker push` on `main` for three days. Task δ.2 used
`test -f` to confirm a runbook existed on disk. The file was there. But the
link from `docs/site-src/ops/runbooks.md` to that runbook pointed outside
`docs_dir`, and `mkdocs build --strict` rejected it. The filesystem check
passed; the consumer tool would have caught the breakage before merge.

This repo publishes a mkdocs site under `docs/site-src/`. The same failure
class is possible any time a plan step adds a cross-link between pages.

## The convention

> **Plan-step verification must use the actual consumer tool, not just
> filesystem checks.**

When a plan step produces a published artifact, the verification step must
invoke the tool that consumes the artifact — `mkdocs build --strict`,
`npx tsc --noEmit`, `ajv validate`, etc. — rather than `test -f`.

A filesystem path can resolve correctly on disk while violating the
consumer's validity contract. The cost of running the real tool in a plan
step is a one-off. The cost of a half-verified plan landing in `main` can
be a deploy outage.

## Artifact types and matching consumer tools

| Artifact                          | Consumer tool                          |
| --------------------------------- | -------------------------------------- |
| mkdocs cross-link / nav entry     | `mkdocs build --strict`                |
| TypeScript import / re-export     | `npx tsc --noEmit`                     |
| JSON Schema `$ref`                | `ajv validate` or schema-lint tooling  |
| OpenAPI `$ref` / path             | `npx @stoplight/spectral-cli lint`     |
| Next.js dynamic route (`[id]`)    | `npm run build` (catches missing params) |

When in doubt, ask: _what tool would reject a broken version of this
artifact at CI time?_ Use that tool in the plan step.

## Applying this to docs-site changes in this repo

For any plan step that adds or modifies a page under `docs/site-src/`:

```bash
# Verify the docs build passes before the plan step is marked done
cd /path/to/repo
mkdocs build --strict --config-file mkdocs.yml
```

The `--strict` flag converts warnings (unknown anchor, file not in
`docs_dir`, orphaned page) into errors, which is the right gate for a
plan verification step. A passing `test -f` on the source file is not
sufficient.
