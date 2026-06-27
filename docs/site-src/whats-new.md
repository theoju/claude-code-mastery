---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
doc_kind: decision
---

# What's New

The engineering-docs-agent appends entries here on each nightly run
when it detects merged work worth surfacing in a user-facing
changelog. Most entries are written by the agent and reviewed via
the `docs-agent/YYYY-MM-DD` PR.

---

## 2026-06-27T08:06:33.986169+00:00
- PR #101: PR #101 adds a new Conventions entry to CLAUDE.md documenting the `/progression` timeline's dual-source milestone architecture. It explains that telemetry detectors (`scripts/progression.mjs`) self-date milestones from session `start_time` across full history, while config detectors (`scripts/config-progression.mjs`) stamp `firstSeenAt` at first-observed and freeze it — producing the identical `2026-05-09T08:37:16.111Z` timestamp on all 8 config milestones by design. It also records the coverage gap where 3 of 12 scored dimensions (`scheduled`, `remote`, `verification`) have no milestone detector. Additionally, it fixes two file-map errors: adds the missing `config-progression.mjs` entry and corrects a stale comment on `app/progression/page.tsx`. No code was changed; this is a documentation-only PR.
- PR #100: Onboards the claude-code-self-assessment repository onto the engineering-docs-agent plugin by adding a host config file (`.engineering-docs-agent/config.yml`) using `framework: none`, seeding `state.json` and `state.example.json`, and wiring up a nightly GitHub Actions workflow (`.github/workflows/docs-agent-nightly.yml`). A previously added synthetic mkdocs scaffold (`mkdocs.yml`, `requirements-docs.txt`) was removed after CCE-64 introduced `framework: none` as a first-class config value. The `.gitignore` was updated to track the committed config and state files while continuing to ignore `current_run.json`. With this setup all doc-agent pipeline stages run normally except `framework_build` lint (skipped with a `framework=none` reason) and `publish-verifier` (skipped because `publishing.base_url` is null).
- PR #102: Corrected the `dismissed_gap_flags` field in `.engineering-docs-agent/state.json` from an empty JSON array (`[]`) to an empty JSON object (`{}`). The plugin's state schema requires this field to be a keyed object (`{owner}/{name}#{pr}` → value), not an array. The one-character diff unblocked the docs-agent nightly, which had been exiting with code 2 within ~0.2s at the schema-validation step, before any subagent could dispatch.
- PR #104: PR #104 adds a tactical DSL grammar reference block to the /self-assessment skill (SKILL.md) documenting all 7 satisfiedWhen operator classes, with a pointer to the canonical evaluator at app/lib/assessment.ts:evaluatePredicate and a worked example. It also ships the design spec and implementation plan for the structural follow-up (PR 2) that will extract evaluatePredicate to scripts/predicate.mjs and pre-compute ranked next-actions into assessment.json.rankedNextActions, eliminating the 'model re-implements the DSL' bug class permanently.
- PR #106: Extracts `scripts/predicate.mjs` as the single canonical DSL evaluator for `satisfiedWhen` predicates (ported from `app/lib/assessment.ts`), collapses the TypeScript counterpart to a 2-line passthrough re-export enforced by a reference-identity CI test, and adds `scripts/rank-next-actions.mjs` which filters satisfied next-actions via the canonical evaluator and ranks the remainder by weight × deficit with a deterministic 5-tier tie-break. The ranker is wired into `scripts/run-assessment.mjs` so every `npm run assess` writes a pre-computed `rankedNextActions[10]` array into `app/data/assessment.json`. The `Assessment` TypeScript interface is extended with `RankedNextAction`, `.claude/skills/self-assessment/SKILL.md` is simplified to read directly from that pre-computed field, and two CLAUDE.md hard rules pin the one-source and read-don't-reimplement contracts end-to-end.
- PR #107: Pure test-suite hardening with no production code changes. Two deferred Minor findings from the PR #106 predicate-ranker review cycle were closed: (1) an explicit regression test was added for the internal `axisOrder()` enum so a future refactor cannot silently re-rank the dashboard axes; and (2) the `=` equality predicate test was extended to assert cross-type string coercion (`{ x: "5" }` against `"x=5"`) so a future strict-equality refactor cannot silently break predicates whose values arrive as strings. A stale stash entry superseded by PRs #104 and #106 was also dropped.
- PR #108: Closes the `/progression` timeline coverage gap (CCE-33) by adding three new telemetry-dated milestone detectors to `scripts/progression.mjs`: `scheduled` (Boris tip 48, fires on first `/loop`/`/schedule`/`/babysit` invocation), `remote` (tip 35, fires on first `RemoteTrigger`/`PushNotification`/`SendMessage` tool use), and `verification` (tip 73, fires on first `/go`). Previously only 8 of 12 scored dimensions had progression detectors; this PR lands the missing three so all 12 are represented on the timeline with backdated telemetry timestamps. A supporting change to `scripts/_usage-data.mjs::scanTranscriptModes` adds a per-session `commands: Set<string>` field (purely additive) to enable the transcript-reading detectors. The probe-tracker spec is updated in-sync per CLAUDE.md hard rules.
- PR #110: Implemented a per-command partition in the transcript scanner (`scripts/_usage-data.mjs`) that separates 'posture commands' (/color, /voice, /focus, /btw, /clear, /compact, /simplify, /rewind, /fewer-permission-prompts) from 'volume commands' (/loop, /schedule, /babysit, /go, /batch). Posture commands are now counted only when classifySessionKind returns interactive_cli or unknown, preventing observer and SDK-orchestrated sessions from echoing the primary session's command markup and inflating posture counters. Volume commands continue to be counted across every session kind. A fail-loud assertCommandPartition guard runs at module load to catch partition drift (disjointness, missing classification, dead classification). Eleven new unit tests cover the helper and fixture-level scenarios. The probe implementation status tracker and CLAUDE.md hard rules were updated to reflect the resolved limitation.
- PR #111: Two-line edit to the `docs-agent-nightly.yml` GitHub Actions workflow: (1) replaced the deprecated `app-id` input with `client-id` for `actions/create-github-app-token@v3`, sourcing the value from `vars.DOCS_AGENT_APP_CLIENT_ID` instead of a secret; (2) moved `JIRA_EMAIL` from GitHub Secrets to GitHub Variables (`vars.JIRA_EMAIL`), since it is a basic-auth username rather than a credential.
- PR #113: Introduced a pure helper `stageRanInEntry(entry, legacyNumber, newName)` in `scripts/signals.mjs` that collapses detection of /ship stage execution across all three `journal.jsonl` format generations (singular `entry.stage`, legacy-numeric `stages_run` array, new-string `stages_run` array) into a single strict-equality check. `gatherShipJournal` was widened to use this helper for both `stage2Count` (verify-agent) and a new `simplifyStageCount` counter. `run-assessment.mjs` MAX-merges `simplifyStageCount` into the `simplifyCommandUses` projection, mirroring the v0.9.16 /color pattern. The journal lookback was widened from 14 to `insightsLookbackDays` (default 30) to align with transcript-derived signals. Thirteen new unit tests cover all three format generations, the falsy-but-valid Stage 0 case, and lookback exclusion. The probe-tracker spec was annotated with a `[^journal-stage-credit]` footnote and a CLAUDE.md Conventions bullet documents the `stageRanInEntry` pattern and canonical stage 0–7 mapping.
- PR #114: Four shipped implementation plans were moved from docs/superpowers/plans/ into docs/superpowers/plans/archived/ as pure file renames (100% similarity, no content changes). The plans cover runtime-adoption probes (PR #94), CCE-33 progression detectors (PR #108), per-command partition (PR #110), and predicate ranker (PR #104) — all of which had already landed.
- PR #116: Replaced the `noTelemetry()` stubs for the Memory & Context Management and Terminal & Customization Execution scorers with real ratio scorers gated on `transcripts: true` and a new `interactive_or_unknown` session universe (`interactive_cli ∪ unknown`). Unified `focusCommandUses` and `rewindCommandUses` from per-message to per-session-coverage counting to match the canonical pattern used by `/btw`, `/clear`, and `/compact`. Added `interactiveOrUnknownSessionsAnalyzed` as a new denominator signal in `insights-signals.mjs` and a corresponding `"interactive_or_unknown"` universe option in `withGates` to satisfy the numerator-subset-of-denominator invariant. All twelve scoring dimensions now return numeric Execution scores; the two previously italic-unmeasured radar vertices (Memory, Customization) are now fully measured. The methodology page and probe-implementation-status tracker were updated to reflect the new measurement basis.
- PR #117: Release v0.9.18 bundles 13 PRs landed since v0.9.17. The headline improvements are: (1) Memory and Terminal & Customization Execution scorers now use transcript-gated ratio scoring (replacing noTelemetry stubs), completing all 12 dimensions on the Execution axis; (2) a per-command POSTURE/VOLUME partition prevents observer/SDK sessions from inflating posture-command counters, with a fail-loud boundary assertion at module load; (3) /ship journal stage-counter logic now covers all three journal format generations, fixing undercount of verify-agent and simplify adoption signals; (4) a canonical predicate evaluator lands in scripts/predicate.mjs with a 1-line passthrough re-export in the app layer, and pre-computed rankedNextActions are written to assessment.json; (5) the /progression timeline gains telemetry-dated detectors for the previously uncovered scheduled, remote, and verification dimensions. Secondary changes include onboarding the engineering-docs-agent plugin, fixing a state.json dismissed_gap_flags shape bug, migrating the Jira workflow to client-id auth, and archiving four completed plans. Only package.json is modified in this commit (version bump to 0.9.18).
- PR #118: Mechanical archival of two shipped plan documents: the CCE-72 plan (PR #113, /ship Stage 2/3 journal-format credit) and the CCE-76 plan (PR #116, Memory + Customization Execution scorers) were moved via `git mv` into `docs/superpowers/plans/archived/`. No content was altered; only the directory location changed.
- PR #119: Removed the Math.max blend that had been mixing a cumulative all-time counter (cliBtwUseCount from ~/.claude.json) into the 30-day windowed session-coverage field btwCommandUses in signalsSummary. The fix exposes cliBtwUseCountAllTime as a separate signalsSummary field and reroutes the btw-side-channel rubric predicate (Boris tips 33 and 54) to use the cumulative source instead of the windowed one. The Memory Execution score itself was unaffected (the scorer body already used maxProbe directly), but the signalsSummary surface now accurately reflects only 30-day windowed session coverage. Probe tracker and signalsSummary key counts were updated (probes 47→48, signalsSummary 71→72), and a new hard rule codifying the two-axis counter-classification requirement was added to CLAUDE.md.
- PR #120: v0.9.19 release cut bundling two changes: (1) a scoring-honesty fix (CCE-78 / PR #119) that decouples the cumulative all-time `/btw` invocation count from the 30-day windowed session-coverage counter in `signalsSummary` — the blend is removed, a new `cliBtwUseCountAllTime` field is exposed, and the tip-33/54 rubric predicate is rerouted to it; a new CLAUDE.md hard rule on cumulative-vs-windowed counter semantics is added for scorer authors; and (2) housekeeping (PR #118) archiving the CCE-72 and CCE-76 landed plan files from `plans/`.
- PR #121: Upgrades the engineering-docs-agent integration from `framework: none` to `framework: mkdocs`, publishing a Material-theme docs site at https://theoju.github.io/claude-code-self-assessment/. Includes two new CI workflows — a push-to-main GitHub Pages deploy pipeline and a PR-level `mkdocs build --strict` gate — migration of existing flat `docs/*.md` files into `docs/site-src/` with nine broken cross-tree relative links repaired, a five-field flip in `.engineering-docs-agent/config.yml` activating the publish-verifier stage of the nightly, path-reference updates across six source files (README, CLAUDE.md, rubric.json, slash commands, skills), and 21 new unit tests covering path migration, scaffold integrity, and config contract.
- PR #122: Post-merge follow-up to PR #121 / CCE-81 that records three durable operational lessons from the actual mkdocs Pages deploy incident: (1) `actions/configure-pages@v6 enablement: true` does not self-bootstrap GitHub Pages on a first deploy — the workflow's GITHUB_TOKEN lacks admin scope, so a one-time `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` call (or the Settings UI toggle) is required before the first run; (2) monitor scripts must avoid zsh's reserved built-in names `status` and `pipestatus`, which crash the shell with 'read-only variable' and silently swallow deploy events; (3) a monitor exiting non-zero with no event lines is almost always a script bug, not a failure of the watched system. CLAUDE.md received two new convention bullets. The mkdocs upgrade spec gained a POST-IMPLEMENTATION CORRECTION block under Gate 5. The upgrade plan gained a 'Post-merge outcomes' section recording all three deviations from the planned rollout.
- PR #125: Dropped the misleading `enablement: true` field from `.github/workflows/docs-agent-pages.yml` (it was always a no-op — `configure-pages@v6` cannot bootstrap GitHub Pages because the workflow token lacks the admin scope). Flipped the corresponding vitest assertion from a positive match to a negative regression guard (broader regex also catches quoted variants). Appended a one-line "Resolved by" footer to the POST-IMPLEMENTATION CORRECTION block in the mkdocs upgrade spec. Trimmed the CLAUDE.md Pages-enablement gotcha bullet to point at the plugin's CLAUDE.md as the durable source rather than repeating the full explanation inline. Docs and workflow text only — no behavioral change to the build or deploy pipeline.
- PR #127: Added a new convention to CLAUDE.md requiring that plan-step verification use the actual consumer tool (e.g., mkdocs build --strict, npx tsc --noEmit, ajv validate) rather than filesystem presence checks (test -f). The rule was propagated byte-identically across three repositories — this repo, theoju/advanced-data-import-system, and theoju/engineering-docs-agent — with MD5 c211304951e64e7a3bea48fbf923ab28 verified via orchestrator three-way diff.

