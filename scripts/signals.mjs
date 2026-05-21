import { existsSync } from "node:fs";
import { readFile, stat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { claudeHome, safeReadJson, safeReaddir } from "./_fs-utils.mjs";
import { gatherInsightsSignals } from "./insights-signals.mjs";
import { scanTranscriptInvocations } from "./_usage-data.mjs";
import { scanHistoryJsonl, HISTORY_COMMAND_LIST } from "./_history-data.mjs";

// Files we scan for worktree-style shortcuts. Keep this list deliberately
// loose — users wire shell rc fragments many ways (zprofile for login
// shells, zshenv for non-interactive, .aliases as a portable include,
// .zshrc.d/* for sourced snippets). Per-file readability is best-effort:
// missing files and unreadable ones are silently skipped.
const SHELL_RC_FILENAMES = [
  ".zshrc",
  ".zprofile",
  ".zshenv",
  ".bashrc",
  ".bash_profile",
  ".aliases",
  ".zsh_aliases",
];
const SHELL_RC_FRAGMENT_DIRS = [".zshrc.d", join(".config", "zsh")];

// True if a string body references worktree navigation. Single source of
// truth for the broad-count predicate so alias and function detection stay
// in sync.
const WORKTREE_BODY_RE = /(\bworktree\b|\.worktrees\/|git\s+worktree)/i;

const execFileAsync = promisify(execFile);

// Action verbs that indicate the file actually tells Claude what to DO.
// A skill/command/agent that doesn't say "run", "use", "prefer", etc. is just
// decoration — anti-gaming defense against "spray empty stubs to inflate score".
const ACTION_VERBS =
  /\b(run|use|prefer|avoid|never|always|don'?t|do not|invoke|trigger|check|verify|build|create|skip|stop|launch|delegate|read|write|edit|fetch|search|generate|format|test|deploy|commit|push|review|update|remove)\b/i;
const MIN_SUBSTANTIVE_CHARS = 50;

/**
 * Strip frontmatter, headings, code-fence markers, and bullet markers so we
 * can measure how much *body* prose a file actually has. Empty stubs and
 * heading-only files collapse to near-zero characters here.
 */
function stripBoilerplate(content) {
  return content
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^\+\+\+[\s\S]*?\+\+\+\s*/m, "")
    .replace(/^#{1,6}\s.*$/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^```.*$/gm, "")
    .replace(/\bTODO\b.*$/gim, "")
    .replace(/\bFIXME\b.*$/gim, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True if the file at `path` has ≥50 chars of non-boilerplate body AND at
 * least one action verb. Used to count only substantive skills/commands/
 * agents/plans — empty stubs no longer inflate the score.
 */
export async function isSubstantive(path) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return false;
  }
  const body = stripBoilerplate(content);
  if (body.length < MIN_SUBSTANTIVE_CHARS) return false;
  if (!ACTION_VERBS.test(body)) return false;
  return true;
}

async function filterSubstantive(dir, names) {
  const out = [];
  for (const n of names) {
    if (await isSubstantive(join(dir, n))) out.push(n);
  }
  return out;
}

async function isSubstantiveSkill(skillPath) {
  let entries = [];
  try {
    const st = await stat(skillPath);
    if (st.isFile()) return isSubstantive(skillPath);
    entries = await readdir(skillPath);
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.endsWith(".md") && (await isSubstantive(join(skillPath, e))))
      return true;
  }
  return false;
}

async function filterSubstantiveSkillDirs(dir, names) {
  const out = [];
  for (const n of names) {
    if (await isSubstantiveSkill(join(dir, n))) out.push(n);
  }
  return out;
}

async function countSubstantiveFiles(dir) {
  const entries = await safeReaddir(dir);
  let n = 0;
  for (const e of entries) {
    if (await isSubstantive(join(dir, e))) n += 1;
  }
  return n;
}

async function listProjectMemoryFiles() {
  const base = join(claudeHome(), "projects");
  const projects = await safeReaddir(base);
  const found = [];
  for (const p of projects) {
    const memoryDir = join(base, p, "memory");
    if (existsSync(memoryDir)) {
      const files = await safeReaddir(memoryDir);
      if (files.length) found.push({ project: p, fileCount: files.length });
    }
  }
  return found;
}

async function dirSize(path) {
  const entries = await safeReaddir(path);
  return entries.length;
}

// True if a PostToolUse hook is wired up to run a formatter on Edit|Write
// (or MultiEdit) tool calls. Distinguishes "I have a formatter feedback loop"
// from "I have *some* PostToolUse hook" — generic detection would credit
// notification or logging hooks unfairly. Two-part check:
//   1. matcher includes Edit or Write (substring, regex-OR-pipe friendly)
//   2. command references a known formatter or the generic 'format' token
// Catches both name-based hooks (prettier, ruff, gofmt, rustfmt, shfmt,
// rubocop, black, eslint) and shell-script wrappers ('format-on-edit.sh',
// 'bun run format', 'npm run format').
const FORMATTER_TOKENS =
  /(prettier|ruff|gofmt|rustfmt|shfmt|rubocop|\bblack\b|eslint|\bformat\b)/i;
export function detectFormatterHook(hooks) {
  const postTool = hooks?.PostToolUse || [];
  for (const entry of postTool) {
    const matcher = entry.matcher || "";
    if (!/Edit|Write/i.test(matcher)) continue;
    for (const h of entry.hooks || []) {
      if (typeof h.command === "string" && FORMATTER_TOKENS.test(h.command)) {
        return true;
      }
    }
  }
  return false;
}

// True when the user has explicitly opted in to Claude in Chrome (a built-in
// Claude Code feature, distinct from MCP plugins). Lives in `~/.claude.json`
// — NOT `~/.claude/settings.json` — because it is CLI runtime state, not
// user-editable config. Strict equality on `true`: bare presence of the
// extension cache or onboarding flag does not imply the integration is on.
export function detectClaudeInChrome(cliConfig) {
  return cliConfig?.claudeInChromeDefaultEnabled === true;
}

// True when the user has invoked the iOS / web Remote Control flow at least
// once. Boris tip 47. Lives in `~/.claude.json#hasUsedRemoteControl` (CLI
// runtime state), not `~/.claude/settings.json`. Strict equality on `true`
// — the field is a sticky flag, not a config toggle, so we reject coerced
// truthy values (1, "true") to avoid future false positives if the CLI
// changes the encoding.
export function detectRemoteControl(cliConfig) {
  return cliConfig?.hasUsedRemoteControl === true;
}

// True if a Stop hook fires a system notification when Claude finishes —
// Boris tip 75. Distinguishes "I get pinged for autonomous runs" from "I
// have *some* Stop hook" (e.g. a stop-verify.sh check). Tokens cover macOS
// (osascript display notification, terminal-notifier, say), Linux
// (notify-send), and the generic `notification` keyword for shell wrappers.
const STOP_NOTIFICATION_TOKENS =
  /(osascript[^\n]*display\s+notification|terminal-notifier|notify-send|\bnotification\b|\bsay\b)/i;
export function detectStopHookNotification(hooks) {
  const stop = hooks?.Stop || [];
  for (const entry of stop) {
    for (const h of entry.hooks || []) {
      if (
        typeof h.command === "string" &&
        STOP_NOTIFICATION_TOKENS.test(h.command)
      ) {
        return true;
      }
    }
  }
  return false;
}

// True if any agent frontmatter declares `isolation: worktree` — Boris tip
// 28. Scans personal + project .md agent files AND plugin agents under
// `~/.claude/plugins/cache/<vendor>/<plugin>/<version>/agents/*.md`.
// Frontmatter is a simple YAML block at the top; we just grep for the
// literal key/value pair. Cheap and avoids pulling a YAML parser.
//
// Probe-Logic Challenger fix (V1.3): the original probe scanned only
// personal/project agents. Plugins are the most likely place an
// `isolation: worktree` declaration would appear, so we also walk the
// plugins cache.
const ISOLATION_FRONTMATTER_RE = /^isolation:\s*["']?worktree["']?\s*$/im;
async function hasWorktreeIsolatedAgent(dirs) {
  for (const dir of dirs) {
    const entries = await safeReaddir(dir);
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      try {
        const content = await readFile(join(dir, name), "utf8");
        if (ISOLATION_FRONTMATTER_RE.test(content)) return true;
      } catch {
        // unreadable — skip
      }
    }
  }
  // Plugin agents: walk `<claudeHome>/plugins/cache/<vendor>/<plugin>/<version>/agents/`.
  // Bound depth so we don't recurse into unrelated plugin assets (skills,
  // commands, hooks, etc.) — only `agents/` flat .md files matter here.
  const pluginsRoot = join(claudeHome(), "plugins", "cache");
  const vendors = await safeReaddir(pluginsRoot);
  for (const vendor of vendors) {
    const vendorDir = join(pluginsRoot, vendor);
    const pluginNames = await safeReaddir(vendorDir);
    for (const plugin of pluginNames) {
      const pluginDir = join(vendorDir, plugin);
      const versions = await safeReaddir(pluginDir);
      for (const version of versions) {
        const agentsDir = join(pluginDir, version, "agents");
        const agentFiles = await safeReaddir(agentsDir);
        for (const name of agentFiles) {
          if (!name.endsWith(".md")) continue;
          try {
            const content = await readFile(join(agentsDir, name), "utf8");
            if (ISOLATION_FRONTMATTER_RE.test(content)) return true;
          } catch {
            // unreadable — skip
          }
        }
      }
    }
  }
  return false;
}

// True if any personal/project agent or personal-skill body contains a verify
// or code-review token. Closes the gap surfaced by Probe-Logic Challenger:
// the original `hasVerifyAgent` only matched agent FILENAMES starting with
// "verify" and missed legitimate verify pipelines like the /ship SKILL.md
// body. The token set is intentionally narrow — `verify`, `reviewer`, and
// `code-review`/`code_review` — so casual prose like "verify the docs" in
// an unrelated skill won't false-positive (it would have to match the *exact*
// token, with word boundaries on `reviewer`/`code-review`). Reads up to 8KB
// per file to bound the cost on large skill libraries.
const VERIFY_BODY_RE = /(verify[- _]?agent|code[-_]?review|\breviewer\b)/i;
const BODY_SCAN_CAP_BYTES = 8 * 1024;
async function scanBodyForVerifyToken(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const head = content.slice(0, BODY_SCAN_CAP_BYTES);
    return VERIFY_BODY_RE.test(head);
  } catch {
    return false;
  }
}
async function hasVerifySignalInBodies({
  agentDirs,
  agentNames,
  skillDirs,
  skillNames,
}) {
  // Agents: flat .md files keyed by name list per dir.
  for (const { dir, names } of agentDirs) {
    for (const n of names) {
      if (!n.endsWith(".md")) continue;
      if (await scanBodyForVerifyToken(join(dir, n))) return true;
    }
  }
  void agentNames; // (kept for future symmetry with skills shape)
  // Skills: each entry is a directory with a SKILL.md (and possibly other
  // .md spokes). Scan SKILL.md primarily.
  for (const { dir, names } of skillDirs) {
    for (const n of names) {
      const skillRoot = join(dir, n);
      const candidates = ["SKILL.md", "skill.md", `${n}.md`];
      for (const c of candidates) {
        if (await scanBodyForVerifyToken(join(skillRoot, c))) return true;
      }
    }
  }
  void skillNames;
  return false;
}

