import { describe, it, expect } from "vitest";
import { auditPlans, formatAuditReport } from "../plans-audit.mjs";

const NOW = new Date("2026-05-21T07:15:00.000Z");
const SECONDS_PER_DAY = 24 * 60 * 60;
const tsDaysAgo = (n) => Math.floor(NOW.getTime() / 1000) - n * SECONDS_PER_DAY;

describe("plans-audit", () => {
  it("reports nothing-to-archive on empty plans dir", async () => {
    const audit = await auditPlans({
      plansDir: "/fake/plans",
      readdir: async () => [],
      gitLog: async () => [],
      now: () => NOW,
    });
    expect(audit.count).toBe(0);
    expect(audit.items).toEqual([]);
    expect(formatAuditReport(audit)).toBe("Plans audit: nothing to archive.");
  });

  it("excludes plans with no git history (in-progress drafts)", async () => {
    const audit = await auditPlans({
      plansDir: "/fake/plans",
      readdir: async () => ["draft.md"],
      gitLog: async () => [],
      now: () => NOW,
    });
    expect(audit.count).toBe(0);
  });

  it("includes a landed plan with PR-tagged squash subject", async () => {
    const audit = await auditPlans({
      plansDir: "/fake/plans",
      readdir: async () => ["2026-05-19-feature.md"],
      gitLog: async () => [
        {
          sha: "abc1234567890abcdef",
          ts: tsDaysAgo(2),
          subject: "feat: new thing (#42)",
        },
      ],
      now: () => NOW,
    });
    expect(audit.count).toBe(1);
    expect(audit.items[0]).toMatchObject({
      filename: "2026-05-19-feature.md",
      prOrSha: "#42",
      ageDays: 2,
      ageLabel: "2 days ago",
    });
  });

  it("skips directory entries (e.g., archived/ subdir is not recursed)", async () => {
    const audit = await auditPlans({
      plansDir: "/fake/plans",
      readdir: async () => ["archived", "live.md"],
      gitLog: async () => [
        {
          sha: "deadbeefdeadbeef",
          ts: tsDaysAgo(3),
          subject: "live plan (#1)",
        },
      ],
      now: () => NOW,
    });
    expect(audit.count).toBe(1);
    expect(audit.items[0].filename).toBe("live.md");
  });

  it("falls back to short SHA when subject lacks (#NN)", async () => {
    const audit = await auditPlans({
      plansDir: "/fake/plans",
      readdir: async () => ["direct.md"],
      gitLog: async () => [
        {
          sha: "9cc07c5f1234567890",
          ts: tsDaysAgo(11),
          subject: "direct-to-main commit no PR",
        },
      ],
      now: () => NOW,
    });
    expect(audit.items[0].prOrSha).toBe("9cc07c5");
    expect(audit.items[0].ageLabel).toBe("11 days ago");
  });

  it("sorts oldest first across multiple plans", async () => {
    const audit = await auditPlans({
      plansDir: "/fake/plans",
      readdir: async () => ["one.md", "two.md", "three.md"],
      gitLog: async ({ path }) => {
        if (path.endsWith("one.md"))
          return [{ sha: "a1", ts: tsDaysAgo(5), subject: "x (#1)" }];
        if (path.endsWith("two.md"))
          return [{ sha: "b2", ts: tsDaysAgo(10), subject: "y (#2)" }];
        if (path.endsWith("three.md"))
          return [{ sha: "c3", ts: tsDaysAgo(1), subject: "z (#3)" }];
        return [];
      },
      now: () => NOW,
    });
    expect(audit.items.map((i) => i.filename)).toEqual([
      "two.md",
      "one.md",
      "three.md",
    ]);
  });
});
