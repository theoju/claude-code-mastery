// Deterministic scoring. Pure function of signals → {score, tier, evidence, gaps}.
// Rules are intentionally transparent so trends (↗/↘) reflect actual config changes.

export const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));

export function tierFor(score) {
  if (score >= 85) return "advanced";
  if (score >= 70) return "solid";
  if (score >= 55) return "developing";
  if (score >= 30) return "starter";
  return "not-touched";
}

export const SCORERS = {
  automation(s) {
    let score = 25;
    const ev = [];
    const gaps = [];
    if (s.settings.hookTotalCount > 0) {
      // Three-state hookFireCount: number > 0 → warm (full credit); 0 → cold
      // (capped credit); null → telemetry absent (trust the config). The null
      // path matters: Claude Code does not emit hook-fires.jsonl by default,
      // so most users would otherwise be falsely cold-gated.
      const fireCount = s.insights?.hookFireCount;
      const cold = typeof fireCount === "number" && fireCount === 0;
      const credit = cold
        ? Math.min(7, s.settings.hookTotalCount * 2)
        : Math.min(25, s.settings.hookTotalCount * 8);
      score += credit;
      const note = cold ? " (no fires in window — gated)" : "";
      ev.push(
        `${s.settings.hookTotalCount} hook(s) configured across: ${s.settings.hookEvents.join(", ")}${note}`,
      );
      if (cold)
        gaps.push(
          "Hooks are configured but none fired in the recent window — wire them to actual events",
        );
    } else {
      gaps.push(
        "settings.json has no hooks block — no PostToolUse, Stop, SessionStart, or PostCompact hooks",
      );
    }
    if (s.personalAgents.length > 0) {
      score += Math.min(15, 5 * s.personalAgents.length);
      ev.push(
        `${s.personalAgents.length} personal agent(s) under ~/.claude/agents`,
      );
    } else {
      gaps.push("~/.claude/agents is empty — zero personal custom agents");
    }
    if (s.personalCommands.length > 0) {
      score += Math.min(15, 5 * s.personalCommands.length);
      ev.push(
        `${s.personalCommands.length} personal slash command(s) under ~/.claude/commands`,
      );
    } else {
      gaps.push("~/.claude/commands is empty — zero personal slash commands");
    }
    if (s.projectCommands.length > 0) {
      score += 8;
      ev.push(
        `${s.projectCommands.length} project-scoped command(s) under .claude/commands`,
      );
    }
    if (s.personalSkills.filter((x) => x !== "boris").length > 0) {
      score += 7;
      ev.push(`${s.personalSkills.length} personal skill(s)`);
    } else {
      gaps.push("No personal skills beyond plugin-installed ones");
    }
    if (s.has.prReviewToolkit || s.has.codeReview)
      ev.push("Review/simplify plugins cover PR lifecycle");
    const shipsRecent = s.shipsRecent ?? s.shipJournal?.totalRuns ?? 0;
    if (shipsRecent >= 1) {
      score += 5;
      ev.push(`${shipsRecent} /ship run(s) recently`);
    }
    return { score: clamp(score), evidence: ev, gaps };
  },

  permissions(s) {
    let score = 50;
    const ev = [];
    const gaps = [];
    if (s.settings.skipDangerousModePermissionPrompt) {
      score -= 25;
      gaps.push(
        "skipDangerousModePermissionPrompt: true bypasses the auto-mode classifier — strict downgrade",
      );
    } else {
      score += 15;
      ev.push("Not using the dangerous-skip bypass");
    }
    if (s.settings.permissionsDefaultMode === "auto") {
      score += 10;
      ev.push("permissions.defaultMode: auto — auto-mode classifier active");
    }
    const allowCount = s.settings.allowList.length;
    if (allowCount === 0) {
      gaps.push(
        "No permission allowlist entries — every new tool triggers a prompt",
      );
    } else {
      score += Math.min(20, allowCount * 3);
      ev.push(
        `${allowCount} permission allowlist entr${allowCount === 1 ? "y" : "ies"}`,
      );
    }
    if (s.settings.denyList.length > 0) {
      score += 5;
      ev.push(`${s.settings.denyList.length} denylist entries`);
    }
    // Amplify the bypass penalty when transcripts confirm interactive bypass use
    // — a config-clean user can still toggle bypassPermissions per session.
    const bypassUse = s.insights?.bypassPermissionsSessionCount;
    if (typeof bypassUse === "number" && bypassUse > 0) {
      const penalty = Math.min(25, bypassUse);
      score -= penalty;
      gaps.push(
        `bypassPermissions used in ${bypassUse} recent session(s) — −${penalty}`,
      );
    }
    return { score: clamp(score), evidence: ev, gaps };
  },

  "model-effort"(s) {
    let score = 40;
    const ev = [];
    const gaps = [];
    const effort = s.settings.effortLevel;
    if (effort === "max" || effort === "xhigh") {
      score += 35;
      ev.push(`effortLevel: "${effort}" — aligned with Opus 4.7 expectations`);
    } else if (effort === "high") {
      score += 15;
      gaps.push(`effortLevel: "high" — Opus 4.7's tuned default is "xhigh"`);
    } else if (effort === "medium" || effort === "low") {
      gaps.push(`effortLevel: "${effort}" — significantly under-tuned for 4.7`);
    }
    if (s.settings.autoCompactWindow) {
      score += 15;
      ev.push(
        `CLAUDE_CODE_AUTO_COMPACT_WINDOW=${s.settings.autoCompactWindow} set`,
      );
    } else {
      gaps.push(
        "No CLAUDE_CODE_AUTO_COMPACT_WINDOW env var — exposed to context rot past 300-400k tokens",
      );
    }
    return { score: clamp(score), evidence: ev, gaps };
  },

  parallel(s) {
    let score = 40;
    const ev = [];
    const gaps = [];
    if (s.has.superpowers) {
      score += 15;
      ev.push(
        "superpowers plugin: worktrees, parallel agents, subagent-driven-development",
      );
    }
    if (s.has.prReviewToolkit) {
      score += 8;
      ev.push("pr-review-toolkit: parallel specialist reviewers");
    }
    if (s.has.featureDev) {
      score += 7;
      ev.push(
        "feature-dev: code-architect / code-explorer / code-reviewer agents",
      );
    }
    if (s.personalAgents.length >= 1) {
      score += 15;
      ev.push(
        `${s.personalAgents.length} personal agent(s) tuned to your domain`,
      );
    } else {
      gaps.push("No personal custom agents tuned to your domain");
    }
    if (s.personalAgents.length === 0)
      gaps.push(
        "Worktree muscle memory unverified — no personal agents using isolation:worktree",
      );
    const worktreeAliasCount =
      s.worktreeAliasCount ?? s.shellAliases?.worktreeAliasCount ?? 0;
    const worktreeShortcutCount =
      s.worktreeShortcutCount ?? s.shellAliases?.worktreeShortcutCount ?? 0;
    const worktreeUsageSessionCount =
      s.worktreeUsageSessionCount ?? s.insights?.worktreeUsageSessionCount ?? 0;
    const batchCommandUses =
      s.batchCommandUses ?? s.transcriptInvocations?.batchCommandUses ?? 0;
    // v0.9 bonuses cap at +15 combined per the calibration design (see
    // docs/superpowers/plans/archived/2026-05-09-score-formula-update.md). Each
    // signal still contributes its full weight when fired alone.
    let v9Bonus = 0;
    // Tip 1 broadening (2026-05-10): credit any of the three adoption paths.
    // Boris's tip is "spin up 3-5 parallel worktree sessions" — the aliases
    // are means, not end. Evidence string reflects whichever path fired.
    if (worktreeAliasCount >= 3) {
      v9Bonus += 8;
      ev.push(`${worktreeAliasCount} worktree alias(es) (za/zb/zc) configured`);
    } else if (worktreeShortcutCount >= 3) {
      v9Bonus += 8;
      ev.push(
        `${worktreeShortcutCount} worktree shell shortcut(s) configured (broad)`,
      );
    } else if (worktreeUsageSessionCount >= 3) {
      v9Bonus += 8;
      ev.push(
        `${worktreeUsageSessionCount} parallel-worktree session(s) in lookback window`,
      );
    }
    if (batchCommandUses >= 1) {
      v9Bonus += 10;
      ev.push(`/batch prompt phrasing adopted (${batchCommandUses} uses)`);
    }
    score += Math.min(15, v9Bonus);
    return { score: clamp(score), evidence: ev, gaps };
  },

  verification(s) {
    let score = 40;
    const ev = [];
    const gaps = [];
    if (s.has.playwright) {
      score += 15;
      ev.push("playwright plugin — browser verification");
    }
    if (s.has.semgrep) {
      score += 10;
      ev.push("semgrep plugin — static analysis");
    }
    if (s.has.prReviewToolkit || s.has.codeReview) {
      score += 10;
      ev.push("post-change review plugins");
    }
    if (s.has.superpowers) {
      score += 5;
      ev.push("superpowers:verification-before-completion active");
    }
    const hasGo =
      s.personalCommands.includes("go.md") ||
      s.projectCommands.includes("go.md");
    if (hasGo) {
      score += 12;
      ev.push("/go composite command present");
    } else gaps.push("No /go composite command in personal or project library");
    if (!s.has.playwright)
      gaps.push(
        "No browser-automation plugin — frontend verification is incomplete",
      );
    const hasClaudeInChrome =
      s.hasClaudeInChrome ?? !!s.settings?.hasClaudeInChrome;
    if (hasClaudeInChrome) {
      score += 5;
      ev.push("Claude in Chrome — frontend verification reach");
    }
    const shipVerifyStageRecent =
      s.shipVerifyStageRecent ?? s.shipJournal?.stage2Count ?? 0;
    if (shipVerifyStageRecent >= 1) {
      score += 5;
      ev.push(`/ship verify-agent fired ${shipVerifyStageRecent}× recently`);
    }
    const goCommandUses =
      s.goCommandUses ?? s.transcriptInvocations?.goCommandUses ?? 0;
    if (goCommandUses >= 3) {
      score += 3;
      ev.push(`/go reflex adopted (${goCommandUses} uses)`);
    }
    const desktopSessionCount =
      s.desktopSessionCount ?? s.insights?.desktopSessionCount ?? 0;
    if (desktopSessionCount >= 1) {
      score += 5;
      ev.push("Used the Claude Code desktop app — Boris tip 52");
    }
    return { score: clamp(score), evidence: ev, gaps };
  },

  memory(s) {
    let score = 45;
    const ev = [];
    const gaps = [];
    if (s.memory.length > 0) {
      score += 20;
      ev.push(
        `Auto-memory active on ${s.memory.length} project(s) — ${s.memory.reduce((n, m) => n + m.fileCount, 0)} memory files total`,
      );
    } else {
      gaps.push("No MEMORY.md files found under ~/.claude/projects");
    }
    if (s.has.claudeMdMgmt) {
      score += 10;
      ev.push("claude-md-management plugin installed");
    }
    if (s.claudeMdExists) {
      score += 10;
      ev.push("CLAUDE.md present (project or global)");
    } else gaps.push("No CLAUDE.md at project root yet");
    if (s.plansCount > 10) {
      score += 8;
      ev.push(`${s.plansCount} saved plans — active planner`);
    }
    if (!s.settings.autoCompactWindow)
      gaps.push(
        "No CLAUDE_CODE_AUTO_COMPACT_WINDOW set — context rot risk above 300-400k",
      );
    return { score: clamp(score), evidence: ev, gaps };
  },

  planning(s) {
    let score = 55;
    const ev = [];
    const gaps = [];
    if (s.has.superpowers) {
      score += 15;
      ev.push("brainstorming / writing-plans / executing-plans skills");
    }
    if (s.has.karpathy) {
      score += 8;
      ev.push("karpathy-guidelines — surgical, verifiable prompts");
    }
    if (s.plansCount >= 10) {
      score += 10;
      ev.push(`${s.plansCount} saved plans`);
    }
    if (s.has.featureDev) {
      score += 5;
      ev.push("feature-dev: structured feature workflow");
    }
    gaps.push(
      "Behavioral check: does every non-trivial prompt include Goal / Constraints / Acceptance Criteria upfront?",
    );
    const planThenLaunchSessions =
      s.planThenLaunchSessions ??
      s.transcriptInvocations?.planThenLaunchSessions ??
      0;
    if (planThenLaunchSessions >= 1) {
      score += 5;
      ev.push(
        `Plan-then-launch discipline detected (${planThenLaunchSessions} session(s))`,
      );
    }
    return { score: clamp(score), evidence: ev, gaps };
  },

  integrations(s) {
    let score = 20;
    const ev = [];
    const gaps = [];
    score += Math.min(70, s.plugins.length * 3);
    ev.push(`${s.plugins.length} plugins enabled`);
    if (s.has.vercel) ev.push("vercel plugin installed");
    if (s.has.imessage) ev.push("imessage plugin — Boris tip 44 adopted");
    if (!s.plugins.some((p) => p.toLowerCase().includes("slack"))) {
      gaps.push(
        "No Slack MCP — Boris tip 9 relies on it for bug triage and daily summaries",
      );
    }
    const mcpServersConnected =
      s.mcpServersConnected ??
      (Array.isArray(s.mcpServers)
        ? s.mcpServers.filter((m) => m && m.status === "connected").length
        : 0);
    if (mcpServersConnected > 0) {
      const mcpBonus = Math.min(15, mcpServersConnected * 3);
      score += mcpBonus;
      ev.push(`${mcpServersConnected} connected MCP server(s)`);
    }
    const hasClaudeInChrome =
      s.hasClaudeInChrome ?? !!s.settings?.hasClaudeInChrome;
    if (hasClaudeInChrome) {
      score += 5;
      ev.push("Claude in Chrome integration enabled");
    }
    return { score: clamp(score), evidence: ev, gaps };
  },

  customization(s) {
    let score = 45;
    const ev = [];
    const gaps = [];
    if (s.statuslineConfigured) {
      score += 15;
      ev.push("Custom statusline.sh configured");
    }
    if (s.has.explanatoryStyle) {
      score += 10;
      ev.push("explanatory-output-style plugin enabled");
    }
    if (s.keybindingsConfigured) {
      score += 10;
      ev.push("Custom keybindings.json");
    } else gaps.push("No custom ~/.claude/keybindings.json");
    const focusCommandUses =
      s.focusCommandUses ?? s.transcriptInvocations?.focusCommandUses ?? 0;
    if (focusCommandUses >= 1) {
      score += 5;
      ev.push(`/focus adopted (${focusCommandUses} session(s))`);
    }
    const hasTerminalSetup =
      s.hasTerminalSetup ?? !!s.settings?.hasTerminalSetup;
    if (hasTerminalSetup) {
      score += 5;
      ev.push(
        "Terminal configured (deep-link / Option-as-Meta) — Boris tip 11",
      );
    }
    // Breadth bonus rewards configuring many surfaces on top of the per-surface
    // depth credit above. The overlap (explanatory style + terminal setup count
    // both here and individually) is intentional: tip 27 ("customize
    // everything") is about breadth, so a broadly-configured setup earns both.
    const surfaces = [
      s.statuslineConfigured,
      s.keybindingsConfigured,
      s.has.explanatoryStyle,
      (s.settings?.customSpinnerVerbCount || 0) > 0,
      !!s.settings?.hasTerminalSetup,
      (s.colorCommandUses ?? 0) > 0,
      (s.voiceCommandUses ?? 0) > 0,
    ].filter(Boolean).length;
    if (surfaces >= 4) {
      score += 10;
      ev.push(
        `${surfaces} customization surfaces configured — "customize everything" (Boris tip 27)`,
      );
    }
    return { score: clamp(score), evidence: ev, gaps };
  },

  scheduled(s) {
    let score = 25;
    const ev = [];
    const gaps = [];
    if (s.has.ralphLoop) {
      score += 15;
      ev.push("ralph-loop plugin — /loop capability");
    }
    const hasScheduled =
      s.personalCommands.some(
        (c) => c.includes("babysit") || c.includes("loop"),
      ) ||
      s.projectCommands.some(
        (c) => c.includes("babysit") || c.includes("loop"),
      );
    if (hasScheduled) {
      score += 20;
      ev.push("Custom scheduled/loop commands present");
    } else
      gaps.push(
        "No active /loop babysitter or /schedule job in personal commands",
      );
    const stopHook = (s.settings.hookEvents || []).includes("Stop");
    if (stopHook) {
      score += 10;
      ev.push("Stop hook configured");
    } else
      gaps.push(
        "No Stop hook for task-completion notifications — Boris tip 75",
      );
    const babysitLoopUses =
      s.babysitLoopUses ?? s.transcriptInvocations?.babysitLoopUses ?? 0;
    const scheduleCommandUses =
      s.scheduleCommandUses ??
      s.transcriptInvocations?.scheduleCommandUses ??
      0;
    // v0.9 bonuses cap at +15 combined per the calibration design.
    let v9Bonus = 0;
    if (babysitLoopUses >= 1) {
      v9Bonus += 10;
      ev.push(`/loop /babysit pattern adopted (${babysitLoopUses} session(s))`);
    }
    if (scheduleCommandUses >= 1) {
      v9Bonus += 5;
      ev.push(`/schedule routine adopted (${scheduleCommandUses} use(s))`);
    }
    score += Math.min(15, v9Bonus);
    return { score: clamp(score), evidence: ev, gaps };
  },

  remote(s) {
    let score = 35;
    const ev = [];
    const gaps = [];
    if (s.has.imessage) {
      score += 20;
      ev.push("imessage plugin installed");
    } else gaps.push("No imessage plugin — Boris tip 44");
    const hasRemoteControl =
      s.hasRemoteControl ?? !!s.settings?.hasRemoteControl;
    if (hasRemoteControl) {
      score += 10;
      ev.push("Remote Control opted in (Boris tip 47)");
    }
    return { score: clamp(score), evidence: ev, gaps };
  },

  learning(s) {
    let score = 55;
    const ev = [];
    const gaps = [];
    if (s.has.explanatoryStyle) {
      score += 20;
      ev.push("explanatory-output-style enabled");
    }
    if (s.has.karpathy) {
      score += 10;
      ev.push("karpathy-guidelines — anti-overcomplication behavior");
    }
    if (s.has.skillCreator) {
      score += 5;
      ev.push("skill-creator plugin — self-improving toolkit");
    }
    return { score: clamp(score), evidence: ev, gaps };
  },
};

