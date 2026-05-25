# MCP & Chrome Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three integrations-dimension detection gaps surfaced by the 2026-05-09 self-assessment audit — Claude in Chrome (gap A+C) and registered MCP servers as a first-class signal class (gap B).

**Architecture:** Add two new pure detection helpers alongside the existing `detectFormatterHook` / `detectStopHookNotification` family in `scripts/signals.mjs`. The Chrome helper reads `~/.claude.json` (CLI runtime config); the MCP helper parses `claude mcp list` stdout via the safe `execFile` API (never the shell-prone `exec`). Wire each through `gatherSignals` → `buildSignalsSummary` → `rubric.json#integrations.nextActions[*].satisfiedWhen` so the existing predicate engine credits both signals automatically. Ship as **two independent base-on-main PRs** (PR A = Chrome, PR B = MCP server class) so each can be reviewed and reverted in isolation.

**Tech Stack:** Node ESM, vitest, `~/.claude.json`, `execFile` from `node:child_process` (safe — never the shell-prone `exec`), `app/lib/assessment.evaluatePredicate` for rubric wiring.

---

## File Structure

| File                                                 | Responsibility                                                                                                                                                                                                          | PR    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `scripts/signals.mjs`                                | Add `detectClaudeInChrome(cliConfig)` (pure) + `gatherCliConfig()` (reads `~/.claude.json`); add `parseMcpListOutput(stdout)` (pure) + `gatherMcpServers()` (subprocess wrapper); wire both into `gatherSignals` return | A + B |
| `scripts/run-assessment.mjs`                         | Forward `hasClaudeInChrome` (PR A) and `mcpServersConnected`, `hasMcpServers` (PR B) inside `buildSignalsSummary`                                                                                                       | A + B |
| `app/data/rubric.json`                               | Add 1 action under `integrations` per PR with `satisfiedWhen` predicate                                                                                                                                                 | A + B |
| `scripts/__tests__/detect-claude-in-chrome.test.mjs` | New file — TDD coverage for `detectClaudeInChrome`                                                                                                                                                                      | A     |
| `scripts/__tests__/parse-mcp-list-output.test.mjs`   | New file — TDD coverage for `parseMcpListOutput`; fixtures for connected/failed/needs-auth, plugin-prefix, claude.ai-prefix, empty output                                                                               | B     |
| `scripts/__tests__/build-signals-summary.test.mjs`   | Extend `makeSignals` fixture; update inline snapshot to include new keys; add per-key forwarding tests                                                                                                                  | A + B |
| `app/lib/__tests__/rubric-predicates.test.ts`        | Extend `ALL_SATISFIED_SIGNALS` fixture with `hasClaudeInChrome` and `mcpServersConnected` so the sweep guard stays green                                                                                                | A + B |

---

# PR A — Claude in Chrome detection

### Task 1: Implement Chrome detection end-to-end (TDD)

**Files:**

- Create: `scripts/__tests__/detect-claude-in-chrome.test.mjs`
- Modify: `scripts/signals.mjs` (export a new `detectClaudeInChrome` function; add `gatherCliConfig` reader; add output to `gatherSignals` return)
- Modify: `scripts/run-assessment.mjs` (forward `hasClaudeInChrome` in `buildSignalsSummary`)
- Modify: `app/data/rubric.json` (add `integrations/claude-in-chrome` action with `satisfiedWhen: "hasClaudeInChrome"`)
- Modify: `scripts/__tests__/build-signals-summary.test.mjs` (extend `makeSignals` fixture, update inline snapshot, add forwarding test)
- Modify: `app/lib/__tests__/rubric-predicates.test.ts` (add `hasClaudeInChrome: true` to `ALL_SATISFIED_SIGNALS`)

- [ ] **Step 1: Write the failing detector test**

Create `scripts/__tests__/detect-claude-in-chrome.test.mjs`:

