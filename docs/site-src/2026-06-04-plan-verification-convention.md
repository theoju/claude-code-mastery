---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/127
synthesized_into: []
doc_kind: decision
---

# Plan-step verification must use the actual consumer tool

A new rule in this repo's project memory (`CLAUDE.md`, Hard rules): when a
plan step produces a published or consumed artifact, the verification step
for that task must invoke the tool that actually consumes the artifact —
not a filesystem existence check.

## The rule

> Plan-step verification must use the actual consumer tool, not just
> filesystem checks.

If a plan step produces a markdown link inside a built docs site, a
TypeScript import, a JSON Schema reference, or an OpenAPI route, the
verification step must run the real consumer — `mkdocs build --strict`,
`npx tsc --noEmit`, `ajv validate`, and so on — instead of a check like
`test -f`.

The reasoning: a filesystem path can resolve correctly on disk while still
violating the consumer's validity contract. `test -f some/path.md` tells you
the file exists; it tells you nothing about whether a docs build in strict
mode will accept a link pointing at it. mkdocs strict mode, for example,
rejects link targets outside `docs_dir` regardless of whether the file is
present somewhere on disk.

## Where it came from

The rule is root-caused from an incident in a sibling repo,
advanced-data-import-system: PR #411 broke that project's docker-push
pipeline. The plan's verification step for one task confirmed a runbook
file existed on disk (`test -f`), but the artifact's real consumer was a
docs link resolved by `mkdocs build --strict` — and that link target failed
strict-mode validation even though the file itself was present. The fix
landed in PR #416.

The cost asymmetry is the whole argument for the rule: running the real
consumer tool in a plan step is a one-off cost. A half-verified plan that
lands anyway is a deploy outage.

## Scope

This is a docs-only, cross-repo convention — it changed project memory, not
code, and landed simultaneously in three sibling repos: this dashboard
(`CLAUDE.md`, via PR #127), advanced-data-import-system (PR #417), and
engineering-docs-agent (PR #106). None of the three repos had a build
pipeline of their own to update; the change is a shared verification
discipline for how plan steps get written and checked going forward, not a
one-time fix to a specific artifact.

The practical takeaway for anyone authoring or reviewing a plan in any of
these repos: before marking a plan step's verification as passed, ask what
actually consumes the artifact the step produced, and run that thing.