// Platform-Setup scorers measure "do you have the infrastructure"; execution
// scorers measure "do you actually use it." Both axes ship side-by-side.

export const GAP_REASONS = {
  NO_INSIGHTS: "Run /insights to populate execution data",
  NO_TRANSCRIPTS:
    "Set scoring.includeTranscripts: true to score this dimension's execution",
  NO_SESSIONS: "No sessions in lookback window",
  NO_MULTI_TASK: "No multi-task sessions in lookback window",
  NO_PLUGINS: "No plugins installed",
  NO_HOOK_FIRE_DATA:
    "~/.claude/hook-fires.jsonl absent — automation execution unmeasured (Claude Code does not emit this telemetry by default)",
  // For dimensions where /insights data structurally cannot carry the signal
  // (effort/model never logged to session-meta; memory tools never appear in
  // tool_counts; terminal/IDE customization is purely client-side config).
  // These render as "unmeasured" with a clear rationale instead of blank.
  NO_TELEMETRY_FOR_DIMENSION:
    "no /insights telemetry exists for this dimension — platform-setup-only by nature",
};

function unavailable(reason) {
  return { score: null, evidence: [], gaps: [], gapReason: reason };
}

// Platform-Setup-only scorers: always unavailable, but the universe
// contract still applies. Universe value is inert here.
function noTelemetry() {
  const fn = () => unavailable(GAP_REASONS.NO_TELEMETRY_FOR_DIMENSION);
  fn.__universe = "all_sessions";
  return fn;
}

