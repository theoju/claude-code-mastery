import { describe, it, expect } from "vitest";
import { buildSignalsSummary } from "../run-assessment.mjs";

// Minimal but realistic signals shape that exercises every path in
// buildSignalsSummary. Mirrors the structure produced by gatherSignals().
function makeSignals(overrides = {}) {
  return {
    settings: {
      effortLevel: "high",
      skipDangerousModePermissionPrompt: false,
      allowList: ["Bash(npm run *)", "Bash(gh pr *)", "Read"],
      denyList: [],
      autoCompactWindow: "400000",
      hookEvents: ["Stop", "PostToolUse"],
      hookTotalCount: 4,
    },
    plugins: ["slack@1", "vercel@1", "other@1"],
    mcpServers: [
      {
        name: "plugin:context7:context7",
        scope: "plugin",
        status: "connected",
      },
      { name: "plugin:figma:figma", scope: "plugin", status: "needs-auth" },
    ],
    personalAgents: ["verify-app.md", "other.md"],
    personalCommands: ["ship.md", "go.md"],
    personalSkills: ["my-skill"],
    projectAgents: [],
    projectCommands: [],
    memory: [{ project: "x" }],
    claudeMdExists: true,
    statuslineConfigured: true,
    keybindingsConfigured: false,
    shipJournal: {
      stage2Count: 3,
      totalRuns: 5,
      lastRunAt: "2026-05-09T12:00:00Z",
    },
    shellAliases: { worktreeAliasCount: 3, worktreeShortcutCount: 5 },
    transcriptInvocations: {
      goCommandUses: 4,
      batchCommandUses: 2,
      focusCommandUses: 1,
      scheduleCommandUses: 1,
      babysitLoopUses: 1,
      loopCommandUses: 4,
      planThenLaunchSessions: 2,
      rewindCommandUses: 3,
      simplifyCommandUses: 1,
      btwCommandUses: 2,
      voiceCommandUses: 1,
      clearCommandUses: 3,
      compactCommandUses: 2,
      colorCommandUses: 3,
      fewerPermsCommandUses: 1,
    },
    insights: null,
    ...overrides,
  };
}