// Pure parser for `claude mcp list` stdout. Returns one record per MCP
// server with name, scope (`plugin` | `claude.ai` | `user`) and status
// (`connected` | `failed` | `needs-auth`). Output format from the Claude
// Code CLI: "<name>: <transport> - <status-glyph> <status-label>". Treats
// any line that doesn't match as garbage rather than throwing — the
// stdout contract isn't strictly versioned and we don't want a CLI bump
// to break the assessment.
const STATUS_TOKEN = {
  "✓ Connected": "connected",
  "✗ Failed to connect": "failed",
  "! Needs authentication": "needs-auth",
};

// Counts worktree shortcuts across the user's shell config files.
//
// Two signals:
//   - worktreeAliasCount: strict Boris za/zb/zc-named aliases (legacy
//     count, kept for backward compatibility with rubric predicates).
//     Distinct alias names are deduped across files so the same alias
//     defined twice doesn't double-count.
//   - worktreeShortcutCount: broad count of any alias OR shell function
//     whose body references `worktree`, `.worktrees/`, or `git worktree`.
//     Catches non-Boris-named wrappers like `wt-a` or `claude-1` and the
//     `wt() { cd ~/.worktrees/$1 && claude; }` function form.
//
// Inputs (all injectable for tests):
//   - rcPaths: explicit list of files to scan. When set, fragment-dir
//     globbing is skipped and `home` is ignored.
//   - home: alternative home directory; expands to all SHELL_RC_FILENAMES
//     plus a recursive walk of SHELL_RC_FRAGMENT_DIRS.
const WORKTREE_ALIAS_RE = /^\s*alias\s+(za|zb|zc)=/;
const ALIAS_LINE_RE = /^\s*alias\s+([A-Za-z_][\w-]*)=(.*)$/;
// Function form: `name() { ...body... }`. Bash/zsh tolerate optional
// whitespace around the parens and the brace-on-next-line. We only need to
// catch the opening `name() {`; the body extends until the matching `}` or
// 50 lines, whichever comes first.
const FUNCTION_OPEN_RE = /^\s*([A-Za-z_][\w-]*)\s*\(\s*\)\s*\{?\s*$/;
const FUNCTION_OPEN_INLINE_RE = /^\s*([A-Za-z_][\w-]*)\s*\(\s*\)\s*\{(.*)$/;
const FUNCTION_LOOKAHEAD_LINES = 50;

// Strip a trailing `# comment` from an alias RHS so the broad-body match
// keys off the actual command, not the explanatory comment. Quote-aware:
// only strips `#` that appears outside single/double quotes.
function stripTrailingComment(rhs) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < rhs.length; i++) {
    const c = rhs[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble) {
      return rhs.slice(0, i);
    }
  }
  return rhs;
}

