# Rename: Claude Code Mastery → Claude Code Self-Assessment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans once decisions are confirmed. This is a rename, not a feature build, so steps are sed-style with verifications rather than TDD.

**Goal:** Replace every `claude-code-mastery` / `Claude Code Mastery` reference in the repo, infrastructure, and operating environment with the new naming, in lockstep with the GitHub repo rename that's already done.

**Status of GitHub repo:** Already renamed to `theoju/claude-code-self-assessment`. Old URL `github.com/theoju/claude-code-mastery` still resolves via GitHub's auto-redirect, so nothing is broken — just stale.

**Local remote URL:** Still pointing at the old name (`git@github.com:theoju/claude-code-mastery.git`). Works via redirect; should be updated.

---

## Review decisions needed BEFORE executing

These are the calls only you can make. Each is followed by my recommendation.

### D1. Display name — "Claude Code Mastery" the brand

The repo slug is now `claude-code-self-assessment`, but the **user-facing product brand** in the dashboard / Slack message / page title is currently "Claude Code Mastery". You have three options:

| Option | UI title | Slug | Tradeoff |
|---|---|---|---|
| **A.** Match repo | "Claude Code Self-Assessment" | `claude-code-self-assessment` | Most consistent. Loses the aspirational "mastery" framing. |
| **B.** Keep brand | "Claude Code Mastery" | `claude-code-self-assessment` | Brand persists; readers see two names. Common in OSS (e.g. `vercel/next.js` → "Next.js"). |
| **C.** Hybrid | "Claude Code Self-Assessment — a mastery dashboard" | `claude-code-self-assessment` | Both phrases visible. Wordier. |

**My recommendation: A.** You explicitly asked for the rename, and "self-assessment" is what `/self-assessment` actually does. Mixing brand+slug invites the same confusion the rename was meant to solve.

### D2. Slack channel default in `assessment.config.example.json`

Currently `"#claude-code-mastery"`. Options:

- **A.** Change to `"#claude-code-self-assessment"` to match.
- **B.** Generalise to `"#claude-code"` — it's an *example*, the user picks their own.

**My recommendation: A.** Keeps it concrete and matches the rename.

### D3. npm package name in `package.json`

Currently `"claude-code-mastery-dashboard"`. The package is private (`"private": true`), never published, so this only shows up in install logs. Change to `"claude-code-self-assessment-dashboard"`?

**My recommendation: yes**, for consistency. Zero risk because it's `private: true`.

### D4. LaunchAgent label `com.theo.claude-mastery`

The plist installed at `~/Library/LaunchAgents/com.theo.claude-mastery.plist` is currently loaded and runs daily at 07:15. Renaming it requires:

1. `launchctl unload` + delete the old plist
2. Update `scripts/launchd/install.sh` LABEL + plist template filename
3. Re-run `npm run schedule:install` to install under new label

**Risk if skipped:** Job keeps working under old label, but the codebase + label diverge — confusing forever. Keep skipped: Job continues firing as `com.theo.claude-mastery`, no impact, just a stale string.

**My recommendation:** Do the rename. It's reversible (you can reinstall in either direction).

### D5. Historical references in `docs/superpowers/plans/*.md`

Three plan files reference PR URLs like `https://github.com/theoju/claude-code-mastery/pull/26`. GitHub auto-redirects these. Options:

- **A.** Update them to the new URL (consistent, but rewrites history).
- **B.** Leave them (these are point-in-time records; the redirect makes them work).

**My recommendation: B.** The plans were written under the old name; rewriting them now turns them into something that didn't actually exist. The redirect makes them functional.

---

## Files to change (29 occurrences in 17 files)

Grouped by what kind of change is needed.

### Group A: Pure brand/copy text (decision D1)

| File | Lines | What |
|---|---|---|
| `app/layout.tsx` | 5, 7 | `<title>` and meta description |
| `app/methodology/page.tsx` | 5 | page metadata title |
| `app/page.tsx` | 51, 62 | header text + intro paragraph |
| `README.md` | 1, 29 | `# Claude Code Mastery` heading + console example |
| `CLAUDE.md` | 1 | `# Project memory: claude-code-mastery` heading |
| `docs/self-assessment.md` | 121 | console example |
| `e2e/dashboard.spec.ts` | 6 | Playwright assertion `getByText(/Claude Code Mastery/i)` |
| `scripts/__tests__/integration/pipeline.test.mjs` | 73 | regex `/Claude Code Mastery — Engineer/` |
| `scripts/run-assessment.mjs` | 182 | console output line |
| `scripts/setup.sh` | 24 | `echo "Claude Code Mastery — one-time setup"` |
| `scripts/launchd/install.sh` | 2 | header comment |
| `scripts/slack.mjs` | 37, 40, 41, 45 | Slack message username, fallback titles, header text |

### Group B: Slug references (decision D2 + D3)