```javascript
import { describe, it, expect } from "vitest";
import { detectClaudeInChrome } from "../signals.mjs";

describe("detectClaudeInChrome", () => {
  it("returns false when cliConfig is undefined or null", () => {
    expect(detectClaudeInChrome(undefined)).toBe(false);
    expect(detectClaudeInChrome(null)).toBe(false);
  });

  it("returns false when no chrome flags are set", () => {
    expect(detectClaudeInChrome({})).toBe(false);
    expect(detectClaudeInChrome({ unrelated: true })).toBe(false);
  });

  it("returns true when claudeInChromeDefaultEnabled is true", () => {
    expect(detectClaudeInChrome({ claudeInChromeDefaultEnabled: true })).toBe(
      true,
    );
  });

  it("requires explicit true (not truthy strings/numbers)", () => {
    expect(detectClaudeInChrome({ claudeInChromeDefaultEnabled: 1 })).toBe(
      false,
    );
    expect(detectClaudeInChrome({ claudeInChromeDefaultEnabled: "true" })).toBe(
      false,
    );
  });

  it("ignores cachedChromeExtensionInstalled alone (extension cache != enabled)", () => {
    expect(detectClaudeInChrome({ cachedChromeExtensionInstalled: true })).toBe(
      false,
    );
  });

  it("ignores hasCompletedClaudeInChromeOnboarding alone (onboarded != enabled)", () => {
    expect(
      detectClaudeInChrome({ hasCompletedClaudeInChromeOnboarding: true }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run scripts/__tests__/detect-claude-in-chrome.test.mjs`
Expected: FAIL — "detectClaudeInChrome is not exported from ../signals.mjs"

- [ ] **Step 3: Implement `detectClaudeInChrome` and `gatherCliConfig` in `scripts/signals.mjs`**

Add near the top of `scripts/signals.mjs`, after the existing `detectFormatterHook` block:

```javascript
/**
 * True when the user has explicitly opted in to Claude in Chrome (a built-in
 * Claude Code feature, distinct from MCP plugins). Lives in `~/.claude.json`
 * — NOT `~/.claude/settings.json` — because it is CLI runtime state, not
 * user-editable config. Strict equality on `true`: bare presence of the
 * extension cache or onboarding flag does not imply the integration is on.
 */
export function detectClaudeInChrome(cliConfig) {
  return cliConfig?.claudeInChromeDefaultEnabled === true;
}
```

Then, in the same file, add a private helper that reads `~/.claude.json` and is invoked from `gatherSignals`:

```javascript
async function gatherCliConfig() {
  return (await safeReadJson(join(claudeHome(), "..", ".claude.json"))) || {};
}
```

In the `gatherSignals` function, just below the existing `safeReadJson` block that loads `settings.json`, add:

```javascript
const cliConfig = await gatherCliConfig();
const hasClaudeInChrome = detectClaudeInChrome(cliConfig);
```

Then add to the `gatherSignals` return object, in the `settings:` block alongside `hasFormatterHook`:

```javascript
      hasClaudeInChrome,
```

- [ ] **Step 4: Run the detector test and confirm it passes**

Run: `npx vitest run scripts/__tests__/detect-claude-in-chrome.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Forward `hasClaudeInChrome` in `buildSignalsSummary`**

In `scripts/run-assessment.mjs`, find the block that returns `hasFormatterHook` (around the same area as `hasSlackPlugin`, `hasVercelPlugin`) and add adjacent:

```javascript
    hasClaudeInChrome: !!signals.settings?.hasClaudeInChrome,
```

- [ ] **Step 6: Update `build-signals-summary.test.mjs` snapshot + add forwarding test**

In `scripts/__tests__/build-signals-summary.test.mjs`, extend the inline snapshot (around line 192-222) to include `"hasClaudeInChrome"` in the alphabetically-sorted key list — it sorts between `hasFormatterHook` and `hasPostToolHook`.

Add a new test before the closing `});`:

```javascript
it("forwards hasClaudeInChrome from settings.hasClaudeInChrome", () => {
  expect(
    buildSignalsSummary(
      makeSignals({
        settings: {
          ...makeSignals().settings,
          hasClaudeInChrome: true,
        },
      }),
    ).hasClaudeInChrome,
  ).toBe(true);
  expect(buildSignalsSummary(makeSignals()).hasClaudeInChrome).toBe(false);
});
```

- [ ] **Step 7: Add the rubric action for `integrations/claude-in-chrome`**

In `app/data/rubric.json`, find the `integrations` dimension's `nextActions` array (currently 2 entries: `vercel-cli`, `slack-mcp`) and append:

```json
{
  "id": "claude-in-chrome",
  "action": "Wire up Claude in Chrome — enables browser-driving agents (mcp__claude-in-chrome__*) — Boris tip 32",
  "effort": "10min",
  "satisfiedWhen": "hasClaudeInChrome"
}
```

- [ ] **Step 8: Extend `ALL_SATISFIED_SIGNALS` fixture in `rubric-predicates.test.ts`**

In `app/lib/__tests__/rubric-predicates.test.ts`, the `ALL_SATISFIED_SIGNALS` object (around line 24): add a new line in the `// integrations` group:

