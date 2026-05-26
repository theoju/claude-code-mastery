import { describe, it, expect } from "vitest";
import {
  SCORERS,
  EXECUTION_SCORERS,
  tierFor,
  clamp,
  scoreAll,
  computeTrends,
  DEFAULT_NOISE_FLOOR,
  adoptionBonus,
} from "../score.mjs";
import { makeSignals, makeRubric, makeInsights } from "./_fixtures.mjs";

describe("clamp", () => {
  it("clamps to 0..100 by default", () => {
    expect(clamp(-5)).toBe(0);
    expect(clamp(50)).toBe(50);
    expect(clamp(200)).toBe(100);
  });
  it("respects custom bounds", () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(25, 10, 20)).toBe(20);
  });
});

describe("tierFor", () => {
  it.each([
    [0, "not-touched"],
    [29, "not-touched"],
    [30, "starter"],
    [54, "starter"],
    [55, "developing"],
    [69, "developing"],
    [70, "solid"],
    [84, "solid"],
    [85, "advanced"],
    [100, "advanced"],
  ])("score %i → %s", (score, tier) => {
    expect(tierFor(score)).toBe(tier);
  });
});

describe("SCORERS.automation", () => {
  it("rewards hooks, agents, commands, skills", () => {
    const r = SCORERS.automation(
      makeSignals({
        settings: { hookTotalCount: 3, hookEvents: ["PostToolUse", "Stop"] },
        personalAgents: ["a.md", "b.md"],
        personalCommands: ["c.md"],
        projectCommands: ["pc.md"],
        personalSkills: ["s1", "s2"],
      }),
    );
    expect(r.score).toBeGreaterThan(60);
    expect(r.evidence.length).toBeGreaterThanOrEqual(4);
    expect(r.gaps.length).toBeLessThan(2);
  });
  it("flags missing hooks/agents/commands/skills as gaps", () => {
    const r = SCORERS.automation(makeSignals());
    expect(r.score).toBeLessThanOrEqual(40);
    expect(r.gaps.join(" ")).toMatch(/no hooks/i);
    expect(r.gaps.join(" ")).toMatch(/agents/i);
    expect(r.gaps.join(" ")).toMatch(/commands/i);
  });
  it("downweights hook credit when configured but never fires in the window", () => {
    const hot = SCORERS.automation(
      makeSignals({
        settings: { hookTotalCount: 3, hookEvents: ["PostToolUse"] },
        insights: makeInsights({ hookFireCount: 12 }),
      }),
    );
    const cold = SCORERS.automation(
      makeSignals({
        settings: { hookTotalCount: 3, hookEvents: ["PostToolUse"] },
        insights: makeInsights({ hookFireCount: 0 }),
      }),
    );
    expect(cold.score).toBeLessThan(hot.score);
    expect(cold.gaps.join(" ")).toMatch(/none fired/i);
    expect(cold.evidence.join(" ")).toMatch(/gated/i);
  });
});