// Strip surrounding single or double quotes from an alias RHS so the body
// match operates on the actual command text.
function unquote(rhs) {
  const trimmed = rhs.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function expandRcPaths(home) {
  const out = [];
  for (const name of SHELL_RC_FILENAMES) out.push(join(home, name));
  for (const fragDir of SHELL_RC_FRAGMENT_DIRS) {
    const abs = join(home, fragDir);
    let entries = [];
    try {
      entries = await readdir(abs);
    } catch {
      continue;
    }
    for (const e of entries) out.push(join(abs, e));
  }
  return out;
}

// Walks file content and detects worktree-bodied shell functions. Returns
// the count of unique function names whose body references worktree paths.
function countWorktreeFunctions(content) {
  const names = new Set();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let name = null;
    let inlineBody = "";
    const inline = line.match(FUNCTION_OPEN_INLINE_RE);
    if (inline) {
      name = inline[1];
      inlineBody = inline[2];
    } else {
      const m = line.match(FUNCTION_OPEN_RE);
      if (m) name = m[1];
    }
    if (!name) continue;
    let body = inlineBody;
    const end = Math.min(lines.length, i + 1 + FUNCTION_LOOKAHEAD_LINES);
    for (let j = i + 1; j < end; j++) {
      body += "\n" + lines[j];
      if (lines[j].includes("}")) break;
    }
    if (WORKTREE_BODY_RE.test(body)) names.add(name);
  }
  return names.size;
}