```typescript
  hasClaudeInChrome: true,
```

- [ ] **Step 9: Run full vitest suite + tsc + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 327+ tests passing, no tsc errors, Next build green.

- [ ] **Step 10: Commit**

```bash
git add -u
git commit -m "$(cat <<'EOF'
feat(self-assessment): detect Claude in Chrome integration

- detectClaudeInChrome reads claudeInChromeDefaultEnabled from ~/.claude.json
- Wire hasClaudeInChrome through gatherSignals -> buildSignalsSummary
- Add integrations/claude-in-chrome rubric action with satisfiedWhen predicate
- Closes Gap A (~/.claude/settings.json was the only config surface read)
  and Gap C (Chrome is neither a plugin nor a registered MCP server)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 2: Open PR A

**Files:** none

- [ ] **Step 1: Create branch and push**

```bash
git checkout -b feat/detect-claude-in-chrome
git push -u origin feat/detect-claude-in-chrome
```

- [ ] **Step 2: Open PR with `gh pr create --base main`**

```bash
gh pr create --base main --title "feat(self-assessment): detect Claude in Chrome integration" --body "$(cat <<'EOF'
## Summary
- Adds detectClaudeInChrome reading claudeInChromeDefaultEnabled from ~/.claude.json
- Forwards hasClaudeInChrome through gatherSignals -> buildSignalsSummary
- New rubric action integrations/claude-in-chrome with satisfiedWhen: hasClaudeInChrome
- Closes Gap A + Gap C from the 2026-05-09 detection-gap audit

## Test plan
- [x] vitest run scripts/__tests__/detect-claude-in-chrome.test.mjs - 6/6 new tests pass
- [x] vitest run - full suite green
- [x] tsc --noEmit and next build green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

# PR B — MCP servers as first-class signal class

### Task 3: Implement MCP server detection end-to-end (TDD)

**Files:**

- Create: `scripts/__tests__/parse-mcp-list-output.test.mjs`
- Modify: `scripts/signals.mjs` (export `parseMcpListOutput`; add `gatherMcpServers` subprocess wrapper using safe `execFile`; expose `mcpServers` array on `gatherSignals` return)
- Modify: `scripts/run-assessment.mjs` (forward `mcpServersConnected`, `hasMcpServers` in `buildSignalsSummary`)
- Modify: `app/data/rubric.json` (add `integrations/mcp-servers` action with `satisfiedWhen: "mcpServersConnected>=3"`)
- Modify: `scripts/__tests__/build-signals-summary.test.mjs` (extend `makeSignals` to accept `mcpServers`; update inline snapshot; add forwarding tests for both keys)
- Modify: `app/lib/__tests__/rubric-predicates.test.ts` (extend `ALL_SATISFIED_SIGNALS` with `mcpServersConnected: 5`)

- [ ] **Step 1: Write failing parser tests**

Create `scripts/__tests__/parse-mcp-list-output.test.mjs`:

```javascript
import { describe, it, expect } from "vitest";
import { parseMcpListOutput } from "../signals.mjs";

const SAMPLE = `Checking MCP server health…

