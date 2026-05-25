// Shared loaders for ~/.claude/usage-data/. Both the per-window aggregation
// (insights-signals.mjs) and the time-ordered milestone walk (progression.mjs)
// read the same files; this module keeps the read shape in one place.

import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { safeReadJson, safeReaddir } from "./_fs-utils.mjs";

export function withinWindow(startTime, cutoff) {
  if (cutoff === null) return true;
  if (!startTime) return false;
  const t = Date.parse(startTime);
  return Number.isFinite(t) && t >= cutoff;
}

export function cutoffFromLookback(now, lookbackDays) {
  if (lookbackDays == null) return null;
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw new Error(
      `cutoffFromLookback: invalid now timestamp ${JSON.stringify(now)}`,
    );
  }
  return nowMs - lookbackDays * 86_400_000;
}

async function readJsonDir(dir) {
  const files = (await safeReaddir(dir)).filter((f) => f.endsWith(".json"));
  return Promise.all(files.map((f) => safeReadJson(join(dir, f))));
}

export async function loadSessionMeta(claudeHome) {
  const docs = await readJsonDir(
    join(claudeHome, "usage-data", "session-meta"),
  );
  return docs.filter((d) => d && d.session_id);
}

export async function loadFacetsMap(claudeHome) {
  const docs = await readJsonDir(join(claudeHome, "usage-data", "facets"));
  const map = new Map();
  for (const d of docs) {
    if (d && d.session_id) map.set(d.session_id, d);
  }
  return map;
}

// Build sessionId → transcript path map in a single pass over projects/*.
// Avoids O(sessions × projects) existsSync calls in any per-session loop.
// Worktrees can leave the same sessionId under multiple project dirs; sort
// and first-wins so repeat runs return identical results.
export async function buildTranscriptIndex(claudeHome) {
  const projectsDir = join(claudeHome, "projects");
  const projects = (await safeReaddir(projectsDir)).slice().sort();
  const entries = await Promise.all(
    projects.map(async (p) => {
      const projectPath = join(projectsDir, p);
      const files = await safeReaddir(projectPath);
      return files
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => [f.slice(0, -".jsonl".length), join(projectPath, f)]);
    }),
  );
  const index = new Map();
  for (const projectEntries of entries) {
    for (const [sessionId, path] of projectEntries) {
      if (!index.has(sessionId)) index.set(sessionId, path);
    }
  }
  return index;
}

// Walks ~/.claude/projects/*/*.jsonl transcripts within lookback. Returns
// counts of /go /batch /focus /schedule slash commands, sessions where
// /loop + /babysit both appear (1 per session), and sessions where an
// ExitPlanMode tool_use is followed by an assistant tool_use (the
// "launch" half of plan-then-launch).
//
// Slash-command detection: the CLI wraps user-typed slash commands in
// markup `<command-name>/cmd</command-name>`. Bare-text matches are kept
// as a fallback for transcript shapes that don't use the markup wrapper
// (e.g. earlier CLI versions, or commands invoked through alternate UIs).
//
// Plan-then-launch detection: ExitPlanMode is the marker (assistant
// tool_use, name === "ExitPlanMode"). Real transcripts interleave
// `type=attachment` (system-reminder injections) and `type=last-prompt`
// rows between assistant turns, so a fixed "next 2 messages" window
// gets consumed by those non-semantic rows. The fix is to advance past
// any line whose type is not "user" or "assistant" and find the next
// real assistant turn — if it contains a tool_use of any name (other
// than another ExitPlanMode), the session counts.

// Strip a plugin prefix like `superpowers:` from `/superpowers:writing-plans`.
function stripPluginPrefix(cmd) {
  return cmd.includes(":") ? cmd.slice(cmd.lastIndexOf(":") + 1) : cmd;
}

const TARGET_COMMANDS = new Set([
  "go",
  "batch",
  "focus",
  "schedule",
  "loop",
  "babysit",
  "rewind",
  "simplify",
  "btw",
  "voice",
  "clear",
  "compact",
  "color",
  "fewer-permission-prompts",
]);

