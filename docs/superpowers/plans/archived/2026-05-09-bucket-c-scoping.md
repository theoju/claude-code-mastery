# Bucket C Scoping Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a decision document for the 6 unpredicated rubric next-actions in "Bucket C" — the genuinely behavioral items where no signal exists in `~/.claude/` to detect them. The decision document captures, per action: detectability options, cost, and a recommendation (instrument / accept-as-coaching / move-to-separate-surface).

**Architecture:** This plan does not produce code. It produces one design spec (`docs/superpowers/specs/2026-05-09-bucket-c-decision.md`). Each unpredicated action gets a structured analysis. The output spec is the input to a follow-up implementation plan if any items are chosen for instrumentation.

**Tech Stack:** None — design work.

**Branch:** `docs/bucket-c-scoping` (worktree off main).

---

## The 6 unpredicated actions

| Dim           | Action ID                   | Boris tip | Action text                                                                                   |
| ------------- | --------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| memory        | `auto-dream`                | 45        | Run /memory and enable auto-dream                                                             |
| memory        | `rewind-reflex`             | 62        | Get into the /rewind reflex when Claude goes sideways                                         |
| planning      | `goal-constraints-template` | 66        | Adopt a template: Goal / Constraints / Acceptance Criteria at top of every non-trivial prompt |
| customization | `per-worktree-color`        | 40        | Set per-worktree /color so parallel sessions are distinguishable                              |
| remote        | `ios-task`                  | 46        | Try kicking off one task from iOS this week                                                   |
| learning      | `spaced-repetition-skill`   | 15        | Optional: build a spaced-repetition skill for parts of the codebase you want to retain        |

---

## Task 1: Inventory existing telemetry surfaces

**Files:** none — research only.

- [ ] **Step 1: Catalogue what `~/.claude/` exposes that we don't already read**

Run:

```bash
ls -la ~/.claude/ 2>&1 | head -30
ls ~/.claude/usage-data/ 2>&1 | head -20
```

For each entry, note: file/dir name, role (config / cache / runtime state / telemetry), whether v0.8 already reads it.

- [ ] **Step 2: Sample transcript fields we don't currently scan**

Run:

```bash
T=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)
python3 -c '
import json, sys
keys = set()
with open("'$T'") as f:
  for line in f:
    try:
      o = json.loads(line)
      def walk(v, prefix=""):
        if isinstance(v, dict):
          for k in v:
            keys.add(f"{prefix}{k}")
            walk(v[k], f"{prefix}{k}.")
      walk(o)
    except: pass
print(sorted(keys)[:40])'
```

Capture the field set. This is the empirical evidence base for "is X actually detectable?"

- [ ] **Step 3: Write findings to working notes**

Create `/tmp/bucket-c-telemetry-inventory.md` with:

- One section per `~/.claude/` directory with content classification
- One section listing all top-level transcript JSONL keys observed
- One section listing notable nested fields (`message.content[*].type`, `attachment.type`, etc.)

Save for Task 3.

---

## Task 2: For each Bucket C action, draft a detectability brief

**Files:** none — research only.

For each of the 6 actions, draft a 100-word brief covering:

- **Signal candidate**: where this could be detected (file/field/pattern)
- **Detection cost**: hours of implementation + ongoing maintenance risk
- **Reliability**: how prone is the signal to false positives or behavioral drift?
- **Recommendation**: instrument / accept-as-coaching / move-to-separate-surface

- [ ] **Step 1: `memory/auto-dream`**

Brief: Auto-dream is `/memory` configuration; surfaced (or not) in `~/.claude/settings.json` as a config flag. Sample the user's settings.json — if `autoDream: true` exists → instrument as a 1-line `detectAutoDream`. If absent → it's a runtime toggle without persistent config; defer.

- [ ] **Step 2: `memory/rewind-reflex`**

Brief: `/rewind` is a slash command. If the user invokes it in transcripts, `<command-name>/rewind</command-name>` markup would appear. Detection cost: trivial (extend `extractSlashCommands` `TARGET_COMMANDS` set with `"rewind"`). Reliability: high (markup is exact). Recommendation: **instrument**.

- [ ] **Step 3: `planning/goal-constraints-template`**

