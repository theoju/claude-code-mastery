# CCE-164 — Session-classifier defect dilutes every posture Execution scorer

**Status:** implemented (2026-08-20)
**Ticket:** [CCE-164](https://designitright.atlassian.net/browse/CCE-164)
**Supersedes the hypothesis in:** the ticket body as filed (see § "The filed hypothesis was wrong")
**Related:** CCE-79 (memory numerator narrowing), CCE-163 (union numerator), CCE-71 / CCE-76
(posture-command gating), PR #97 (numerator ⊋ denominator regression), PR #110
(`POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition)

---

## Summary

`classifySessionKind` in `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:629`
misclassifies **265 of 612** in-window sessions (43%) as `unknown`. Those sessions are
automated SDK agent runs, not human interactive sessions, and `unknown` is admitted into the
`interactive_or_unknown` posture universe. The Memory Execution denominator is therefore
**353 when it should be 93** — a 3.8× dilution.

Two independent defects produce this. Both are in the classifier, not in the scorers.

Fixing them moves the Memory Execution ratio from **21.81% → 82.80%** with the numerator
essentially unchanged (77 hits either way). No scoring formula changes.

---

## The filed hypothesis was wrong

CCE-164 was filed on the hypothesis that the denominator is diluted by **short sessions** —
one- or two-message interactions where `/clear` would be ceremony — and proposed gating on
`user_message_count` / `duration_minutes` from `~/.claude/usage-data/session-meta/*.json`.

The size signal was real but it was a **symptom**, not the cause. The short sessions are
short because they are automated agent runs, not because humans have brief conversations.
Once the classifier is fixed, an explicit size gate adds nothing:

| Universe | denom | num | ratio |
| --- | ---: | ---: | ---: |
| current (`interactive_cli ∪ unknown`) | 353 | 77 | 21.81% |
| fixed classifier | 93 | 77 | **82.80%** |
| fixed classifier + `user_message_count >= 3` | 60 | 49 | 81.67% |

The size gate moves the ratio by 1.1 points and discards 28 real hits. **Do not implement
it.** This section exists so a future reader does not re-derive the discarded hypothesis.

---

## Defect 1 — unhandled `entrypoint` value, failing open

`classifySessionKind` enumerates the entrypoints it knows and falls through to `unknown` for
everything else:

```js
const ep = entry.entrypoint;
if (typeof ep !== "string") continue;
if (ep === "cli" || ep === "claude-desktop") return "interactive_cli";
if (ep === "sdk-cli") {
  return path.includes("observer-sessions") ? "observer" : "sdk_orchestrated";
}
// sdk-py falls through here → loop continues → returns "unknown"
```

`sdk-py` is not handled. Census of every distinct `entrypoint` value across all 639
transcripts on disk (depth = line index of the first row carrying the field):

| entrypoint | transcripts | depth p50 / p90 / max | under `observer-sessions/` |
| --- | ---: | --- | ---: |
| `sdk-cli` | 312 | 3 / 6 / 83 | 127 |
| **`sdk-py`** | **226** | **3 / 3 / 5** | **0** |
| `cli` | 100 | 4 / 5 / 42 | 0 |
| `claude-desktop` | 1 | 3 / 3 / 3 | 0 |

Every transcript carries an `entrypoint` row (zero transcripts lacked one within 300 lines),
so `unknown` should be near-empty in practice. It is 43% of the window instead.

These are not ambiguous sessions. Sampling `first_prompt` across the misclassified set
returns the same automated agent prompt over and over:

```
Review this change for security vulnerabilities. Changed files (you may Read these and an…
You previously flagged these candidate vulnerabilities: [ { "filePath": "backend/ap…
```

and their `project_path` values are worktrees and `~/.claude-mem/observer-sessions`.

**The failure direction is what makes this severe.** An unrecognized entrypoint resolves to
`unknown`, and `unknown` is *admitted* to the posture universe. The classifier fails **open**:
every new non-interactive entrypoint Anthropic ships silently pollutes posture scoring until
someone notices. It must fail **closed**.

## Defect 2 — 5-line scan bound

```js
for await (const raw of rl) {
  if (++scanned > 5) break;
```

The bound predates transcript shapes that lead with `queue-operation` and `attachment` rows.
Entry-type census of the first 5 lines across the misclassified sessions:

```
queue-operation 622, attachment 450, user 226, ai-title 5, mode 5,
permission-mode 4, worktree-state 3, last-prompt 3, agent-name 3, …
```

None of those rows carry `entrypoint`. Depth needed to resolve the previously-`unknown`
sessions:

| scan bound | resolved |
| ---: | ---: |
| 5 | 226 |
| 10 | 254 |
| 20 | 260 |
| 50 | 264 |
| 100 | 265 |

Corpus-wide the deepest first-`entrypoint` row sits at **line 83**. A bound of 5 truncates
the tail; 39 sessions (34 → `observer`, 5 → `interactive_cli`) resolve only past it.

Defect 2 is independent of Defect 1: fixing only the `sdk-py` case still loses those 39.

---

## Blast radius

`unknown` feeds the `interactive_or_unknown` universe (`scripts/score.mjs:616`) **and** the
`allowPosture` gate inside `scanTranscriptInvocations`
(`scripts/_usage-data.mjs:337`), so the defect inflates both sides of every posture ratio —
though empirically the numerator inflation is tiny (the 265 misclassified sessions contribute
3 hits) while the denominator inflation is 3.8×.

Affected surfaces:

- **Denominator** — `memory` and `customization` Execution scorers
  (`universe: "interactive_or_unknown"`).
- **Numerator gate** — every `POSTURE_COMMANDS` counter: `/color`, `/voice`, `/focus`,
  `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`, plus the
  CCE-163 memory-tool detection.
- **`interactive_only` scorers** (`permissions`, `planning`, `learning`, `automation`,
  `parallel`, `model-effort`, `verification`) under-count their denominator by the 5 genuine
  `cli` sessions that Defect 2 hid: 88 → 93.
- **`sessionsByKind`** census on `/methodology/probes`, and the probe tracker's
  "Validated against" header counts.

`all_sessions` scorers (`scheduled`, `remote`, `integrations`, `verification`) are unaffected —
their denominator is `inWindow.length`, which never consulted the classifier.

---

## Design

### Invert the classifier to an allow-list

Interactive is the small, enumerable, stable set. Everything else is not interactive.

```js
const INTERACTIVE_ENTRYPOINTS = new Set(["cli", "claude-desktop"]);

// …inside the scan loop:
const ep = entry.entrypoint;
if (typeof ep !== "string") continue;
if (INTERACTIVE_ENTRYPOINTS.has(ep)) return "interactive_cli";
// Every other entrypoint is machine-driven. Fail CLOSED: a future
// `sdk-rb` / `sdk-go` must never land in the posture universe by default.
return path.includes("observer-sessions") ? "observer" : "sdk_orchestrated";
```

This changes the semantics of `unknown` to exactly one thing: **no `entrypoint` row was found**
(no transcript on disk, an unreadable file, or a transcript that genuinely lacks the field).
That is a real "we could not tell", and keeping it inside `interactive_or_unknown` preserves
the conservative intent CCE-76 wanted — it is just no longer a dumping ground.

### Raise the scan bound

Corpus max is 83. Set the bound to **200** — comfortably past the observed tail, still O(1)
per file and still bailing on the first `entrypoint` row (p50 = 3, so the common case reads
three lines). Name it as a module constant with the census in the comment so the next person
who wants to lower it sees the data.

### Explicitly NOT in scope

- **No size gate.** Falsified above.
- **No scoring-formula change.** The ratio, the union numerator, and the `Math.max` lower
  bound from CCE-163 all stay exactly as they are.
- **No change to auto-compact handling.** CCE-163 decision (A) stands: evidence only.
- **No universe change on any scorer.** `memory` and `customization` stay on
  `interactive_or_unknown`; the fix makes that universe mean what it always claimed to mean.

---

## Target re-derivation

The Memory Execution rubric target is **60**, set by CCE-79 against the *diluted* denominator
and deliberately held by CCE-163. With the classifier fixed the observed ratio is 82.80%,
which under `normalize(rawScore, target)` = `clamp(round(83 / 60 × 100))` pins the score at
**100** — the target stops discriminating.

Two readings, and the choice is a judgement call that must be recorded rather than hidden:

1. **Hold 60.** The target was always meant as a behavioural standard ("60% of interactive
   sessions show deliberate context management"), not a curve fitted to one machine. A user
   who clears the bar scores 100; that is the target doing its job.
2. **Raise it.** 60 was calibrated when the denominator was 3.8× too large. Re-deriving
   against a correct denominator argues for something nearer the observed 83.

**Decision: hold 60, and record why.** Raising the target to sit just under one machine's
observed rate is curve-fitting to a sample of one — the exact failure CCE-163's spec called
out when it declined to tune. The number that was wrong was the *denominator*, and that is
what this change fixes. Revisit only with a multi-user distribution, which the repo's privacy
rules (§ Privacy, all scoring local, nothing uploaded) make unavailable today.

The honest consequence: this machine now scores 100 on Memory Execution and the dimension
stops being informative *for this user*. That is the correct outcome for a user who has
`/clear`, `/compact`, `claude-mem`, and `graphify` in active rotation across 83% of
interactive sessions. A ceiling reached is not a broken metric.

---

## Verification plan

Filesystem checks are not enough here — the contract is behavioural, so exercise it at the
source layer (the CLAUDE.md rule: back gate changes with a `gatherInsightsSignals` test, not
just a fixture-fed scorer test).

1. **Unit — classifier.** Fixture transcripts for each of: `cli`, `claude-desktop`, `sdk-py`,
   `sdk-cli`, `sdk-cli` under an `observer-sessions/` path, an unknown-future `sdk-rb`
   (must resolve `sdk_orchestrated`, **not** `unknown` — this is the fail-closed assertion),
   an `entrypoint` row at line 80 (must resolve, guarding Defect 2), and a transcript with no
   `entrypoint` row at all (must stay `unknown`).
2. **Unit — subagent short-circuit** still wins over entrypoint inspection.
3. **Source-level — `gatherInsightsSignals`.** Build a temp `claudeHome` with a mix of kinds
   and assert `sessionsByKind` and `interactiveOrUnknownSessionsAnalyzed` directly.
4. **Invariant.** Assert the memory numerator ≤ denominator on real data — the PR #97 trap.
5. **Before/after assessment run.** Report both, per the ticket's acceptance criteria.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| A genuinely interactive entrypoint gets added upstream and now fails closed into `sdk_orchestrated` | Deliberate trade: under-counting a posture denominator is conservative, over-counting is what shipped this bug. The unit test names the allow-list explicitly so extending it is a one-line, test-covered change. |
| Scores jump discontinuously; the trend series shows a cliff | Expected and correct. Note it in the PR body and the spec so the history file's discontinuity is explained rather than re-investigated. |
| Scan bound 200 slows the walk on large corpora | Loop still breaks on the first `entrypoint` row (p50 = 3). The bound is a ceiling for pathological files, not a read length. |
| `unknown` becoming near-empty makes `interactive_or_unknown` and `interactive_only` converge, so the distinction looks pointless | It is not pointless — it is the correct behaviour of a fail-closed classifier on this corpus. Keep both universes; the distinction still matters when a transcript is missing. |

---

## Measured outcome

Both runs: 30-day window, `--claude-md-target /Users/theo/Projects/advanced-data-importer/
--include-transcripts`, same machine, same corpus, minutes apart.

```
sessionsByKind   before  interactive_cli 88, sdk_orchestrated 166, observer  93, unknown 265
                  after  interactive_cli 93, sdk_orchestrated 392, observer 127, unknown   0
```

`unknown` went to **0 across all 639 transcripts on disk** — every transcript carries an
`entrypoint` row, so after the fix nothing is unclassifiable.

| Dimension (Execution) | before | after | Δ |
| --- | ---: | ---: | ---: |
| **memory** | 37 | **100** | **+63** |
| planning | 43 | 45 | +2 |
| permissions | 80 | 81 | +1 |
| model-effort | 84 | 84 | — |
| parallel | 47 | 47 | — |
| verification | 65 | 65 | — |
| integrations | 28 | 28 | — |
| customization | 0 | 0 | — |
| learning | 62 | 62 | — |
| scheduled | 100 | 100 | — |
| remote | 100 | 100 | — |
| **Execution overall** | **60** | **68** | **+8** |

Platform Setup is unchanged at **92** — correct, this is an Execution-axis defect.

Memory evidence line after the fix, showing the invariant holding with no cap applied:

> Deliberate context management: 79 of 93 interactive_cli∪unknown sessions (84.95%) —
> /clear 47, /compact 23, memory tools 25 (union, not sum).

### Two results worth reading carefully

**`customization` stays 0, and that is correct.** It shares the diluted denominator, so it
was a candidate to move. Its numerator is genuinely zero — `/color` 0, `/voice` 0,
`/focus` 0 across the window. A real zero, not a measurement artifact. Do not "fix" it.

**`interactive_or_unknown` and `interactive_only` now return the same number (93).** They
converge because `unknown` is empty on this corpus, not because the distinction is
meaningless — a session-meta record with no transcript on disk still resolves `unknown`, and
the conservative union still admits it. Keep both universes.

### Residual known mismatch (not fixed here, documented deliberately)

The numerator and denominator are still assembled from **different walks**:
`gatherInsightsSignals` counts session-meta records whose `start_time` is in-window, while
`scanTranscriptInvocations` walks every transcript on disk and filters **per line** on
timestamp. A session with in-window lines but an out-of-window `start_time` therefore counts
toward the numerator and not the denominator. Measured effect today: numerator 79 from the
transcript walk vs 77 from the session-meta-joined analysis — 2 sessions, and 79 ≤ 93, so the
invariant holds with room. The scorer's `Math.min(rawRatio, 1)` cap remains the backstop.
Closing this properly means passing the eligible session-id set into the scanner; that is a
separate change with its own blast radius and is **not** in scope for CCE-164.

## Provenance

Every number in this document was measured on 2026-08-20 against the live
`~/.claude/usage-data/` corpus with a 30-day window (612 session-meta records, 639 transcripts
on disk). Analysis scripts were throwaway; the census they produced is reproduced inline above
rather than cited by path, because the corpus moves.