claude.ai Slack: https://mcp.slack.com/mcp - ✓ Connected
claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ! Needs authentication
plugin:context7:context7: npx -y @upstash/context7-mcp - ✓ Connected
plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✗ Failed to connect
plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ! Needs authentication
plugin:terraform:terraform: docker run -i --rm hashicorp/terraform-mcp-server:0.4.0 - ✓ Connected
`;

describe("parseMcpListOutput", () => {
  it("returns empty array for empty input", () => {
    expect(parseMcpListOutput("")).toEqual([]);
    expect(parseMcpListOutput(undefined)).toEqual([]);
  });

  it("ignores the 'Checking MCP server health…' header line", () => {
    const out = parseMcpListOutput("Checking MCP server health…\n\n");
    expect(out).toEqual([]);
  });

  it("parses claude.ai-prefixed entries with connected status", () => {
    const out = parseMcpListOutput(
      "claude.ai Slack: https://mcp.slack.com/mcp - ✓ Connected\n",
    );
    expect(out).toEqual([
      {
        name: "claude.ai Slack",
        scope: "claude.ai",
        status: "connected",
      },
    ]);
  });

  it("parses plugin-prefixed entries", () => {
    const out = parseMcpListOutput(
      "plugin:context7:context7: npx -y @upstash/context7-mcp - ✓ Connected\n",
    );
    expect(out).toEqual([
      {
        name: "plugin:context7:context7",
        scope: "plugin",
        status: "connected",
      },
    ]);
  });

  it("classifies all three statuses", () => {
    const out = parseMcpListOutput(SAMPLE);
    const statuses = out.map((e) => e.status).sort();
    expect(statuses).toEqual([
      "connected",
      "connected",
      "connected",
      "failed",
      "needs-auth",
      "needs-auth",
    ]);
  });

  it("parses the full sample into 6 entries with correct scope split", () => {
    const out = parseMcpListOutput(SAMPLE);
    expect(out).toHaveLength(6);
    const scopes = out.map((e) => e.scope).sort();
    expect(scopes).toEqual([
      "claude.ai",
      "claude.ai",
      "plugin",
      "plugin",
      "plugin",
      "plugin",
    ]);
  });

  it("ignores malformed lines without crashing", () => {
    expect(parseMcpListOutput("garbage line\n")).toEqual([]);
    expect(parseMcpListOutput(":\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the parser test to confirm it fails**

Run: `npx vitest run scripts/__tests__/parse-mcp-list-output.test.mjs`
Expected: FAIL — `parseMcpListOutput is not exported from ../signals.mjs`.

- [ ] **Step 3: Implement `parseMcpListOutput` in `scripts/signals.mjs`**

Add the parser, near the other `detect*` exports:

```javascript
const STATUS_TOKEN = {
  "✓ Connected": "connected",
  "✗ Failed to connect": "failed",
  "! Needs authentication": "needs-auth",
};

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
    const colonIdx = left.indexOf(":");
    if (colonIdx < 0) continue;
    const name = left.slice(0, colonIdx).trim();
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
```

Document above the parser block: this is a pure parser fed from `gatherMcpServers` stdout; treat malformed lines as garbage rather than throwing.

- [ ] **Step 4: Run parser tests and confirm they pass**

Run: `npx vitest run scripts/__tests__/parse-mcp-list-output.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add `gatherMcpServers` subprocess wrapper**

In `scripts/signals.mjs`, near the top imports, add an import line that pulls `execFile` from the Node `node:child_process` module and a `promisify` from `node:util`. Construct a promisified version named `execFileAsync`. (We use the safe `execFile` API specifically — never the shell-prone alternative — because the safe form passes argv as an array and never spawns a shell.)

Then, after `parseMcpListOutput`, add:

```javascript
async function gatherMcpServers() {
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
```

- [ ] **Step 6: Wire `mcpServers` into `gatherSignals` return**

In the `gatherSignals` function in `scripts/signals.mjs`, after the existing `cliConfig`/`hasClaudeInChrome` block from PR A, add:

```javascript
const mcpServers = await gatherMcpServers();
```

Then add to the top-level `gatherSignals` return object (a sibling of `plugins`, `memory`, `claudeMdExists`):

```javascript
    mcpServers,
```

- [ ] **Step 7: Forward `mcpServersConnected` and `hasMcpServers` in `buildSignalsSummary`**

In `scripts/run-assessment.mjs`, add inside the returned object near `plugins.length`:

```javascript
    mcpServersConnected: (signals.mcpServers || []).filter(
      (s) => s.status === "connected",
    ).length,
    hasMcpServers: (signals.mcpServers || []).length > 0,
```

- [ ] **Step 8: Update `build-signals-summary.test.mjs`**

In `scripts/__tests__/build-signals-summary.test.mjs`:

(a) Extend `makeSignals` defaults (around line 6-30):

```javascript
    mcpServers: [
      { name: "plugin:context7:context7", scope: "plugin", status: "connected" },
      { name: "plugin:figma:figma", scope: "plugin", status: "needs-auth" },
    ],
```

(b) Add `"hasMcpServers"` and `"mcpServersConnected"` to the alphabetical inline snapshot (around line 192-222), placed after `hasFormatterHook` and `keybindingsConfigured` respectively.

