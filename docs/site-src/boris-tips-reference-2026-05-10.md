# Boris Cherny — Claude Code Tips Reference

**Captured:** 2026-05-10
**Source:** Boris Cherny's tip threads (and team-member additions where noted) on X/Twitter, posted Jan 2 2026 → Apr 16 2026.
**Purpose:** Canonical reference for the 87-tip classification (`docs/tip-classification-2026-05-10.md`) and the dashboard's `boris-tips-content.json`. The dashboard data file currently holds 75 tips; this reference is the source-of-truth for the missing 12 (rows 76–87 in the classification doc).

The threads are reproduced as posted, with thread numbers, posting dates, and link placeholders preserved. Tips within each thread are listed in the order Boris posted them.

---

## Thread 1 — January 2, 2026 (link)

1. Run 5 Claudes in parallel in your terminal, each in its own git checkout, numbered tabs 1–5, with iTerm2 system notifications.
2. Run 5–10 additional sessions on claude.ai/code; hand off between local and web using `&` or `--teleport`; kick off sessions from the Claude iOS app.
3. Use Opus 4.5 with thinking for everything — less steering and better tool use makes it faster overall despite being larger.
4. Share a single CLAUDE.md for your repo, checked into git; add to it anytime Claude does something wrong.
5. Tag `@.claude` on coworkers' PRs during code review to add learnings to CLAUDE.md (using the GitHub Action via `/install-github-action`).
6. Start most sessions in Plan mode (shift+tab twice); iterate on the plan, then switch to auto-accept for one-shot implementation.
7. Use slash commands for every "inner loop" workflow (e.g. `/commit-push-pr`); store in `.claude/commands/`, check into git; use inline bash to pre-compute context.
8. Use subagents for common PR workflows (code-simplifier, verify-app, etc.) stored in `.claude/agents/`.
9. Use a PostToolUse hook to auto-format code after every write/edit.
10. Use `/permissions` to pre-allow common safe commands instead of `--dangerously-skip-permissions`; share in `.claude/settings.json`.
11. Integrate tools like Slack (via MCP), BigQuery (`bq` CLI), and Sentry so Claude can use them autonomously.
12. For long-running tasks, use background agent verification, agent Stop hooks, or `--permission-mode=dontAsk`.
13. **Most important tip:** Give Claude a way to verify its work (bash, test suites, browser testing via Chrome extension) — this 2–3x's the quality of results.

## Thread 2 — January 31, 2026 (link)

14. Do more in parallel with 3–5 git worktrees, each running its own Claude session; name worktrees and set up shell aliases (`za`, `zb`, `zc`).
15. Start every complex task in plan mode; have one Claude write the plan and a second Claude review it as a staff engineer; switch back to plan mode when things go sideways.
16. Invest in your CLAUDE.md — after every correction say "Update your CLAUDE.md so you don't make that mistake again"; ruthlessly edit over time.
17. Create your own skills and commit them to git; turn anything you do more than once a day into a skill or command (e.g. `/techdebt`, Slack/GDrive/Asana context sync).
18. Claude fixes most bugs by itself — paste a Slack bug thread and say "fix"; say "Go fix the failing CI tests"; point Claude at docker logs for distributed systems.
19. Level up your prompting: challenge Claude ("grill me on these changes"), tell it to scrap mediocre fixes and implement the elegant solution, write detailed specs to reduce ambiguity.
20. Terminal setup: use Ghostty; customize `/statusline`; color-code and name terminal tabs; use voice dictation (fn×2 on macOS) — you speak 3x faster than you type.
21. Use subagents: append "use subagents" to throw more compute at problems; offload tasks to keep main context clean; route permission requests through an Opus-powered subagent via a hook.
22. Use Claude for data and analytics via the `bq` CLI and BigQuery skills — Boris hasn't written SQL in 6+ months; works with any database that has a CLI, MCP, or API.
23. Use Claude for learning: enable "Explanatory" or "Learning" output style, have Claude generate HTML presentations of unfamiliar code, ask for ASCII diagrams, build spaced-repetition learning skills.