// Commands whose Boris-tip semantics is "phrase it inside the prompt"
// rather than "type it as a top-level slash command". These should
// match anywhere in user text, not just at the start.
//   - /go (Boris tip 73): "Adopt 'Claude do X, then /go' as your default
//     closing prompt" — appears at the end of a longer prompt, not as
//     a standalone invocation.
//   - /batch (Boris tip 30, rubric action wording): "phrase it as
//     'use /batch with worktree isolation, put up PRs'" — embedded in
//     prompt instructions to a multi-step planner.
// The other four (/focus, /schedule, /loop, /babysit) are top-level
// invocations whose mentions in prose are usually noise (skill
// instruction echoes, references to /babysit-prs, etc.) — they require
// the <command-name> markup or start-of-line form.
const PROMPT_PHRASE_COMMANDS = new Set(["go", "batch"]);

const COMMAND_NAME_TAG_RE = /<command-name>\/([\w:-]+)/g;
// Anchored start-of-line shapes — used as a fallback for legacy /
// alternate transcript shapes that emit a bare /cmd line. Negative
// lookahead `(?![\w-])` rejects compound continuations like `/go-fast`
// or `/babysit-prs`.
const SLASH_RE = {
  go: /^\/go(?![\w-])/,
  batch: /^\/batch(?![\w-])/,
  focus: /^\/focus(?![\w-])/,
  schedule: /^\/schedule(?![\w-])/,
  loop: /^\/loop(?![\w-])/,
  babysit: /^\/babysit(?![\w-])/,
  rewind: /^\/rewind(?![\w-])/,
  simplify: /^\/simplify(?![\w-])/,
  btw: /^\/btw(?![\w-])/,
  voice: /^\/voice(?![\w-])/,
  clear: /^\/clear(?![\w-])/,
  compact: /^\/compact(?![\w-])/,
  color: /^\/color(?![\w-])/,
  // Hyphenated command — the negative lookahead still rejects `-foo`
  // extensions; the literal hyphens in the path are part of the command name.
  "fewer-permission-prompts": /^\/fewer-permission-prompts(?![\w-])/,
};
// Anywhere-in-text shapes — used only for prompt-phrase commands.
// Negative lookbehind `(?<![/\w])` rejects URL/path context (e.g.
// `https://example.com/go`, `/Users/theo/go/src`); negative lookahead
// `(?![\w-])` rejects compound continuations (`/batch-thing`).
const PROMPT_PHRASE_RE = {
  go: /(?<![/\w])\/go(?![\w-])/,
  batch: /(?<![/\w])\/batch(?![\w-])/,
};

// Returns the set of target slash-command names (e.g. {"loop", "focus"})
// found in the user message text. Three detection paths:
//   1. <command-name>/cmd</command-name> markup (top-level slash invoke)
//   2. ^/cmd at start of trimmed message (legacy bare-text fallback)
//   3. /cmd anywhere in text — only for PROMPT_PHRASE_COMMANDS
// Each matched command name is added to the set at most once per
// message, so per-message granularity is preserved regardless of how
// many times the command appears in a single user turn.
function extractSlashCommands(text) {
  const found = new Set();
  if (!text) return found;
  for (const m of text.matchAll(COMMAND_NAME_TAG_RE)) {
    const cmd = stripPluginPrefix(m[1]);
    if (TARGET_COMMANDS.has(cmd)) found.add(cmd);
  }
  const trimmed = text.trimStart();
  for (const cmd of TARGET_COMMANDS) {
    if (SLASH_RE[cmd].test(trimmed)) found.add(cmd);
  }
  for (const cmd of PROMPT_PHRASE_COMMANDS) {
    if (PROMPT_PHRASE_RE[cmd].test(text)) found.add(cmd);
  }
  return found;
}

function userMessageText(line) {
  if (line.type !== "user" || !line.message) return null;
  const c = line.message.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    for (const item of c) {
      if (item?.type === "text" && typeof item.text === "string") {
        return item.text;
      }
    }
  }
  return null;
}

function assistantToolUseName(line) {
  if (line.type !== "assistant" || !line.message) return null;
  const c = line.message.content;
  if (!Array.isArray(c)) return null;
  for (const item of c) {
    if (item?.type === "tool_use" && typeof item.name === "string") {
      return item.name;
    }
  }
  return null;
}

