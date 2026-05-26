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

  it("btwCommandUses takes MAX of history and cliConfig counter", () => {
    const s = makeSignals({
      historyInvocations: { btwCommandUses: 5 },
      settings: { cliBtwUseCount: 36 },
    });
    expect(buildSignalsSummary(s).btwCommandUses).toBe(36);
  });
});
