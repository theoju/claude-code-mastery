---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/204
synthesized_into: []
doc_kind: decision
---

# Docs-agent nightly run time budget: 2100s

PR #204 set `run.time_budget_seconds: 2100` in `.engineering-docs-agent/config.yml`,
capping how long a single engineering-docs-agent nightly run is allowed to
execute. If you're wondering why the budget isn't the plugin's 2700s default,
this page is the answer.

## The real ceiling isn't `timeout-minutes`

The GitHub App installation token the docs-agent workflow runs under has a
fixed **3600-second TTL**. That's the actual constraint on run length — not
the workflow's `timeout-minutes` setting. A run that outlives the token risks
having authoring, merge, or publish-verification stages fail mid-flight with
an authentication error, regardless of how much wall-clock budget the
workflow itself would otherwise allow.

## Why 2100s and not the 2700s default

`.engineering-docs-agent/config.yml` documents the arithmetic inline, and
it's exact at 2100s (`orchestrator_runner.py`, `AUTHORING_TTL_SAFETY_SECONDS`):

```
2100 × 1.15 (authoring overrun)                = 2415
2415 + 900 (merge.checks_timeout_seconds)      = 3315
3315 + 285 (post-run tail)                     = 3600
```

At the 2700s default, the same sum comes out to 4004 — over the 3600s token
TTL. When that happens, the authoring hard cap gets clamped flat to the
budget on every run, which reports `authoring_hard_cap_squeezed`. That
clamp is the actual cost of leaving the budget at 2700s: it removes the
overrun allowance that lets an in-progress PR group finish the PR it's in
the middle of. A group that gets cut mid-PR earns no baseline advance for
that cycle — the run does work but the pipeline doesn't credit it.

This wasn't theoretical. The squeeze was observed on both 2026-08-21 runs
(workflow runs 32460602658 and 32495019606), which is what prompted dropping
the budget to 2100s.

## Don't raise this back up

If you're tuning `run.time_budget_seconds` for this host, raising it above
2100 reintroduces the squeeze — the 1.15× authoring-overrun multiplier plus
the fixed 900s merge-checks timeout and 285s post-run tail push the total
back past the 3600s token TTL. The 2100s figure isn't a rough guess; it's
the value that makes the arithmetic land exactly at the ceiling with no
slack wasted and no overrun sacrificed.

*This page is a flat, dated note rather than filed under an operations or
decisions section — the core lens doesn't have one yet. Migrate it once
that structure exists.*