function pct(n) {
  return Math.round(n * 100) / 100;
}

// Capped adoption credit — a third scorer-contribution shape alongside the
// withGates ratio scorers. NOT gated by a session denominator: these signals
// are global booleans / counters / recency from ~/.claude.json, not per-session
// rates. `cap` bounds the contribution so one ever-used flag can't dominate a
// dimension. `label` ("behavioral" | "awareness" | "proxy") is carried for
// honest rendering. Returns { points, evidence, gap, label }.
export function adoptionBonus({
  kind,
  cap,
  on,
  value,
  days,
  window,
  target,
  label = "behavioral",
  evidenceText = null,
  gapText = null,
}) {
  let frac;
  if (kind === "boolean") frac = on ? 1 : 0;
  else if (kind === "counter")
    frac =
      target > 0 && Number.isFinite(value) ? Math.min(value / target, 1) : 0;
  else if (kind === "recency")
    frac =
      Number.isFinite(days) && window > 0
        ? Math.max(0, Math.min(1, 1 - days / window))
        : 0;
  else throw new Error(`adoptionBonus: unknown kind ${kind}`);
  const points = Math.round(cap * frac);
  return {
    points,
    label,
    evidence: points > 0 ? evidenceText : null,
    gap: points > 0 ? null : gapText,
  };
}