## 2026-06-02 — Published docs site (mkdocs + GitHub Pages)

**PR #121 · CCE-81**

The engineering-docs-agent integration upgraded from `framework: none`
to `framework: mkdocs`, publishing a Material-theme site at
<https://theoju.github.io/claude-code-self-assessment/>.

What landed:

- **Two CI workflows.** `docs-agent-pages.yml` deploys on every push to
  `main` that touches `docs/site-src/**`, `mkdocs.yml`, or
  `requirements-docs.txt`. `docs-build-check.yml` runs `mkdocs build
  --strict` on every PR so broken cross-references fail before they merge,
  not after.
- **Source migration.** Existing flat `docs/*.md` files moved into
  `docs/site-src/`; nine broken relative cross-tree links repaired. The
  `docs_dir: docs/site-src` and `site_dir: site` entries in `mkdocs.yml`
  are the durable pointers.
- **Path-reference updates.** Six source files updated to the new paths:
  `README.md`, `CLAUDE.md`, `app/data/rubric.json`, both slash commands,
  and the self-assessment skill.
- **21 new unit tests** covering path migration correctness, scaffold
  integrity, and the `.engineering-docs-agent/config.yml` contract.

### First-deploy gotcha: `configure-pages@v6 enablement: true` is a no-op

The workflow originally included `enablement: true` in the
`actions/configure-pages@v6` step. It does **not** bootstrap GitHub Pages
on first deploy — the workflow `GITHUB_TOKEN` lacks the admin scope required
to call `POST /repos/.../pages`, so the very first run fails with
`Resource not accessible by integration`.

