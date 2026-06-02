import { describe, it, expect } from "vitest";
import { buildSignalsSummary } from "../run-assessment.mjs";
import { makeSignals } from "./_fixtures.mjs";

describe("buildSignalsSummary — runtime adoption", () => {
  it("projects the new adoption flags", () => {
    const s = makeSignals({
      settings: {
        coworkDispatchAdopted: true,
        opus47AwarenessAdopted: true,
        cliBtwUseCount: 36,
        planModeRecencyDays: 3,
        skillsUsedRecently: 2,
      },
    });
    const out = buildSignalsSummary(s);
    expect(out.coworkDispatchAdopted).toBe(true);
    expect(out.opus47AwarenessAdopted).toBe(true);
    expect(out.planModeRecencyDays).toBe(3);
    expect(out.skillsUsedRecently).toBe(2);
  });

  // CCE-78: btwCommandUses must NOT blend with cliBtwUseCount. The cliConfig
  // counter is cumulative all-time invocation count; btwCommandUses is 30-day
  // windowed session-coverage. Blending the two into a single field corrupted
  // the Memory Execution ratio. The all-time count is now exposed on its own
  // field, cliBtwUseCountAllTime, for predicates that want "have you ever
  // adopted this habit" semantics.
  it("btwCommandUses takes MAX of transcript and history only — NOT cliBtwUseCount (CCE-78)", () => {
    const s = makeSignals({
      historyInvocations: { btwCommandUses: 5 },
      settings: { cliBtwUseCount: 36 },
    });
    expect(buildSignalsSummary(s).btwCommandUses).toBe(5);
  });

  it("exposes cliBtwUseCountAllTime separately for habit predicates (CCE-78)", () => {
    const s = makeSignals({
      historyInvocations: { btwCommandUses: 0 },
      settings: { cliBtwUseCount: 36 },
    });
    const out = buildSignalsSummary(s);
    expect(out.btwCommandUses).toBe(0);
    expect(out.cliBtwUseCountAllTime).toBe(36);
  });

  it("cliBtwUseCountAllTime defaults to 0 when settings.cliBtwUseCount is missing", () => {
    const s = makeSignals({ settings: {} });
    expect(buildSignalsSummary(s).cliBtwUseCountAllTime).toBe(0);
  });
});