(c) Add forwarding tests:

```javascript
it("computes mcpServersConnected as count of connected entries", () => {
  expect(buildSignalsSummary(makeSignals()).mcpServersConnected).toBe(1);
  expect(
    buildSignalsSummary(makeSignals({ mcpServers: [] })).mcpServersConnected,
  ).toBe(0);
});

it("hasMcpServers is true iff signals.mcpServers is non-empty", () => {
  expect(buildSignalsSummary(makeSignals()).hasMcpServers).toBe(true);
  expect(
    buildSignalsSummary(makeSignals({ mcpServers: [] })).hasMcpServers,
  ).toBe(false);
});
```

- [ ] **Step 9: Add rubric action for `integrations/mcp-servers`**

In `app/data/rubric.json`, append to `integrations.nextActions`:

```json
{
  "id": "mcp-servers",
  "action": "Connect ≥3 MCP servers — Boris tip 9 — high-value MCPs include Atlassian, Slack, Playwright, Postman",
  "effort": "30min",
  "satisfiedWhen": "mcpServersConnected>=3"
}
```

- [ ] **Step 10: Extend `ALL_SATISFIED_SIGNALS` fixture in `rubric-predicates.test.ts`**

Add inside the `// integrations` group of `ALL_SATISFIED_SIGNALS`:

```typescript
  mcpServersConnected: 5,
```

- [ ] **Step 11: Run full vitest suite + tsc + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 336+ tests passing, no tsc errors, Next build green.

- [ ] **Step 12: Commit**

```bash
git add -u
git commit -m "$(cat <<'EOF'
feat(self-assessment): MCP servers as first-class signal class

- parseMcpListOutput parses claude mcp list stdout (pure, fully tested)
- gatherMcpServers shells out via the safe execFile API with 30s timeout
  and an empty-array fallback (never the shell-prone alternative)
- Wire mcpServers, mcpServersConnected, hasMcpServers through gatherSignals
  -> buildSignalsSummary
- Add integrations/mcp-servers rubric action (satisfiedWhen: connected>=3)
- Closes Gap B from the 2026-05-09 detection-gap audit; integrations dim
  no longer conflates plugin count with MCP-server count

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Task 4: Open PR B

**Files:** none

- [ ] **Step 1: Create branch and push**

```bash
git checkout -b feat/detect-mcp-servers
git push -u origin feat/detect-mcp-servers
```

- [ ] **Step 2: Open PR with `gh pr create --base main`**

```bash
gh pr create --base main --title "feat(self-assessment): MCP servers as first-class signal class" --body "$(cat <<'EOF'
## Summary
- New pure parser parseMcpListOutput for claude mcp list stdout
- Subprocess wrapper gatherMcpServers (safe execFile API, 30s timeout, empty-array fallback)
- Forwards mcpServersConnected (count of connected) and hasMcpServers through buildSignalsSummary
- New rubric action integrations/mcp-servers with satisfiedWhen: mcpServersConnected>=3
- Closes Gap B from the 2026-05-09 detection-gap audit

## Test plan
- [x] vitest run scripts/__tests__/parse-mcp-list-output.test.mjs - 7/7 new parser tests pass
- [x] vitest run - full suite green
- [x] tsc --noEmit and next build green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review

**Spec coverage:** Three gaps from the audit are addressed —

- Gap A (scorer reads only `~/.claude/settings.json`): closed by Task 1 reading `~/.claude.json` via `gatherCliConfig`.
- Gap B (no MCP-server signal class): closed by Task 3 introducing `parseMcpListOutput` + `gatherMcpServers` + `mcpServers`/`mcpServersConnected` signals.
- Gap C (Chrome is neither plugin nor registered MCP): closed by Task 1 — `detectClaudeInChrome` reads the dedicated CLI flag.

**Placeholder scan:** No "TBD"/"TODO"/"implement later" markers; every step shows the exact code or command.

**Type consistency:** `mcpServers` array shape `{ name, scope, status }` is used identically in parser tests, `gatherMcpServers`, fixture, and the snapshot. Predicate `mcpServersConnected>=3` matches the field forwarded by `buildSignalsSummary`. `hasClaudeInChrome` is forwarded from `signals.settings?.hasClaudeInChrome` (consistent with existing `hasFormatterHook` pattern).