## Thread 3 — February 11, 2026 (link)

24. Configure your terminal: `/config` for theme, enable notifications, `/terminal-setup` for shift+enter newlines, `/vim` for vim mode.
25. Adjust effort level via `/model` (low/medium/high); Boris uses High for everything.
26. Install plugins, MCPs, and skills via `/plugin` — LSPs for every major language, custom marketplaces; check `settings.json` into your codebase.
27. Create custom agents by dropping `.md` files in `.claude/agents` with custom name, color, tool set, permission mode, and model; set a default agent in `settings.json`.
28. Pre-approve common permissions with `/permissions`; full wildcard syntax (e.g. `Bash(bun run *)`, `Edit(/docs/**)`); check into team `settings.json`.
29. Enable sandboxing via `/sandbox` for improved safety with reduced permission prompts; supports file and network isolation.
30. Add a custom status line via `/statusline` showing model, directory, context remaining, cost, etc.
31. Customize every keybinding via `/keybindings` (stored in `~/.claude/keybindings.json`); settings live reload.
32. Set up hooks for agent lifecycle: route permissions to Slack/Opus, nudge Claude to keep going on Stop, pre/post-process tool calls, add custom logging.
33. Customize spinner verbs in settings (e.g. Star Trek themed); check into source control to share with team.
34. Use output styles via `/config` — Explanatory, Learning, or Custom styles to adjust Claude's voice.
35. Customize all the things — 37 settings and 84 env vars supported; configure per codebase, per folder, per user, or enterprise-wide.

## Thread 4 — February 20, 2026 (link)

36. Use `claude --worktree` to run Claude Code in its own git worktree; name your worktree or let Claude name it.
37. Use worktree mode in the Desktop app by checking the "worktree" checkbox in the Code tab.
38. Subagents now support worktree isolation — especially powerful for large batched changes and code migrations.
39. Custom agents can always run in their own worktree by adding `isolation: worktree` to agent frontmatter.
40. Non-git VCS users (Mercurial, Perforce, SVN) can define `WorktreeCreate`/`WorktreeRemove` hooks for isolation.

## Thread 5 — February 27, 2026 (link)

41. `/simplify` — uses parallel agents to improve code quality, tune efficiency, and ensure CLAUDE.md compliance.
42. `/batch` — interactively plan code migrations, then execute in parallel using dozens of agents with git worktree isolation, each testing and creating a PR.

## Thread 6 — March 7–10, 2026 (link)

43. `/loop` — schedule recurring tasks for up to 3 days; use for PR babysitting, Slack summaries, deploy monitoring.
44. Code Review — when a PR opens, Claude dispatches a team of specialized agents to hunt for bugs and post inline comments.
45. `/btw` — ask a side-chain question while Claude is actively working; single-turn, no tool calls, full conversation context.

## Thread 7 — March 13, 2026 (posted by @trq212, link)

46. `/effort max` — max reasoning mode where Claude reasons as long as needed; burns usage faster, activate per session.
47. `claude remote-control` — spawn new local sessions from the mobile app (Max, Team, Enterprise).
48. Voice mode — rolled out to 100% of users in Desktop and Cowork.
49. Setup scripts — automate cloud environment setup that runs before Claude Code launches.
50. `claude --name` — name your session at launch for easy identification when running multiple sessions.
51. Auto session naming — after plan mode, Claude auto-names your session based on what you're working on.
52. `/color` — customize the prompt input color per session to visually distinguish parallel sessions.
53. PostCompact hook — fires after context compression so you can re-inject critical instructions or log compaction events.

## Thread 8 — March 23–25, 2026 (links)

54. Auto mode — model-based classifiers auto-approve safe operations, flag risky ones; the middle ground between constant approvals and `--dangerously-skip-permissions`.
55. `/schedule` — cloud-based recurring jobs that run even when your laptop is closed (unlike `/loop` which is local).
56. iMessage plugin — install via `/plugin install imessage@claude-plugins-official`; text Claude like a contact from any Apple device.
57. Auto-memory and auto-dream — `/memory` to configure; Claude auto-saves preferences/corrections between sessions; auto-dream periodically consolidates and cleans memory like REM sleep.