// Wraps an execution scorer with the standard insights/transcripts/sessions
// gates so each scorer body only deals with the math, not data availability.
// `universe` is mandatory and selects which denominator the session gate uses:
//   - "interactive_only": s.insights.interactiveSessionsAnalyzed
//   - "all_sessions":     s.insights.sessionsAnalyzed
// The choice is recorded on the wrapped function as `__universe` so tests
// (and the methodology page) can audit the contract.
export function withGates(opts, fn) {
  const universe = opts.universe;
  if (
    universe !== "interactive_only" &&
    universe !== "interactive_or_unknown" &&
    universe !== "all_sessions"
  ) {
    throw new Error(
      `withGates: universe must be 'interactive_only', 'interactive_or_unknown', or 'all_sessions', got ${universe}`,
    );
  }
  const wrapped = (s) => {
    if (!s.insights) return unavailable(GAP_REASONS.NO_INSIGHTS);
    if (opts.transcripts && !s.insights.transcriptsScanned) {
      return unavailable(GAP_REASONS.NO_TRANSCRIPTS);
    }
    const denom =
      universe === "interactive_only"
        ? s.insights.interactiveSessionsAnalyzed
        : universe === "interactive_or_unknown"
          ? s.insights.interactiveOrUnknownSessionsAnalyzed
          : s.insights.sessionsAnalyzed;
    if (opts.requireSessions !== false && !denom) {
      return unavailable(GAP_REASONS.NO_SESSIONS);
    }
    return fn(s);
  };
  wrapped.__universe = universe;
  return wrapped;
}

