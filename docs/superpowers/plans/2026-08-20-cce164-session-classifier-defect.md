# CCE-164 — Fix the session classifier (implementation plan)

**Spec:** `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-08-20-cce164-session-classifier-defect-design.md`
**Ticket:** [CCE-164](https://designitright.atlassian.net/browse/CCE-164)
**Branch:** `fix/cce-164-session-classifier`

Baseline captured before any edit (30-day window, ADIS CLAUDE.md target):

```
Platform 92  ·  Execution 60
automation P89 E—    permissions P100 E80   model-effort P100 E84  parallel P94 E47
verification P87 E65 memory P100 E37        planning P87 E43       integrations P95 E28
customization P100 E0 scheduled P63 E100    remote P87 E100        learning P100 E62
sessionsByKind: interactive_cli 88, sdk_orchestrated 166, observer 93, subagent 0, unknown 265
```

---

## T1 — Fix `classifySessionKind`

`scripts/_usage-data.mjs:629`.

1. Add module constants above the function:
   - `INTERACTIVE_ENTRYPOINTS = new Set(["cli", "claude-desktop"])`
   - `ENTRYPOINT_SCAN_BOUND = 200`, with the corpus census in the comment (max observed 83).
2. Invert the branch order: allow-list check returns `interactive_cli`; **any other**
   string entrypoint returns `observer` (path under `observer-sessions/`) or
   `sdk_orchestrated`. Fail closed.
3. Keep the `/subagents/agent-` short-circuit first.
4. Keep the trailing `return "unknown"` for "no entrypoint row found".

**Verify:** `node -e` one-shot against three real transcripts (one `cli`, one `sdk-py`,
one `sdk-cli` under `observer-sessions/`) printing the classification.

## T2 — Unit tests for the classifier

`scripts/__tests__/_usage-data.test.mjs` (co-locate with the existing classifier tests).

Cases, each a temp fixture transcript:
1. `cli` → `interactive_cli`
2. `claude-desktop` → `interactive_cli`
3. `sdk-py` → `sdk_orchestrated`  ← Defect 1
4. `sdk-cli` → `sdk_orchestrated`
5. `sdk-cli` under `…/observer-sessions/…` → `observer`
6. **`sdk-rb` (invented future entrypoint) → `sdk_orchestrated`** ← the fail-closed assertion
7. `entrypoint` row at line 80 → resolves, not `unknown`  ← Defect 2
8. transcript with no `entrypoint` row → `unknown`
9. `/subagents/agent-*.jsonl` path → `subagent`, short-circuit wins over an interactive
   entrypoint inside the file

No `toBeGreaterThan`-style loose assertions — exact equality on the returned kind.

**Verify:** `npx vitest run scripts/__tests__/_usage-data.test.mjs`

## T3 — Source-level test for `gatherInsightsSignals`

`scripts/__tests__/insights-signals.test.mjs`. Build a temp `claudeHome` with
`usage-data/session-meta/*.json` + matching `projects/<slug>/<session-id>.jsonl` transcripts
across kinds, then assert:

- `sessionsByKind` exactly
- `interactiveSessionsAnalyzed` and `interactiveOrUnknownSessionsAnalyzed`
- an `sdk-py` session is **absent** from `interactiveOrUnknownSessionsAnalyzed`

Per the CLAUDE.md rule, this is the test that must fail if a future edit re-drops the gate at
the counting layer — a fixture-fed scorer test would not catch it.

**Verify:** `npx vitest run scripts/__tests__/insights-signals.test.mjs`

## T4 — Numerator ⊆ denominator invariant

Add an assertion-style test proving the memory union numerator cannot exceed the
`interactive_or_unknown` denominator, exercising the real gate path (PR #97 trap).

**Verify:** full `npx vitest run`

## T5 — Docs

1. **Probe tracker** `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` —
   re-derive the five machine-enforced header counts by invoking, never by parsing. Update
   any registry row whose description asserts the old `unknown` semantics.
2. **CLAUDE.md** — add the fail-open/fail-closed classifier lesson under Hard rules, next to
   the existing denominator-semantics rule.
3. Mark the spec `Status: implemented` and append the measured after-numbers.

**Verify:** `npx vitest run scripts/__tests__/tracker-counts.test.mjs`

## T6 — Full gates + before/after assessment

```bash
npm run lint && npx tsc --noEmit && npx vitest run && npm run build
npm run assess -- --claude-md-target /Users/theo/Projects/advanced-data-importer/ \
  --include-transcripts --insights-lookback 30 --no-slack --print
```

Report both score sets. A discontinuity in `assessment-history.json` is expected — say so in
the PR body rather than letting a future reader treat it as a regression.

## T7 — Ship

Commit, push, PR referencing CCE-164, CI green, merge, transition the ticket.
