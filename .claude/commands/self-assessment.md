---
description: Run the Claude Code Self-Assessment. Scores ~/.claude/* state against Boris Cherny's 87 tips and the two-axis Platform Setup vs Execution rubric, then (if configured) posts the summary to Slack.
argument-hint: [--no-slack] [--print] [--include-transcripts] [--no-transcripts] [--insights-lookback N] [--progression-lookback N|none] [--claude-md-target name=path|path]
allowed-tools: Bash(node:*), Bash(npm:*), Edit, Read, Write
---

# /self-assessment

Run `npm run assess -- $ARGUMENTS`, then report back per the contract in [`.claude/skills/self-assessment/SKILL.md`](../skills/self-assessment/SKILL.md).

Follow the protocol and spoke index defined in SKILL.md for setup, gotchas, and signals.

Full human-facing user guide: [`docs/site-src/self-assessment.md`](../../docs/site-src/self-assessment.md).