describe("SCORERS.permissions", () => {
  it("downgrades when skipDangerousModePermissionPrompt is true", () => {
    const skip = SCORERS.permissions(
      makeSignals({ settings: { skipDangerousModePermissionPrompt: true } }),
    );
    const safe = SCORERS.permissions(makeSignals());
    expect(skip.score).toBeLessThan(safe.score);
    expect(skip.gaps.join(" ")).toMatch(/dangerous/i);
  });
  it("rewards allowlist and denylist entries", () => {
    const r = SCORERS.permissions(
      makeSignals({
        settings: {
          allowList: ["Bash(npm run *)", "Bash(gh pr *)", "Read"],
          denyList: ["Bash(rm -rf *)"],
        },
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.evidence.some((e) => /3 permission allowlist/i.test(e))).toBe(
      true,
    );
  });
  it("amplifies penalty when transcripts show bypassPermissions usage", () => {
    const clean = SCORERS.permissions(makeSignals());
    const bypassed = SCORERS.permissions(
      makeSignals({
        insights: makeInsights({
          transcriptsScanned: true,
          bypassPermissionsSessionCount: 5,
        }),
      }),
    );
    expect(bypassed.score).toBe(clean.score - 5);
    expect(bypassed.gaps.join(" ")).toMatch(/bypassPermissions used in 5/);
  });
  it("ignores bypass amplification when transcripts not scanned", () => {
    const clean = SCORERS.permissions(makeSignals());
    const noTranscript = SCORERS.permissions(
      makeSignals({ insights: makeInsights({ transcriptsScanned: false }) }),
    );
    expect(noTranscript.score).toBe(clean.score);
  });
  it("permissions: +10 when defaultMode is auto", () => {
    const base = SCORERS.permissions(
      makeSignals({
        settings: {
          ...makeSignals().settings,
          permissionsDefaultMode: "default",
        },
      }),
    ).score;
    const auto = SCORERS.permissions(
      makeSignals({
        settings: { ...makeSignals().settings, permissionsDefaultMode: "auto" },
      }),
    ).score;
    expect(auto - base).toBe(10);
  });
});

describe("SCORERS['model-effort']", () => {
  it("rewards xhigh/max effort", () => {
    const xhigh = SCORERS["model-effort"](
      makeSignals({
        settings: { effortLevel: "xhigh", autoCompactWindow: "400000" },
      }),
    );
    expect(xhigh.score).toBeGreaterThanOrEqual(85);
    expect(xhigh.gaps.length).toBe(0);
  });
  it("flags medium/low as significantly under-tuned", () => {
    const med = SCORERS["model-effort"](
      makeSignals({ settings: { effortLevel: "medium" } }),
    );
    expect(med.gaps.join(" ")).toMatch(/under-tuned/i);
  });
  it("partially credits 'high'", () => {
    const high = SCORERS["model-effort"](
      makeSignals({ settings: { effortLevel: "high" } }),
    );
    expect(high.score).toBeGreaterThan(40);
    expect(high.gaps.join(" ")).toMatch(/xhigh/i);
  });
});

describe("SCORERS.parallel", () => {
  it("rewards superpowers + personal agents", () => {
    const r = SCORERS.parallel(
      makeSignals({
        has: { superpowers: true, prReviewToolkit: true, featureDev: true },
        personalAgents: ["verify.md"],
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(80);
  });
  it("flags zero personal agents", () => {
    const r = SCORERS.parallel(makeSignals());
    expect(r.gaps.join(" ")).toMatch(/personal/i);
  });
});

describe("SCORERS.verification", () => {
  it("rewards playwright + /go composite + review plugins", () => {
    const r = SCORERS.verification(
      makeSignals({
        has: {
          playwright: true,
          semgrep: true,
          prReviewToolkit: true,
          superpowers: true,
        },
        personalCommands: ["go.md"],
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(85);
  });
  it("flags missing /go and missing playwright", () => {
    const r = SCORERS.verification(makeSignals());
    const gaps = r.gaps.join(" ");
    expect(gaps).toMatch(/go composite/i);
    expect(gaps).toMatch(/browser-automation/i);
  });
});

describe("SCORERS.memory", () => {
  it("rewards memory files + claudeMd + plans + plugin", () => {
    const r = SCORERS.memory(
      makeSignals({
        memory: [
          { project: "x", fileCount: 3 },
          { project: "y", fileCount: 2 },
        ],
        claudeMdExists: true,
        plansCount: 15,
        has: { claudeMdMgmt: true },
        settings: { autoCompactWindow: "400000" },
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(80);
  });
  it("flags missing CLAUDE.md and missing memory and missing window", () => {
    const r = SCORERS.memory(makeSignals());
    const gaps = r.gaps.join(" ");
    expect(gaps).toMatch(/MEMORY\.md/);
    expect(gaps).toMatch(/CLAUDE\.md/);
    expect(gaps).toMatch(/AUTO_COMPACT/);
  });
});

describe("SCORERS.planning", () => {
  it("rewards superpowers + karpathy + saved plans", () => {
    const r = SCORERS.planning(
      makeSignals({
        has: { superpowers: true, karpathy: true, featureDev: true },
        plansCount: 12,
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(85);
  });
  it("always emits the behavioral check gap", () => {
    const r = SCORERS.planning(makeSignals());
    expect(r.gaps.length).toBeGreaterThan(0);
    expect(r.gaps[0]).toMatch(/Goal|Constraints|Acceptance/);
  });
});

describe("SCORERS.integrations", () => {
  it("scales with plugin count", () => {
    const few = SCORERS.integrations(makeSignals({ plugins: ["a@1", "b@1"] }));
    const many = SCORERS.integrations(
      makeSignals({ plugins: Array.from({ length: 25 }, (_, i) => `p${i}@1`) }),
    );
    expect(many.score).toBeGreaterThan(few.score);
  });
  it("flags missing Slack MCP", () => {
    const r = SCORERS.integrations(makeSignals({ plugins: ["foo@1"] }));
    expect(r.gaps.join(" ")).toMatch(/Slack/);
  });
});

describe("SCORERS.customization", () => {
  it("rewards statusline + explanatory + keybindings", () => {
    const r = SCORERS.customization(
      makeSignals({
        statuslineConfigured: true,
        keybindingsConfigured: true,
        has: { explanatoryStyle: true },
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.gaps.length).toBe(0);
  });
});

describe("SCORERS.scheduled", () => {
  it("rewards ralph-loop + Stop hook + scheduled commands", () => {
    const r = SCORERS.scheduled(
      makeSignals({
        has: { ralphLoop: true },
        personalCommands: ["babysit-prs.md"],
        settings: { hookEvents: ["Stop"], hookTotalCount: 1 },
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(70);
  });
});

describe("SCORERS.remote", () => {
  it("rewards imessage plugin", () => {
    const r = SCORERS.remote(makeSignals({ has: { imessage: true } }));
    expect(r.score).toBe(55);
  });
  it("flags missing imessage", () => {
    const r = SCORERS.remote(makeSignals());
    expect(r.gaps[0]).toMatch(/imessage/);
  });
});

describe("SCORERS.learning", () => {
  it("rewards explanatory + karpathy + skill-creator", () => {
    const r = SCORERS.learning(
      makeSignals({
        has: { explanatoryStyle: true, karpathy: true, skillCreator: true },
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(85);
  });
});

describe("EXECUTION_SCORERS", () => {
  describe("permissions", () => {
    it("returns null score with gapReason when insights are absent", () => {
      const r = EXECUTION_SCORERS.permissions(makeSignals());
      expect(r.score).toBeNull();
      expect(r.gapReason).toMatch(/run \/insights/i);
    });
    it("returns null score with gapReason when transcripts not scanned", () => {
      const r = EXECUTION_SCORERS.permissions(
        makeSignals({ insights: makeInsights({ transcriptsScanned: false }) }),
      );
      expect(r.score).toBeNull();
      expect(r.gapReason).toMatch(/includeTranscripts/);
    });
    it("rewards high auto-mode ratio, punishes bypass usage", () => {
      const r = EXECUTION_SCORERS.permissions(
        makeSignals({
          insights: makeInsights({
            transcriptsScanned: true,
            sessionsAnalyzed: 100,
            autoModeSessionCount: 90,
            bypassPermissionsSessionCount: 0,
          }),
        }),
      );
      expect(r.score).toBeGreaterThanOrEqual(85);
      const bad = EXECUTION_SCORERS.permissions(
        makeSignals({
          insights: makeInsights({
            transcriptsScanned: true,
            sessionsAnalyzed: 100,
            autoModeSessionCount: 50,
            bypassPermissionsSessionCount: 25,
          }),
        }),
      );
      expect(bad.score).toBeLessThan(r.score);
      expect(bad.gaps.join(" ")).toMatch(/bypassPermissions/);
    });
    it("denominator excludes sdk-orchestrated sessions (regression: observer dilution)", () => {
      const insights = makeInsights({
        transcriptsScanned: true,
        sessionsAnalyzed: 400,
        interactiveSessionsAnalyzed: 50,
        sessionsByKind: {
          interactive_cli: 50,
          sdk_orchestrated: 0,
          observer: 350,
          subagent: 0,
          unknown: 0,
        },
        autoModeSessionCount: 45,
        bypassPermissionsSessionCount: 0,
      });
      const result = EXECUTION_SCORERS.permissions({ insights });
      // 45/50 = 90% → high score, NOT 45/400 = 11% → near-zero score
      expect(result.score).toBeGreaterThan(80);
      expect(result.evidence[0]).toMatch(/45\/50/);
    });
    it("uses soft 1.2× asymmetry — majority-auto users with some bypass don't score zero", () => {
      // A user at 50% auto + 25% bypass scored 0 under the old 2× asymmetry.
      // The new 1.2× ratio surfaces the trend honestly: still well below the
      // 90/0 score (=90) but no longer reads as complete failure.
      const mixed = EXECUTION_SCORERS.permissions(
        makeSignals({
          insights: makeInsights({
            transcriptsScanned: true,
            sessionsAnalyzed: 100,
            autoModeSessionCount: 50,
            bypassPermissionsSessionCount: 25,
          }),
        }),
      );
      // 50/100*100 - 25/100*120 = 50 - 30 = 20
      expect(mixed.score).toBe(20);
    });
  });

  describe("verification", () => {
    it("returns null when insights absent", () => {
      const r = EXECUTION_SCORERS.verification(makeSignals());
      expect(r.score).toBeNull();
    });
    it("scales inversely with buggy_code + wrong_approach rate", () => {
      const clean = EXECUTION_SCORERS.verification(
        makeSignals({
          insights: makeInsights({ sessionsAnalyzed: 100, frictionCounts: {} }),
        }),
      );
      const messy = EXECUTION_SCORERS.verification(
        makeSignals({
          insights: makeInsights({
            sessionsAnalyzed: 100,
            frictionCounts: { buggy_code: 20, wrong_approach: 5 },
          }),
        }),
      );
      expect(clean.score).toBe(100);
      expect(messy.score).toBeLessThan(clean.score);
      expect(messy.gaps.join(" ")).toMatch(/20 first-pass-bug/);
    });
    it("uses exponential decay — never goes negative pre-clamp, even at high friction rates", () => {
      // Old linear amplifier produced negative scores at >20% miss rate, then
      // clamped to 0. New exponential curve asymptotes to 0 smoothly — a 30%
      // miss rate scores ~9, not clamped 0, so the radar still distinguishes
      // "really bad" from "completely off the rails."
      const moderate = EXECUTION_SCORERS.verification(
        makeSignals({
          insights: makeInsights({
            sessionsAnalyzed: 100,
            frictionCounts: { buggy_code: 10, wrong_approach: 5 }, // 15%
          }),
        }),
      );
      const heavy = EXECUTION_SCORERS.verification(
        makeSignals({
          insights: makeInsights({
            sessionsAnalyzed: 100,
            frictionCounts: { buggy_code: 20, wrong_approach: 10 }, // 30%
          }),
        }),
      );
      // exp(-0.15*8)*100 = 30; exp(-0.30*8)*100 = 9
      expect(moderate.score).toBe(30);
      expect(heavy.score).toBe(9);
      expect(heavy.score).toBeGreaterThan(0);
    });
  });

  describe("parallel", () => {
    it("scores subagent dispatch ratio without transcripts", () => {
      const r = EXECUTION_SCORERS.parallel(
        makeSignals({
          insights: makeInsights({
            sessionsAnalyzed: 100,
            subagentSessionCount: 60,
            transcriptsScanned: false,
          }),
        }),
      );
      expect(r.score).toBe(60);
    });
    it("adds worktree bonus when transcripts scanned", () => {
      const r = EXECUTION_SCORERS.parallel(
        makeSignals({
          insights: makeInsights({
            sessionsAnalyzed: 100,
            subagentSessionCount: 40,
            worktreeUsageSessionCount: 30,
            transcriptsScanned: true,
          }),
        }),
      );
      expect(r.score).toBe(40 + 15); // 30/100 * 50 = 15
    });
    it("flags low subagent dispatch as a gap", () => {
      const r = EXECUTION_SCORERS.parallel(
        makeSignals({
          insights: makeInsights({
            sessionsAnalyzed: 100,
            subagentSessionCount: 5,
          }),
        }),
      );
      expect(r.gaps.join(" ")).toMatch(/Subagent dispatch/);
    });
  });

  describe("planning", () => {
    it("requires transcripts", () => {
      const r = EXECUTION_SCORERS.planning(
        makeSignals({ insights: makeInsights({ transcriptsScanned: false }) }),
      );
      expect(r.score).toBeNull();
      expect(r.gapReason).toMatch(/includeTranscripts/);
    });
    it("computes plan-mode ratio against multi-task sessions", () => {
      const r = EXECUTION_SCORERS.planning(
        makeSignals({
          insights: makeInsights({
            transcriptsScanned: true,
            multiTaskSessionCount: 10,
            planModeSessionCount: 3,
          }),
        }),
      );
      expect(r.score).toBe(30);
      expect(r.gaps.join(" ")).toMatch(/half of multi-task/);
    });
  });

  describe("automation", () => {
    it("scales with hook fire count", () => {
      const cold = EXECUTION_SCORERS.automation(
        makeSignals({
          insights: makeInsights({ sessionsAnalyzed: 100, hookFireCount: 0 }),
        }),
      );
      const warm = EXECUTION_SCORERS.automation(
        makeSignals({
          insights: makeInsights({ sessionsAnalyzed: 100, hookFireCount: 100 }),
        }),
      );
      expect(warm.score).toBeGreaterThan(cold.score);
      expect(cold.gaps.join(" ")).toMatch(/dormant/i);
    });
    it("adds subagent-with-personal-agents bonus", () => {
      const r = EXECUTION_SCORERS.automation(
        makeSignals({
          personalAgents: ["mine.md"],
          insights: makeInsights({
            sessionsAnalyzed: 100,
            hookFireCount: 0,
            subagentSessionCount: 50,
          }),
        }),
      );
      expect(r.score).toBe(20);
    });
    it("returns unavailable when hookFireCount is null (file missing, not zero fires)", () => {
      // Distinguishes "Claude Code didn't write hook-fires.jsonl" (null) from
      // "the file exists but no fires happened in window" (0). The latter is a
      // legitimate score of 0; the former must surface as unmeasured.
      const r = EXECUTION_SCORERS.automation(
        makeSignals({
          insights: makeInsights({
            sessionsAnalyzed: 100,
            hookFireCount: null,
          }),
        }),
      );
      expect(r.score).toBeNull();
      expect(r.gapReason).toMatch(/hook-fires\.jsonl absent/);
    });
  });

  describe("integrations", () => {
    it("returns null with no plugins installed", () => {
      const r = EXECUTION_SCORERS.integrations(
        makeSignals({ plugins: [], insights: makeInsights({}) }),
      );
      expect(r.score).toBeNull();
    });
    it("scores volume per session, not coverage of installed plugins", () => {
      // 4 plugins installed, only 2 fired but with heavy use: 200 calls/100
      // sessions = 2/session → exactly the calibration target → score 100.
      const heavyContextual = EXECUTION_SCORERS.integrations(
        makeSignals({
          plugins: ["a@1", "b@1", "c@1", "d@1"],
          insights: makeInsights({
            sessionsAnalyzed: 100,
            toolInvocationsByPlugin: { a: 150, b: 50 },
          }),
        }),
      );
      expect(heavyContextual.score).toBe(100);
      // Same coverage (2/4) but only 20 calls total — score reflects low volume.
      const lightCoverage = EXECUTION_SCORERS.integrations(
        makeSignals({
          plugins: ["a@1", "b@1", "c@1", "d@1"],
          insights: makeInsights({
            sessionsAnalyzed: 100,
            toolInvocationsByPlugin: { a: 15, b: 5 },
          }),
        }),
      );
      expect(lightCoverage.score).toBe(10); // 20/100/2 = 0.10 → 10
      expect(lightCoverage.evidence.join(" ")).toMatch(/0\.2 per session/);
    });
    it("treats idle plugins as informational, not score-reducing", () => {
      // 30 plugins installed, 1 fires heavily — under the old coverage formula
      // this would score 3 (1/30); new formula focuses on volume, no penalty
      // for breadth of installed-but-idle.
      const r = EXECUTION_SCORERS.integrations(
        makeSignals({
          plugins: Array.from({ length: 30 }, (_, i) => `p${i}@1`),
          insights: makeInsights({
            sessionsAnalyzed: 100,
            toolInvocationsByPlugin: { atlassian: 200 },
          }),
        }),
      );
      expect(r.score).toBe(100);
      expect(r.gaps.join(" ")).toMatch(/29 plugins installed but idle/);
      expect(r.gaps.join(" ")).toMatch(/informational/);
    });
  });

  describe("scheduled", () => {
    it("scores 0 with dormant gap when no scheduled-tool invocations", () => {
      const r = EXECUTION_SCORERS.scheduled(
        makeSignals({
          insights: makeInsights({ scheduledInvocationsTotal: 0 }),
        }),
      );
      expect(r.score).toBe(0);
      expect(r.gaps.join(" ")).toMatch(/dormant/);
      expect(r.gapReason).toBeNull();
    });
    it("uses presence-and-intensity: 1=50, 2=75, 3+=100", () => {
      const one = EXECUTION_SCORERS.scheduled(
        makeSignals({
          insights: makeInsights({ scheduledInvocationsTotal: 1 }),
        }),
      );
      const two = EXECUTION_SCORERS.scheduled(
        makeSignals({
          insights: makeInsights({ scheduledInvocationsTotal: 2 }),
        }),
      );
      const five = EXECUTION_SCORERS.scheduled(
        makeSignals({
          insights: makeInsights({ scheduledInvocationsTotal: 5 }),
        }),
      );
      expect(one.score).toBe(50);
      expect(two.score).toBe(75);
      expect(five.score).toBe(100);
    });
  });

  describe("remote", () => {
    it("scores 0 with dormant gap when no remote-tool invocations", () => {
      const r = EXECUTION_SCORERS.remote(
        makeSignals({ insights: makeInsights({ remoteInvocationsTotal: 0 }) }),
      );
      expect(r.score).toBe(0);
      expect(r.gaps.join(" ")).toMatch(/dormant/);
    });
    it("scores 75 for two remote invocations and 100 for three+", () => {
      const two = EXECUTION_SCORERS.remote(
        makeSignals({ insights: makeInsights({ remoteInvocationsTotal: 2 }) }),
      );
      const four = EXECUTION_SCORERS.remote(
        makeSignals({ insights: makeInsights({ remoteInvocationsTotal: 4 }) }),
      );
      expect(two.score).toBe(75);
      expect(four.score).toBe(100);
    });
  });

  describe("platform-setup-only dimensions", () => {
    it.each(["memory", "customization"])(
      "%s returns null with NO_TELEMETRY_FOR_DIMENSION reason",
      (id) => {
        const r = EXECUTION_SCORERS[id](
          makeSignals({ insights: makeInsights() }),
        );
        expect(r.score).toBeNull();
        expect(r.gapReason).toMatch(/no \/insights telemetry/);
      },
    );
  });

  it("every scorer declares a universe option (interactive_only or all_sessions)", () => {
    for (const [name, scorer] of Object.entries(EXECUTION_SCORERS)) {
      expect(scorer.__universe, `${name} must declare universe`).toMatch(
        /^(interactive_only|all_sessions)$/,
      );
    }
  });

  describe("learning", () => {
    it("returns NO_TRANSCRIPTS when transcripts not scanned", () => {
      const r = EXECUTION_SCORERS.learning(
        makeSignals({ insights: makeInsights({ transcriptsScanned: false }) }),
      );
      expect(r.score).toBeNull();
      expect(r.gapReason).toMatch(/includeTranscripts/);
    });
    it("scores linear ratio of sessions emitting ★ Insight banners", () => {
      const r = EXECUTION_SCORERS.learning(
        makeSignals({
          insights: makeInsights({
            transcriptsScanned: true,
            sessionsAnalyzed: 100,
            learningModeSessionCount: 30,
            learningModeMatchesTotal: 90,
          }),
        }),
      );
      expect(r.score).toBe(30);
      expect(r.evidence.join(" ")).toMatch(/30\/100/);
      expect(r.evidence.join(" ")).toMatch(/90 ★ Insight banners/);
    });
    it("flags low adoption (<30%) with a gap message", () => {
      const r = EXECUTION_SCORERS.learning(
        makeSignals({
          insights: makeInsights({
            transcriptsScanned: true,
            sessionsAnalyzed: 100,
            learningModeSessionCount: 10,
            learningModeMatchesTotal: 12,
          }),
        }),
      );
      expect(r.score).toBe(10);
      expect(r.gaps.join(" ")).toMatch(/<30%/);
    });
  });

  describe("model-effort", () => {
    it("returns NO_TRANSCRIPTS when transcripts not scanned", () => {
      const r = EXECUTION_SCORERS["model-effort"](
        makeSignals({ insights: makeInsights({ transcriptsScanned: false }) }),
      );
      expect(r.score).toBeNull();
      expect(r.gapReason).toMatch(/includeTranscripts/);
    });
    it("scores the Opus-dominant session ratio", () => {
      const r = EXECUTION_SCORERS["model-effort"](
        makeSignals({
          insights: makeInsights({
            transcriptsScanned: true,
            interactiveSessionsAnalyzed: 10,
            opusDominantSessionCount: 8,
            opusModelMatchesTotal: 40,
          }),
        }),
      );
      expect(r.score).toBe(80);
      expect(r.gapReason).toBeNull();
      expect(r.evidence.join(" ")).toMatch(/8\/10/);
    });
    it("flags low Opus adoption (<50%) with a gap message", () => {
      const r = EXECUTION_SCORERS["model-effort"](
        makeSignals({
          insights: makeInsights({
            transcriptsScanned: true,
            interactiveSessionsAnalyzed: 10,
            opusDominantSessionCount: 3,
            opusModelMatchesTotal: 12,
          }),
        }),
      );
      expect(r.score).toBe(30);
      expect(r.gaps.join(" ")).toMatch(/fewer than half/);
    });
  });
});

describe("scoreAll", () => {
  it("emits one row per rubric dimension with tier and clamped score", () => {
    const rubric = makeRubric();
    const result = scoreAll(rubric, makeSignals());
    expect(result.scores).toHaveLength(rubric.dimensions.length);
    for (const s of result.scores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect([
        "not-touched",
        "starter",
        "developing",
        "solid",
        "advanced",
      ]).toContain(s.tier);
    }
  });
  it("computes weight-normalized overall and target", () => {
    const rubric = makeRubric();
    const result = scoreAll(rubric, makeSignals());
    expect(typeof result.overall).toBe("number");
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.targetOverall).toBeGreaterThanOrEqual(result.overall);
  });
  it("preserves capturedAt as ISO string", () => {
    const result = scoreAll(makeRubric(), makeSignals());
    expect(() => new Date(result.capturedAt).toISOString()).not.toThrow();
  });
  it("zeroes out scores for unknown rubric ids", () => {
    const rubric = {
      dimensions: [{ id: "made-up", title: "X", weight: 1, target: 50 }],
    };
    const result = scoreAll(rubric, makeSignals());
    expect(result.scores[0]).toMatchObject({
      id: "made-up",
      score: 0,
      tier: "not-touched",
    });
  });

  it("emits null executionOverall when no execution data is available", () => {
    const result = scoreAll(makeRubric(), makeSignals());
    expect(result.executionOverall).toBeNull();
    for (const s of result.scores) expect(s.executionScore).toBeNull();
  });

  it("emits weight-normalized executionOverall when insights present", () => {
    const result = scoreAll(
      makeRubric(),
      makeSignals({
        plugins: ["a@1", "b@1"],
        insights: makeInsights({
          sessionsAnalyzed: 100,
          subagentSessionCount: 50,
          frictionCounts: {},
        }),
      }),
    );
    expect(typeof result.executionOverall).toBe("number");
    expect(result.executionOverall).toBeGreaterThan(0);
    const exScored = result.scores.filter(
      (s) => typeof s.executionScore === "number",
    );
    expect(exScored.length).toBeGreaterThan(0);
  });
});

describe("computeTrends (legacy — no rubric arg)", () => {
  const current = {
    scores: [
      { id: "a", score: 70 },
      { id: "b", score: 50 },
      { id: "c", score: 80 },
      { id: "d", score: 40 },
    ],
  };

  it("marks every dimension as 'new' when history is empty", () => {
    const trends = computeTrends(current, []);
    expect(Object.values(trends).every((t) => t === "new")).toBe(true);
  });

  it("classifies improving / flat against last entry (score ≥5 AND evidence changed)", () => {
    // wobble → flat: real progress requires widened fixture: score ≥5 + evidence change
    const history = [
      {
        capturedAt: "2026-04-24",
        overall: 60,
        scores: [
          { id: "a", score: 65, evidence: ["base"], gaps: [] },
          { id: "b", score: 55, evidence: ["base"], gaps: [] },
          { id: "c", score: 80, evidence: ["base"], gaps: [] },
        ],
      },
    ];
    const curWithEvidence = {
      scores: [
        { id: "a", score: 70, evidence: ["base", "new-signal"], gaps: [] }, // +5, evidence added → improving
        { id: "b", score: 50, evidence: ["base"], gaps: ["gap1"] }, // -5, gaps added → slipping
        { id: "c", score: 80, evidence: ["base"], gaps: [] }, // flat
        { id: "d", score: 40, evidence: [], gaps: [] }, // new
      ],
    };
    const trends = computeTrends(curWithEvidence, history);
    expect(trends.a).toBe("improving");
    expect(trends.b).toBe("slipping");
    expect(trends.c).toBe("flat");
    expect(trends.d).toBe("new");
  });

  it("treats ±1 as flat (within noise band)", () => {
    const history = [
      {
        capturedAt: "x",
        overall: 60,
        scores: [
          { id: "a", score: 71 },
          { id: "b", score: 49 },
        ],
      },
    ];
    const trends = computeTrends(
      {
        scores: [
          { id: "a", score: 70 },
          { id: "b", score: 50 },
        ],
      },
      history,
    );
    expect(trends.a).toBe("flat");
    expect(trends.b).toBe("flat");
  });
});

describe("computeTrends", () => {
  const rubric = {
    dimensions: [
      { id: "automation", noiseFloor: 5 },
      { id: "permissions" }, // no override → uses DEFAULT_NOISE_FLOOR
    ],
  };

  function snapshot(scores) {
    return { scores };
  }

  it("returns 'new' for any dimension on first run", () => {
    const t = computeTrends(
      snapshot([{ id: "automation", score: 60, evidence: [], gaps: [] }]),
      [],
      rubric,
    );
    expect(t.automation).toBe("new");
  });

  it("flags 'flat' for sub-noise-floor wobbles", () => {
    const prev = snapshot([
      { id: "automation", score: 60, evidence: ["a"], gaps: ["b"] },
    ]);
    const cur = snapshot([
      { id: "automation", score: 63, evidence: ["a"], gaps: ["b"] },
    ]);
    const t = computeTrends(cur, [prev], rubric);
    expect(t.automation).toBe("flat");
  });

  it("flags 'flat' when score moved past floor but evidence/gaps unchanged", () => {
    const prev = snapshot([
      { id: "automation", score: 60, evidence: ["x"], gaps: [] },
    ]);
    const cur = snapshot([
      { id: "automation", score: 70, evidence: ["x"], gaps: [] },
    ]);
    const t = computeTrends(cur, [prev], rubric);
    expect(t.automation).toBe("flat");
  });

  it("flags 'improving' when score and evidence both move up", () => {
    const prev = snapshot([
      { id: "automation", score: 60, evidence: ["x"], gaps: ["y"] },
    ]);
    const cur = snapshot([
      { id: "automation", score: 75, evidence: ["x", "z"], gaps: [] },
    ]);
    const t = computeTrends(cur, [prev], rubric);
    expect(t.automation).toBe("improving");
  });

  it("uses DEFAULT_NOISE_FLOOR when dimension has no override", () => {
    const prev = snapshot([
      { id: "permissions", score: 60, evidence: ["x"], gaps: [] },
    ]);
    const cur = snapshot([
      {
        id: "permissions",
        score: 60 + DEFAULT_NOISE_FLOOR - 1,
        evidence: ["x"],
        gaps: [],
      },
    ]);
    const t = computeTrends(cur, [prev], rubric);
    expect(t.permissions).toBe("flat");
  });
});

describe("SCORERS.integrations — v0.8 bonuses", () => {
  it("adds bonus for mcpServersConnected (capped at +15)", () => {
    const baseline = SCORERS.integrations(makeSignals()).score;
    const oneMcp = SCORERS.integrations(
      makeSignals({ mcpServersConnected: 1 }),
    ).score;
    const fiveMcp = SCORERS.integrations(
      makeSignals({ mcpServersConnected: 5 }),
    ).score;
    const tenMcp = SCORERS.integrations(
      makeSignals({ mcpServersConnected: 10 }),
    ).score;
    expect(oneMcp).toBe(Math.min(100, baseline + 3));
    expect(fiveMcp).toBe(Math.min(100, baseline + 15));
    expect(tenMcp).toBe(Math.min(100, baseline + 15)); // capped
  });

  it("adds +5 for hasClaudeInChrome", () => {
    const baseline = SCORERS.integrations(makeSignals()).score;
    const withChrome = SCORERS.integrations(
      makeSignals({ hasClaudeInChrome: true }),
    ).score;
    expect(withChrome).toBe(Math.min(100, baseline + 5));
  });

  it("evidence reflects new credits", () => {
    const r = SCORERS.integrations(
      makeSignals({ mcpServersConnected: 3, hasClaudeInChrome: true }),
    );
    expect(r.evidence.some((e) => e.includes("MCP server"))).toBe(true);
    expect(r.evidence.some((e) => e.includes("Claude in Chrome"))).toBe(true);
  });
});

describe("SCORERS.verification — v0.8 bonuses", () => {
  it("adds +5 for hasClaudeInChrome", () => {
    const baseline = SCORERS.verification(makeSignals()).score;
    const withChrome = SCORERS.verification(
      makeSignals({ hasClaudeInChrome: true }),
    ).score;
    expect(withChrome).toBe(Math.min(100, baseline + 5));
  });

  it("adds +5 when shipVerifyStageRecent >= 1", () => {
    const baseline = SCORERS.verification(makeSignals()).score;
    const oneShip = SCORERS.verification(
      makeSignals({ shipVerifyStageRecent: 1 }),
    ).score;
    const fiveShip = SCORERS.verification(
      makeSignals({ shipVerifyStageRecent: 5 }),
    ).score;
    expect(oneShip).toBe(Math.min(100, baseline + 5));
    expect(fiveShip).toBe(Math.min(100, baseline + 5)); // not stacking
  });

  it("adds +3 when goCommandUses >= 3 (reflex adoption)", () => {
    const baseline = SCORERS.verification(makeSignals()).score;
    const oneGo = SCORERS.verification(makeSignals({ goCommandUses: 1 })).score;
    const threeGo = SCORERS.verification(
      makeSignals({ goCommandUses: 3 }),
    ).score;
    expect(oneGo).toBe(baseline); // below threshold
    expect(threeGo).toBe(Math.min(100, baseline + 3));
  });

  it("adds +5 when desktopSessionCount >= 1 (Boris tip 52)", () => {
    const baseline = SCORERS.verification(makeSignals()).score;
    const withDesktop = SCORERS.verification(
      makeSignals({ desktopSessionCount: 1 }),
    );
    const withoutDesktop = SCORERS.verification(
      makeSignals({ desktopSessionCount: 0 }),
    );
    expect(withDesktop.score).toBe(Math.min(100, baseline + 5));
    expect(withDesktop.evidence).toContain(
      "Used the Claude Code desktop app — Boris tip 52",
    );
    expect(withoutDesktop.score).toBe(baseline); // credit not applied
    expect(withoutDesktop.evidence).not.toContain(
      "Used the Claude Code desktop app — Boris tip 52",
    );
  });
});

describe("SCORERS.parallel — v0.8 bonuses", () => {
  it("adds +8 when worktreeAliasCount >= 3", () => {
    const baseline = SCORERS.parallel(makeSignals()).score;
    const twoAliases = SCORERS.parallel(
      makeSignals({ worktreeAliasCount: 2 }),
    ).score;
    const threeAliases = SCORERS.parallel(
      makeSignals({ worktreeAliasCount: 3 }),
    ).score;
    expect(twoAliases).toBe(baseline);
    expect(threeAliases).toBe(Math.min(100, baseline + 8));
  });

  it("adds +10 when batchCommandUses >= 1", () => {
    const baseline = SCORERS.parallel(makeSignals()).score;
    const withBatch = SCORERS.parallel(
      makeSignals({ batchCommandUses: 1 }),
    ).score;
    expect(withBatch).toBe(Math.min(100, baseline + 10));
  });
});

describe("customization breadth (tip 27)", () => {
  it("rewards configuring many customization surfaces", () => {
    const few = makeSignals({ statuslineConfigured: true });
    const many = makeSignals({
      statuslineConfigured: true,
      keybindingsConfigured: true,
      has: { explanatoryStyle: true },
      settings: { customSpinnerVerbCount: 3, hasTerminalSetup: true },
    });
    expect(SCORERS.customization(many).score).toBeGreaterThan(
      SCORERS.customization(few).score,
    );
  });
  it("emits a 'customization surfaces' evidence line at breadth >= 4", () => {
    const many = makeSignals({
      statuslineConfigured: true,
      keybindingsConfigured: true,
      has: { explanatoryStyle: true },
      settings: { customSpinnerVerbCount: 3, hasTerminalSetup: true },
    });
    expect(SCORERS.customization(many).evidence.join(" ")).toMatch(
      /customization surface/,
    );
  });
});

describe("SCORERS — v0.8 small bonuses across remaining dims", () => {
  it("scheduled: +10 for babysitLoopUses, +5 for scheduleCommandUses", () => {
    const baseline = SCORERS.scheduled(makeSignals()).score;
    expect(SCORERS.scheduled(makeSignals({ babysitLoopUses: 1 })).score).toBe(
      Math.min(100, baseline + 10),
    );
    expect(
      SCORERS.scheduled(makeSignals({ scheduleCommandUses: 1 })).score,
    ).toBe(Math.min(100, baseline + 5));
  });

  it("scheduled: combined v9 bonuses cap at +15", () => {
    const baseline = SCORERS.scheduled(makeSignals()).score;
    const both = SCORERS.scheduled(
      makeSignals({ babysitLoopUses: 1, scheduleCommandUses: 1 }),
    ).score;
    // 10 + 5 = 15 → exactly at cap
    expect(both).toBe(Math.min(100, baseline + 15));
  });

  it("parallel: combined v9 bonuses cap at +15", () => {
    const baseline = SCORERS.parallel(makeSignals()).score;
    const both = SCORERS.parallel(
      makeSignals({ worktreeAliasCount: 3, batchCommandUses: 1 }),
    ).score;
    // 8 + 10 = 18 → capped to 15
    expect(both).toBe(Math.min(100, baseline + 15));
  });

  it("customization: +5 for focusCommandUses >= 1", () => {
    const baseline = SCORERS.customization(makeSignals()).score;
    expect(
      SCORERS.customization(makeSignals({ focusCommandUses: 1 })).score,
    ).toBe(Math.min(100, baseline + 5));
  });

  it("customization: +5 when hasTerminalSetup is true (Boris tip 11)", () => {
    const baseline = SCORERS.customization(makeSignals()).score;
    const withTerminal = SCORERS.customization(
      makeSignals({ hasTerminalSetup: true }),
    );
    const withoutTerminal = SCORERS.customization(
      makeSignals({ hasTerminalSetup: false }),
    );
    expect(withTerminal.score).toBe(Math.min(100, baseline + 5));
    expect(withTerminal.evidence).toContain(
      "Terminal configured (deep-link / Option-as-Meta) — Boris tip 11",
    );
    expect(withoutTerminal.score).toBe(baseline); // credit not applied
    expect(withoutTerminal.evidence).not.toContain(
      "Terminal configured (deep-link / Option-as-Meta) — Boris tip 11",
    );
  });

  it("planning: +5 for planThenLaunchSessions >= 1", () => {
    const baseline = SCORERS.planning(makeSignals()).score;
    expect(
      SCORERS.planning(makeSignals({ planThenLaunchSessions: 1 })).score,
    ).toBe(Math.min(100, baseline + 5));
  });

  it("automation: +5 for shipsRecent >= 1", () => {
    const baseline = SCORERS.automation(makeSignals()).score;
    expect(SCORERS.automation(makeSignals({ shipsRecent: 1 })).score).toBe(
      Math.min(100, baseline + 5),
    );
  });

  it("remote: +10 for hasRemoteControl", () => {
    const baseline = SCORERS.remote(makeSignals()).score;
    expect(SCORERS.remote(makeSignals({ hasRemoteControl: true })).score).toBe(
      Math.min(100, baseline + 10),
    );
  });
});

describe("parallel execution — cowork adoption credit (tip 50)", () => {
  it("adds capped credit when cowork dispatch adopted", () => {
    const base = makeSignals({
      insights: makeInsights({
        subagentSessionCount: 0,
        transcriptsScanned: true,
      }),
    });
    const withCowork = makeSignals({
      settings: { coworkDispatchAdopted: true },
      insights: makeInsights({
        subagentSessionCount: 0,
        transcriptsScanned: true,
      }),
    });
    const a = EXECUTION_SCORERS.parallel(base).score;
    const b = EXECUTION_SCORERS.parallel(withCowork).score;
    expect(b).toBeGreaterThan(a);
  });
});

describe("execution adoption credit (tips 74/33/planning/learning)", () => {
  const ins = () =>
    makeInsights({
      transcriptsScanned: true,
      opusDominantSessionCount: 0,
      planModeSessionCount: 0,
      multiTaskSessionCount: 1,
      hookFireCount: 0,
      learningModeSessionCount: 0,
    });

  it("model-effort gains awareness credit (tip 74, capped low)", () => {
    const a = EXECUTION_SCORERS["model-effort"](
      makeSignals({ insights: ins() }),
    ).score;
    const b = EXECUTION_SCORERS["model-effort"](
      makeSignals({
        settings: { opus47AwarenessAdopted: true },
        insights: ins(),
      }),
    ).score;
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBe(8);
  });
  it("automation gains btw counter credit (tip 33)", () => {
    const a = EXECUTION_SCORERS.automation(
      makeSignals({ insights: ins() }),
    ).score;
    const b = EXECUTION_SCORERS.automation(
      makeSignals({ settings: { cliBtwUseCount: 36 }, insights: ins() }),
    ).score;
    expect(b).toBeGreaterThan(a);
  });
  it("planning gains plan-mode recency credit", () => {
    const a = EXECUTION_SCORERS.planning(
      makeSignals({ insights: ins() }),
    ).score;
    const b = EXECUTION_SCORERS.planning(
      makeSignals({ settings: { planModeRecencyDays: 1 }, insights: ins() }),
    ).score;
    expect(b).toBeGreaterThan(a);
  });
  it("learning gains skill-recency credit", () => {
    const a = EXECUTION_SCORERS.learning(
      makeSignals({ insights: ins() }),
    ).score;
    const b = EXECUTION_SCORERS.learning(
      makeSignals({ settings: { skillsUsedRecently: 3 }, insights: ins() }),
    ).score;
    expect(b).toBeGreaterThan(a);
  });
});

describe("adoptionBonus", () => {
  it("boolean: full cap when on, zero when off", () => {
    expect(adoptionBonus({ on: true, kind: "boolean", cap: 15 }).points).toBe(
      15,
    );
    expect(adoptionBonus({ on: false, kind: "boolean", cap: 15 }).points).toBe(
      0,
    );
  });
  it("counter: scales to cap, never exceeds", () => {
    expect(
      adoptionBonus({ value: 0, kind: "counter", cap: 10, target: 5 }).points,
    ).toBe(0);
    expect(
      adoptionBonus({ value: 5, kind: "counter", cap: 10, target: 5 }).points,
    ).toBe(10);
    expect(
      adoptionBonus({ value: 50, kind: "counter", cap: 10, target: 5 }).points,
    ).toBe(10);
  });
  it("recency: full cap when recent, decays to 0 past window", () => {
    expect(
      adoptionBonus({ days: 0, kind: "recency", cap: 10, window: 30 }).points,
    ).toBe(10);
    expect(
      adoptionBonus({ days: 30, kind: "recency", cap: 10, window: 30 }).points,
    ).toBe(0);
    expect(
      adoptionBonus({ days: null, kind: "recency", cap: 10, window: 30 })
        .points,
    ).toBe(0);
    expect(
      adoptionBonus({ days: -5, kind: "recency", cap: 10, window: 30 }).points,
    ).toBe(10);
    expect(
      adoptionBonus({ days: -100, kind: "recency", cap: 10, window: 30 })
        .points,
    ).toBe(10);
  });
  it("non-finite value/days yield 0 points, never NaN", () => {
    // counter: missing/NaN value must not propagate NaN into the score
    expect(
      adoptionBonus({ value: undefined, kind: "counter", cap: 10, target: 3 })
        .points,
    ).toBe(0);
    expect(
      adoptionBonus({ value: NaN, kind: "counter", cap: 10, target: 3 }).points,
    ).toBe(0);
    // recency: NaN/Infinity days must not propagate NaN
    expect(
      adoptionBonus({ days: NaN, kind: "recency", cap: 8, window: 30 }).points,
    ).toBe(0);
    expect(
      adoptionBonus({ days: Infinity, kind: "recency", cap: 8, window: 30 })
        .points,
    ).toBe(0);
  });
  it("emits evidence when credited, gap when not", () => {
    const hit = adoptionBonus({
      on: true,
      kind: "boolean",
      cap: 15,
      evidenceText: "E",
      gapText: "G",
    });
    expect(hit.evidence).toBe("E");
    expect(hit.gap).toBeNull();
    const miss = adoptionBonus({
      on: false,
      kind: "boolean",
      cap: 15,
      evidenceText: "E",
      gapText: "G",
    });
    expect(miss.evidence).toBeNull();
    expect(miss.gap).toBe("G");
  });
});