// Coefficients calibrated so a typical "good" practice rate maps to ~70-90 and
// a poor one tapers smoothly rather than crashing to zero. Audit notes:
// - permissionsBypassPenalty=120 (was 200): soft asymmetry, bypass still
//   weighted 1.2× auto. The earlier 2× ratio crushed mixed-adoption users
//   (50% auto + 25% bypass → 0) which read as "complete failure" for someone
//   actually mostly on auto.
// - verificationDecayRate=8: replaces the linear miss-rate amplifier.
//   score = 100 * exp(-missRate * 8) — smooth, asymptotes to 0, never
//   negative pre-clamp. 10% miss → 45, 15% → 30, 20% → 20, 30% → 9.
// - integrationsTargetCallsPerSession=2: replaces coverage formula
//   (pluginsUsed/pluginsInstalled) which punished breadth. Volume-per-session
//   instead — heavy contextual use of a few specialty plugins now scores
//   high; installing 30 unused plugins no longer sinks the score.
// - parallelWorktreeBonus=50: half the weight of the primary subagent signal.
const COEFFS = {
  permissionsAutoWeight: 100,
  permissionsBypassPenalty: 120,
  verificationDecayRate: 8,
  parallelSubagentWeight: 100,
  parallelWorktreeBonus: 50,
  planningRatioWeight: 100,
  automationHookWeight: 50,
  automationOwnAgentBonus: 20,
  integrationsTargetCallsPerSession: 2,
  integrationsCoverageGapThreshold: 3,
};