export async function scanTranscriptInvocations(options = {}) {
  const counts = {
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
  };
  // Vitest skip: when integration tests run gatherSignals without injecting
  // projectsRoot, don't walk the developer's real ~/.claude/projects/.
  if (process.env.VITEST && !options.projectsRoot) {
    return counts;
  }
  const { projectsRoot, now = new Date(), lookbackDays = 30 } = options;
  if (!projectsRoot) return counts;
  let sessionFiles;
  try {
    const { readdir } = await import("node:fs/promises");
    const projectDirs = await readdir(projectsRoot, { withFileTypes: true });
    sessionFiles = [];
    for (const d of projectDirs) {
      if (!d.isDirectory()) continue;
      const inner = await readdir(join(projectsRoot, d.name));
      for (const f of inner) {
        if (f.endsWith(".jsonl")) {
          sessionFiles.push(join(projectsRoot, d.name, f));
        }
      }
    }
  } catch {
    return counts;
  }
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;

  // Plan-then-launch detection needs a 12-row lookahead from any
  // ExitPlanMode tool_use, so we maintain a rolling window of the
  // current line + the next 12 parsed lines. Per-line work happens
  // against the head of the window once the lookahead is full;
  // remaining entries drain at end-of-stream.
  const SCAN_BOUND = 12;
  const WINDOW_SIZE = SCAN_BOUND + 1;

  for (const path of sessionFiles) {
    let sessionHasLoop = false;
    let sessionHasBabysit = false;
    // P1 probes are 1-per-session (per Boris-tip semantics: adoption,
    // not frequency). Per-session flags flip on first sighting and
    // increment the counter once after the session drain.
    let sessionHasSimplify = false;
    let sessionHasBtw = false;
    let sessionHasVoice = false;
    let sessionHasClear = false;
    let sessionHasCompact = false;
    let sessionHasColor = false;
    let sessionHasFewerPerms = false;
    const window = [];

    const processCurrent = () => {
      const line = window[0];
      if (!line) return;
      const ts = Date.parse(line.timestamp || "");
      if (!Number.isNaN(ts) && ts < cutoff) return;

      const uText = userMessageText(line);
      if (uText) {
        const found = extractSlashCommands(uText);
        if (found.has("go")) counts.goCommandUses++;
        if (found.has("batch")) counts.batchCommandUses++;
        if (found.has("focus")) counts.focusCommandUses++;
        if (found.has("schedule")) counts.scheduleCommandUses++;
        if (found.has("rewind")) counts.rewindCommandUses++;
        if (found.has("loop")) sessionHasLoop = true;
        if (found.has("babysit")) sessionHasBabysit = true;
        if (found.has("simplify")) sessionHasSimplify = true;
        if (found.has("btw")) sessionHasBtw = true;
        if (found.has("voice")) sessionHasVoice = true;
        if (found.has("clear")) sessionHasClear = true;
        if (found.has("compact")) sessionHasCompact = true;
        if (found.has("color")) sessionHasColor = true;
        if (found.has("fewer-permission-prompts")) sessionHasFewerPerms = true;
      }

      const toolName = assistantToolUseName(line);
      if (toolName === "ExitPlanMode") {
        // Walk forward past non-semantic rows (attachment/last-prompt/etc.)
        // until the next assistant turn. If that turn has any tool_use
        // other than ExitPlanMode, the session counts. Bounded by the
        // 12-entry lookahead so a transcript with no following assistant
        // turn (e.g. session ended at the plan) doesn't scan further.
        for (let j = 1; j < window.length; j++) {
          const next = window[j];
          if (next.type !== "assistant") continue;
          const nextTool = assistantToolUseName(next);
          if (nextTool && nextTool !== "ExitPlanMode") {
            counts.planThenLaunchSessions++;
          }
          break;
        }
      }
    };

    let rl;
    try {
      const stream = createReadStream(path, { encoding: "utf8" });
      rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const rawLine of rl) {
        let parsed;
        try {
          parsed = JSON.parse(rawLine);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== "object") continue;
        window.push(parsed);
        if (window.length > WINDOW_SIZE) {
          processCurrent();
          window.shift();
        }
      }
    } catch {
      if (rl) rl.close();
      continue;
    }
    // Drain the remaining lookahead window — these never reached the
    // "full window" branch because the file ended.
    while (window.length > 0) {
      processCurrent();
      window.shift();
    }

    // loopCommandUses tracks /loop adoption broadly (any session). The
    // strict babysitLoopUses (BOTH /loop AND /babysit) is preserved for
    // score.mjs's +10 calibration but under-counts the dominant pattern:
    // 30-day sampling showed 92% of /loop sessions never paired with
    // /babysit. The rubric's babysit-loop next-action gates on the
    // broader signal so we recommend the right next step for solo /loop
    // users instead of leaving them stuck.
    if (sessionHasLoop) counts.loopCommandUses++;
    if (sessionHasLoop && sessionHasBabysit) counts.babysitLoopUses++;
    if (sessionHasSimplify) counts.simplifyCommandUses++;
    if (sessionHasBtw) counts.btwCommandUses++;
    if (sessionHasVoice) counts.voiceCommandUses++;
    if (sessionHasClear) counts.clearCommandUses++;
    if (sessionHasCompact) counts.compactCommandUses++;
    if (sessionHasColor) counts.colorCommandUses++;
    if (sessionHasFewerPerms) counts.fewerPermsCommandUses++;
  }
  return counts;
}

