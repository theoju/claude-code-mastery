// Pure read-only ingest. Returns null when ~/.claude/usage-data/ is absent so
// the rest of the scoring pipeline can fail soft for fresh users.

import { existsSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  buildTranscriptIndex,
  classifySessionKind,
  cutoffFromLookback,
  loadFacetsMap,
  loadSessionMeta,
  scanTranscriptModes,
  withinWindow,
} from "./_usage-data.mjs";

// Matches plugin-namespaced MCP tool names (`mcp__plugin_<name>_<server>__*`).
// Built-in connectors like `mcp__claude_ai_Gmail__*` are intentionally not
// attributed — they're not user-installed plugins.
const PLUGIN_TOOL_RE = /^mcp__plugin_([a-z0-9-]+?)_[a-z0-9-]+__/i;

// Tool name groups for dimension scorers that key off specific built-in tools.
// Categorization lives here (signal shape) rather than in score.mjs (scoring
// policy) so a future tool rename only changes one file.
const SCHEDULED_TOOL_NAMES = new Set([
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
]);
const REMOTE_TOOL_NAMES = new Set([
  "RemoteTrigger",
  "PushNotification",
  "SendMessage",
]);

function parsePluginName(toolName) {
  const m = toolName.match(PLUGIN_TOOL_RE);
  return m ? m[1].toLowerCase() : null;
}

// Returns total: null when the file is absent (no telemetry source), 0 when
// the file exists but is empty (telemetry available, no fires in window).
// Downstream scorers must treat null as "unmeasured" — not "scored zero" —
// so users without hook-fire logging don't get a hard zero on automation.
async function readHookFires(claudeHome, cutoff) {
  const path = join(claudeHome, "hook-fires.jsonl");
  if (!existsSync(path)) return { total: null, byEvent: {} };
  let total = 0;
  const byEvent = {};
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
  });
  for await (const raw of rl) {
    if (!raw) continue;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (cutoff !== null) {
      const t = Date.parse(entry.timestamp || "");
      if (!Number.isFinite(t) || t < cutoff) continue;
    }
    total += 1;
    const ev = entry.event || "unknown";
    byEvent[ev] = (byEvent[ev] || 0) + 1;
  }
  return { total, byEvent };
}

