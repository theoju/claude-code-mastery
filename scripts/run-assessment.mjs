#!/usr/bin/env node
// Entry point for the /self-assessment slash command and the morning routine.
//
// Usage:
//   node scripts/run-assessment.mjs [--no-slack] [--no-write] [--print]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { gatherSignals } from "./signals.mjs";
import { scoreAll, computeTrends } from "./score.mjs";
import { detectMilestones } from "./progression.mjs";
import {
  detectConfigMilestones,
  loadConfigProgressionState,
  saveConfigProgressionState,
} from "./config-progression.mjs";
import { buildSlackMessage, postToSlack } from "./slack.mjs";
import {
  auditAll,
  summarize,
  CRITERIA,
  expandHome,
} from "./claude-md-audit.mjs";
import { auditPlans, formatAuditReport } from "./plans-audit.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, "app", "data");
const CONFIG_PATH = join(ROOT, "assessment.config.json");
const CONFIG_EXAMPLE_PATH = join(ROOT, "assessment.config.example.json");
const HISTORY_PATH = join(DATA_DIR, "assessment-history.json");
const ASSESSMENT_PATH = join(DATA_DIR, "assessment.json");
const RUBRIC_PATH = join(DATA_DIR, "rubric.json");
const PROGRESSION_PATH = join(DATA_DIR, "progression.json");
const PROGRESSION_CONFIG_PATH = join(DATA_DIR, "progression-config.json");

// Read a probe value from BOTH the transcript scanner and history scanner
// and return the max. The history scanner has higher fidelity for
// side-channel commands (e.g. /btw never reaches the session JSONL);
// the transcript scanner has higher fidelity for transcript-derived
// patterns (e.g. /loop fired by /ship). Math.max recovers whichever
// source saw it.
function maxProbe(signals, field) {
  const t = signals.transcriptInvocations?.[field] ?? 0;
  const h = signals.historyInvocations?.[field] ?? 0;
  return Math.max(t, h);
}