export async function gatherShellAliases(options = {}) {
  // Vitest skip: when integration tests run gatherSignals without injecting
  // rcPaths or home, don't read the developer's real shell rc files.
  if (process.env.VITEST && !options.rcPaths && !options.home) {
    return { worktreeAliasCount: 0, worktreeShortcutCount: 0 };
  }
  let rcPaths;
  if (options.rcPaths) {
    rcPaths = options.rcPaths;
  } else {
    const home = options.home || homedir();
    rcPaths = await expandRcPaths(home);
  }
  const strictNames = new Set();
  const broadAliasNames = new Set();
  let broadFunctionCount = 0;
  for (const p of rcPaths) {
    let content;
    try {
      content = await readFile(p, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const strict = line.match(WORKTREE_ALIAS_RE);
      if (strict) strictNames.add(strict[1]);
      const aliasMatch = line.match(ALIAS_LINE_RE);
      if (aliasMatch) {
        const aliasName = aliasMatch[1];
        const body = unquote(stripTrailingComment(aliasMatch[2]));
        if (WORKTREE_BODY_RE.test(body)) broadAliasNames.add(aliasName);
      }
    }
    broadFunctionCount += countWorktreeFunctions(content);
  }
  return {
    worktreeAliasCount: strictNames.size,
    worktreeShortcutCount: broadAliasNames.size + broadFunctionCount,
  };
}

// Reads ~/.claude/ship/journal.jsonl line by line. Counts stage:2 entries
// (verify-agent dispatches) and outcome:"shipped" entries within the
// lookback window. Empty/missing file returns all zeros. Malformed lines
// are skipped silently — same fault tolerance as parseJournalLine.
//
// Inputs are injected (journalPath, now) so tests can drive temp files
// without monkey-patching globals.
export async function gatherShipJournal(options = {}) {
  // Vitest skip: when integration tests run gatherSignals without injecting
  // journalPath, don't read the developer's real ~/.claude/ship/journal.jsonl.
  if (process.env.VITEST && !options.journalPath) {
    return { stage2Count: 0, totalRuns: 0, lastRunAt: null };
  }
  const {
    journalPath = join(claudeHome(), "ship", "journal.jsonl"),
    now = new Date(),
    lookbackDays = 14,
  } = options;
  let raw;
  try {
    raw = await readFile(journalPath, "utf8");
  } catch {
    return { stage2Count: 0, totalRuns: 0, lastRunAt: null };
  }
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  let stage2Count = 0;
  let totalRuns = 0;
  let lastRunAt = null;
  for (const line of raw.split("\n")) {
    const entry = parseJournalLine(line);
    if (!entry || typeof entry.ts !== "string") continue;
    const t = Date.parse(entry.ts);
    if (Number.isNaN(t) || t < cutoff) continue;
    if (entry.stage === 2) stage2Count++;
    if (entry.outcome === "shipped") {
      totalRuns++;
      if (!lastRunAt || entry.ts > lastRunAt) lastRunAt = entry.ts;
    }
  }
  return { stage2Count, totalRuns, lastRunAt };
}

// Parse a single JSONL line from ~/.claude/ship/journal.jsonl. Returns the
// parsed object on valid JSON object input, null on anything else (empty,
// malformed, non-object). Mirrors parseMcpListOutput's "skip silently"
// fault tolerance — the journal is append-only across all sessions and
// schema may evolve, so the reader stays tolerant.
export function parseJournalLine(line) {
  if (!line || !line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseMcpListOutput(stdout) {
  if (!stdout || typeof stdout !== "string") return [];
  const out = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("Checking MCP server health")) continue;
    const dashIdx = line.lastIndexOf(" - ");
    if (dashIdx < 0) continue;
    const statusLabel = line.slice(dashIdx + 3).trim();
    const status = STATUS_TOKEN[statusLabel];
    if (!status) continue;
    const left = line.slice(0, dashIdx);
    // ": " (colon-space) is the name/transport delimiter. Plugin-prefixed
    // names contain inner colons (`plugin:context7:context7`), so we need
    // the last occurrence — split-on-first-colon would clip them.
    const sepIdx = left.lastIndexOf(": ");
    if (sepIdx < 0) continue;
    const name = left.slice(0, sepIdx).trim();
    if (!name) continue;
    const scope = name.startsWith("plugin:")
      ? "plugin"
      : name.startsWith("claude.ai ")
        ? "claude.ai"
        : "user";
    out.push({ name, scope, status });
  }
  return out;
}

// Subprocess wrapper around `claude mcp list`. Uses the safe `execFile` API
// (argv array, no shell) — never the shell-prone alternative. Empty-array
// fallback if the CLI is missing, slow, or non-zero exits, so a broken
// `claude` install doesn't poison the whole assessment run. Skipped under
// vitest because the CLI takes ~10s to probe every MCP server (TLS round
// trips), which would balloon every integration test past its timeout.
async function gatherMcpServers() {
  if (process.env.VITEST) return [];
  try {
    const { stdout } = await execFileAsync("claude", ["mcp", "list"], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return parseMcpListOutput(stdout);
  } catch {
    return [];
  }
}

// True if the `vercel` CLI is on PATH. Boris tip 18 (Vercel CLI unlocks
// env/deploy/logs agentic flows). Uses `which` so we get a path on
// success, ENOENT on failure. The injectable execFile parameter exists
// purely for tests — production callers always use the default.
export async function detectVercelCli({ execFile = execFileAsync } = {}) {
  try {
    const { stdout } = await execFile("which", ["vercel"], { timeout: 2000 });
    return typeof stdout === "string" && stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function gatherSignals(projectRoot = process.cwd(), options = {}) {
  const { insightsLookbackDays = 30, includeTranscripts = false } = options;
  const settings =
    (await safeReadJson(join(claudeHome(), "settings.json"))) || {};
  const cliConfig =
    (await safeReadJson(join(claudeHome(), "..", ".claude.json"))) || {};
  const hasClaudeInChrome = detectClaudeInChrome(cliConfig);
  const hasRemoteControl = detectRemoteControl(cliConfig);
  const projectSettings =
    (await safeReadJson(join(projectRoot, ".claude", "settings.local.json"))) ||
    {};

  const personalAgentsDir = join(claudeHome(), "agents");
  const personalCommandsDir = join(claudeHome(), "commands");
  const personalSkillsDir = join(claudeHome(), "skills");
  const projectAgentsDir = join(projectRoot, ".claude", "agents");
  const projectCommandsDir = join(projectRoot, ".claude", "commands");

  const personalAgentsRaw = (await safeReaddir(personalAgentsDir)).filter((f) =>
    f.endsWith(".md"),
  );
  const personalCommandsRaw = (await safeReaddir(personalCommandsDir)).filter(
    (f) => f.endsWith(".md"),
  );
  const personalSkillsRaw = (await safeReaddir(personalSkillsDir)).filter(
    (f) => !f.startsWith("."),
  );
  const projectAgentsRaw = (await safeReaddir(projectAgentsDir)).filter((f) =>
    f.endsWith(".md"),
  );
  const projectCommandsRaw = (await safeReaddir(projectCommandsDir)).filter(
    (f) => f.endsWith(".md"),
  );

  // Substantive filter: count only files with real body content + an action
  // verb. Closes the "spray empty stubs to inflate the score" loophole.
  const personalAgents = await filterSubstantive(
    personalAgentsDir,
    personalAgentsRaw,
  );
  const personalCommands = await filterSubstantive(
    personalCommandsDir,
    personalCommandsRaw,
  );
  const personalSkills = await filterSubstantiveSkillDirs(
    personalSkillsDir,
    personalSkillsRaw,
  );
  const projectAgents = await filterSubstantive(
    projectAgentsDir,
    projectAgentsRaw,
  );
  const projectCommands = await filterSubstantive(
    projectCommandsDir,
    projectCommandsRaw,
  );

  const plugins = Object.entries(settings.enabledPlugins || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  // P6.1 (Boris tip 44): the code-review plugin auto-reviews PRs as they open.
  // Anchored regex: name must START with `code-review` followed by either `@`
  // (marketplace separator) or end-of-string. This intentionally rejects
  // `pr-review-toolkit@*` (a different plugin, already detected via
  // hasVerifyAgent), `code-review-helper@*` (unrelated), and
  // `pre-code-review@*` (unrelated prefix). Only enabled plugins are
  // considered because `plugins` was already filtered to v === true.
  const CODE_REVIEW_PLUGIN_RE = /^code-review(@|$)/i;
  const hasCodeReviewPlugin = plugins.some((p) =>
    CODE_REVIEW_PLUGIN_RE.test(p),
  );

  const memory = await listProjectMemoryFiles();
  const claudeMdExists =
    existsSync(join(projectRoot, "CLAUDE.md")) ||
    existsSync(join(claudeHome(), "CLAUDE.md"));

  const hooks = settings.hooks || {};
  const env = settings.env || {};
  const hasFormatterHook = detectFormatterHook(hooks);
  const hasStopHookNotification = detectStopHookNotification(hooks);
  const customSpinnerVerbCount = Array.isArray(settings.spinnerVerbs?.verbs)
    ? settings.spinnerVerbs.verbs.length
    : 0;
  const hasIsolatedAgent = await hasWorktreeIsolatedAgent([
    personalAgentsDir,
    projectAgentsDir,
  ]);
  const verifySignalBodyMatch = await hasVerifySignalInBodies({
    agentDirs: [
      { dir: personalAgentsDir, names: personalAgentsRaw },
      { dir: projectAgentsDir, names: projectAgentsRaw },
    ],
    skillDirs: [{ dir: personalSkillsDir, names: personalSkillsRaw }],
  });

  const plansDir = join(claudeHome(), "plans");
  const plansCountRaw = await dirSize(plansDir);
  // Empty plan files (no body, no checklist, no verbs) shouldn't count toward
  // Memory or Planning credit.
  const plansCount = await countSubstantiveFiles(plansDir);
  const sessionsCount = await dirSize(join(claudeHome(), "sessions"));
  const statuslineConfigured = existsSync(join(claudeHome(), "statusline.sh"));
  const keybindingsConfigured = existsSync(
    join(claudeHome(), "keybindings.json"),
  );

  const hasPlugin = (prefix) => plugins.some((p) => p.startsWith(prefix));

  const mcpServers = await gatherMcpServers();
  const hasVercelCli = process.env.VITEST ? false : await detectVercelCli();
  const shipJournal = await gatherShipJournal({ lookbackDays: 14 });
  const shellAliases = await gatherShellAliases();
  const transcriptInvocations = await scanTranscriptInvocations({
    projectsRoot: join(claudeHome(), "projects"),
    lookbackDays: 30,
  });
  // History scanner reads ~/.claude/history.jsonl directly — the durable
  // record of typed user prompts. Side-channel commands like /btw never
  // land in the session JSONL, so we read history.jsonl and merge via
  // Math.max in buildSignalsSummary. Same 30-day lookback as the
  // transcript scanner to keep the windows aligned.
  const historyInvocations = process.env.VITEST
    ? {}
    : await scanHistoryJsonl({
        historyPath: join(claudeHome(), "history.jsonl"),
        lookbackMs: 30 * 24 * 60 * 60 * 1000,
        commands: HISTORY_COMMAND_LIST,
      });

  const insights = await gatherInsightsSignals({
    claudeHome: claudeHome(),
    lookbackDays: insightsLookbackDays,
    includeTranscripts,
  });

  return {
    capturedAt: new Date().toISOString(),
    settings: {
      effortLevel: settings.effortLevel || "unknown",
      skipDangerousModePermissionPrompt:
        !!settings.skipDangerousModePermissionPrompt,
      allowList: (settings.permissions?.allow || []).concat(
        projectSettings.permissions?.allow || [],
      ),
      denyList: (settings.permissions?.deny || []).concat(
        projectSettings.permissions?.deny || [],
      ),
      autoCompactWindow:
        env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ||
        process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ||
        null,
      // Tip 45 (Boris): auto-memory is default-on; the only flag is the
      // *inverse* disable flag. Treat any value of "1" (string) as opt-out;
      // anything else (absent, "0", undefined) leaves auto-memory enabled.
      autoMemoryEnabled:
        (env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ??
          process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY) !== "1",
      hookEvents: Object.keys(hooks),
      hookTotalCount: Object.values(hooks).flat().length,
      hasFormatterHook,
      hasStopHookNotification,
      customSpinnerVerbCount,
      hasIsolatedAgent,
      hasClaudeInChrome,
      hasRemoteControl,
      hasVercelCli,
      // P2.2 (Boris tip 34): Default | Explanatory | Learning | Concise | custom.
      // Verbatim string; null when settings.outputStyle is absent.
      outputStyle:
        typeof settings.outputStyle === "string" ? settings.outputStyle : null,
      // settings.permissions.defaultMode — null when absent. Used purely as
      // a diagnostic signal on the dashboard (cross-axis sanity hint): if
      // setup says auto but Execution permissions are low, surface the
      // disconnect. Never used in scoring; the two axes stay independent.
      permissionsDefaultMode:
        typeof settings.permissions?.defaultMode === "string"
          ? settings.permissions.defaultMode
          : null,
    },
    personalAgents,
    personalCommands,
    personalSkills,
    projectAgents,
    projectCommands,
    raw: {
      personalAgents: personalAgentsRaw,
      personalCommands: personalCommandsRaw,
      personalSkills: personalSkillsRaw,
      projectAgents: projectAgentsRaw,
      projectCommands: projectCommandsRaw,
      plansCount: plansCountRaw,
    },
    plugins,
    hasCodeReviewPlugin,
    verifySignalBodyMatch,
    mcpServers,
    shipJournal,
    shellAliases,
    transcriptInvocations,
    historyInvocations,
    memory,
    claudeMdExists,
    plansCount,
    sessionsCount,
    statuslineConfigured,
    keybindingsConfigured,
    has: {
      superpowers: hasPlugin("superpowers@"),
      prReviewToolkit: hasPlugin("pr-review-toolkit@"),
      codeReview: hasPlugin("code-review@"),
      codeSimplifier: hasPlugin("code-simplifier@"),
      featureDev: hasPlugin("feature-dev@"),
      skillCreator: hasPlugin("skill-creator@"),
      claudeMdMgmt: hasPlugin("claude-md-management@"),
      ralphLoop: hasPlugin("ralph-loop@"),
      commitCommands: hasPlugin("commit-commands@"),
      explanatoryStyle: hasPlugin("explanatory-output-style@"),
      playwright: hasPlugin("playwright@"),
      semgrep: hasPlugin("semgrep@"),
      vercel: hasPlugin("vercel@"),
      imessage: hasPlugin("imessage@"),
      karpathy: hasPlugin("andrej-karpathy-skills@"),
      claudeCodeSetup: hasPlugin("claude-code-setup@"),
      frontendDesign: hasPlugin("frontend-design@"),
    },
    insights,
  };
}