| File | Lines | What |
|---|---|---|
| `package.json` | 2 | `"name": "claude-code-mastery-dashboard"` |
| `assessment.config.example.json` | 9, 10 | `"channel": "#claude-code-mastery"`, `"username": "Claude Code Mastery"` |
| `assessment.config.json` | 8 | local config — `"username": "Claude Code Mastery"` (gitignored, but should match) |
| `.claude/skills/self-assessment/setup.md` | 15, 37, 38 | example channel + username in skill docs |

### Group C: GitHub URL references (auto-redirect makes these work, but stale)

These are decision **D5**. If you choose A (rewrite), 3 files in `docs/superpowers/plans/` need updating. If B (leave), no action.

### Group D: LaunchAgent (decision D4)

If you choose to rename:

| File | Change |
|---|---|
| `scripts/launchd/install.sh` line 12 | `LABEL="com.$(whoami).claude-mastery"` → `LABEL="com.$(whoami).claude-self-assessment"` |
| `scripts/launchd/install.sh` line 15 | `TEMPLATE=".../claude-mastery.plist.template"` → `claude-self-assessment.plist.template` |
| `scripts/launchd/claude-mastery.plist.template` | Rename file → `claude-self-assessment.plist.template` |
| `scripts/launchd/install-coverage.sh` line 56 | header reference to "Mastery routine" → "Self-Assessment routine" |
| `~/Library/LaunchAgents/com.theo.claude-mastery.plist` | Unload via `launchctl unload`, delete, then `npm run schedule:install` re-installs under new label |

### Group E: Local git remote (always do, regardless of decisions)

```bash
git remote set-url origin git@github.com:theoju/claude-code-self-assessment.git
git fetch origin   # verify
```

---

## Execution order (after decisions)

The order matters because some steps invalidate the running daily job.

```
1. [Group E] Update local git remote
2. [Group A]  Bulk-replace brand strings (sed -i, then manual verify)
3. [Group B]  Update package.json + config example + skill docs
4. [Group C]  (Optional) Rewrite historical plan URLs
5. [Group D]  (If chosen) LaunchAgent rename:
   5a. launchctl unload ~/Library/LaunchAgents/com.theo.claude-mastery.plist
   5b. rm ~/Library/LaunchAgents/com.theo.claude-mastery.plist
   5c. mv plist template + edit install.sh + install-coverage.sh
   5d. npm run schedule:install   (re-installs under new label)
   5e. launchctl list | grep claude   (verify new label loaded)
6. Run `npx vitest run`           (expect 189/189 — Playwright e2e regex changed in step 2)
7. Run `npm run assess --print`   (visually verify Slack/console copy reads correctly)
8. Visit http://localhost:3737    (visually verify dashboard headers)
9. Open PR off branch `chore/rename-to-self-assessment` against main
```

---

## Verification checklist

After executing, every one of these MUST come back clean:

```bash
# 1. Zero matches in any tracked file
git grep -i "claude-code-mastery"           # expect: 0 results
git grep -i "Claude Code Mastery"           # expect: 0 results (or only intentional historical refs)

# 2. Package builds
npm run build                                # expect: clean

# 3. Tests pass
npx vitest run                               # expect: 189/189

# 4. Dashboard renders
npm run assess -- --print --no-slack        # expect: header reads new name

# 5. Remote works
git fetch origin                             # expect: silent success

# 6. (If D4 chosen) LaunchAgent reloaded
launchctl list | grep claude-self-assessment # expect: loaded
launchctl list | grep claude-mastery         # expect: 0 results
```

---

## Risk / blast radius

- **Low risk overall.** This is a string rename with no schema or behavior change.
- **One sharp edge:** the LaunchAgent rename (D4) momentarily leaves you with no scheduled job between unload and reinstall. The window is seconds. If the rename happens between 07:14 and 07:16, the daily run skips. Trivial; just don't rename at 07:15.
- **GitHub URL redirect** has no expiry as long as the repo isn't recreated under the old name. Even if I miss a reference, it'll keep working.
- **No data loss possible.** No schema changes, no DB, no published artefact.

---

## Self-review

| Spec item | Where addressed |
|---|---|
| "validate all places in the docs" | Group A + B + C |
| "output" | scripts/run-assessment.mjs, scripts/slack.mjs (Group A) |
| "github updates" | Group E (remote URL) + D5 (PR URL refs) |
| "tell me what needs to be reviewed" | Decisions D1–D5 above |
| "to replace the naming" | Execution order steps 1–4 |

No placeholders. Every decision has a recommendation. Every file has explicit lines.

---

## Awaiting your decisions

Reply with **D1–D5** picks (e.g. "A, A, yes, yes, B"), and I'll execute.

If you just say "go with all my recommendations", that maps to: **A, A, yes, yes, B** — full rename, including the LaunchAgent, leaving historical plan URLs alone.