// Pure derivation: signals (raw filesystem capture) → signalsSummary (flat
// scalar map). The predicate engine in app/lib/assessment.ts evaluates
// rubric satisfiedWhen expressions against this object. Exported so the
// shape can be unit-tested without spawning the full assessment pipeline.
export function buildSignalsSummary(signals) {
  const hookEvents = signals.settings.hookEvents || [];
  return {
    plugins: signals.plugins.length,
    personalAgents: signals.personalAgents.length,
    personalCommands: signals.personalCommands.length,
    personalSkills: signals.personalSkills.length,
    personalSkillNames: signals.personalSkills.slice(),
    hookTotalCount: signals.settings.hookTotalCount,
    effortLevel: signals.settings.effortLevel,
    skipDangerous: signals.settings.skipDangerousModePermissionPrompt,
    autoCompactWindow: signals.settings.autoCompactWindow,
    allowListCount: signals.settings.allowList.length,
    hasWildcardAllow: signals.settings.allowList.some((e) => e.includes("*")),
    hookEvents,
    hasStopHook: hookEvents.includes("Stop"),
    hasPostToolHook: hookEvents.includes("PostToolUse"),
    hasFormatterHook: !!signals.settings.hasFormatterHook,
    hasStopHookNotification: !!signals.settings.hasStopHookNotification,
    hasCustomSpinnerVerbs: (signals.settings.customSpinnerVerbCount || 0) > 0,
    // Probe-Logic Challenger fix (V1.3): the static probe only catches
    // agents that declare `isolation: worktree` in frontmatter. The rubric
    // goal is "isolation patterns adopted" — so when execution telemetry
    // shows the user actually USES worktrees, that's the same end-state
    // and should satisfy the predicate. OR the static flag with the
    // execution signal `insights.worktreeUsageSessionCount > 0`.
    hasIsolatedAgent:
      !!signals.settings.hasIsolatedAgent ||
      (signals.insights?.worktreeUsageSessionCount ?? 0) > 0,
    hasClaudeInChrome: !!signals.settings.hasClaudeInChrome,
    // P6.1 (Boris tip 44): detected at gather-time by anchored regex on
    // enabledPlugins keys; here we just project the boolean through.
    hasCodeReviewPlugin: !!signals.hasCodeReviewPlugin,
    hasRemoteControl: !!signals.settings.hasRemoteControl,
    hasShipCommand:
      signals.personalCommands.includes("ship.md") ||
      signals.projectCommands.includes("ship.md"),
    // Broadened in V1.2 (probe-validation): the original probe matched only
    // agent FILENAMES starting with "verify" and missed legitimate verify
    // pipelines like the /ship skill body, the pr-review-toolkit plugin,
    // and code-reviewer plugin agents. We now OR three signals together.
    // Body matching is collapsed to a boolean by `gatherSignals` so this
    // function stays a pure projection.
    hasVerifyAgent:
      signals.personalAgents.some((f) => /^verify/i.test(f)) ||
      signals.projectAgents.some((f) => /^verify/i.test(f)) ||
      !!signals.verifySignalBodyMatch ||
      (signals.plugins || []).some((p) =>
        /(^|-)(pr-review|review-toolkit|reviewer)(-|$|@)/i.test(p),
      ),
    claudeMdExists: signals.claudeMdExists,
    statuslineConfigured: signals.statuslineConfigured,
    keybindingsConfigured: signals.keybindingsConfigured,
    hasSlackPlugin: signals.plugins.some((p) => /slack/i.test(p)),
    hasVercelCli: !!signals.settings.hasVercelCli,
    hasVercelPlugin: signals.plugins.some((p) => /vercel/i.test(p)),
    mcpServersConnected: (signals.mcpServers || []).filter(
      (s) => s.status === "connected",
    ).length,
    hasMcpServers: (signals.mcpServers || []).length > 0,
    shipVerifyStageRecent: signals.shipJournal?.stage2Count ?? 0,
    shipsRecent: signals.shipJournal?.totalRuns ?? 0,
    worktreeAliasCount: signals.shellAliases?.worktreeAliasCount ?? 0,
    worktreeShortcutCount: signals.shellAliases?.worktreeShortcutCount ?? 0,
    // Slash-command counters: typed prompts also land in
    // ~/.claude/history.jsonl, which captures side-channel commands like
    // /btw that never reach the session JSONL. Take Math.max so the
    // assessment cannot regress below transcript-only behavior, only
    // recover signal the JSONL scanner misses. /go and /rewind stay
    // transcript-only (/go is mid-phrase, /rewind is keyboard-shortcut —
    // both work correctly through the existing path); planThenLaunch is
    // a structural transcript signal with no analogue in history.jsonl.
    goCommandUses: signals.transcriptInvocations?.goCommandUses ?? 0,
    batchCommandUses: maxProbe(signals, "batchCommandUses"),
    focusCommandUses: maxProbe(signals, "focusCommandUses"),
    scheduleCommandUses: maxProbe(signals, "scheduleCommandUses"),
    babysitLoopUses: maxProbe(signals, "babysitLoopUses"),
    loopCommandUses: maxProbe(signals, "loopCommandUses"),
    planThenLaunchSessions:
      signals.transcriptInvocations?.planThenLaunchSessions ?? 0,
    rewindCommandUses: signals.transcriptInvocations?.rewindCommandUses ?? 0,
    simplifyCommandUses: maxProbe(signals, "simplifyCommandUses"),
    btwCommandUses: maxProbe(signals, "btwCommandUses"),
    voiceCommandUses: maxProbe(signals, "voiceCommandUses"),
    clearCommandUses: maxProbe(signals, "clearCommandUses"),
    compactCommandUses: maxProbe(signals, "compactCommandUses"),
    colorCommandUses: maxProbe(signals, "colorCommandUses"),
    fewerPermsCommandUses: maxProbe(signals, "fewerPermsCommandUses"),
    // Tip 45 (Boris): auto-memory is default-on. Read the inverse env flag
    // `CLAUDE_CODE_DISABLE_AUTO_MEMORY` and invert. The signals layer is
    // responsible for the env-block parse — this projection just forwards.
    autoMemoryEnabled: signals.settings.autoMemoryEnabled !== false,
    // Tip 1 (Boris): "Run Multiple Claude Sessions in Parallel." The headline
    // is the end-state — 3-5 parallel worktree sessions — not the literal
    // za/zb/zc alias mechanism. V1.3 broadened tip 28's `hasIsolatedAgent`
    // the same way: OR the static signal with execution telemetry. Threshold
    // `>=3` matches Boris's "3-5 parallel" phrasing.
    parallelWorktreeAdoption:
      (signals.shellAliases?.worktreeAliasCount ?? 0) >= 3 ||
      (signals.shellAliases?.worktreeShortcutCount ?? 0) >= 3 ||
      (signals.insights?.worktreeUsageSessionCount ?? 0) >= 3,
    projectsWithMemory: signals.memory.length,
    insightsAvailable: !!signals.insights,
    insightsSessionsAnalyzed: signals.insights?.sessionsAnalyzed ?? 0,
    insightsLookbackDays: signals.insights?.lookbackDays ?? null,
    insightsTranscriptsScanned: signals.insights?.transcriptsScanned ?? false,
    insightsHookFireCount: signals.insights?.hookFireCount ?? 0,
    // P2.2 (Boris tip 34): root-level `outputStyle` string from settings.json.
    // Verbatim — predicates use the `=v|w` literal-match operator (e.g.
    // `outputStyle=Explanatory|Learning`).
    outputStyle: signals.settings.outputStyle ?? null,
    // Diagnostic only; never used by any predicate. Preserves the two-axis rule.
    permissionsDefaultMode: signals.settings.permissionsDefaultMode ?? null,
  };
}

