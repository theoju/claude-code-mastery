# Design: `~/.claude.json` runtime-adoption instrumentation

- **Date:** 2026-05-26
- **Status:** Draft (awaiting user review → writing-plans)
- **Scope:** Instrument 4 previously-untracked Boris tips (50, 27, 74, 39) by
  reading a new data surface (`~/.claude.json` runtime-adoption flags), plus
  opportunistically strengthen 3 already-tracked behaviors (tip 33 `btw`,
  plan-mode recency, skill-usage recency). Approach **C** from the brainstorm:
  split signals by their nature across the existing two axes.

---

## 1. Motivation

The probe tracker's 2026-05-25 triage classified 11 Boris tips as untracked: 6
"blocked until a signal ships" and 5 "permanently unmeasurable." An empirical
survey of current Claude Code data surfaces (the project's "empirically verify
telemetry fields before scoring against them" hard rule) overturned that triage
for a subset, because **`~/.claude.json` carries feature-adoption state that no
existing scorer reads.**

### Survey evidence (2026-05-26)

Surfaces checked: `~/.claude.json`, `~/.claude/settings.json`,
`~/.claude/usage-data/{facets,session-meta}`, `~/.claude/history.jsonl`
(5065 lines / 73 distinct slash commands), and 30–60 recent
`~/.claude/projects/*/*.jsonl` transcripts.

| Surface          | Finding                                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.claude.json` | `hasUsedAgentsFleet=true`, `lastReleaseNotesSeen`, `opus47LaunchSeenCount=12`, `unpinOpus47LaunchEffort=true`, `changelogLastFetched`, `btwUseCount=36`, `promptQueueUseCount=1602`, `lastPlanModeUse`, per-skill `skillUsage[*].lastUsedAt`, `hasUsedBackslashReturn`, `hasUsedRemoteControl` |
| transcripts      | new entry type `{type:"ai-title", aiTitle, sessionId}` present in 59/60 recent files; `{type:"bridge-session", bridgeSessionId:"cse_…"}` in 1/60 (a **cloud** bridge ≈ tip 35, not a local fork)                                                                                               |
| Bash tool inputs | only `command` / `description` keys — **no** sandbox field                                                                                                                                                                                                                                     |
| settings.json    | `permissions={allow, defaultMode}` — **no** sandbox key                                                                                                                                                                                                                                        |
| history.jsonl    | 0 hits for recap / fork / name / bare / sandbox / cowork / add-dir                                                                                                                                                                                                                             |

### Reclassification of the 11

| Tip                     | Old class    | New class                        | Signal                                            |
| ----------------------- | ------------ | -------------------------------- | ------------------------------------------------- |
| 50 Cowork Dispatch      | blocked      | **measurable**                   | `hasUsedAgentsFleet`                              |
| 27 Customize Everything | unmeasurable | **measurable**                   | composite of existing customization config        |
| 74 4.6→4.7 Shifts       | unmeasurable | **measurable (awareness proxy)** | release-notes / opus47-launch flags               |
| 39 Auto Session Naming  | unmeasurable | **detectable, info-only**        | `ai-title` transcript entry (non-discriminating)  |
| 21 Sandboxing           | blocked      | still blocked                    | no signal in settings or Bash inputs              |
| 38 `--name`             | blocked      | still blocked                    | `ai-title` is auto, can't isolate a user-set name |
| 53 Fork Sessions        | blocked      | still blocked                    | `bridge-session` is a cloud bridge, not a fork    |
| 58 `--add-dir`          | blocked      | still blocked                    | `projects` entries are single-path                |
| 70 Recaps               | blocked      | still blocked                    | no `/recap` in history, no key                    |
| 57 `--bare`             | unmeasurable | still unmeasurable               | launch flag, no trace                             |
| 12 Bug Fixing           | unmeasurable | still unmeasurable               | generic activity, no discriminating signal        |

**Net:** 3 newly scored (50, 27, 74) + 1 info-chip (39); 7 remain documented as
blocked/unmeasurable. Plus a "broad" extension: re-instrument tips 33, planning,
learning with stronger `~/.claude.json` signals.

---

## 2. Goals / Non-goals

**Goals**

- Add a single, well-bounded loader for `~/.claude.json` adoption state.
- Score tips 50, 27, 74 on the **correct axis** without violating the
  never-collapse rule or the ratio-scorer denominator rule.
- Surface 39 as a non-scored feature-active chip.
- Strengthen tips 33 / planning / learning with corroborating recency/counter
  signals.
- Keep everything predicate-backed (probes page + tracker stay single source of
  truth) and update the tracker in the same change.

**Non-goals**

- No attempt to score 21, 38, 53, 58, 70, 57, 12 — they remain documented as
  blocked/unmeasurable. No fabricated signals.
- No new Anthropic API calls; no new external/telemetry uploads.
- No new dimension. All signals route into existing rubric dimensions.

---

## 3. Architecture

Four units, each with one purpose and a testable interface.

### 3.1 `scripts/_runtime-state.mjs` (new) — ingestion

- **Does:** reads `~/.claude.json`, returns a whitelisted typed object.
- **Interface:** `loadRuntimeState(claudeHome) → RuntimeState`.
- **Depends on:** filesystem only.
- **Error handling:** missing file, malformed JSON, or absent fields → return
  an object with each allowlisted field at its safe default (`false` / `0` /
  `null`). Never throws. Matches the graceful-degrade contract of the other
  loaders in `scripts/_usage-data.mjs`.
- **Allowlist (the ONLY fields read):**
  - booleans: `hasUsedAgentsFleet`, `unpinOpus47LaunchEffort`
  - version/awareness: `lastReleaseNotesSeen`, `opus47LaunchSeenCount`, `changelogLastFetched`
  - counters: `btwUseCount`
  - recency: `lastPlanModeUse`, and `skillUsage[*].lastUsedAt` reduced to a count of skills used in the last 30 days (matching the project's existing 30-day window)
- The allowlist is exactly the set scored in §3.2 / §4 — nothing read that
  isn't used. The loader is the reusable seam (adding a field later is a
  one-line change); we do not pre-read unused flags.
- Reading the whole blob is forbidden — the allowlist is the privacy and
  stability boundary.

### 3.2 Signal extraction → `buildSignalsSummary`

`loadRuntimeState` output is folded into the signals object that
`scripts/run-assessment.mjs` `buildSignalsSummary` (line 55) serializes. New
named keys (final names settled in plan): `coworkDispatchAdopted`,
`opus47AwarenessLevel`, `btwUses`, `planModeRecencyDays`, `skillsUsedRecently`
(all from §3.1), plus `aiTitlePresent` (sourced from the **transcript scan**,
not the `~/.claude.json` loader). Each is also added to the test fixture `makeSignals`
(`scripts/__tests__/_fixtures.mjs`) — missing fields cascade into NaN scores, so
the fixture must carry every new key.

### 3.3 `adoptionCredit()` (new) in `scripts/score.mjs` — scorer shape

A **third scorer family** alongside the `withGates` ratio scorers and
`noTelemetry()`.

- **Why new:** these signals are global booleans / counters / recency, not
  per-session rates. Forcing them through `withGates({ universe })` would impose
  a session denominator they don't have — the exact "score posture without a
  valid denominator" mistake the codebase forbids.
- **Signature (illustrative):**
  `adoptionCredit({ kind: "boolean" | "counter" | "recency", cap, label })`
  returning the standard scorer result `{ score, evidence, gaps, gapReason }`.
- **`cap`** bounds the contribution so one ever-used flag cannot dominate a
  dimension (kills the inflation risk). Default: behavioral signals capped at the
  dimension's target; **awareness-labelled** signals (tip 74) capped at ~30% of
  target.
- **`label`** ∈ `{"behavioral", "awareness", "proxy"}` propagates to the
  dashboard so soft signals render honestly and never read as mastery.
- It is a **named, separately-tested helper**, not an inline special-case inside
  a `withGates` body — this is what keeps boolean-as-rate confusion from leaking
  back in.

### 3.4 Progression milestones — `scripts/progression.mjs`

New `DETECTORS` entries, but **only for signals that carry a real timestamp**
(`lastPlanModeUse`, `skillUsage[*].lastUsedAt`, any `lastXUse`). A timestampless
boolean (`hasUsedAgentsFleet`) is **scored but gets no milestone** — fabricating
a "first seen = now" timestamp would corrupt the timeline. This is the one place
Approach C is only a partial superset of the milestones-only alternative; it is
intentional and called out so nobody "fixes" it later.

---

## 4. Axis routing (Approach C)

| Tip / signal            | Dimension id    | Axis                                | Mechanism                                                | Cap / label          |
| ----------------------- | --------------- | ----------------------------------- | -------------------------------------------------------- | -------------------- |
| 27 Customize Everything | `customization` | **Platform** (`SCORERS`)            | composite breadth of already-scored customization config | n/a (config breadth) |
| 50 Cowork Dispatch      | `parallel`      | **Execution** (`EXECUTION_SCORERS`) | `adoptionCredit` boolean                                 | target / behavioral  |
| 74 4.6→4.7 Shifts       | `model-effort`  | **Execution**                       | `adoptionCredit`                                         | ~30% / awareness     |
| 33 `btw` (tracked)      | `automation`    | **Execution**                       | `adoptionCredit` counter                                 | target / behavioral  |
| plan-mode recency       | `planning`      | **Execution**                       | `adoptionCredit` recency, corroborates transcript signal | target / behavioral  |
| skill-usage recency     | `learning`      | **Execution**                       | `adoptionCredit` recency                                 | target / behavioral  |
| 39 Auto Session Naming  | `memory`        | —                                   | info-only chip (`ai-title` present)                      | **not scored**       |

Both axes remain separately presented on every surface (dashboard, methodology,
console, Slack) — no collapse. tip 27 strengthens the **Platform** customization
scorer; the customization **Execution** scorer stays `noTelemetry()`.

---

## 5. Probes page + catalog

- **New catalog source category `runtime`** in `app/data/probe-catalog.json`
  (today: `settings` / `transcripts` / `filesystem` / `plugins` / `history`).
  One entry per scored behavioral flag, shape `{source, path, description}`.
- The scored flags get `satisfiedWhen` predicates in `rubric.json` → they appear
  on `/methodology/probes` under a new **"Runtime adoption"** group.
- **New axis badge `A`** (adoption) in `app/methodology/probes/page.tsx`
  `SOURCE_META`, visually distinct from the existing `P` / `P*`. Intro legend
  updated to explain `A`.

---

## 6. Tracker sync (hard rule — same PR)

`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`:

- **Part 1:** add a `runtime` source-layer with its registry rows.
- **Part 2:** flip tips 50, 27, 74 from ❌; 39 stays ❌ with an info-only note;
  re-derive the ✅/📊/🗣/❌ tally.
- **Header counts:** re-derive all five (tips, dimensions, next-actions,
  probe-catalog entries, `signalsSummary` keys). The `signalsSummary` count is
  derived by **invoking** `buildSignalsSummary(makeSignals())` and counting
  `Object.keys(...)` — never by parsing the function source.
- `scripts/__tests__/tracker-counts.test.mjs` machine-enforces the five counts;
  a stale number fails CI.

---

## 7. Testing

- `scripts/__tests__/_runtime-state.test.mjs` (new): missing file, malformed
  JSON, partial fields, full file → each returns safe allowlisted output.
- `adoptionCredit` unit tests: cap enforcement per `kind`, `label` propagation,
  boolean/counter/recency math.
- Fixture update: `makeSignals` gains every new key (guard against NaN cascade).
- Probes-page render test: the new "Runtime adoption" group + `A` badge appear.
- `tracker-counts.test.mjs`: passes with re-derived counts (auto).
- Full suite (`npx vitest run`) green; fixture changes, not weakened assertions.

---

## 8. Privacy

- All scoring stays local. Raw `~/.claude.json` values feed scores but are
  **never** serialized to Slack or console in raw form — only the aggregate
  dimension/axis scores cross a shareable surface, consistent with the existing
  shareable-surface rule.
- The allowlist (3.1) is the data boundary: fields outside it are never read.
- A one-line note added to the methodology Attribution/privacy section noting
  `~/.claude.json` is read locally for adoption scoring.

---

## 9. Risks

- **`adoptionCredit` is a genuinely new scorer concept** — the most likely place
  for a future bug or a two-axis violation to hide. Mitigation: named helper +
  dedicated tests + explicit cap/label semantics in this spec.
- **Semantic mapping of `hasUsedAgentsFleet` → tip 50 "Cowork Dispatch"** is
  high-confidence but not doc-verified. Mitigation: confirm against Claude Code
  release notes / docs during implementation; if it maps to a different feature,
  relabel without changing the mechanism.
- **Tracker count drift** — five interdependent counts. Mitigation: the
  machine-enforced test; re-derive, never guess.

---

## 10. Out of scope

Tips 21, 38, 53, 57, 58, 70, 12 remain unscored and documented as
blocked/unmeasurable. `tipsHistory` (43 exposure IDs) is noted as a future
cross-cutting "tip exposure" signal but is **not** instrumented here (YAGNI).