export const EXECUTION_SCORERS = {
  permissions: withGates(
    { transcripts: true, universe: "interactive_only" },
    (s) => {
      const {
        autoModeSessionCount,
        bypassPermissionsSessionCount,
        interactiveSessionsAnalyzed,
      } = s.insights;
      if (
        autoModeSessionCount == null ||
        bypassPermissionsSessionCount == null
      ) {
        return unavailable(GAP_REASONS.NO_TRANSCRIPTS);
      }
      const autoRatio = autoModeSessionCount / interactiveSessionsAnalyzed;
      const bypassRatio =
        bypassPermissionsSessionCount / interactiveSessionsAnalyzed;
      const score = clamp(
        Math.round(
          autoRatio * COEFFS.permissionsAutoWeight -
            bypassRatio * COEFFS.permissionsBypassPenalty,
        ),
      );
      const evidence = [
        `Auto mode: ${autoModeSessionCount}/${interactiveSessionsAnalyzed} interactive sessions (${pct(autoRatio * 100)}%)`,
      ];
      const gaps = [];
      if (bypassPermissionsSessionCount > 0) {
        gaps.push(
          `bypassPermissions: ${bypassPermissionsSessionCount}/${interactiveSessionsAnalyzed} sessions — auto mode preferred`,
        );
      }
      return { score, evidence, gaps, gapReason: null };
    },
  ),

  verification: withGates({ universe: "all_sessions" }, (s) => {
    const { frictionCounts, sessionsAnalyzed } = s.insights;
    const buggy = frictionCounts.buggy_code || 0;
    const wrong = frictionCounts.wrong_approach || 0;
    const missRate = (buggy + wrong) / sessionsAnalyzed;
    // Exponential decay: graceful taper, no negative pre-clamp. A 15% friction
    // rate is normal sustained work; the prior 500× linear amplifier crushed
    // it to 25, treating productive engineering as failure.
    const score = clamp(
      Math.round(100 * Math.exp(-missRate * COEFFS.verificationDecayRate)),
    );
    const evidence = [
      `Verification friction rate: ${buggy} buggy_code + ${wrong} wrong_approach across ${sessionsAnalyzed} sessions (${pct(missRate * 100)}%)`,
    ];
    const gaps = [];
    if (buggy > 0)
      gaps.push(
        `${buggy} first-pass-bug events — Verification's whole point is catching these`,
      );
    return { score, evidence, gaps, gapReason: null };
  }),

  parallel: withGates({ universe: "interactive_only" }, (s) => {
    const {
      subagentSessionCount,
      worktreeUsageSessionCount,
      interactiveSessionsAnalyzed,
      transcriptsScanned,
    } = s.insights;
    const subagentRatio = subagentSessionCount / interactiveSessionsAnalyzed;
    let score = subagentRatio * COEFFS.parallelSubagentWeight;
    const evidence = [
      `Subagent dispatch: ${subagentSessionCount}/${interactiveSessionsAnalyzed} interactive sessions (${pct(subagentRatio * 100)}%)`,
    ];
    const gaps = [];
    if (transcriptsScanned) {
      const wtRatio = worktreeUsageSessionCount / interactiveSessionsAnalyzed;
      score += wtRatio * COEFFS.parallelWorktreeBonus;
      evidence.push(
        `Worktree isolation: ${worktreeUsageSessionCount}/${interactiveSessionsAnalyzed} (${pct(wtRatio * 100)}%)`,
      );
    }
    if (subagentRatio < 0.2)
      gaps.push(
        "Subagent dispatch in fewer than 20% of interactive sessions — Boris tip 1",
      );
    const cowork = adoptionBonus({
      kind: "boolean",
      cap: 15,
      on: !!s.settings?.coworkDispatchAdopted,
      label: "behavioral",
      evidenceText:
        "Cowork / agents-fleet dispatch adopted (~/.claude.json hasUsedAgentsFleet) — Boris tip 50",
      gapText: "Never dispatched a cowork / agents-fleet run — Boris tip 50",
    });
    score += cowork.points;
    if (cowork.evidence) evidence.push(cowork.evidence);
    if (cowork.gap) gaps.push(cowork.gap);
    return { score: clamp(Math.round(score)), evidence, gaps, gapReason: null };
  }),

  // requireSessions: false — gates internally on multiTaskSessionCount instead.
  planning: withGates(
    { transcripts: true, requireSessions: false, universe: "interactive_only" },
    (s) => {
      const { planModeMultiTaskSessionCount, multiTaskSessionCount } =
        s.insights;
      if (multiTaskSessionCount === 0)
        return unavailable(GAP_REASONS.NO_MULTI_TASK);
      // Numerator is the multi_task∩plan_mode intersection (not the broader
      // planModeSessionCount), so the ratio is a true fraction of multi-task
      // sessions and can't exceed 100%.
      const ratio = planModeMultiTaskSessionCount / multiTaskSessionCount;
      let score = clamp(Math.round(ratio * COEFFS.planningRatioWeight));
      const evidence = [
        `Plan mode: ${planModeMultiTaskSessionCount}/${multiTaskSessionCount} multi-task sessions (${pct(ratio * 100)}%)`,
      ];
      const gaps = [];
      if (ratio < 0.5)
        gaps.push(
          "Plan mode in fewer than half of multi-task sessions — Boris tip 65",
        );
      const planRecency = adoptionBonus({
        kind: "recency",
        cap: 8,
        days: s.settings?.planModeRecencyDays ?? null,
        window: 30,
        label: "behavioral",
        evidenceText: `Plan mode used in the last ${s.settings?.planModeRecencyDays} day(s) — recency corroboration`,
        gapText: null,
      });
      score = clamp(score + planRecency.points);
      if (planRecency.evidence) evidence.push(planRecency.evidence);
      return { score, evidence, gaps, gapReason: null };
    },
  ),

  automation: withGates({ universe: "interactive_only" }, (s) => {
    const { hookFireCount, interactiveSessionsAnalyzed, subagentSessionCount } =
      s.insights;
    // Null hookFireCount means ~/.claude/hook-fires.jsonl was absent — Claude
    // Code does not emit this telemetry by default. Distinguish from a real
    // zero (file present, no fires in window) so users without the logging
    // hook see "unmeasured" rather than a hard zero.
    if (hookFireCount === null)
      return unavailable(GAP_REASONS.NO_HOOK_FIRE_DATA);
    let score = Math.round(
      (hookFireCount / interactiveSessionsAnalyzed) *
        COEFFS.automationHookWeight,
    );
    if (s.personalAgents.length > 0 && subagentSessionCount > 0)
      score += COEFFS.automationOwnAgentBonus;
    const evidence = [
      `Hook fires: ${hookFireCount} across ${interactiveSessionsAnalyzed} interactive sessions`,
    ];
    const gaps = [];
    if (hookFireCount === 0)
      gaps.push("Zero hook fires in window — automation is dormant");
    const btw = adoptionBonus({
      kind: "counter",
      cap: 10,
      value: s.settings?.cliBtwUseCount ?? 0,
      target: 10,
      label: "behavioral",
      evidenceText: `/btw side-channel adopted (${s.settings?.cliBtwUseCount ?? 0} uses) — Boris tip 33`,
      gapText: null,
    });
    score += btw.points;
    if (btw.evidence) evidence.push(btw.evidence);
    return { score: clamp(score), evidence, gaps, gapReason: null };
  }),

  integrations: withGates(
    { requireSessions: false, universe: "all_sessions" },
    (s) => {
      const toolInvocationsByPlugin = s.insights.toolInvocationsByPlugin || {};
      const pluginsUsed = Object.keys(toolInvocationsByPlugin).length;
      const pluginsInstalled = s.plugins.length;
      if (pluginsInstalled === 0) return unavailable(GAP_REASONS.NO_PLUGINS);
      const { sessionsAnalyzed } = s.insights;
      if (sessionsAnalyzed === 0) return unavailable(GAP_REASONS.NO_SESSIONS);
      // Volume per session, not coverage. Specialty plugins (terraform, postman,
      // figma, supabase) only fire in their context — penalizing the user for
      // having installed them is geometrically wrong. Heavy contextual use of a
      // few plugins is the engaged pattern; rate against a calibration target
      // of 2 calls/session caps it linearly to 100.
      const totalPluginCalls = Object.values(toolInvocationsByPlugin).reduce(
        (sum, n) => sum + (typeof n === "number" ? n : 0),
        0,
      );
      const callsPerSession = totalPluginCalls / sessionsAnalyzed;
      const score = clamp(
        Math.round(
          Math.min(
            callsPerSession / COEFFS.integrationsTargetCallsPerSession,
            1,
          ) * 100,
        ),
      );
      const evidence = [
        `Plugin tool calls: ${totalPluginCalls} across ${sessionsAnalyzed} sessions (${pct(callsPerSession)} per session, target ${COEFFS.integrationsTargetCallsPerSession})`,
        `${pluginsUsed}/${pluginsInstalled} installed plugins fired calls in window`,
      ];
      const gaps = [];
      if (
        pluginsInstalled - pluginsUsed >
        COEFFS.integrationsCoverageGapThreshold
      ) {
        gaps.push(
          `${pluginsInstalled - pluginsUsed} plugins installed but idle in window — review whether some are deadweight (informational; doesn't reduce score)`,
        );
      }
      return { score, evidence, gaps, gapReason: null };
    },
  ),

  // Scheduled & remote work fires rarely (cron creation is one-time; remote
  // pings are sporadic). Volume-per-session would wash the signal out — most
  // users have ~0.005 invocations/session even when actively using these
  // features. Use presence-and-intensity: 1 invocation in window = 50, ≥3 = 100.
  scheduled: withGates(
    { requireSessions: false, universe: "all_sessions" },
    (s) => {
      const { scheduledInvocationsTotal, sessionsAnalyzed } = s.insights;
      if (sessionsAnalyzed === 0) return unavailable(GAP_REASONS.NO_SESSIONS);
      if (scheduledInvocationsTotal === 0) {
        return {
          score: 0,
          evidence: [
            `No scheduled-tool invocations in ${sessionsAnalyzed} sessions`,
          ],
          gaps: [
            "No CronCreate/CronDelete/CronList/ScheduleWakeup invocations — recurring/autonomous workflows dormant",
          ],
          gapReason: null,
        };
      }
      const score = clamp(
        Math.round(50 + Math.min(scheduledInvocationsTotal - 1, 2) * 25),
      );
      return {
        score,
        evidence: [
          `Scheduled-tool invocations: ${scheduledInvocationsTotal} (CronCreate/CronDelete/CronList/ScheduleWakeup) across ${sessionsAnalyzed} sessions`,
        ],
        gaps: [],
        gapReason: null,
      };
    },
  ),

  remote: withGates(
    { requireSessions: false, universe: "all_sessions" },
    (s) => {
      const { remoteInvocationsTotal, sessionsAnalyzed } = s.insights;
      if (sessionsAnalyzed === 0) return unavailable(GAP_REASONS.NO_SESSIONS);
      if (remoteInvocationsTotal === 0) {
        return {
          score: 0,
          evidence: [
            `No remote-tool invocations in ${sessionsAnalyzed} sessions`,
          ],
          gaps: [
            "No RemoteTrigger/PushNotification/SendMessage invocations — mobile/remote workflows dormant",
          ],
          gapReason: null,
        };
      }
      const score = clamp(
        Math.round(50 + Math.min(remoteInvocationsTotal - 1, 2) * 25),
      );
      return {
        score,
        evidence: [
          `Remote-tool invocations: ${remoteInvocationsTotal} (RemoteTrigger/PushNotification/SendMessage) across ${sessionsAnalyzed} sessions`,
        ],
        gaps: [],
        gapReason: null,
      };
    },
  ),

  // Tip 2: Opus-dominant session ratio. The MODEL half of "Model & Effort" —
  // effort level is never written to session-meta, but model choice IS
  // recoverable from transcripts (entry.message.model). Universe interactive_only:
  // model choice is user posture, not an SDK/observer default.
  "model-effort": withGates(
    { transcripts: true, universe: "interactive_only" },
    (s) => {
      const {
        opusDominantSessionCount,
        opusModelMatchesTotal,
        interactiveSessionsAnalyzed,
      } = s.insights;
      // Defensive, not dead: withGates guarantees transcriptsScanned===true,
      // but a cached insights blob from before this scorer existed (e.g. an old
      // assessment-history.json entry) can be transcripts-scanned yet lack the
      // opus field. Route those to unmeasured rather than scoring a false 0.
      if (opusDominantSessionCount == null)
        return unavailable(GAP_REASONS.NO_TRANSCRIPTS);
      const ratio = opusDominantSessionCount / interactiveSessionsAnalyzed;
      let score = clamp(Math.round(ratio * 100));
      const evidence = [
        `Opus-dominant in ${opusDominantSessionCount}/${interactiveSessionsAnalyzed} interactive sessions (${pct(ratio * 100)}%) — ${opusModelMatchesTotal} Opus assistant turns total`,
      ];
      const gaps = [];
      if (ratio < 0.5)
        gaps.push(
          "Opus-dominant in fewer than half of interactive sessions — Boris tip 2",
        );
      const awareness = adoptionBonus({
        kind: "boolean",
        cap: 8,
        on: !!s.settings?.opus47AwarenessAdopted,
        label: "awareness",
        evidenceText:
          "Engaged with the 4.7 release surface (release notes / launch) — Boris tip 74 (awareness proxy)",
        gapText: null,
      });
      score = clamp(score + awareness.points);
      if (awareness.evidence) evidence.push(awareness.evidence);
      return { score, evidence, gaps, gapReason: null };
    },
  ),

  // Platform-Setup-only-by-nature dimensions. /insights data does not carry the
  // relevant signal: memory-related tools never appear in tool_counts; terminal/IDE
  // customization (statusline, keybindings, themes) is pure client config.
  // Surface the rationale per dimension so users see "unmeasured because X"
  // instead of a blank radar vertex that looks identical to a forgotten scorer.
  // Universe is inert here (always unavailable) but the contract requires a value.
  memory: noTelemetry(),
  customization: noTelemetry(),

  // Linear ratio of sessions emitting the `★ Insight ` banner — the rendered
  // signature of the explanatory-output-style plugin. Platform Setup already credits
  // plugin installation (signals.mjs hasPlugin check); this scorer credits
  // actual use. Honest caveat: if the plugin's banner string changes upstream,
  // this scorer goes silent (returns 0). Documented in methodology.
  learning: withGates(
    { transcripts: true, universe: "interactive_only" },
    (s) => {
      const {
        learningModeSessionCount,
        learningModeMatchesTotal,
        interactiveSessionsAnalyzed,
      } = s.insights;
      if (learningModeSessionCount == null)
        return unavailable(GAP_REASONS.NO_TRANSCRIPTS);
      const ratio = learningModeSessionCount / interactiveSessionsAnalyzed;
      let score = clamp(Math.round(ratio * 100));
      const evidence = [
        `Explanatory-mode active in ${learningModeSessionCount}/${interactiveSessionsAnalyzed} interactive sessions (${pct(ratio * 100)}%) — ${learningModeMatchesTotal} ★ Insight banners total`,
      ];
      const gaps = [];
      if (ratio < 0.3) {
        gaps.push(
          "Explanatory mode active in <30% of interactive sessions — try /output-style explanatory for learning work",
        );
      }
      const skillRecency = adoptionBonus({
        kind: "counter",
        cap: 10,
        value: s.settings?.skillsUsedRecently ?? 0,
        target: 3,
        label: "behavioral",
        evidenceText: `${s.settings?.skillsUsedRecently ?? 0} skill(s) used in the last 30 days — active self-improving toolkit`,
        gapText: null,
      });
      score = clamp(score + skillRecency.points);
      if (skillRecency.evidence) evidence.push(skillRecency.evidence);
      return { score, evidence, gaps, gapReason: null };
    },
  ),
};

