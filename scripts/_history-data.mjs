// Scan ~/.claude/history.jsonl — the durable record of typed user prompts —
// for slash-command invocations. Complements scanTranscriptInvocations,
// which reads ~/.claude/projects/*/*.jsonl session transcripts.
//
// Why both? Side-channel slash-commands like /btw (Boris tips 33+54: a
// single-turn no-tools chat) do NOT land in the session JSONL because
// they don't run inside the main session loop. Calibration against a real
// 14-day window showed history.jsonl is consistently the higher-fidelity
// source for typed slash-commands (e.g. /clear: 123 vs 93, /compact:
// 37 vs 18, /btw: 8 vs 0). The assessment pipeline takes Math.max of
// both data sources so we never regress below the existing JSONL-only
// behavior — only ever recover signal the JSONL scanner can't see.
//
// Per-session 1-counting matches the existing probe semantics: a session
// that types /<cmd> three times still counts as one adoption signal.

import { readFile } from "node:fs/promises";

// Map a slash-command name (matching TARGET_COMMANDS in _usage-data.mjs)
// to the signalsSummary field it feeds. Mirrors the field naming used by
// scanTranscriptInvocations so a downstream consumer can Math.max
// field-by-field.
const COMMAND_TO_FIELD = {
  simplify: "simplifyCommandUses",
  btw: "btwCommandUses",
  voice: "voiceCommandUses",
  clear: "clearCommandUses",
  compact: "compactCommandUses",
  // /color is client-side (recolors the prompt) and lands in the session
  // transcript as a system-type entry, which scanTranscriptInvocations
  // (user-message-only) can't see. history.jsonl is the only reliable
  // source for real /color adoption — Boris tip 40.
  color: "colorCommandUses",
  "fewer-permission-prompts": "fewerPermsCommandUses",
  loop: "loopCommandUses",
  // /babysit is intentionally NOT mapped here. babysitLoopUses must keep
  // its strict per-session AND-gate (both /loop AND /babysit in the same
  // session) per the V1.4 audit (PR #46). Counting /babysit alone from
  // history would defeat that audit's intent — loopCommandUses already
  // captures the looser "any /loop session" signal.
  focus: "focusCommandUses",
  schedule: "scheduleCommandUses",
  batch: "batchCommandUses",
};

function stripPluginPrefix(cmd) {
  return cmd.includes(":") ? cmd.slice(cmd.lastIndexOf(":") + 1) : cmd;
}

// Extract the leading slash-command token from a display string.
// Returns the bare command name (no leading slash, plugin prefix stripped)
// or null if the display doesn't start with a recognizable /command.
// Negative lookahead style: we match the longest hyphenated identifier
// after the leading slash, then check exact membership against the
// supplied set — this rejects /btw-other (matches "btw-other", not "btw")
// without bespoke per-command regex.
function extractLeadingCommand(display) {
  if (typeof display !== "string") return null;
  const trimmed = display.trimStart();
  // Match a leading slash, optional plugin namespace, then the command
  // name. Allow letters/digits/hyphen in the command body. Stop at first
  // whitespace or non-id char.
  const m = trimmed.match(/^\/([\w:-]+)/);
  if (!m) return null;
  return stripPluginPrefix(m[1]);
}

/**
 * Scan ~/.claude/history.jsonl for typed slash-commands.
 *
 * @param {object} opts
 * @param {string} opts.historyPath - absolute path to history.jsonl
 * @param {Date} [opts.now] - reference time for the lookback window
 * @param {number} opts.lookbackMs - lookback window in milliseconds
 * @param {string[]} opts.commands - slash-command names to count (no leading slash)
 * @returns {Promise<Record<string, number>>} per-session counts keyed by signalsSummary field
 */
export async function scanHistoryJsonl(opts = {}) {
  const { historyPath, now = new Date(), lookbackMs, commands = [] } = opts;

  // Seed the output with every requested command at 0 so callers can
  // depend on stable shape regardless of file presence / contents.
  const counts = {};
  for (const cmd of commands) {
    const field = COMMAND_TO_FIELD[cmd];
    if (field) counts[field] = 0;
  }

  if (!historyPath) return counts;

  let raw;
  try {
    raw = await readFile(historyPath, "utf8");
  } catch {
    // ENOENT or unreadable — return zero counts. Production code path
    // must never crash on a missing history file.
    return counts;
  }

  const cutoff = now.getTime() - lookbackMs;
  const requested = new Set(commands);

  // Per-(field, session) dedup: a session counts once per command field
  // even if the user typed /<cmd> repeatedly. Tracks pairs as
  // `${field}::${sessionId}` to avoid nested maps.
  const seen = new Set();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      // Malformed line — skip.
      continue;
    }
    const tsMs = Number(entry.timestamp);
    if (!Number.isFinite(tsMs) || tsMs < cutoff) continue;

    const cmd = extractLeadingCommand(entry.display);
    if (!cmd || !requested.has(cmd)) continue;
    const field = COMMAND_TO_FIELD[cmd];
    if (!field) continue;

    const sessionId = entry.sessionId || "__no_session__";
    const key = `${field}::${sessionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[field] = (counts[field] || 0) + 1;
  }

  return counts;
}

/**
 * The default list of commands worth scanning from history.jsonl —
 * everything in TARGET_COMMANDS except /rewind (keyboard shortcut,
 * never typed) and /go (PROMPT_PHRASE command, JSONL mid-text path
 * already covers it). /color belongs here specifically because it is
 * client-side: its real invocations never reach the user-message
 * transcript scan, so history.jsonl is its only reliable source.
 */
export const HISTORY_COMMAND_LIST = [
  "simplify",
  "btw",
  "voice",
  "clear",
  "compact",
  "color",
  "fewer-permission-prompts",
  "loop",
  "focus",
  "schedule",
  "batch",
];
