import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherInsightsSignals } from "../insights-signals.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "insights-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFacet(claudeHome, sessionId, body) {
  const path = join(claudeHome, "usage-data", "facets", `${sessionId}.json`);
  mkdirSync(join(claudeHome, "usage-data", "facets"), { recursive: true });
  writeFileSync(path, JSON.stringify({ session_id: sessionId, ...body }));
}

function writeMeta(claudeHome, sessionId, body) {
  const path = join(
    claudeHome,
    "usage-data",
    "session-meta",
    `${sessionId}.json`,
  );
  mkdirSync(join(claudeHome, "usage-data", "session-meta"), {
    recursive: true,
  });
  writeFileSync(path, JSON.stringify({ session_id: sessionId, ...body }));
}

function writeTranscript(claudeHome, projectDir, sessionId, lines) {
  const path = join(claudeHome, "projects", projectDir, `${sessionId}.jsonl`);
  mkdirSync(join(claudeHome, "projects", projectDir), { recursive: true });
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

const NOW = "2026-05-04T12:00:00.000Z";
const TWENTY_DAYS_AGO = "2026-04-14T12:00:00.000Z";
const SIXTY_DAYS_AGO = "2026-03-05T12:00:00.000Z";

describe("gatherInsightsSignals", () => {
  it("throws on unparseable now timestamp", async () => {
    mkdirSync(join(dir, "usage-data", "session-meta"), { recursive: true });
    mkdirSync(join(dir, "usage-data", "facets"), { recursive: true });
    await expect(
      gatherInsightsSignals({
        claudeHome: dir,
        now: "not a date",
        lookbackDays: 30,
      }),
    ).rejects.toThrow(/invalid now timestamp/);
  });

  it("returns null when ~/.claude/usage-data is absent", async () => {
    const result = await gatherInsightsSignals({ claudeHome: dir, now: NOW });
    expect(result).toBeNull();
  });

  it("returns empty-but-shaped result when usage-data exists with no sessions", async () => {
    mkdirSync(join(dir, "usage-data", "facets"), { recursive: true });
    mkdirSync(join(dir, "usage-data", "session-meta"), { recursive: true });
    const result = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(result).toMatchObject({
      sessionsAnalyzed: 0,
      lookbackDays: 30,
      subagentSessionCount: 0,
      mcpSessionCount: 0,
    });
  });

  it("filters sessions outside lookback window by start_time", async () => {
    writeMeta(dir, "in", {
      start_time: TWENTY_DAYS_AGO,
      uses_task_agent: true,
      uses_mcp: true,
      tool_counts: { Bash: 5, TaskCreate: 2 },
      git_commits: 3,
    });
    writeMeta(dir, "out", {
      start_time: SIXTY_DAYS_AGO,
      uses_task_agent: true,
      uses_mcp: true,
      tool_counts: { Bash: 10, TaskCreate: 4 },
      git_commits: 7,
    });
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.sessionsAnalyzed).toBe(1);
    expect(r.subagentSessionCount).toBe(1);
    expect(r.mcpSessionCount).toBe(1);
    expect(r.gitCommitsTotal).toBe(3);
    expect(r.taskInvocationsTotal).toBe(2);
  });

  it("includes all sessions when lookbackDays is null (full history)", async () => {
    writeMeta(dir, "recent", {
      start_time: TWENTY_DAYS_AGO,
      uses_task_agent: true,
    });
    writeMeta(dir, "ancient", {
      start_time: SIXTY_DAYS_AGO,
      uses_task_agent: false,
    });
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: null,
    });
    expect(r.sessionsAnalyzed).toBe(2);
    expect(r.subagentSessionCount).toBe(1);
  });

  it("aggregates friction and outcome counts from facets", async () => {
    writeMeta(dir, "s1", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "s2", { start_time: TWENTY_DAYS_AGO });
    writeFacet(dir, "s1", {
      outcome: "fully_achieved",
      friction_counts: { buggy_code: 2, wrong_approach: 1 },
    });
    writeFacet(dir, "s2", {
      outcome: "mostly_achieved",
      friction_counts: { buggy_code: 1 },
    });
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.frictionCounts).toEqual({ buggy_code: 3, wrong_approach: 1 });
    expect(r.outcomeCounts).toEqual({ fully_achieved: 1, mostly_achieved: 1 });
  });

  it("counts multi_task session_type from facets", async () => {
    writeMeta(dir, "s1", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "s2", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "s3", { start_time: TWENTY_DAYS_AGO });
    writeFacet(dir, "s1", { session_type: "multi_task" });
    writeFacet(dir, "s2", { session_type: "multi_task" });
    writeFacet(dir, "s3", { session_type: "single_task" });
    writeTranscript(dir, "proj-a", "s1", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
    ]);
    writeTranscript(dir, "proj-a", "s2", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
    ]);
    writeTranscript(dir, "proj-a", "s3", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.multiTaskSessionCount).toBe(2);
  });

  it("multiTaskSessionCount excludes non-interactive sessions", async () => {
    // Regression: multiTaskSessionCount must respect the interactive_cli
    // universe gate. SDK-orchestrated sessions (entrypoint sdk-cli) can
    // also be tagged multi_task in facets, but they don't reflect user
    // adoption of multi-task planning — counting them dilutes the
    // planning scorer's denominator.
    writeMeta(dir, "s-int", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "s-sdk", { start_time: TWENTY_DAYS_AGO });
    writeFacet(dir, "s-int", { session_type: "multi_task" });
    writeFacet(dir, "s-sdk", { session_type: "multi_task" });
    writeTranscript(dir, "-Users-x-Projects-app", "s-int", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
    ]);
    writeTranscript(dir, "-Users-x-Projects-routine", "s-sdk", [
      { type: "user", entrypoint: "sdk-cli", timestamp: TWENTY_DAYS_AGO },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.multiTaskSessionCount).toBe(1);
  });

  it("aggregates scheduled and remote tool invocations from tool_counts", async () => {
    writeMeta(dir, "s1", {
      start_time: TWENTY_DAYS_AGO,
      tool_counts: {
        Bash: 10,
        CronCreate: 1,
        ScheduleWakeup: 2,
        RemoteTrigger: 3,
        SendMessage: 1,
      },
    });
    writeMeta(dir, "s2", {
      start_time: TWENTY_DAYS_AGO,
      tool_counts: {
        CronDelete: 1,
        CronList: 4,
        PushNotification: 2,
      },
    });
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    // Scheduled: 1 (CronCreate) + 2 (ScheduleWakeup) + 1 (CronDelete) + 4 (CronList) = 8
    expect(r.scheduledInvocationsTotal).toBe(8);
    // Remote: 3 (RemoteTrigger) + 1 (SendMessage) + 2 (PushNotification) = 6
    expect(r.remoteInvocationsTotal).toBe(6);
  });

  it("attributes plugin tool invocations from mcp__plugin_<name>__* prefix", async () => {
    writeMeta(dir, "s1", {
      start_time: TWENTY_DAYS_AGO,
      tool_counts: {
        Bash: 10,
        mcp__plugin_atlassian_atlassian__createJiraIssue: 3,
        mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql: 5,
        mcp__plugin_slack_slack__slack_send_message: 2,
      },
    });
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.toolInvocationsByPlugin).toEqual({
      atlassian: 8,
      slack: 2,
    });
    expect(r.toolInvocationsTotal).toBe(20);
  });

  it("ingests hook-fires.jsonl when present, filtered by window", async () => {
    writeMeta(dir, "s1", { start_time: TWENTY_DAYS_AGO });
    writeFileSync(
      join(dir, "hook-fires.jsonl"),
      [
        { timestamp: TWENTY_DAYS_AGO, event: "PostToolUse" },
        { timestamp: TWENTY_DAYS_AGO, event: "Stop" },
        { timestamp: SIXTY_DAYS_AGO, event: "Stop" },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
    );
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.hookFireCount).toBe(2);
    expect(r.hookFiresByEvent).toEqual({ PostToolUse: 1, Stop: 1 });
  });

  it("returns hookFireCount=null when hook-fires.jsonl absent (distinguish from empty file)", async () => {
    // Claude Code does not emit hook-fires.jsonl by default. Returning null
    // (not 0) lets downstream scorers route to "unmeasured" instead of
    // collapsing to a hard zero on every user without the logging hook.
    writeMeta(dir, "s1", { start_time: TWENTY_DAYS_AGO });
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.hookFireCount).toBeNull();
    expect(r.hookFiresByEvent).toEqual({});
  });

  it("returns hookFireCount=0 when hook-fires.jsonl exists but has no in-window entries", async () => {
    // Distinct from null above: file exists, telemetry is wired, but nothing
    // fired in the lookback. This is a real zero — automation execution
    // legitimately scores 0, not "unmeasured".
    writeMeta(dir, "s1", { start_time: TWENTY_DAYS_AGO });
    writeFileSync(join(dir, "hook-fires.jsonl"), ""); // empty file
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.hookFireCount).toBe(0);
    expect(r.hookFiresByEvent).toEqual({});
  });

  it("does not scan transcripts unless includeTranscripts=true", async () => {
    writeMeta(dir, "s1", { start_time: TWENTY_DAYS_AGO });
    writeTranscript(dir, "proj", "s1", [
      { type: "user", permissionMode: "auto", timestamp: TWENTY_DAYS_AGO },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.transcriptsScanned).toBe(false);
    expect(r.autoModeSessionCount).toBeNull();
    expect(r.bypassPermissionsSessionCount).toBeNull();
    expect(r.planModeSessionCount).toBeNull();
    expect(r.worktreeUsageSessionCount).toBeNull();
  });

  it("does not touch transcripts when includeTranscripts=false (malformed data is fine)", async () => {
    writeMeta(dir, "s1", { start_time: TWENTY_DAYS_AGO });
    writeTranscript(dir, "proj", "s1", []);
    // Hand-write a malformed transcript that would crash a JSON.parse pass.
    const path = join(dir, "projects", "proj", "s1.jsonl");
    writeFileSync(path, "{not json at all\n");
    await expect(
      gatherInsightsSignals({ claudeHome: dir, now: NOW, lookbackDays: 30 }),
    ).resolves.toMatchObject({ transcriptsScanned: false });
  });

  it("scans transcripts when opted in, attributing permissionMode events to sessions", async () => {
    writeMeta(dir, "auto-only", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "bypass-only", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "mixed", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "no-mode", { start_time: TWENTY_DAYS_AGO });

    writeTranscript(dir, "proj-a", "auto-only", [
      {
        type: "user",
        entrypoint: "cli",
        permissionMode: "auto",
        timestamp: TWENTY_DAYS_AGO,
      },
      { type: "user", permissionMode: "auto", timestamp: TWENTY_DAYS_AGO },
    ]);
    writeTranscript(dir, "proj-a", "bypass-only", [
      {
        type: "user",
        entrypoint: "cli",
        permissionMode: "bypassPermissions",
        timestamp: TWENTY_DAYS_AGO,
      },
    ]);
    writeTranscript(dir, "proj-b", "mixed", [
      {
        type: "user",
        entrypoint: "cli",
        permissionMode: "auto",
        timestamp: TWENTY_DAYS_AGO,
      },
      { type: "user", permissionMode: "plan", timestamp: TWENTY_DAYS_AGO },
      {
        type: "user",
        permissionMode: "bypassPermissions",
        timestamp: TWENTY_DAYS_AGO,
      },
    ]);
    writeTranscript(dir, "proj-b", "no-mode", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
    ]);

    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: true,
    });
    expect(r.transcriptsScanned).toBe(true);
    expect(r.autoModeSessionCount).toBe(2);
    expect(r.bypassPermissionsSessionCount).toBe(2);
    expect(r.planModeSessionCount).toBe(1);
  });

  it("counts ★ Insight banners as learning-mode adoption when scanning transcripts", async () => {
    writeMeta(dir, "active", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "quiet", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "user-quote", { start_time: TWENTY_DAYS_AGO });
    // Two assistant turns in this session contain the banner -> session counts once.
    writeTranscript(dir, "proj-a", "active", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
      {
        type: "assistant",
        message: { content: "★ Insight ───\nfoo\n───" },
        timestamp: TWENTY_DAYS_AGO,
      },
      {
        type: "assistant",
        message: { content: "★ Insight ───\nbar\n───" },
        timestamp: TWENTY_DAYS_AGO,
      },
    ]);
    // No banners.
    writeTranscript(dir, "proj-a", "quiet", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
      {
        type: "assistant",
        message: { content: "regular reply" },
        timestamp: TWENTY_DAYS_AGO,
      },
    ]);
    // User quotes the pattern in their own message — must NOT count.
    writeTranscript(dir, "proj-b", "user-quote", [
      {
        type: "user",
        entrypoint: "cli",
        message: { content: "what is ★ Insight ?" },
        timestamp: TWENTY_DAYS_AGO,
      },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: true,
    });
    expect(r.learningModeSessionCount).toBe(1);
    expect(r.learningModeMatchesTotal).toBe(2);
  });

  it("planModeSessionCount includes sessions with planning-skill invocations", async () => {
    // Session uses a planning skill but never enters native plan mode —
    // the Planning Exec scorer should still credit it.
    writeMeta(dir, "skill-plan", { start_time: TWENTY_DAYS_AGO });
    writeTranscript(dir, "proj-a", "skill-plan", [
      {
        type: "user",
        entrypoint: "cli",
        message: {
          content: "<command-name>/superpowers:writing-plans</command-name>",
        },
        timestamp: TWENTY_DAYS_AGO,
      },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: true,
    });
    expect(r.planModeSessionCount).toBe(1);
  });

  it("learningModeSessionCount includes sessions with learning-skill invocations", async () => {
    writeMeta(dir, "skill-learn", { start_time: TWENTY_DAYS_AGO });
    writeTranscript(dir, "proj-a", "skill-learn", [
      {
        type: "user",
        entrypoint: "cli",
        message: { content: "<command-name>/thariq-skills</command-name>" },
        timestamp: TWENTY_DAYS_AGO,
      },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: true,
    });
    expect(r.learningModeSessionCount).toBe(1);
    // matchesTotal counts banner OCCURRENCES only — no banners here.
    expect(r.learningModeMatchesTotal).toBe(0);
  });

  it("learningModeSessionCount does not double-count sessions with both banner AND skill", async () => {
    writeMeta(dir, "both", { start_time: TWENTY_DAYS_AGO });
    writeTranscript(dir, "proj-a", "both", [
      {
        type: "user",
        entrypoint: "cli",
        message: { content: "<command-name>/thariq-skills</command-name>" },
        timestamp: TWENTY_DAYS_AGO,
      },
      {
        type: "assistant",
        message: { content: "★ Insight ───\nthing\n───" },
        timestamp: TWENTY_DAYS_AGO,
      },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: true,
    });
    expect(r.learningModeSessionCount).toBe(1);
    // Banner-occurrence count is unchanged by skill detection.
    expect(r.learningModeMatchesTotal).toBe(1);
  });

  it("leaves learningModeSessionCount null when transcripts not scanned", async () => {
    writeMeta(dir, "s1", { start_time: TWENTY_DAYS_AGO });
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: false,
    });
    expect(r.learningModeSessionCount).toBeNull();
    expect(r.learningModeMatchesTotal).toBeNull();
  });

  it("counts worktree-state events as worktree usage when scanning transcripts", async () => {
    writeMeta(dir, "wt-session", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "no-wt", { start_time: TWENTY_DAYS_AGO });
    writeTranscript(dir, "proj-a", "wt-session", [
      { type: "worktree-state", worktreeSession: { worktreeName: "x" } },
      {
        type: "user",
        entrypoint: "cli",
        permissionMode: "auto",
        timestamp: TWENTY_DAYS_AGO,
      },
    ]);
    writeTranscript(dir, "proj-b", "no-wt", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: true,
    });
    expect(r.worktreeUsageSessionCount).toBe(1);
  });

  it("drops sessions without a start_time when window is constrained", async () => {
    writeMeta(dir, "no-start", { uses_task_agent: true });
    writeMeta(dir, "good", {
      start_time: TWENTY_DAYS_AGO,
      uses_task_agent: true,
    });
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.sessionsAnalyzed).toBe(1);
    expect(r.subagentSessionCount).toBe(1);
  });

  it("classifies in-window sessions by kind and emits sessionsByKind", async () => {
    writeMeta(dir, "s-int-1", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "s-sdk-1", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "s-obs-1", { start_time: TWENTY_DAYS_AGO });
    // interactive_cli: entrypoint "cli"
    writeTranscript(dir, "-Users-x-Projects-app", "s-int-1", [
      { type: "user", entrypoint: "cli", permissionMode: "auto" },
    ]);
    // sdk_orchestrated: entrypoint "sdk-cli" in non-observer dir
    writeTranscript(dir, "-Users-x-Projects-routine", "s-sdk-1", [
      { type: "user", entrypoint: "sdk-cli", permissionMode: "default" },
    ]);
    // observer: entrypoint "sdk-cli" in observer-sessions dir
    writeTranscript(dir, "-Users-x--claude-mem-observer-sessions", "s-obs-1", [
      { type: "user", entrypoint: "sdk-cli", permissionMode: "default" },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      lookbackDays: 30,
      now: NOW,
      includeTranscripts: true,
    });
    expect(r.sessionsAnalyzed).toBe(3);
    expect(r.interactiveSessionsAnalyzed).toBe(1);
    expect(r.sessionsByKind).toEqual({
      interactive_cli: 1,
      sdk_orchestrated: 1,
      observer: 1,
      subagent: 0,
      unknown: 0,
    });
  });

  it("autoModeSessionCount excludes sdk-cli sessions even if their transcript records permissionMode auto", async () => {
    writeMeta(dir, "s-int-1", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "s-sdk-1", { start_time: TWENTY_DAYS_AGO });
    writeTranscript(dir, "-Users-x-Projects-app", "s-int-1", [
      { type: "user", entrypoint: "cli", permissionMode: "auto" },
    ]);
    writeTranscript(dir, "-Users-x-Projects-routine", "s-sdk-1", [
      { type: "user", entrypoint: "sdk-cli", permissionMode: "auto" },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: true,
    });
    expect(r.interactiveSessionsAnalyzed).toBe(1);
    expect(r.autoModeSessionCount).toBe(1);
  });

  it("aggregates opusDominantSessionCount and opusModelMatchesTotal (tip 2)", async () => {
    writeMeta(dir, "opus-heavy", { start_time: TWENTY_DAYS_AGO });
    writeMeta(dir, "balanced", { start_time: TWENTY_DAYS_AGO });
    // Opus-dominant: 2 of 3 assistant turns on Opus (strict majority).
    writeTranscript(dir, "-Users-x-Projects-app", "opus-heavy", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
      { type: "assistant", message: { model: "claude-opus-4-7" } },
      { type: "assistant", message: { model: "claude-opus-4-7" } },
      { type: "assistant", message: { model: "claude-haiku-4-5" } },
    ]);
    // Not dominant: only 1 of 3 on Opus.
    writeTranscript(dir, "-Users-x-Projects-app", "balanced", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
      { type: "assistant", message: { model: "claude-opus-4-7" } },
      { type: "assistant", message: { model: "claude-sonnet-4-6" } },
      { type: "assistant", message: { model: "claude-sonnet-4-6" } },
    ]);
    // Exactly 50% Opus is a TIE — strict majority means NOT dominant.
    writeMeta(dir, "tied", { start_time: TWENTY_DAYS_AGO });
    writeTranscript(dir, "-Users-x-Projects-app", "tied", [
      { type: "user", entrypoint: "cli", timestamp: TWENTY_DAYS_AGO },
      { type: "assistant", message: { model: "claude-opus-4-7" } },
      { type: "assistant", message: { model: "claude-sonnet-4-6" } },
    ]);
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: true,
    });
    // Only opus-heavy is dominant; balanced (1/3) and tied (1/2) are not.
    expect(r.opusDominantSessionCount).toBe(1);
    // Broad Opus-turn sum across all three sessions: 2 + 1 + 1 = 4.
    expect(r.opusModelMatchesTotal).toBe(4);
  });

  it("leaves opus fields null when transcripts not scanned", async () => {
    writeMeta(dir, "s1", { start_time: TWENTY_DAYS_AGO });
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: false,
    });
    expect(r.opusDominantSessionCount).toBeNull();
    expect(r.opusModelMatchesTotal).toBeNull();
  });

  it("survives malformed JSON files without throwing", async () => {
    mkdirSync(join(dir, "usage-data", "session-meta"), { recursive: true });
    mkdirSync(join(dir, "usage-data", "facets"), { recursive: true });
    writeFileSync(
      join(dir, "usage-data", "session-meta", "bad.json"),
      "{not json",
    );
    writeMeta(dir, "good", {
      start_time: TWENTY_DAYS_AGO,
      uses_task_agent: true,
    });
    const r = await gatherInsightsSignals({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    expect(r.sessionsAnalyzed).toBe(1);
    expect(r.subagentSessionCount).toBe(1);
  });
});
