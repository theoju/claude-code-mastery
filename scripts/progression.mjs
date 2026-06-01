// Walks ~/.claude/usage-data/session-meta and (opt-in) raw transcripts in
// chronological order to detect behavioral milestones — first time the user
// adopted a workflow pattern, last time they used a deprecated one. Output
// is a flat array of {timestamp, dimension, milestone, evidence} events
// suitable for a vertical timeline UI.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildTranscriptIndex,
  cutoffFromLookback,
  loadFacetsMap,
  loadSessionMeta,
  scanTranscriptModes,
  withinWindow,
} from "./_usage-data.mjs";

// 30 days ≈ a typical project cadence; if no bypass session has happened
// in a window that long, calling it "stopped" is honest. 3 occurrences
// avoids one-off experiments triggering the milestone.
const STOPPED_USING_THRESHOLD_DAYS = 30;
const STOPPED_USING_MIN_OCCURRENCES = 3;

async function buildTranscriptScans(claudeHome, sessions) {
  const index = await buildTranscriptIndex(claudeHome);
  const entries = await Promise.all(
    sessions.map(async (m) => {
      const path = index.get(m.session_id);
      if (!path) return null;
      return [m.session_id, await scanTranscriptModes(path)];
    }),
  );
  return new Map(entries.filter(Boolean));
}

const DETECTORS = [
  {
    transcriptsRequired: false,
    detect(sessions) {
      const m = sessions.find((s) => s.uses_task_agent);
      if (!m) return null;
      const taskCount = m.tool_counts?.TaskCreate ?? 0;
      return {
        timestamp: m.start_time,
        dimension: "parallel",
        milestone: "Started using subagents",
        borisTip: 1,
        evidence: `First Task-agent session (${taskCount} TaskCreate dispatches)`,
        sessionId: m.session_id,
      };
    },
  },
  {
    transcriptsRequired: false,
    detect(sessions) {
      const m = sessions.find((s) => s.uses_mcp);
      if (!m) return null;
      return {
        timestamp: m.start_time,
        dimension: "integrations",
        milestone: "First MCP-powered session",
        borisTip: 9,
        evidence: "First session that fired MCP tool calls",
        sessionId: m.session_id,
      };
    },
  },
  {
    transcriptsRequired: false,
    detect(sessions, facets) {
      const m = sessions.find(
        (s) => facets.get(s.session_id)?.session_type === "multi_task",
      );
      if (!m) return null;
      return {
        timestamp: m.start_time,
        dimension: "planning",
        milestone: "First multi-task session",
        borisTip: 65,
        evidence: "First session that orchestrated multiple distinct tasks",
        sessionId: m.session_id,
      };
    },
  },
  {
    transcriptsRequired: true,
    detect(sessions, _facets, transcripts) {
      const m = sessions.find((s) =>
        transcripts.get(s.session_id)?.modes.has("auto"),
      );
      if (!m) return null;
      return {
        timestamp: m.start_time,
        dimension: "permissions",
        milestone: "Adopted auto mode",
        borisTip: 42,
        evidence: "First session with permissionMode=auto in transcript",
        sessionId: m.session_id,
      };
    },
  },
  {
    transcriptsRequired: true,
    detect(sessions, _facets, transcripts) {
      const m = sessions.find((s) =>
        transcripts.get(s.session_id)?.modes.has("plan"),
      );
      if (!m) return null;
      return {
        timestamp: m.start_time,
        dimension: "planning",
        milestone: "Adopted plan mode",
        borisTip: 65,
        evidence: "First session that entered plan mode",
        sessionId: m.session_id,
      };
    },
  },
  {
    transcriptsRequired: true,
    detect(sessions, _facets, transcripts) {
      const m = sessions.find(
        (s) => transcripts.get(s.session_id)?.hasWorktreeState,
      );
      if (!m) return null;
      return {
        timestamp: m.start_time,
        dimension: "parallel",
        milestone: "Adopted worktree isolation",
        borisTip: 28,
        evidence: "First session running inside a git worktree",
        sessionId: m.session_id,
      };
    },
  },
  {
    transcriptsRequired: true,
    detect(sessions, _facets, transcripts) {
      const m = sessions.find(
        (s) => (transcripts.get(s.session_id)?.learningModeMatches ?? 0) > 0,
      );
      if (!m) return null;
      return {
        timestamp: m.start_time,
        dimension: "learning",
        milestone: "First explanatory-mode session",
        borisTip: 51,
        evidence:
          "First session emitting the ★ Insight banner from explanatory-output-style",
        sessionId: m.session_id,
      };
    },
  },
  {
    transcriptsRequired: true,
    detect(sessions, _facets, transcripts) {
      const m = sessions.find((s) => {
        const skills = transcripts.get(s.session_id)?.skills;
        return skills && skills.size > 0;
      });
      if (!m) return null;
      const first = [...transcripts.get(m.session_id).skills][0];
      return {
        timestamp: m.start_time,
        dimension: "automation",
        milestone: "First skill invocation",
        borisTip: 5,
        evidence: `First session attributing a skill (${first})`,
        sessionId: m.session_id,
      };
    },
  },
  {
    transcriptsRequired: true,
    // "Stopped" is a long-arc signal: scoped to full history (ctx.allSessions),
    // not the lookback window, so a short lookbackDays doesn't silently
    // disable detection. Also requires recent activity overall — otherwise
    // "stopped using bypass" fires for users who stopped using Claude entirely.
    detect(_sessions, _facets, transcripts, ctx) {
      const bypassSessions = ctx.allSessions.filter((m) =>
        transcripts.get(m.session_id)?.modes.has("bypassPermissions"),
      );
      if (bypassSessions.length < STOPPED_USING_MIN_OCCURRENCES) return null;
      const last = bypassSessions[bypassSessions.length - 1];
      const ageDays = (ctx.nowMs - Date.parse(last.start_time)) / 86_400_000;
      if (ageDays < STOPPED_USING_THRESHOLD_DAYS) return null;
      const latestAny = ctx.allSessions[ctx.allSessions.length - 1];
      const inactivityDays = latestAny
        ? (ctx.nowMs - Date.parse(latestAny.start_time)) / 86_400_000
        : Infinity;
      if (inactivityDays >= STOPPED_USING_THRESHOLD_DAYS) return null;
      return {
        timestamp: last.start_time,
        dimension: "permissions",
        milestone: "Stopped using bypass",
        borisTip: 42,
        evidence: `Last of ${bypassSessions.length} bypassPermissions sessions; none in the ${Math.round(ageDays)} days since`,
        sessionId: last.session_id,
      };
    },
  },
  {
    transcriptsRequired: true,
    detect(sessions, _facets, transcripts) {
      const scheduledCommands = ["loop", "schedule", "babysit"];
      const m = sessions.find((s) => {
        const cmds = transcripts.get(s.session_id)?.commands;
        return cmds && scheduledCommands.some((c) => cmds.has(c));
      });
      if (!m) return null;
      const cmds = transcripts.get(m.session_id).commands;
      const cmd = scheduledCommands.find((c) => cmds.has(c));
      return {
        timestamp: m.start_time,
        dimension: "scheduled",
        milestone: "Started using scheduled workflows",
        borisTip: 48,
        evidence: `First session invoking /${cmd}`,
        sessionId: m.session_id,
      };
    },
  },
];