describe("buildSignalsSummary", () => {
  it("returns an object with every documented field", () => {
    const r = buildSignalsSummary(makeSignals());
    const expectedKeys = [
      "plugins",
      "personalAgents",
      "personalCommands",
      "personalSkills",
      "personalSkillNames",
      "hookTotalCount",
      "effortLevel",
      "skipDangerous",
      "autoCompactWindow",
      "allowListCount",
      "hasWildcardAllow",
      "hookEvents",
      "hasStopHook",
      "hasPostToolHook",
      "hasShipCommand",
      "hasVerifyAgent",
      "hasCodeReviewPlugin",
      "outputStyle",
      "claudeMdExists",
      "statuslineConfigured",
      "keybindingsConfigured",
      "hasSlackPlugin",
      "hasVercelCli",
      "hasVercelPlugin",
      "projectsWithMemory",
      "insightsAvailable",
      "insightsSessionsAnalyzed",
      "insightsLookbackDays",
      "insightsTranscriptsScanned",
      "insightsHookFireCount",
      "shipVerifyStageRecent",
      "shipsRecent",
      "worktreeAliasCount",
      "worktreeShortcutCount",
      "goCommandUses",
      "batchCommandUses",
      "focusCommandUses",
      "scheduleCommandUses",
      "babysitLoopUses",
      "loopCommandUses",
      "planThenLaunchSessions",
      "rewindCommandUses",
      "simplifyCommandUses",
      "btwCommandUses",
      "voiceCommandUses",
      "clearCommandUses",
      "compactCommandUses",
      "colorCommandUses",
      "fewerPermsCommandUses",
      "autoMemoryEnabled",
      "parallelWorktreeAdoption",
    ];
    for (const k of expectedKeys) expect(r).toHaveProperty(k);
  });

  // Tip 1 (Boris): "Run Multiple Claude Sessions in Parallel." The headline is
  // about end-state (3-5 parallel worktree sessions), not the specific shell-
  // alias mechanism. V1.3 broadened `hasIsolatedAgent` (tip 28) by ORing with
  // execution telemetry; same pattern applied here.
  describe("parallelWorktreeAdoption (tip 1, V1.3-style broadening)", () => {
    it("fires when worktreeAliasCount >= 3 (Boris za/zb/zc literal)", () => {
      const r = buildSignalsSummary(
        makeSignals({
          shellAliases: { worktreeAliasCount: 3, worktreeShortcutCount: 0 },
          insights: { worktreeUsageSessionCount: 0, sessionsAnalyzed: 100 },
        }),
      );
      expect(r.parallelWorktreeAdoption).toBe(true);
    });

    it("fires when worktreeShortcutCount >= 3 (broad alias/function wrappers)", () => {
      const r = buildSignalsSummary(
        makeSignals({
          shellAliases: { worktreeAliasCount: 0, worktreeShortcutCount: 3 },
          insights: { worktreeUsageSessionCount: 0, sessionsAnalyzed: 100 },
        }),
      );
      expect(r.parallelWorktreeAdoption).toBe(true);
    });

    it("fires when worktreeUsageSessionCount >= 3 (execution telemetry)", () => {
      const r = buildSignalsSummary(
        makeSignals({
          shellAliases: { worktreeAliasCount: 0, worktreeShortcutCount: 0 },
          insights: { worktreeUsageSessionCount: 42, sessionsAnalyzed: 301 },
        }),
      );
      expect(r.parallelWorktreeAdoption).toBe(true);
    });

    it("is false when all three signals are below threshold", () => {
      const r = buildSignalsSummary(
        makeSignals({
          shellAliases: { worktreeAliasCount: 2, worktreeShortcutCount: 1 },
          insights: { worktreeUsageSessionCount: 2, sessionsAnalyzed: 100 },
        }),
      );
      expect(r.parallelWorktreeAdoption).toBe(false);
    });

    it("tolerates null insights / missing shellAliases", () => {
      const r = buildSignalsSummary(
        makeSignals({
          shellAliases: undefined,
          insights: null,
        }),
      );
      expect(r.parallelWorktreeAdoption).toBe(false);
    });
  });

  // Tip 45 (Boris): auto-memory is ENABLED unless the user has explicitly
  // disabled it via `env.CLAUDE_CODE_DISABLE_AUTO_MEMORY="1"` in settings.json.
  // Default-on semantics — absent/"0" both read as enabled.
  describe("autoMemoryEnabled (tip 45)", () => {
    it("is true when settings.autoMemoryEnabled is true", () => {
      const r = buildSignalsSummary(
        makeSignals({
          settings: { ...makeSignals().settings, autoMemoryEnabled: true },
        }),
      );
      expect(r.autoMemoryEnabled).toBe(true);
    });

    it("is false when settings.autoMemoryEnabled is false (explicit opt-out)", () => {
      const r = buildSignalsSummary(
        makeSignals({
          settings: { ...makeSignals().settings, autoMemoryEnabled: false },
        }),
      );
      expect(r.autoMemoryEnabled).toBe(false);
    });

    it("defaults to true when settings.autoMemoryEnabled is undefined", () => {
      const r = buildSignalsSummary(makeSignals());
      expect(r.autoMemoryEnabled).toBe(true);
    });
  });

  it("counts allowList entries correctly", () => {
    const r = buildSignalsSummary(makeSignals());
    expect(r.allowListCount).toBe(3);
  });

  it("hasWildcardAllow detects '*' in any allowlist entry", () => {
    expect(
      buildSignalsSummary(
        makeSignals({
          settings: {
            ...makeSignals().settings,
            allowList: ["Read", "Bash(npm run *)"],
          },
        }),
      ).hasWildcardAllow,
    ).toBe(true);
    expect(
      buildSignalsSummary(
        makeSignals({
          settings: {
            ...makeSignals().settings,
            allowList: ["Read", "WebFetch"],
          },
        }),
      ).hasWildcardAllow,
    ).toBe(false);
  });

  it("hasStopHook / hasPostToolHook reflect hookEvents membership", () => {
    const r = buildSignalsSummary(
      makeSignals({
        settings: {
          ...makeSignals().settings,
          hookEvents: ["Stop"],
        },
      }),
    );
    expect(r.hasStopHook).toBe(true);
    expect(r.hasPostToolHook).toBe(false);
  });

  it("hasStopHook / hasPostToolHook tolerate missing hookEvents", () => {
    const r = buildSignalsSummary(
      makeSignals({
        settings: { ...makeSignals().settings, hookEvents: undefined },
      }),
    );
    expect(r.hasStopHook).toBe(false);
    expect(r.hasPostToolHook).toBe(false);
  });

  it("hasShipCommand checks both personal and project commands", () => {
    expect(
      buildSignalsSummary(
        makeSignals({ personalCommands: ["ship.md"], projectCommands: [] }),
      ).hasShipCommand,
    ).toBe(true);
    expect(
      buildSignalsSummary(
        makeSignals({ personalCommands: [], projectCommands: ["ship.md"] }),
      ).hasShipCommand,
    ).toBe(true);
    expect(
      buildSignalsSummary(
        makeSignals({ personalCommands: ["go.md"], projectCommands: [] }),
      ).hasShipCommand,
    ).toBe(false);
  });

  it("hasVerifyAgent matches /^verify/i in either scope", () => {
    expect(
      buildSignalsSummary(
        makeSignals({
          personalAgents: ["verify-app.md"],
          plugins: [],
          verifySignalBodyMatch: false,
        }),
      ).hasVerifyAgent,
    ).toBe(true);
    expect(
      buildSignalsSummary(
        makeSignals({
          personalAgents: [],
          projectAgents: ["VerifyAuth.md"],
          plugins: [],
          verifySignalBodyMatch: false,
        }),
      ).hasVerifyAgent,
    ).toBe(true);
    expect(
      buildSignalsSummary(
        makeSignals({
          personalAgents: ["other.md"],
          plugins: [],
          verifySignalBodyMatch: false,
        }),
      ).hasVerifyAgent,
    ).toBe(false);
  });

  it("hasVerifyAgent fires when a personal skill/agent body contains 'verify'", () => {
    expect(
      buildSignalsSummary(
        makeSignals({
          personalAgents: ["other.md"],
          projectAgents: [],
          plugins: [],
          verifySignalBodyMatch: true,
        }),
      ).hasVerifyAgent,
    ).toBe(true);
  });

  it("hasVerifyAgent fires when an installed plugin matches pr-review-toolkit", () => {
    expect(
      buildSignalsSummary(
        makeSignals({
          personalAgents: ["other.md"],
          projectAgents: [],
          plugins: ["pr-review-toolkit@claude-plugins-official"],
          verifySignalBodyMatch: false,
        }),
      ).hasVerifyAgent,
    ).toBe(true);
  });

  it("hasVerifyAgent fires when a body token 'code-reviewer' is present", () => {
    expect(
      buildSignalsSummary(
        makeSignals({
          personalAgents: ["other.md"],
          projectAgents: [],
          plugins: [],
          // Gather-time scanner already collapsed the body match into a flag.
          verifySignalBodyMatch: true,
        }),
      ).hasVerifyAgent,
    ).toBe(true);
  });

  it("hasVerifyAgent is false when filename, body, and plugin all miss", () => {
    expect(
      buildSignalsSummary(
        makeSignals({
          personalAgents: ["other.md", "build.md"],
          projectAgents: ["check.md"],
          plugins: ["slack@1", "vercel@1"],
          verifySignalBodyMatch: false,
        }),
      ).hasVerifyAgent,
    ).toBe(false);
  });

  it("hasVerifyAgent does not match plugins where 'reviewer' is a substring of an unrelated word", () => {
    expect(
      buildSignalsSummary(
        makeSignals({
          personalAgents: ["other.md"],
          projectAgents: [],
          plugins: ["previewer-plus@1", "interviewer-bot@2"],
          verifySignalBodyMatch: false,
        }),
      ).hasVerifyAgent,
    ).toBe(false);
  });

  it("hasSlackPlugin / hasVercelPlugin do case-insensitive substring match", () => {
    const r = buildSignalsSummary(
      makeSignals({ plugins: ["foo-Slack-bar@1", "VercelLite@2"] }),
    );
    expect(r.hasSlackPlugin).toBe(true);
    expect(r.hasVercelPlugin).toBe(true);
  });

  it("insights null produces falsy/zero defaults rather than nulls or NaN", () => {
    const r = buildSignalsSummary(makeSignals({ insights: null }));
    expect(r.insightsAvailable).toBe(false);
    expect(r.insightsSessionsAnalyzed).toBe(0);
    expect(r.insightsLookbackDays).toBeNull();
    expect(r.insightsTranscriptsScanned).toBe(false);
    expect(r.insightsHookFireCount).toBe(0);
  });

  it("populated insights forwards numeric fields", () => {
    const r = buildSignalsSummary(
      makeSignals({
        insights: {
          sessionsAnalyzed: 144,
          lookbackDays: 30,
          transcriptsScanned: true,
          hookFireCount: 12,
        },
      }),
    );
    expect(r.insightsAvailable).toBe(true);
    expect(r.insightsSessionsAnalyzed).toBe(144);
    expect(r.insightsLookbackDays).toBe(30);
    expect(r.insightsTranscriptsScanned).toBe(true);
    expect(r.insightsHookFireCount).toBe(12);
  });

  it("forwards new settings flags (formatter/stopNotif/isolatedAgent/spinner)", () => {
    const r = buildSignalsSummary(
      makeSignals({
        settings: {
          ...makeSignals().settings,
          hasFormatterHook: true,
          hasStopHookNotification: true,
          hasIsolatedAgent: true,
          customSpinnerVerbCount: 7,
        },
      }),
    );
    expect(r.hasFormatterHook).toBe(true);
    expect(r.hasStopHookNotification).toBe(true);
    expect(r.hasIsolatedAgent).toBe(true);
    expect(r.hasCustomSpinnerVerbs).toBe(true);
  });

  // Probe-Logic Challenger fix: hasIsolatedAgent now ORs the static
  // settings flag with execution telemetry — if the user actually USES
  // worktrees (worktreeUsageSessionCount > 0), the rubric's "isolation
  // patterns adopted" goal is satisfied even when no agent file declares
  // `isolation: worktree` in frontmatter.
  it("hasIsolatedAgent fires when settings flag is true (regression)", () => {
    const r = buildSignalsSummary(
      makeSignals({
        settings: {
          ...makeSignals().settings,
          hasIsolatedAgent: true,
        },
      }),
    );
    expect(r.hasIsolatedAgent).toBe(true);
  });

  it("hasIsolatedAgent fires when worktreeUsageSessionCount > 0 (no static flag)", () => {
    const r = buildSignalsSummary(
      makeSignals({
        settings: {
          ...makeSignals().settings,
          hasIsolatedAgent: false,
        },
        insights: {
          worktreeUsageSessionCount: 3,
        },
      }),
    );
    expect(r.hasIsolatedAgent).toBe(true);
  });

  it("hasIsolatedAgent is false when no static flag AND worktreeUsageSessionCount === 0", () => {
    const r = buildSignalsSummary(
      makeSignals({
        settings: {
          ...makeSignals().settings,
          hasIsolatedAgent: false,
        },
        insights: {
          worktreeUsageSessionCount: 0,
        },
      }),
    );
    expect(r.hasIsolatedAgent).toBe(false);
  });

  it("hasIsolatedAgent is false when no static flag AND insights is null/missing", () => {
    const r = buildSignalsSummary(
      makeSignals({
        settings: {
          ...makeSignals().settings,
          hasIsolatedAgent: false,
        },
        insights: null,
      }),
    );
    expect(r.hasIsolatedAgent).toBe(false);
  });

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

  it("forwards hasRemoteControl from settings.hasRemoteControl", () => {
    expect(
      buildSignalsSummary(
        makeSignals({
          settings: {
            ...makeSignals().settings,
            hasRemoteControl: true,
          },
        }),
      ).hasRemoteControl,
    ).toBe(true);
    expect(buildSignalsSummary(makeSignals()).hasRemoteControl).toBe(false);
  });

  it("forwards hasVercelCli from settings.hasVercelCli", () => {
    expect(
      buildSignalsSummary(
        makeSignals({
          settings: { ...makeSignals().settings, hasVercelCli: true },
        }),
      ).hasVercelCli,
    ).toBe(true);
    expect(buildSignalsSummary(makeSignals()).hasVercelCli).toBe(false);
  });

  it("computes mcpServersConnected as count of connected entries", () => {
    expect(buildSignalsSummary(makeSignals()).mcpServersConnected).toBe(1);
    expect(
      buildSignalsSummary(makeSignals({ mcpServers: [] })).mcpServersConnected,
    ).toBe(0);
    expect(
      buildSignalsSummary(
        makeSignals({
          mcpServers: [
            { name: "a", scope: "plugin", status: "connected" },
            { name: "b", scope: "plugin", status: "connected" },
            { name: "c", scope: "plugin", status: "failed" },
          ],
        }),
      ).mcpServersConnected,
    ).toBe(2);
  });

  it("hasMcpServers is true iff signals.mcpServers is non-empty", () => {
    expect(buildSignalsSummary(makeSignals()).hasMcpServers).toBe(true);
    expect(
      buildSignalsSummary(makeSignals({ mcpServers: [] })).hasMcpServers,
    ).toBe(false);
  });

  it("hasCustomSpinnerVerbs is false when count is 0 or missing", () => {
    expect(
      buildSignalsSummary(
        makeSignals({
          settings: { ...makeSignals().settings, customSpinnerVerbCount: 0 },
        }),
      ).hasCustomSpinnerVerbs,
    ).toBe(false);
    expect(buildSignalsSummary(makeSignals()).hasCustomSpinnerVerbs).toBe(
      false,
    );
  });

  it("forwards ship-journal counts", () => {
    const r = buildSignalsSummary(makeSignals());
    expect(r.shipVerifyStageRecent).toBe(3);
    expect(r.shipsRecent).toBe(5);
  });

  it("forwards shell-alias count", () => {
    expect(buildSignalsSummary(makeSignals()).worktreeAliasCount).toBe(3);
  });

  it("forwards shell-shortcut count (broad worktree wrapper detection)", () => {
    expect(buildSignalsSummary(makeSignals()).worktreeShortcutCount).toBe(5);
  });

  it("forwards transcript invocation counts", () => {
    const r = buildSignalsSummary(makeSignals());
    expect(r.goCommandUses).toBe(4);
    expect(r.batchCommandUses).toBe(2);
    expect(r.focusCommandUses).toBe(1);
    expect(r.scheduleCommandUses).toBe(1);
    expect(r.babysitLoopUses).toBe(1);
    expect(r.loopCommandUses).toBe(4);
    expect(r.planThenLaunchSessions).toBe(2);
    expect(r.rewindCommandUses).toBe(3);
  });

  it("buildSignalsSummary forwards new P1 slash-command counters from transcriptInvocations", () => {
    const r = buildSignalsSummary(makeSignals());
    expect(r.simplifyCommandUses).toBe(1);
    expect(r.btwCommandUses).toBe(2);
    expect(r.voiceCommandUses).toBe(1);
    expect(r.clearCommandUses).toBe(3);
    expect(r.compactCommandUses).toBe(2);
    expect(r.colorCommandUses).toBe(3);
    expect(r.fewerPermsCommandUses).toBe(1);
  });

  it("MAX-merges historyInvocations and transcriptInvocations for typed slash-commands", () => {
    // history > transcript → take history. This is the /btw case: the
    // session JSONL never sees /btw, but history.jsonl has 6 in 14d.
    const rHistoryHigher = buildSignalsSummary(
      makeSignals({
        transcriptInvocations: {
          ...makeSignals().transcriptInvocations,
          btwCommandUses: 0,
          simplifyCommandUses: 1,
          clearCommandUses: 3,
          fewerPermsCommandUses: 1,
          loopCommandUses: 4,
          babysitLoopUses: 1,
        },
        historyInvocations: {
          btwCommandUses: 6,
          simplifyCommandUses: 5,
          clearCommandUses: 12,
          fewerPermsCommandUses: 3,
          loopCommandUses: 2, // lower — transcript wins
          babysitLoopUses: 3, // higher — history wins
        },
      }),
    );
    expect(rHistoryHigher.btwCommandUses).toBe(6);
    expect(rHistoryHigher.simplifyCommandUses).toBe(5);
    expect(rHistoryHigher.clearCommandUses).toBe(12);
    expect(rHistoryHigher.fewerPermsCommandUses).toBe(3);
    // transcript higher (e.g. /loop also fires via /ship chain) → take transcript
    expect(rHistoryHigher.loopCommandUses).toBe(4);
    // history higher → take history
    expect(rHistoryHigher.babysitLoopUses).toBe(3);
    // /go and /rewind are NOT history-merged — transcript wins regardless
    const rGoRewind = buildSignalsSummary(
      makeSignals({
        transcriptInvocations: {
          ...makeSignals().transcriptInvocations,
          goCommandUses: 4,
          rewindCommandUses: 3,
        },
        historyInvocations: {
          goCommandUses: 99,
          rewindCommandUses: 99,
        },
      }),
    );
    expect(rGoRewind.goCommandUses).toBe(4);
    expect(rGoRewind.rewindCommandUses).toBe(3);
  });

  it("handles missing historyInvocations (falls back to transcript only)", () => {
    const r = buildSignalsSummary(
      makeSignals({ historyInvocations: undefined }),
    );
    expect(r.btwCommandUses).toBe(2); // from the default transcriptInvocations
    expect(r.simplifyCommandUses).toBe(1);
    expect(r.clearCommandUses).toBe(3);
  });

  it("defaults missing P1 slash-command counters to 0", () => {
    const r = buildSignalsSummary(
      makeSignals({ transcriptInvocations: undefined }),
    );
    expect(r.simplifyCommandUses).toBe(0);
    expect(r.btwCommandUses).toBe(0);
    expect(r.voiceCommandUses).toBe(0);
    expect(r.clearCommandUses).toBe(0);
    expect(r.compactCommandUses).toBe(0);
    expect(r.fewerPermsCommandUses).toBe(0);
  });

  it("defaults missing gatherer outputs to 0", () => {
    const r = buildSignalsSummary(
      makeSignals({
        shipJournal: undefined,
        shellAliases: undefined,
        transcriptInvocations: undefined,
      }),
    );
    expect(r.shipVerifyStageRecent).toBe(0);
    expect(r.shipsRecent).toBe(0);
    expect(r.worktreeAliasCount).toBe(0);
    expect(r.worktreeShortcutCount).toBe(0);
    expect(r.goCommandUses).toBe(0);
    expect(r.planThenLaunchSessions).toBe(0);
  });

  // P2.2 — outputStyle (Boris tip 34)
  it("buildSignalsSummary forwards outputStyle from settings", () => {
    const r = buildSignalsSummary(
      makeSignals({
        settings: {
          ...makeSignals().settings,
          outputStyle: "Explanatory",
        },
      }),
    );
    expect(r.outputStyle).toBe("Explanatory");
  });

  it("outputStyle defaults to null when settings absent", () => {
    // makeSignals() base settings has no outputStyle field.
    const r = buildSignalsSummary(makeSignals());
    expect(r.outputStyle).toBeNull();
  });

  // P6.1 — hasCodeReviewPlugin (Boris tip 44)
  it("hasCodeReviewPlugin is true when settings.hasCodeReviewPlugin is set", () => {
    const r = buildSignalsSummary(
      makeSignals({
        hasCodeReviewPlugin: true,
      }),
    );
    expect(r.hasCodeReviewPlugin).toBe(true);
  });

  it("hasCodeReviewPlugin defaults to false when absent", () => {
    expect(buildSignalsSummary(makeSignals()).hasCodeReviewPlugin).toBe(false);
  });

  it("output keys form a stable contract — locked-in by snapshot", () => {
    const r = buildSignalsSummary(makeSignals());
    const sortedKeys = Object.keys(r).sort();
    expect(sortedKeys).toMatchInlineSnapshot(`
      [
        "allowListCount",
        "autoCompactWindow",
        "autoMemoryEnabled",
        "babysitLoopUses",
        "batchCommandUses",
        "btwCommandUses",
        "claudeMdExists",
        "clearCommandUses",
        "colorCommandUses",
        "compactCommandUses",
        "effortLevel",
        "fewerPermsCommandUses",
        "focusCommandUses",
        "goCommandUses",
        "hasClaudeInChrome",
        "hasCodeReviewPlugin",
        "hasCustomSpinnerVerbs",
        "hasFormatterHook",
        "hasIsolatedAgent",
        "hasMcpServers",
        "hasPostToolHook",
        "hasRemoteControl",
        "hasShipCommand",
        "hasSlackPlugin",
        "hasStopHook",
        "hasStopHookNotification",
        "hasVercelCli",
        "hasVercelPlugin",
        "hasVerifyAgent",
        "hasWildcardAllow",
        "hookEvents",
        "hookTotalCount",
        "insightsAvailable",
        "insightsHookFireCount",
        "insightsLookbackDays",
        "insightsSessionsAnalyzed",
        "insightsTranscriptsScanned",
        "keybindingsConfigured",
        "loopCommandUses",
        "mcpServersConnected",
        "outputStyle",
        "parallelWorktreeAdoption",
        "permissionsDefaultMode",
        "personalAgents",
        "personalCommands",
        "personalSkillNames",
        "personalSkills",
        "planThenLaunchSessions",
        "plugins",
        "projectsWithMemory",
        "rewindCommandUses",
        "scheduleCommandUses",
        "shipVerifyStageRecent",
        "shipsRecent",
        "simplifyCommandUses",
        "skipDangerous",
        "statuslineConfigured",
        "voiceCommandUses",
        "worktreeAliasCount",
        "worktreeShortcutCount",
      ]
    `);
  });
});