const argv = process.argv.slice(2);
const flags = new Set(argv);

function flagValues(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === name) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out.push(next);
        i++;
      }
    } else if (a.startsWith(`${name}=`)) {
      out.push(a.slice(name.length + 1));
    }
  }
  return out;
}

function singleFlagValue(name) {
  const all = flagValues(name);
  return all.length ? all[all.length - 1] : null;
}

function parseLookbackOverride(raw) {
  if (raw === "none" || raw === "null" || raw === "full") return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `expected a positive integer or 'none', got: ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

function parseTargetSpec(spec) {
  // Accepts "name=path" or just "path" (name defaults to last path segment).
  const eq = spec.indexOf("=");
  if (eq > 0) {
    return { name: spec.slice(0, eq), path: spec.slice(eq + 1) };
  }
  const path = spec;
  const name = path.replace(/\/+$/, "").split("/").pop() || path;
  return { name, path };
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const rubric = await readJson(RUBRIC_PATH);
  if (!rubric) throw new Error(`rubric.json missing at ${RUBRIC_PATH}`);

  const config =
    (await readJson(CONFIG_PATH)) ||
    (await readJson(CONFIG_EXAMPLE_PATH)) ||
    {};

  const scoringConfig = config?.scoring || {};
  // CLI flags override config so a one-shot deep run doesn't require editing
  // assessment.config.json. Useful for the weekly transcript scan.
  const insightsLookbackRaw = singleFlagValue("--insights-lookback");
  const progressionLookbackRaw = singleFlagValue("--progression-lookback");
  const insightsLookbackDays =
    insightsLookbackRaw != null
      ? parseLookbackOverride(insightsLookbackRaw)
      : (scoringConfig.insightsLookbackDays ?? 30);
  const progressionLookbackDays =
    progressionLookbackRaw != null
      ? parseLookbackOverride(progressionLookbackRaw)
      : (scoringConfig.progressionLookbackDays ?? null);
  // --no-transcripts > --include-transcripts > config. The explicit "off"
  // form lets users skip the expensive scan in one run without editing config.
  const includeTranscripts = flags.has("--no-transcripts")
    ? false
    : flags.has("--include-transcripts")
      ? true
      : !!scoringConfig.includeTranscripts;

  const claudeHome = process.env.CLAUDE_HOME || join(homedir(), ".claude");
  const signals = await gatherSignals(ROOT, {
    insightsLookbackDays,
    includeTranscripts,
  });
  const progression = await detectMilestones({
    claudeHome,
    lookbackDays: progressionLookbackDays,
    includeTranscripts,
  });
  const scored = scoreAll(rubric, signals);
  const history = (await readJson(HISTORY_PATH)) || [];
  const trends = computeTrends(scored, history, rubric);

  const cliTargets = flagValues("--claude-md-target").map(parseTargetSpec);
  const cmConfig = config?.claudeMd || {};
  const configTargets =
    cmConfig.enabled === false ? [] : cmConfig.targets || [];
  const cmTargets = (cliTargets.length ? cliTargets : configTargets).map(
    (t) => ({
      name: t.name,
      path: expandHome(t.path),
    }),
  );
  const claudeMdRuns = cmTargets.length ? await auditAll(cmTargets) : [];
  const plansAudit = await auditPlans();

  const assessment = {
    ...scored,
    trends,
    signalsSummary: buildSignalsSummary(signals),
    insights: signals.insights,
    claudeMd: claudeMdRuns.length
      ? {
          mode: "report-only",
          auditedAt: new Date().toISOString(),
          summary: summarize(claudeMdRuns),
          runs: claudeMdRuns,
        }
      : null,
    user: config?.user?.displayName || null,
  };

  // Configuration-side milestones run alongside behavioral ones. They share
  // the same progression.json schema (timestamp / dimension / milestone /
  // borisTip / evidence / sessionId) and are sorted into the timeline by
  // first-seen date. The state file persists firstSeenAt so config milestones
  // pin permanently — reverting settings later doesn't erase history.
  const priorConfigState = await loadConfigProgressionState(
    PROGRESSION_CONFIG_PATH,
  );
  const configResult = detectConfigMilestones({
    signalsSummary: assessment.signalsSummary,
    priorState: priorConfigState,
    now: assessment.capturedAt || new Date().toISOString(),
  });
  if (progression) {
    progression.milestones = [
      ...progression.milestones,
      ...configResult.milestones,
    ].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }

  if (!flags.has("--no-write")) {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(ASSESSMENT_PATH, JSON.stringify(assessment, null, 2));
    const newHistory = [
      ...history,
      {
        capturedAt: assessment.capturedAt,
        overall: assessment.overall,
        scores: scored.scores,
      },
    ].slice(-90);
    await writeFile(HISTORY_PATH, JSON.stringify(newHistory, null, 2));
    if (progression) {
      await writeFile(PROGRESSION_PATH, JSON.stringify(progression, null, 2));
    }
    await saveConfigProgressionState(
      PROGRESSION_CONFIG_PATH,
      configResult.state,
    );
  }

  if (flags.has("--print") || !process.env.CI) {
    const exHeader =
      scored.executionOverall == null
        ? "Execution    n/a / 100 (run /insights to populate)"
        : `Execution ${scored.executionOverall} / 100 (observed practice)`;
    const lines = [
      `Claude Code Self-Assessment — ${assessment.user || "you"}`,
      `Platform Setup  ${assessment.overall} / 100`,
      exHeader,
      ``,
      ...scored.scores.map((s) => {
        const d = rubric.dimensions.find((x) => x.id === s.id);
        const trend =
          { improving: "↗", slipping: "↘", flat: "→", new: "✦" }[
            trends[s.id]
          ] || "?";
        const ex =
          typeof s.executionScore === "number"
            ? ` · ex ${s.executionScore.toString().padStart(3)}`
            : "";
        // Show normalized score with raw value as a small hint so the formula
        // (raw / d.target × 100) is auditable from the CLI output.
        return `  ${s.score.toString().padStart(3)} / 100  ${trend}  ${d.title} (raw ${s.rawScore}/${d.target})${ex}`;
      }),
    ];
    if (progression && progression.milestones.length > 0) {
      lines.push(
        "",
        `Progression — ${progression.milestones.length} milestone(s):`,
      );
      for (const m of progression.milestones) {
        lines.push(
          `  ${m.timestamp.slice(0, 10)}  ${m.milestone}  (${m.dimension}, Boris tip ${m.borisTip})`,
        );
      }
    }
    if (claudeMdRuns.length) {
      const sum = assessment.claudeMd.summary;
      lines.push("", "CLAUDE.md health (report-only):");
      const avgPart =
        sum.avgScore == null
          ? "no scoreable files"
          : `Avg: ${sum.avgScore} (${sum.avgGrade})`;
      lines.push(
        `  Targets: ${sum.targets} · Files: ${sum.files} · ${avgPart}`,
      );
      if (sum.files > 0) {
        const dist = sum.distribution;
        lines.push(
          `  Distribution: A:${dist.A} B:${dist.B} C:${dist.C} D:${dist.D} F:${dist.F}`,
        );
      }
      if (sum.targetsMissing)
        lines.push(`  Targets without CLAUDE.md: ${sum.targetsMissing}`);
      if (sum.targetsError)
        lines.push(`  Targets with errors: ${sum.targetsError}`);
      if (sum.avgBreakdown) {
        const labelWidth = Math.max(...CRITERIA.map((c) => c.label.length));
        lines.push(
          `  Breakdown (avg across ${sum.files} file${sum.files === 1 ? "" : "s"}):`,
        );
        for (const c of CRITERIA) {
          const v = sum.avgBreakdown[c.key];
          lines.push(`    ${c.label.padEnd(labelWidth)}  ${v}/${c.max}`);
        }
      }
    }
    lines.push("", formatAuditReport(plansAudit));
    console.log(lines.join("\n"));
  }

  if (!flags.has("--no-slack") && config?.slack?.enabled) {
    const msg = buildSlackMessage(assessment, rubric, config);
    const result = await postToSlack(msg);
    if (result.posted)
      console.log(`\nPosted to Slack ${config.slack.channel || ""}`.trim());
    else console.log(`\nSlack post skipped: ${result.reason}`);
  }

  return assessment;
}

// Only run main() when this file is invoked as a CLI (not when imported by
// tests). The compare-with-resolve dance handles both `node script.mjs`
// (argv[1] is a path) and direct module-URL invocation.
if (
  import.meta.url === `file://${process.argv[1] || ""}` ||
  import.meta.url === process.argv[1]
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