Brief: This is prompt-shape, not slash command. Detection requires NLP-style heuristics on user-message text — look for top-of-message structure containing the literals "Goal", "Constraints", "Acceptance Criteria" (or close synonyms) within the first ~5 lines. Detection cost: medium (regex + threshold tuning); reliability: medium-low (false positives on prose mentioning those words). Recommendation: **accept-as-coaching** — the action is a pattern, not a tool, and false positives erode trust faster than missed detections (per the rubric's design rule).

- [ ] **Step 4: `customization/per-worktree-color`**

Brief: `/color` configuration likely lives in `~/.claude/settings.json` per-project or globally. Sample settings.json across projects — if a `colorPerWorktree: true` or per-project override exists → simple detector. Otherwise: this is per-session client-side state with no persistence. Recommendation: **accept-as-coaching** unless settings.json reveals a persistent flag.

- [ ] **Step 5: `remote/ios-task`**

Brief: iOS-initiated task → would surface in `~/.claude/projects/*/*.jsonl` with a session-origin marker (e.g., `clientType: "ios"` or similar). Sample the transcript JSONL for any iOS-distinctive fields. If found → trivial detector. If not → no signal exists; recommend **accept-as-coaching**.

- [ ] **Step 6: `learning/spaced-repetition-skill`**

Brief: A custom skill in `~/.claude/skills/<name>/SKILL.md`. Detection: scan personalSkills (already gathered) for skill names containing keywords like "spaced", "repetition", "review", "retain". Cost: trivial. Reliability: medium (depends on user's naming convention). Recommendation: **instrument** with a permissive regex.

---

## Task 3: Write the decision spec

**Files:**

- Create: `docs/superpowers/specs/2026-05-09-bucket-c-decision.md`

- [ ] **Step 1: Compile findings**

Combine Task 1 inventory + Task 2 briefs into a single spec at `docs/superpowers/specs/2026-05-09-bucket-c-decision.md`. Structure:

```markdown
# Bucket C Decision Spec

## Goal

Decide for each of 6 unpredicated rubric actions: instrument, accept-as-coaching, or move-to-separate-surface.

## Telemetry inventory

[Task 1 output]

## Per-action analysis

### memory/auto-dream

[Task 2 Step 1 brief + final recommendation]

### memory/rewind-reflex

[Task 2 Step 2 brief + final recommendation]

[... 4 more sections ...]

## Decision summary

| Action | Decision | Effort to instrument |
| ------ | -------- | -------------------- |

## Follow-up implementation plan

For each "instrument" decision, the follow-up implementation plan
(separate doc) wires the detector + signal + predicate following the
v0.8 pattern.

## Out of scope

- Bucket C items chosen for "accept-as-coaching" stay unpredicated;
  the dashboard renders them under a "behavioral coaching" label
  rather than a TODO/priority surface (UI change deferred).
```

- [ ] **Step 2: Self-review**

Read the spec end-to-end. For each action:

- Is the recommendation justified by the brief?
- Is the effort estimate concrete?
- Does the spec name the file/field that would be touched?

If any section is vague, fix inline.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-09-bucket-c-decision.md
git commit -m "docs(spec): Bucket C decision — instrument vs coach vs surface for 6 unpredicated actions"
```

---

## Task 4: Update Bucket C placeholder in CLAUDE.md (optional)

**Files:**

- Modify: `CLAUDE.md` — single line referencing the spec

- [ ] **Step 1: Add a pointer**

In `CLAUDE.md`, find the section discussing "Unmeasured ≠ scored zero" and append:

```
Bucket C decisions (auto-dream, rewind-reflex, goal-constraints-template,
per-worktree-color, ios-task, spaced-repetition-skill) are tracked in
docs/superpowers/specs/2026-05-09-bucket-c-decision.md.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: pointer from CLAUDE.md to Bucket C decision spec"
```

---

## Self-Review

**1. Spec coverage:**

- All 6 unpredicated actions listed and analyzed (Task 2 has one step per action ✓)
- Empirical inventory of `~/.claude/` precedes per-action analysis (Task 1 ✓)
- Output is a single decision spec, not loose research (Task 3 ✓)

**2. Placeholder scan:**

- No "TBD" — each Task 2 step has a concrete brief framework with stated reasoning.
- The spec template at Task 3 Step 1 has explicit section headers, not "fill in".

**3. Type consistency:**

- "instrument / accept-as-coaching / move-to-separate-surface" used consistently as the three decision categories.
- Action IDs (`memory/auto-dream`, etc.) match `app/data/rubric.json` exactly.

## Out of scope

- Implementation of any chosen "instrument" decisions — that's a follow-up plan after this spec is approved.
- UI changes to render "accept-as-coaching" actions differently from "instrumentable" ones.
- Score-formula changes (separate plan).