// Skill invocations that are structurally equivalent to native plan mode.
// The Planning Setup scorer already credits the user for having these
// (see score.mjs#planning: "brainstorming / writing-plans / executing-plans
// skills"). Mirroring the signal here lets the Execution scorer count the
// user's actual planning ritual instead of only the rare shift+tab+enter
// keystroke.
const PLANNING_SKILL_COMMANDS = new Set([
  "superpowers:brainstorming",
  "superpowers:writing-plans",
  "superpowers:executing-plans",
  "superpowers:subagent-driven-development",
  "ultraplan",
]);

// Coaching/skill-learning surfaces. The existing ★ Insight banner detection
// only fires for Explanatory output mode; users on Concise/Default get 0
// banners regardless of real learning activity. These skill invocations
// union with the banner signal so the Learning Exec scorer sees both.
const LEARNING_SKILL_COMMANDS = new Set(["thariq-skills", "boris"]);

// Match <command-name>cmd</command-name> with optional leading slash. Some
// commands (e.g. /btw) emit the markup without the slash; most include it.
const COMMAND_NAME_RE = /<command-name>\/?([\w:-]+)<\/command-name>/g;

// Single transcript scan that surfaces every behavioral signal both consumers
// need (permissionMode set, worktree-state flag, attributionSkill set). Keeps
// transcript parsing in one place even if today both insights-signals.mjs and
// progression.mjs each call it on the same files.
export async function scanTranscriptModes(path) {
  const modes = new Set();
  const skills = new Set();
  let hasWorktreeState = false;
  // Detect explanatory-output-style adoption via its rendered banner. The
  // transcript schema has no outputStyle field (verified empirically across
  // 60+ sample transcripts); the plugin's instruction to emit `★ Insight `
  // is the only reliable behavioral signature. Substring on raw line text
  // is intentional — avoids stringifying nested message.content per turn.
  let learningModeMatches = 0;
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
    if (entry.type === "worktree-state") hasWorktreeState = true;
    if (typeof entry.permissionMode === "string")
      modes.add(entry.permissionMode);
    if (typeof entry.attributionSkill === "string")
      skills.add(entry.attributionSkill);
    if (entry.type === "assistant" && raw.includes("★ Insight ")) {
      learningModeMatches += 1;
    }
    // Mode-equivalent skill detection — scan raw line text for the
    // <command-name> markup. Lenient on leading slash; compares against
    // the FULL namespaced form (don't strip plugin prefix) since the
    // planning skills are namespaced as `superpowers:writing-plans`.
    if (raw.includes("<command-name>")) {
      for (const m of raw.matchAll(COMMAND_NAME_RE)) {
        const cmd = m[1];
        if (PLANNING_SKILL_COMMANDS.has(cmd)) modes.add("plan");
        if (LEARNING_SKILL_COMMANDS.has(cmd)) modes.add("learning");
      }
    }
  }
  return { modes, hasWorktreeState, skills, learningModeMatches };
}

// Classify a session by transcript-file inspection. Cheap: only reads
// the first ~5 lines until a recognized signal is found.
//
// Posture scorers (permissions, plan, learning) must restrict their
// universe to "interactive_cli" — SDK/observer/subagent sessions don't
// honor user-level settings and would silently dilute the ratio.
export async function classifySessionKind(path) {
  if (path.includes("/subagents/agent-")) return "subagent";

  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
  });
  let scanned = 0;
  try {
    for await (const raw of rl) {
      if (++scanned > 5) break;
      if (!raw) continue;
      let entry;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      const ep = entry.entrypoint;
      if (typeof ep !== "string") continue;
      if (ep === "cli" || ep === "claude-desktop") return "interactive_cli";
      if (ep === "sdk-cli") {
        return path.includes("observer-sessions")
          ? "observer"
          : "sdk_orchestrated";
      }
    }
  } finally {
    rl.close();
  }
  return "unknown";
}