// Per-dim score is normalized to its target so hitting target = 100. Both
// axes (Platform Setup and Execution) use the same per-dim target from the rubric,
// making the radar's two polygons semantically comparable: a vertex at 100
// means "you've hit the rubric's target for this dimension," regardless of
// whether the target was 75 or 95 raw. Raw values are preserved as
// `rawScore`/`executionRawScore` for transparency.
function normalize(rawScore, target) {
  if (typeof rawScore !== "number" || target <= 0) return null;
  return clamp(Math.round((rawScore / target) * 100));
}

export function scoreAll(rubric, signals) {
  const now = new Date().toISOString();
  const scores = rubric.dimensions.map((d) => {
    const fn = SCORERS[d.id];
    const exFn = EXECUTION_SCORERS[d.id];
    if (!fn) {
      return {
        id: d.id,
        score: 0,
        rawScore: 0,
        tier: "not-touched",
        evidence: [],
        gaps: [],
        executionScore: null,
        executionRawScore: null,
        gapReason: null,
        target: 100,
        rawTarget: d.target,
        weight: d.weight,
      };
    }
    const { score: rawScore, evidence, gaps } = fn(signals);
    const ex = exFn
      ? exFn(signals)
      : { score: null, gapReason: null, evidence: [], gaps: [] };
    const normScore = normalize(rawScore, d.target);
    const normExScore = normalize(ex.score, d.target);
    return {
      id: d.id,
      score: normScore,
      rawScore,
      tier: tierFor(normScore),
      evidence,
      gaps,
      executionScore: normExScore,
      executionRawScore: ex.score,
      executionEvidence: ex.evidence,
      executionGaps: ex.gaps,
      gapReason: ex.gapReason,
      target: 100,
      rawTarget: d.target,
      weight: d.weight,
    };
  });

  const totalW = scores.reduce((sum, r) => sum + r.weight, 0);
  const overall = Math.round(
    scores.reduce((sum, r) => sum + r.score * r.weight, 0) / totalW,
  );
  // Always 100 after normalization — kept in the output for backward-compat
  // with consumers that look for the field.
  const targetOverall = 100;

  // Execution overall is weight-normalized over dimensions that produced a
  // (normalized) score; null when no execution data exists at all.
  const exScored = scores.filter((r) => typeof r.executionScore === "number");
  const exTotalW = exScored.reduce((sum, r) => sum + r.weight, 0);
  const executionOverall =
    exScored.length === 0
      ? null
      : Math.round(
          exScored.reduce((sum, r) => sum + r.executionScore * r.weight, 0) /
            exTotalW,
        );

  return { capturedAt: now, overall, targetOverall, executionOverall, scores };
}

