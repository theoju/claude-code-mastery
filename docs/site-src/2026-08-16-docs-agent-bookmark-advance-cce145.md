---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/190
synthesized_into: []
doc_kind: decision
---

# Advancing the docs-agent collection bookmark past the CCE-145 hold (PR #190)

PR #190 moves the engineering-docs-agent's collection bookmark forward to
commit `316cb691641c74b202b5e0ba78f04065460117b8`, ending a hold that had
been in place since 2026-08-13. The bookmark lives in
`.engineering-docs-agent/state.json`, under `last_successful_run` — the
`head_sha` and `completed_at` fields are the two values that move on every
advance. The file's schema and overall shape are unchanged by this PR; only
those two values change.

## Why there was a hold

The hold intentionally kept lint-blocked pages inside the nightly collection
range so they could land once a linter defect, tracked as CCE-145, was
fixed. It worked for one cycle: PR #187 landed 11 pages that had previously
been blocked.

## Why the hold was reversed

Re-collecting the same PR range on subsequent nights stopped being safe once
the topics in that range were already on `main`. The page-author step
generates a fresh, non-deterministic slug each time it runs, so re-running
collection over an unchanged range doesn't update the existing page — it
authors a new one under a different filename for the same topic. PR #189
would have added six duplicate pages this way. Separately, a page still
blocked by the CCE-145 defect (a false-positive `citation_exists` failure)
left stale nav and `SUMMARY.md` entries in the collection output, which
broke `mkdocs build --strict`.

Both failure modes get worse the longer the same range is re-collected, and
neither is a plausible trade for the marginal benefit of holding the
bookmark open. The hold had already delivered its win — the 11 pages in PR
#187 — so continuing to hold it provided no further upside, only the
growing duplication risk.

## What advancing the bookmark costs

Advancing the bookmark stops the duplication and the strict-build breakage,
but it also strands the topics that are still blocked by the CCE-145 linter
defect: they fall outside the collection range and won't be picked up by
the next nightly run. They aren't lost — the plan is to recover them in a
single future run using a since-sha override once CCE-145 is fixed, rather
than leaving the bookmark parked indefinitely to keep them in scope.

## Status

CCE-145 (the underlying linter defect) is still open. A follow-up recovery
run using a since-sha override is expected once it's resolved.