export async function detectMilestones({
  claudeHome,
  now = new Date().toISOString(),
  lookbackDays = null,
  includeTranscripts = false,
} = {}) {
  if (!claudeHome) throw new Error("detectMilestones: claudeHome required");
  const usageDir = join(claudeHome, "usage-data");
  if (!existsSync(usageDir)) return null;

  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw new Error(
      `detectMilestones: invalid now timestamp ${JSON.stringify(now)}`,
    );
  }
  const cutoff = cutoffFromLookback(now, lookbackDays);

  const allMeta = await loadSessionMeta(claudeHome);
  // Stable secondary sort by session_id so ties on start_time produce
  // deterministic "first" detection across runs.
  const sortByTime = (a, b) => {
    const dt = Date.parse(a.start_time) - Date.parse(b.start_time);
    if (dt !== 0) return dt;
    return a.session_id < b.session_id
      ? -1
      : a.session_id > b.session_id
        ? 1
        : 0;
  };
  const allSessions = allMeta
    .filter((m) => m.start_time && Number.isFinite(Date.parse(m.start_time)))
    .sort(sortByTime);
  const inWindow = allSessions.filter((m) =>
    withinWindow(m.start_time, cutoff),
  );

  const facets = await loadFacetsMap(claudeHome);
  // "Stopped using" detectors need full history; "first" detectors only need
  // the window. Scan all sessions once so transcripts cover both.
  const transcripts = includeTranscripts
    ? await buildTranscriptScans(claudeHome, allSessions)
    : null;
  const ctx = { nowMs, allSessions };

  const milestones = [];
  for (const detector of DETECTORS) {
    if (detector.transcriptsRequired && !transcripts) continue;
    const milestone = detector.detect(inWindow, facets, transcripts, ctx);
    if (milestone) milestones.push(milestone);
  }
  milestones.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  return {
    capturedAt: now,
    lookbackDays,
    sessionsWalked: inWindow.length,
    transcriptsScanned: includeTranscripts,
    milestones,
  };
}