// Per-dimension noise floor for trend detection. Lower = more sensitive.
// Default 5 means a one-line config edit (often a 5–8 point swing) doesn't
// masquerade as a behavioral trend.
export const DEFAULT_NOISE_FLOOR = 5;

function noiseFloorFor(rubric, dimensionId) {
  const dim = rubric?.dimensions?.find((d) => d.id === dimensionId);
  return Math.max(1, dim?.noiseFloor ?? DEFAULT_NOISE_FLOOR);
}

function evidenceChanged(curEntry, prevEntry) {
  // Compare evidence + gaps as sets. A pure score wobble without any signal
  // change is treated as flat — keeps weekend-noise out of the trend feed.
  const a = new Set([...(curEntry.evidence || []), ...(curEntry.gaps || [])]);
  const b = new Set([...(prevEntry.evidence || []), ...(prevEntry.gaps || [])]);
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
}

export function computeTrends(current, history, rubric) {
  const prev = history && history.length ? history[history.length - 1] : null;
  const trends = {};
  for (const s of current.scores) {
    if (!prev) {
      trends[s.id] = "new";
      continue;
    }
    const prevEntry = prev.scores.find((x) => x.id === s.id);
    if (!prevEntry) {
      trends[s.id] = "new";
      continue;
    }
    const delta = s.score - prevEntry.score;
    const floor = noiseFloorFor(rubric, s.id);
    if (Math.abs(delta) < floor) {
      trends[s.id] = "flat";
    } else if (!evidenceChanged(s, prevEntry)) {
      trends[s.id] = "flat";
    } else if (delta > 0) {
      trends[s.id] = "improving";
    } else {
      trends[s.id] = "slipping";
    }
  }
  return trends;
}
