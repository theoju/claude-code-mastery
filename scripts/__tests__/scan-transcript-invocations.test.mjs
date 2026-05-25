import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanTranscriptInvocations } from "../_usage-data.mjs";

let projectsRoot;
beforeEach(() => {
  projectsRoot = mkdtempSync(join(tmpdir(), "transcripts-"));
});
afterEach(() => {
  rmSync(projectsRoot, { recursive: true, force: true });
});

function writeSession(name, lines) {
  const dir = join(projectsRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.jsonl`), lines.join("\n"));
}

const userText = (text, ts = "2026-05-09T12:00:00Z") =>
  JSON.stringify({
    type: "user",
    timestamp: ts,
    message: { role: "user", content: text },
  });

const assistantText = (text, ts = "2026-05-09T12:00:01Z") =>
  JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  });

const assistantToolUse = (name, ts = "2026-05-09T12:00:01Z") =>
  JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name, input: {} }],
    },
  });

// Non-semantic interleaved row — system_reminder injection. Real
// transcripts pack 1-3 of these between every assistant turn; the
// scanner must skip past them when locating the "next assistant turn"
// after ExitPlanMode.
const attachment = (ts = "2026-05-09T12:00:01Z") =>
  JSON.stringify({ type: "attachment", timestamp: ts });

// CLI markup shape — what a user actually-typed slash command looks
// like in current transcripts. The bare `/cmd` text form is also
// supported as a fallback (see `extractSlashCommands`).
const userMarkup = (cmd, ts = "2026-05-09T12:00:00Z") =>
  JSON.stringify({
    type: "user",
    timestamp: ts,
    message: {
      role: "user",
      content: `<command-message>${cmd}</command-message>\n<command-name>${cmd}</command-name>`,
    },
  });

describe("scanTranscriptInvocations", () => {
  it("returns zeros when projectsRoot is empty", async () => {
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r).toEqual({
      goCommandUses: 0,
      batchCommandUses: 0,
      focusCommandUses: 0,
      scheduleCommandUses: 0,
      babysitLoopUses: 0,
      loopCommandUses: 0,
      planThenLaunchSessions: 0,
      rewindCommandUses: 0,
      simplifyCommandUses: 0,
      btwCommandUses: 0,
      voiceCommandUses: 0,
      clearCommandUses: 0,
      compactCommandUses: 0,
      colorCommandUses: 0,
      fewerPermsCommandUses: 0,
    });
  });

  it("counts simplifyCommandUses as 1-per-session for sessions with /simplify", async () => {
    writeSession("s1", [userMarkup("/simplify"), userText("/simplify again")]);
    writeSession("s2", [userText("hello"), userText("nothing here")]);
    writeSession("s3", [userText("/simplify the code")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.simplifyCommandUses).toBe(2);
  });

  it("counts btwCommandUses as 1-per-session for sessions with /btw", async () => {
    writeSession("s1", [userMarkup("/btw"), userText("/btw side question")]);
    writeSession("s2", [userText("/btw try this")]);
    writeSession("s3", [userText("no command here")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.btwCommandUses).toBe(2);
  });

  it("counts voiceCommandUses as 1-per-session for sessions with /voice", async () => {
    writeSession("s1", [userMarkup("/voice")]);
    writeSession("s2", [userText("/voice on")]);
    writeSession("s3", [userText("just typing")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.voiceCommandUses).toBe(2);
  });

  it("counts colorCommandUses as 1-per-session for sessions with /color", async () => {
    writeSession("s1", [userMarkup("/color")]);
    writeSession("s2", [userText("/color red")]);
    writeSession("s3", [userText("just typing")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.colorCommandUses).toBe(2);
  });

  it("counts clearCommandUses as 1-per-session for sessions with /clear", async () => {
    writeSession("s1", [userMarkup("/clear"), userText("/clear")]);
    writeSession("s2", [userText("/clear context")]);
    writeSession("s3", [userText("nothing")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.clearCommandUses).toBe(2);
  });

  it("counts compactCommandUses as 1-per-session for sessions with /compact", async () => {
    writeSession("s1", [userMarkup("/compact"), userText("/compact")]);
    writeSession("s2", [userText("/compact now")]);
    writeSession("s3", [userText("nothing")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.compactCommandUses).toBe(2);
  });

  it("counts fewerPermsCommandUses as 1-per-session for sessions with /fewer-permission-prompts", async () => {
    writeSession("s1", [userMarkup("/fewer-permission-prompts")]);
    writeSession("s2", [userText("/fewer-permission-prompts please")]);
    writeSession("s3", [userText("not here")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.fewerPermsCommandUses).toBe(2);
  });

  it("counts /rewind invocations (markup + start-of-line)", async () => {
    // /rewind is a top-level slash invocation (Boris tip 62) — only the
    // markup form and start-of-line form count, not mid-prose mentions
    // (e.g. "I should /rewind here" in a planning prompt).
    writeSession("s1", [
      userMarkup("/rewind"),
      userText("/rewind"),
      userText("we should /rewind that misstep"), // mid-sentence — does NOT count
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.rewindCommandUses).toBe(2);
  });

  it("counts bare-text /go, /batch, /focus, /schedule at start of message", async () => {
    writeSession("s1", [
      userText("/go run the tests"),
      userText("/batch update fixtures"),
      userText("/focus"),
      userText("/schedule daily"),
      userText("/go"),
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.goCommandUses).toBe(2);
    expect(r.batchCommandUses).toBe(1);
    expect(r.focusCommandUses).toBe(1);
    expect(r.scheduleCommandUses).toBe(1);
  });

  it("counts mid-sentence /go and /batch (Boris-tip prompt-phrase usage)", async () => {
    // /go and /batch have action-text semantics ("phrase it in the
    // prompt as ...") so mid-sentence mentions ARE the intended signal.
    // /focus, /schedule, /loop, /babysit are top-level invocations and
    // do NOT count mid-sentence (prose mentions are usually noise).
    writeSession("s1", [
      userText("create a plan usin /batch /go for B.1 Bugs"),
      userText("when we hit a tough sweep, use /batch with worktree iso"),
      userText("after the diff, run /go"),
      userText("we should think about /focus and /schedule someday"),
      userText("the /loop /babysit pattern is cool"),
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    // 2 messages match /go: msg 1 mid-sentence, msg 3 at start
    expect(r.goCommandUses).toBe(2);
    // 2 messages contain mid-sentence /batch
    expect(r.batchCommandUses).toBe(2);
    // mid-sentence does NOT count for these — message 4/5 are prose
    expect(r.focusCommandUses).toBe(0);
    expect(r.scheduleCommandUses).toBe(0);
    expect(r.babysitLoopUses).toBe(0);
  });

  it("rejects compound continuations and URL/path context", async () => {
    // Boundary cases that must NOT match:
    //   - /go-fast (compound continuation)
    //   - /Users/theo/go/src (path context)
    //   - https://example.com/go (URL)
    //   - /babysit-prs (different command, distinct trailing -prs)
    writeSession("s1", [
      userText("the /go-fast wrapper is unrelated"),
      userText("see /Users/theo/go/src for the source"),
      userText("https://example.com/go for docs"),
      userText("we use /babysit-prs not /babysit"),
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.goCommandUses).toBe(0);
    expect(r.babysitLoopUses).toBe(0);
  });

  it("counts babysit-loop sessions (1 per session if both /loop and /babysit present)", async () => {
    writeSession("s1", [
      userText("/loop 30m"),
      userText("/babysit"),
      userText("/loop 30m"),
    ]);
    writeSession("s2", [userText("/loop")]);
    writeSession("s3", [userText("/loop"), userText("/babysit")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.babysitLoopUses).toBe(2);
  });

  it("counts loopCommandUses for any session containing /loop (even without /babysit)", async () => {
    // 30-day sampling: 92% of /loop adoption is unpaired with /babysit.
    // The strict babysitLoopUses counter under-counts the dominant pattern.
    // loopCommandUses captures /loop alone — what users actually do.
    writeSession("s1", [userText("/loop 30m")]);
    writeSession("s2", [userText("hello"), userText("no slash here")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.loopCommandUses).toBe(1);
  });

  it("loopCommandUses is 1-per-session, not per-message", async () => {
    writeSession("s1", [
      userText("/loop 30m"),
      userText("/loop 5m /babysit-prs"),
      userText("/loop"),
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.loopCommandUses).toBe(1);
  });

  it("loopCommandUses and babysitLoopUses are independent counters", async () => {
    // s1: /loop alone → loopCommandUses++, babysitLoopUses unchanged
    writeSession("s1", [userText("/loop 30m")]);
    // s2: both → both increment
    writeSession("s2", [userText("/loop"), userText("/babysit")]);
    // s3: /babysit alone → neither increments (no /loop in the session)
    writeSession("s3", [userText("/babysit")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.loopCommandUses).toBe(2);
    expect(r.babysitLoopUses).toBe(1);
  });

  it("detects plan-then-launch: counts when first assistant turn after ExitPlanMode is a tool_use", async () => {
    writeSession("s1", [
      assistantToolUse("ExitPlanMode"),
      assistantToolUse("Edit"),
    ]);
    writeSession("s2", [
      assistantToolUse("ExitPlanMode"),
      assistantText("let me explain the plan first..."),
      assistantToolUse("Edit"),
    ]);
    writeSession("s3", [
      assistantToolUse("ExitPlanMode"),
      assistantText("ok"),
      assistantToolUse("Bash"),
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    // s1 counts: first assistant turn after ExitPlanMode is a tool_use.
    // s2 + s3 do NOT count: first assistant turn is text narration —
    // exactly the anti-pattern Boris tip 65 calls out.
    expect(r.planThenLaunchSessions).toBe(1);
  });

  it("plan-then-launch skips type=attachment system-reminder rows", async () => {
    // Real transcripts interleave attachment rows between assistant
    // turns; the old "next 2 messages" window got consumed by them and
    // returned 0 even when a tool_use actually followed. The fix is to
    // skip non-assistant rows when locating the next turn — covering
    // both the case where a user turn sits between (s1) and the case
    // where only attachment rows do (s2). s2 isolates the literal
    // "attachment rows consumed the window" failure mode.
    writeSession("s1", [
      assistantToolUse("ExitPlanMode"),
      JSON.stringify({ type: "user", timestamp: "2026-05-09T12:00:01Z" }),
      attachment(),
      attachment(),
      attachment(),
      assistantToolUse("Bash"),
    ]);
    writeSession("s2", [
      assistantToolUse("ExitPlanMode"),
      attachment(),
      attachment(),
      attachment(),
      assistantToolUse("Edit"),
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.planThenLaunchSessions).toBe(2);
  });

  it("counts <command-name> markup slash commands (real CLI shape)", async () => {
    writeSession("s1", [
      userMarkup("/loop"),
      userMarkup("/loop"),
      userMarkup("/babysit"),
      userMarkup("/focus"),
      userMarkup("/go"),
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.focusCommandUses).toBe(1);
    expect(r.goCommandUses).toBe(1);
    expect(r.babysitLoopUses).toBe(1);
  });

  it("strips plugin prefix from <command-name> markup", async () => {
    // /superpowers:focus and /myplugin:go should still register as
    // /focus and /go respectively. The prefix strip mirrors how the
    // user invokes them — the action is the same regardless of which
    // plugin namespace surfaced it.
    writeSession("s1", [
      userMarkup("/superpowers:focus"),
      userMarkup("/myplugin:go"),
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.focusCommandUses).toBe(1);
    expect(r.goCommandUses).toBe(1);
  });

  it("respects lookback window via timestamps", async () => {
    writeSession("recent", [userText("/go", "2026-05-09T00:00:00Z")]);
    writeSession("ancient", [userText("/go", "2026-01-01T00:00:00Z")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.goCommandUses).toBe(1);
  });
});