The fix before the first deploy is a one-time admin call:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Or use the UI: Settings → Pages → Build and deployment → Source →
"GitHub Actions". Once Pages exists, all subsequent workflow-triggered runs
work and the `enablement:` field is silently ignored. The misleading field
was removed in PR #125 (see below).

---

## 2026-06-02 — Removed misleading `configure-pages` field (PR #125 · CCE-82)

`enablement: true` in `.github/workflows/docs-agent-pages.yml` was
dropped. It had been added under the assumption it would auto-bootstrap
GitHub Pages; post-incident analysis confirmed it is a permanent no-op
because `GITHUB_TOKEN` cannot expand its own scopes to include Pages admin.

What changed:

- The `enablement: true` line removed from the workflow.
- The corresponding vitest assertion flipped from a positive match to a
  negative regression guard (broader regex catches quoted variants too),
  so the line cannot be silently re-added.
- The `POST-IMPLEMENTATION CORRECTION` block in
  `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` received a
  "Resolved by PR #125" footer.

The durable fix for future host-repo onboarding — run `gh api -X POST
repos/<owner>/<repo>/pages -f build_type=workflow` from an admin login
before the first Pages deploy — is recorded in `CLAUDE.md` conventions and
in the engineering-docs-agent plugin's own `CLAUDE.md`.
