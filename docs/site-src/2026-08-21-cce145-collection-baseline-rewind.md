---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/202
synthesized_into: []
doc_kind: decision
---

# Collection baseline rewind (CCE-145)

The engineering-docs-agent nightly run tracks its own progress through this
repo's PR history with a single bookmark:
`last_successful_run.head_sha` in `.engineering-docs-agent/state.json`. Every
nightly cycle collects PR summaries for commits after that SHA, authors pages
for the ones with `doc_targets`, and then advances the bookmark past
whatever it processed — **whether or not every page was successfully
written.** That's the defect this rewind works around.

## What happened

The 2026-08-21 nightly run (workflow run `32460602658`, landed as PR #201)
processed five PRs and authored five pages, but two PRs blocked:

- **PR #198** (`2026-08-21-memory-execution-scorer-redesign-cce163.md`) was
  blocked by a CCE-145 linter false positive that has since been fixed
  upstream.
- **PR #196** (`2026-08-21-claude-md-audit-command-scoring.md`) was blocked
  by a genuine broken internal link in the drafted page.

Both PRs are legitimate `doc_targets` — the CLAUDE.md audit scoring rework
and the Memory Execution scorer redesign spec are both real, substantive
changes that deserve a page. But the collection bookmark still advanced past
them along with the rest of the batch. Because collection is bookmark-driven
rather than retry-driven, the next nightly run would never revisit that
window: both pages would stay permanently stranded behind an advanced
`head_sha`, with no future run ever re-collecting the PRs that back them.

## The fix

PR #202 rewound `last_successful_run.head_sha` in
`.engineering-docs-agent/state.json` from `17f30757` (the merge of PR #200,
the 0.9.20 release-bump PR) back to `017f671a` — the merge of PR #197,
one commit earlier, which is the parent of PR #196's merge. That's the
minimal rewind that reopens the collection window to include PRs #196,
#198, #199, and #200 without re-processing anything further back.
`state.json` on `main` now carries the rewound value in full
(`017f671a3f30a7a3a5bc620172cbeb86f6f74240`), confirming the merge landed
as intended.

The change is confined entirely to the docs-agent's own tracking state —
no application code, scorer logic, or user-facing behavior changed. Nothing
in `scripts/` or `app/` was touched.

## Why the rewind is safe

`state.json` already records per-PR summaries under `pr_summaries`, keyed
by `owner/repo#N`, each with a `fingerprint`. Re-collecting a PR whose
summary is already on file and unchanged is a no-op for that PR; only the
two previously-blocked doc targets (#196, #198) actually need new pages
authored. The other two PRs in the reopened window, #199 (the session
classifier fail-closed fix, CCE-164) and #200 (the 0.9.20 release digest),
already produced pages in the run that first advanced past them — rewinding
just means those two get reconsidered as well, which is expected collateral
of moving the bookmark rather than a targeted per-PR retry.

## Follow-up

This is a recovery step, not a structural fix. The underlying gap —
blocked doc targets get silently dropped once the bookmark advances past
them, with no automatic retry — is still open. A durable fix would track
per-PR authoring outcomes independently of the collection bookmark, so a
blocked page can be retried on the next run without a manual rewind like
this one.
