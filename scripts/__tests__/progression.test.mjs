import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectMilestones } from "../progression.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "progression-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NOW = "2026-05-04T12:00:00.000Z";

function writeMeta(claudeHome, sessionId, body) {
  mkdirSync(join(claudeHome, "usage-data", "session-meta"), {
    recursive: true,
  });
  writeFileSync(
    join(claudeHome, "usage-data", "session-meta", `${sessionId}.json`),
    JSON.stringify({ session_id: sessionId, ...body }),
  );
}

function writeFacet(claudeHome, sessionId, body) {
  mkdirSync(join(claudeHome, "usage-data", "facets"), { recursive: true });
  writeFileSync(
    join(claudeHome, "usage-data", "facets", `${sessionId}.json`),
    JSON.stringify({ session_id: sessionId, ...body }),
  );
}

function writeTranscript(claudeHome, projectDir, sessionId, lines) {
  mkdirSync(join(claudeHome, "projects", projectDir), { recursive: true });
  writeFileSync(
    join(claudeHome, "projects", projectDir, `${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

function daysAgo(days) {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
}

describe("detectMilestones", () => {
  it("returns null when ~/.claude/usage-data is absent", async () => {
    const r = await detectMilestones({ claudeHome: dir, now: NOW });
    expect(r).toBeNull();
  });

  it("returns empty milestones array when no sessions match any detector", async () => {
    writeMeta(dir, "s1", { start_time: daysAgo(50), uses_task_agent: false });
    const r = await detectMilestones({ claudeHome: dir, now: NOW });
    expect(r.milestones).toEqual([]);
    expect(r.sessionsWalked).toBe(1);
  });

  it("emits the first-subagent milestone using the earliest session", async () => {
    writeMeta(dir, "later", { start_time: daysAgo(10), uses_task_agent: true });
    writeMeta(dir, "earliest", {
      start_time: daysAgo(60),
      uses_task_agent: true,
      tool_counts: { TaskCreate: 5 },
    });
    writeMeta(dir, "no-task", {
      start_time: daysAgo(30),
      uses_task_agent: false,
    });
    const r = await detectMilestones({ claudeHome: dir, now: NOW });
    const milestone = r.milestones.find((m) => m.dimension === "parallel");
    expect(milestone.sessionId).toBe("earliest");
    expect(milestone.evidence).toMatch(/5 TaskCreate/);
  });

  it("emits first-multi-task by walking facets", async () => {
    writeMeta(dir, "single", { start_time: daysAgo(40) });
    writeMeta(dir, "multi", { start_time: daysAgo(20) });
    writeFacet(dir, "single", { session_type: "single_task" });
    writeFacet(dir, "multi", { session_type: "multi_task" });
    const r = await detectMilestones({ claudeHome: dir, now: NOW });
    const milestone = r.milestones.find(
      (m) => m.milestone === "First multi-task session",
    );
    expect(milestone.sessionId).toBe("multi");
  });

  it("skips transcript-required detectors when includeTranscripts=false", async () => {
    writeMeta(dir, "s1", { start_time: daysAgo(20) });
    writeTranscript(dir, "proj", "s1", [
      { type: "user", permissionMode: "auto", timestamp: daysAgo(20) },
    ]);
    const r = await detectMilestones({ claudeHome: dir, now: NOW });
    expect(r.transcriptsScanned).toBe(false);
    expect(
      r.milestones.find((m) => m.milestone === "Adopted auto mode"),
    ).toBeUndefined();
  });

  it("breaks ties on start_time deterministically by session_id", async () => {
    const sameTs = daysAgo(20);
    writeMeta(dir, "zzz", {
      start_time: sameTs,
      uses_task_agent: true,
      tool_counts: { TaskCreate: 1 },
    });
    writeMeta(dir, "aaa", {
      start_time: sameTs,
      uses_task_agent: true,
      tool_counts: { TaskCreate: 9 },
    });
    const r = await detectMilestones({ claudeHome: dir, now: NOW });
    const milestone = r.milestones.find(
      (m) => m.milestone === "Started using subagents",
    );
    expect(milestone.sessionId).toBe("aaa");
  });

  it("throws on unparseable now timestamp regardless of lookbackDays", async () => {
    writeMeta(dir, "s1", { start_time: daysAgo(5) });
    await expect(
      detectMilestones({ claudeHome: dir, now: "not a date" }),
    ).rejects.toThrow(/invalid now timestamp/);
  });

  it("emits transcript-derived milestones when opted in", async () => {
    writeMeta(dir, "auto-day", { start_time: daysAgo(20) });
    writeMeta(dir, "plan-day", { start_time: daysAgo(15) });
    writeMeta(dir, "wt-day", { start_time: daysAgo(10) });
    writeMeta(dir, "skill-day", { start_time: daysAgo(5) });
    writeTranscript(dir, "p", "auto-day", [
      { type: "user", permissionMode: "auto", timestamp: daysAgo(20) },
    ]);
    writeTranscript(dir, "p", "plan-day", [
      { type: "user", permissionMode: "plan", timestamp: daysAgo(15) },
    ]);
    writeTranscript(dir, "p", "wt-day", [
      { type: "worktree-state", worktreeSession: { worktreeName: "x" } },
      { type: "user", timestamp: daysAgo(10) },
    ]);
    writeTranscript(dir, "p", "skill-day", [
      { type: "assistant", attributionSkill: "simplify" },
    ]);

    const r = await detectMilestones({
      claudeHome: dir,
      now: NOW,
      includeTranscripts: true,
    });
    const titles = r.milestones.map((m) => m.milestone);
    expect(titles).toContain("Adopted auto mode");
    expect(titles).toContain("Adopted plan mode");
    expect(titles).toContain("Adopted worktree isolation");
    expect(titles).toContain("First skill invocation");
  });

  it("emits 'stopped using bypass' when last bypass session is past the threshold", async () => {
    // Three bypass sessions, all >30 days ago
    for (let i = 0; i < 3; i++) {
      const id = `bypass-${i}`;
      writeMeta(dir, id, { start_time: daysAgo(45 + i) });
      writeTranscript(dir, "p", id, [
        {
          type: "user",
          permissionMode: "bypassPermissions",
          timestamp: daysAgo(45 + i),
        },
      ]);
    }
    // Recent clean sessions
    writeMeta(dir, "recent", { start_time: daysAgo(5) });
    writeTranscript(dir, "p", "recent", [
      { type: "user", permissionMode: "auto", timestamp: daysAgo(5) },
    ]);

    const r = await detectMilestones({
      claudeHome: dir,
      now: NOW,
      includeTranscripts: true,
    });
    const stopped = r.milestones.find(
      (m) => m.milestone === "Stopped using bypass",
    );
    expect(stopped).toBeDefined();
    expect(stopped.evidence).toMatch(/3 bypassPermissions sessions/);
  });

  it("does NOT emit 'stopped using bypass' when bypass is still recent", async () => {
    writeMeta(dir, "b1", { start_time: daysAgo(50) });
    writeMeta(dir, "b2", { start_time: daysAgo(40) });
    writeMeta(dir, "b3", { start_time: daysAgo(5) }); // recent — disqualifies "stopped"
    for (const id of ["b1", "b2", "b3"]) {
      const day =
        id === "b3" ? daysAgo(5) : id === "b2" ? daysAgo(40) : daysAgo(50);
      writeTranscript(dir, "p", id, [
        { type: "user", permissionMode: "bypassPermissions", timestamp: day },
      ]);
    }

    const r = await detectMilestones({
      claudeHome: dir,
      now: NOW,
      includeTranscripts: true,
    });
    expect(
      r.milestones.find((m) => m.milestone === "Stopped using bypass"),
    ).toBeUndefined();
  });

  it("emits 'stopped using bypass' even when lookbackDays excludes the bypass sessions", async () => {
    // Bypass sessions are all >100 days ago, well outside a 30-day window.
    for (let i = 0; i < 3; i++) {
      const id = `bypass-${i}`;
      writeMeta(dir, id, { start_time: daysAgo(110 + i) });
      writeTranscript(dir, "p", id, [
        {
          type: "user",
          permissionMode: "bypassPermissions",
          timestamp: daysAgo(110 + i),
        },
      ]);
    }
    writeMeta(dir, "recent", { start_time: daysAgo(2) });
    writeTranscript(dir, "p", "recent", [
      { type: "user", permissionMode: "auto", timestamp: daysAgo(2) },
    ]);

    const r = await detectMilestones({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
      includeTranscripts: true,
    });
    const stopped = r.milestones.find(
      (m) => m.milestone === "Stopped using bypass",
    );
    expect(stopped).toBeDefined();
    expect(stopped.evidence).toMatch(/3 bypassPermissions sessions/);
  });

  it("does NOT emit 'stopped using bypass' when the user has been inactive overall", async () => {
    // Three old bypass sessions and NO recent activity: "stopped" would be a
    // false positive — the user simply stopped using Claude.
    for (let i = 0; i < 3; i++) {
      const id = `bypass-${i}`;
      writeMeta(dir, id, { start_time: daysAgo(80 + i) });
      writeTranscript(dir, "p", id, [
        {
          type: "user",
          permissionMode: "bypassPermissions",
          timestamp: daysAgo(80 + i),
        },
      ]);
    }
    const r = await detectMilestones({
      claudeHome: dir,
      now: NOW,
      includeTranscripts: true,
    });
    expect(
      r.milestones.find((m) => m.milestone === "Stopped using bypass"),
    ).toBeUndefined();
  });

  it("does NOT emit 'stopped using bypass' when fewer than 3 bypass sessions historically", async () => {
    writeMeta(dir, "b1", { start_time: daysAgo(50) });
    writeMeta(dir, "b2", { start_time: daysAgo(45) });
    for (const id of ["b1", "b2"]) {
      writeTranscript(dir, "p", id, [
        {
          type: "user",
          permissionMode: "bypassPermissions",
          timestamp: daysAgo(45),
        },
      ]);
    }
    const r = await detectMilestones({
      claudeHome: dir,
      now: NOW,
      includeTranscripts: true,
    });
    expect(
      r.milestones.find((m) => m.milestone === "Stopped using bypass"),
    ).toBeUndefined();
  });

  it("filters sessions outside the lookback window when one is set", async () => {
    writeMeta(dir, "old", { start_time: daysAgo(120), uses_task_agent: true });
    writeMeta(dir, "recent", { start_time: daysAgo(5), uses_task_agent: true });
    const r = await detectMilestones({
      claudeHome: dir,
      now: NOW,
      lookbackDays: 30,
    });
    const milestone = r.milestones.find(
      (m) => m.milestone === "Started using subagents",
    );
    expect(milestone.sessionId).toBe("recent");
  });

  it("emits milestones sorted by timestamp ascending", async () => {
    writeMeta(dir, "subagent-day", {
      start_time: daysAgo(40),
      uses_task_agent: true,
    });
    writeMeta(dir, "mcp-day", { start_time: daysAgo(20), uses_mcp: true });
    const r = await detectMilestones({ claudeHome: dir, now: NOW });
    const timestamps = r.milestones.map((m) => Date.parse(m.timestamp));
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it("emits scheduled milestone on first /loop|/schedule|/babysit invocation", async () => {
    writeMeta(dir, "no-cmd", { start_time: daysAgo(40) });
    writeMeta(dir, "babysit-day", { start_time: daysAgo(20) });
    writeMeta(dir, "later-loop", { start_time: daysAgo(10) });
    writeTranscript(dir, "p", "no-cmd", [
      { type: "user", timestamp: daysAgo(40) },
    ]);
    writeTranscript(dir, "p", "babysit-day", [
      {
        type: "assistant",
        message: { content: "<command-name>babysit</command-name>" },
      },
    ]);
    writeTranscript(dir, "p", "later-loop", [
      {
        type: "assistant",
        message: { content: "<command-name>loop</command-name>" },
      },
    ]);

    const r = await detectMilestones({
      claudeHome: dir,
      now: NOW,
      includeTranscripts: true,
    });
    const milestone = r.milestones.find((m) => m.dimension === "scheduled");
    expect(milestone).toBeDefined();
    expect(milestone.sessionId).toBe("babysit-day");
    expect(milestone.milestone).toBe("Started using scheduled workflows");
    expect(milestone.borisTip).toBe(48);
    expect(milestone.evidence).toMatch(/\/babysit/);
  });

  it("emits remote milestone on first RemoteTrigger|PushNotification|SendMessage tool fire", async () => {
    writeMeta(dir, "no-remote", { start_time: daysAgo(30) });
    writeMeta(dir, "push-day", {
      start_time: daysAgo(15),
      tool_counts: { PushNotification: 2 },
    });
    writeMeta(dir, "later-trigger", {
      start_time: daysAgo(5),
      tool_counts: { RemoteTrigger: 1 },
    });

    const r = await detectMilestones({ claudeHome: dir, now: NOW });
    const milestone = r.milestones.find((m) => m.dimension === "remote");
    expect(milestone).toBeDefined();
    expect(milestone.sessionId).toBe("push-day");
    expect(milestone.milestone).toBe("First remote-tool invocation");
    expect(milestone.borisTip).toBe(35);
    expect(milestone.evidence).toMatch(/PushNotification \(2 calls\)/);
  });

  it("emits verification milestone on first /go invocation", async () => {
    writeMeta(dir, "no-go", { start_time: daysAgo(30) });
    writeMeta(dir, "go-day", { start_time: daysAgo(12) });
    writeMeta(dir, "later-go", { start_time: daysAgo(3) });
    writeTranscript(dir, "p", "no-go", [
      { type: "user", timestamp: daysAgo(30) },
    ]);
    writeTranscript(dir, "p", "go-day", [
      {
        type: "assistant",
        message: { content: "<command-name>go</command-name>" },
      },
    ]);
    writeTranscript(dir, "p", "later-go", [
      {
        type: "assistant",
        message: { content: "<command-name>go</command-name>" },
      },
    ]);

    const r = await detectMilestones({
      claudeHome: dir,
      now: NOW,
      includeTranscripts: true,
    });
    const milestone = r.milestones.find((m) => m.dimension === "verification");
    expect(milestone).toBeDefined();
    expect(milestone.sessionId).toBe("go-day");
    expect(milestone.milestone).toBe("First /go composite invocation");
    expect(milestone.borisTip).toBe(73);
    expect(milestone.evidence).toMatch(/\/go/);
  });
});