## Thread 9 — March 29, 2026 (link)

58. Claude Code has a mobile app — use the Code tab in the Claude iOS/Android app for full sessions.
59. Move sessions between devices with `/teleport` or `/remote-control`; enable "Enable Remote Control for all sessions" in `/config`.
60. `/loop` and `/schedule` for automated workflows — turn workflows into skills + loops (e.g. `/babysit`, `/slack-feedback`, `/post-merge-sweeper`, `/pr-pruner`).
61. Hooks for deterministic agent lifecycle: SessionStart, PreToolUse, PermissionRequest, Stop events.
62. Cowork Dispatch — secure remote control for the Claude Desktop app; uses your MCPs, browser, and computer.
63. Use the Chrome extension for frontend work — give Claude a way to verify its output by letting it use a browser.
64. Desktop app auto-starts and tests web servers with a built-in browser.
65. Fork your session with `/branch` or `claude --resume <id> --fork-session`.
66. `/btw` for side queries while Claude works.
67. Git worktrees via `claude -w`; `WorktreeCreate` hook for non-git VCS.
68. `/batch` for fanning out massive changesets to dozens/hundreds of worktree agents.
69. `--bare` flag for 10x faster SDK startup by skipping local CLAUDE.md/settings/MCP discovery.
70. `--add-dir` or `/add-dir` to give Claude access to additional repos; add `additionalDirectories` to team `settings.json`.
71. `--agent` to launch with a custom agent that has its own system prompt, tools, and permissions.
72. `/voice` for voice input — hold spacebar in CLI, press voice button in Desktop, or use iOS dictation.

## Thread 10 — April 14–16, 2026 (Boris + team members)

73. Routines — configure once (prompt, repo, connectors), trigger on a schedule (cron), GitHub event, or API webhook; runs on Anthropic infra.
74. `/rewind` over correcting — double-tap Esc to drop failed attempts from context instead of correcting inline.
75. `/compact` vs `/clear` — compact for lossy LLM summary when continuing related work; clear for hand-written brief when starting fresh.
76. Lower your auto-compact threshold (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`) to avoid context rot around 300–400k tokens.
77. Delegation over guidance — treat Opus 4.7 like an engineer you delegate to, not a pair programmer you guide line by line.
78. Give full task context upfront: goal, constraints, and acceptance criteria in the first turn.
79. xhigh effort — new default for Opus 4.7, reasons longer before acting.
80. Auto mode + parallel Claudes — auto mode means you can run more Claudes simultaneously without babysitting.
81. `/fewer-permission-prompts` — scans session history and recommends safe commands to add to your allowlist.
82. Recaps — short summaries of what an agent did while you were away.
83. Focus mode (`/focus`) — hides intermediate work, shows only the final result.
84. `/go` — composite skill that verifies, runs `/simplify`, and puts up a PR.
85. Three behavioral shifts from 4.6 to 4.7: calibrated response length, less automatic tool usage, more judicious subagent spawning.
86. Task completion notifications — sound alerts, Stop hooks, iTerm2 notifications, or recaps.

---

## Notes on numbering

The numbering above is sequential across all threads as posted (1–86 in this capture). The dashboard's classification doc treats the canonical Boris post as 87 tips; the 87th may be a more recent thread item not present in this capture. In `docs/tip-classification-2026-05-10.md` the row numbers are mapped to the dashboard's data-file ordering, which clusters related deep-dives differently — see that doc's rows 76–87 for the gap-filled mapping into the 75-row data file.

## Provenance

- Threads 1–6 are Boris's original posts on X.
- Thread 7 is by `@trq212` (Anthropic team, March 13, 2026).
- Thread 8 mixes Boris's thread and follow-up posts.
- Thread 9 is Boris's "Claude Code summary" thread on March 29, 2026.
- Thread 10 mixes Boris's April 14 post and Cat Wu's April 16 follow-up on Opus 4.7 best practices.

When new threads land, append a new section here and update `boris-tips-content.json` accordingly. Do not silently re-number historical tips.