export async function gatherInsightsSignals({
  claudeHome,
  now = new Date().toISOString(),
  lookbackDays = 30,
  includeTranscripts = false,
} = {}) {
  if (!claudeHome)
    throw new Error("gatherInsightsSignals: claudeHome required");
  const usageDir = join(claudeHome, "usage-data");
  if (!existsSync(usageDir)) return null;

  const cutoff = cutoffFromLookback(now, lookbackDays);

  const [allMeta, facets] = await Promise.all([
    loadSessionMeta(claudeHome),
    loadFacetsMap(claudeHome),
  ]);
  const inWindow = allMeta.filter((m) => withinWindow(m.start_time, cutoff));

  const transcriptIndex = await buildTranscriptIndex(claudeHome);
  const sessionsByKind = {
    interactive_cli: 0,
    sdk_orchestrated: 0,
    observer: 0,
    subagent: 0,
    unknown: 0,
  };
  const kindBySession = new Map();
  for (const m of inWindow) {
    const tpath = transcriptIndex.get(m.session_id);
    const kind = tpath ? await classifySessionKind(tpath) : "unknown";
    kindBySession.set(m.session_id, kind);
    sessionsByKind[kind] += 1;
  }
  const interactiveSessionsAnalyzed = sessionsByKind.interactive_cli;
  const interactiveOrUnknownSessionsAnalyzed =
    sessionsByKind.interactive_cli + sessionsByKind.unknown;

  let subagentSessionCount = 0;
  let mcpSessionCount = 0;
  let multiTaskSessionCount = 0;
  let taskInvocationsTotal = 0;
  let toolInvocationsTotal = 0;
  let scheduledInvocationsTotal = 0;
  let remoteInvocationsTotal = 0;
  let gitCommitsTotal = 0;
  const toolInvocationsByPlugin = {};
  const frictionCounts = {};
  const outcomeCounts = {};

  for (const m of inWindow) {
    if (m.uses_task_agent) subagentSessionCount += 1;
    if (m.uses_mcp) mcpSessionCount += 1;
    if (typeof m.git_commits === "number") gitCommitsTotal += m.git_commits;

    const tools = m.tool_counts || {};
    for (const [name, count] of Object.entries(tools)) {
      if (typeof count !== "number") continue;
      toolInvocationsTotal += count;
      // "TaskCreate" is current; "Task" appears in older session-meta files.
      if (name === "TaskCreate" || name === "Task")
        taskInvocationsTotal += count;
      if (SCHEDULED_TOOL_NAMES.has(name)) scheduledInvocationsTotal += count;
      if (REMOTE_TOOL_NAMES.has(name)) remoteInvocationsTotal += count;
      const plugin = parsePluginName(name);
      if (plugin)
        toolInvocationsByPlugin[plugin] =
          (toolInvocationsByPlugin[plugin] || 0) + count;
    }

    const facet = facets.get(m.session_id);
    if (facet) {
      if (
        facet.session_type === "multi_task" &&
        kindBySession.get(m.session_id) === "interactive_cli"
      ) {
        multiTaskSessionCount += 1;
      }
      if (facet.outcome)
        outcomeCounts[facet.outcome] = (outcomeCounts[facet.outcome] || 0) + 1;
      const fc = facet.friction_counts || {};
      for (const [k, v] of Object.entries(fc)) {
        if (typeof v === "number")
          frictionCounts[k] = (frictionCounts[k] || 0) + v;
      }
    }
  }

  const hookFires = await readHookFires(claudeHome, cutoff);

  const result = {
    capturedAt: now,
    lookbackDays,
    sessionsAnalyzed: inWindow.length,
    sessionsByKind,
    interactiveSessionsAnalyzed,
    interactiveOrUnknownSessionsAnalyzed,
    subagentSessionCount,
    mcpSessionCount,
    multiTaskSessionCount,
    taskInvocationsTotal,
    toolInvocationsTotal,
    scheduledInvocationsTotal,
    remoteInvocationsTotal,
    toolInvocationsByPlugin,
    gitCommitsTotal,
    frictionCounts,
    outcomeCounts,
    hookFireCount: hookFires.total,
    hookFiresByEvent: hookFires.byEvent,
    transcriptsScanned: false,
    // Null (not undefined) when transcripts were skipped: scoring predicates
    // must distinguish "user doesn't do X" from "we didn't look."
    autoModeSessionCount: null,
    bypassPermissionsSessionCount: null,
    planModeSessionCount: null,
    planModeMultiTaskSessionCount: null,
    worktreeUsageSessionCount: null,
    learningModeSessionCount: null,
    learningModeMatchesTotal: null,
    opusDominantSessionCount: null,
    opusModelMatchesTotal: null,
    desktopSessionCount: null,
    aiTitlePresent: null,
  };

  if (includeTranscripts) {
    let autoModeSessionCount = 0;
    let bypassPermissionsSessionCount = 0;
    let planModeSessionCount = 0;
    let planModeMultiTaskSessionCount = 0;
    let worktreeUsageSessionCount = 0;
    let learningModeSessionCount = 0;
    let learningModeMatchesTotal = 0;
    let opusDominantSessionCount = 0;
    let opusModelMatchesTotal = 0;
    let desktopSessionCount = 0;
    let aiTitlePresent = false;
    for (const m of inWindow) {
      const path = transcriptIndex.get(m.session_id);
      if (!path) continue;
      const {
        modes,
        hasWorktreeState,
        hasAiTitle,
        learningModeMatches,
        assistantTurns,
        opusAssistantTurns,
        entrypoint,
      } = await scanTranscriptModes(path);
      // Posture counters describe user adoption — they must only count
      // sessions whose kind is "interactive_cli". SDK/observer/subagent
      // sessions can record permissionMode but don't reflect user choice
      // (the SDK injects modes for its own orchestration). Volume metrics
      // like learningModeMatchesTotal stay broad: they measure banner
      // occurrences, not session-level adoption.
      const isInteractive =
        kindBySession.get(m.session_id) === "interactive_cli";
      if (isInteractive) {
        if (modes.has("auto")) autoModeSessionCount += 1;
        if (modes.has("bypassPermissions")) bypassPermissionsSessionCount += 1;
        // Union: native permissionMode === "plan" OR a planning-equivalent
        // skill invocation. Both routes are surfaced via modes.has("plan")
        // from scanTranscriptModes — see PLANNING_SKILL_COMMANDS there.
        if (modes.has("plan")) {
          planModeSessionCount += 1;
          // The planning ratio's numerator must be the multi_task∩plan_mode
          // intersection so it can't exceed its multiTaskSessionCount
          // denominator. planModeSessionCount alone also counts plan mode in
          // single-task sessions, which pushed the ratio past 100% (the
          // 36/34 = 105.88% bug). multiTaskSessionCount uses the same
          // facet.session_type === "multi_task" gate as the first loop.
          if (facets.get(m.session_id)?.session_type === "multi_task")
            planModeMultiTaskSessionCount += 1;
        }
        if (hasWorktreeState) worktreeUsageSessionCount += 1;
        // Union: ★ Insight banners OR a learning-skill invocation. One
        // increment per session even if both fire (matchesTotal stays
        // banner-only — it measures banner occurrences, not session
        // adoption, and the skill signal carries no occurrence semantics).
        if (learningModeMatches > 0 || modes.has("learning"))
          learningModeSessionCount += 1;
        // Tip 2: Opus-dominant = strict majority of assistant turns on Opus.
        // Interactive-only (model choice is user posture); ties and zero-turn
        // sessions are not dominant.
        if (assistantTurns > 0 && opusAssistantTurns * 2 > assistantTurns)
          opusDominantSessionCount += 1;
      }
      learningModeMatchesTotal += learningModeMatches;
      // Volume metric stays broad (banner-style), like learningModeMatchesTotal.
      opusModelMatchesTotal += opusAssistantTurns;
      // Tip 52: broad adoption/volume counter — no universe gating.
      if (entrypoint === "claude-desktop") {
        desktopSessionCount += 1;
      }
      // Tip 39: info-only — true if ANY scanned session has an ai-title entry.
      if (hasAiTitle) aiTitlePresent = true;
    }
    result.transcriptsScanned = true;
    result.autoModeSessionCount = autoModeSessionCount;
    result.bypassPermissionsSessionCount = bypassPermissionsSessionCount;
    result.planModeSessionCount = planModeSessionCount;
    result.planModeMultiTaskSessionCount = planModeMultiTaskSessionCount;
    result.worktreeUsageSessionCount = worktreeUsageSessionCount;
    result.learningModeSessionCount = learningModeSessionCount;
    result.learningModeMatchesTotal = learningModeMatchesTotal;
    result.opusDominantSessionCount = opusDominantSessionCount;
    result.opusModelMatchesTotal = opusModelMatchesTotal;
    result.desktopSessionCount = desktopSessionCount;
    result.aiTitlePresent = aiTitlePresent;
  }

  return result;
}
