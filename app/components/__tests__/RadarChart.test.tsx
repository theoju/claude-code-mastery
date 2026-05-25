// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, createEvent } from "@testing-library/react";
import RadarChart from "../RadarChart";
import type { Dimension } from "@/app/lib/assessment";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function dim(id: string, score: number, target = 90): Dimension {
  return {
    id,
    title: id,
    weight: 1,
    target,
    rawTarget: target,
    rubricArea: "test",
    borisTips: "1",
    nextActions: [],
    score,
    rawScore: score,
    tier: "developing",
    trend: "flat",
    evidence: [],
    gaps: [],
    summary: "",
    executionScore: null,
    executionRawScore: null,
    executionEvidence: [],
    executionGaps: [],
    gapReason: null,
  };
}

describe("RadarChart", () => {
  it("renders an svg with rings, radial lines, and the score+target paths", () => {
    const dims = [dim("a", 60), dim("b", 70), dim("c", 80), dim("d", 50)];
    const { container } = render(<RadarChart dimensions={dims} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    // 5 ring circles + n visible score dots + n transparent hit-area circles.
    expect(container.querySelectorAll("circle").length).toBe(
      5 + dims.length + dims.length,
    );
    expect(container.querySelectorAll("line").length).toBe(dims.length);
    expect(container.querySelectorAll("path").length).toBe(2);
    expect(container.querySelectorAll("text").length).toBe(dims.length);
  });

  it("places the first vertex at the top (angle = -π/2) for a known input", () => {
    const dims = [dim("a", 100), dim("b", 0), dim("c", 0), dim("d", 0)];
    const { container } = render(<RadarChart dimensions={dims} size={500} />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(2);
    const scorePath = paths[1].getAttribute("d") || "";
    // size 500 → cx=cy=250, radius=180 → first vertex ≈ (250.0, 70.0)
    expect(scorePath).toMatch(/^M250\.0,70\.0/);
  });

  it("uses a padded viewBox so labels at the radius edge don't clip", () => {
    const dims = [dim("a", 50), dim("b", 50), dim("c", 50)];
    const { container } = render(<RadarChart dimensions={dims} size={300} />);
    // Padded viewBox: `-PAD_L -PAD_T (size+PAD_L+PAD_R) (size+PAD_T+PAD_B)`.
    // For size=300 with PAD_L=60, PAD_R=80, PAD_T=24, PAD_B=40 →
    // viewBox="-60 -24 440 364". The exact numbers are an implementation
    // detail; what matters is that x-start is negative and width > size.
    const vb = container.querySelector("svg")?.getAttribute("viewBox") || "";
    const [x, , w] = vb.split(" ").map(Number);
    expect(x).toBeLessThan(0);
    expect(w).toBeGreaterThan(300);
  });

  it("does not draw an execution polygon when showExecution is false (default)", () => {
    const dims = [
      { ...dim("a", 60), executionScore: 30 },
      { ...dim("b", 70), executionScore: 40 },
      { ...dim("c", 80), executionScore: 50 },
    ];
    const { container } = render(<RadarChart dimensions={dims} />);
    expect(container.querySelectorAll("path").length).toBe(2);
  });

  it("draws an execution polygon spanning only dimensions with executionScore set", () => {
    const dims = [
      { ...dim("a", 60), executionScore: 30 },
      { ...dim("b", 70), executionScore: null },
      { ...dim("c", 80), executionScore: 40 },
      { ...dim("d", 50), executionScore: 20 },
    ];
    const { container } = render(
      <RadarChart dimensions={dims} showExecution />,
    );
    expect(container.querySelectorAll("path").length).toBe(3);
    const execPath = container.querySelectorAll("path")[2];
    expect(execPath.getAttribute("stroke-dasharray")).toBe("3 3");
    // 5 rings + 4 setup dots + 3 execution dots + 4 hit-area circles.
    expect(container.querySelectorAll("circle").length).toBe(5 + 4 + 3 + 4);
  });

  it("italicizes labels and renders (1) marker for unmeasured-execution dims", () => {
    const dims = [
      { ...dim("a", 60), executionScore: 30 },
      { ...dim("b", 70), executionScore: null }, // unmeasured
      { ...dim("c", 80), executionScore: 40 },
      { ...dim("d", 50), executionScore: null }, // unmeasured
    ];
    const { container } = render(
      <RadarChart dimensions={dims} showExecution />,
    );
    const italicLabels = Array.from(container.querySelectorAll("text")).filter(
      (t) => t.getAttribute("font-style") === "italic",
    );
    expect(italicLabels.length).toBe(2);
    // Each italic label contains a `(1)` tspan rather than the old `¹`.
    for (const t of italicLabels) {
      expect(t.querySelector("tspan")?.textContent).toBe("(1)");
    }
    // Without showExecution, no italic markers regardless of executionScore.
    const { container: c2 } = render(<RadarChart dimensions={dims} />);
    expect(
      Array.from(c2.querySelectorAll("text")).filter(
        (t) => t.getAttribute("font-style") === "italic",
      ).length,
    ).toBe(0);
  });

  it("omits the execution polygon when fewer than 2 dimensions have an execution score", () => {
    const dims = [
      { ...dim("a", 60), executionScore: 30 },
      { ...dim("b", 70), executionScore: null },
      { ...dim("c", 80), executionScore: null },
    ];
    const { container } = render(
      <RadarChart dimensions={dims} showExecution />,
    );
    expect(container.querySelectorAll("path").length).toBe(2);
    // 5 rings + 3 setup dots + 1 execution dot + 3 hit-area circles.
    expect(container.querySelectorAll("circle").length).toBe(5 + 3 + 1 + 3);
  });

  // --- New tests for tooltip + click-to-navigate ---

  it("reveals a tooltip group when a vertex hit-area is hovered", () => {
    const dims = [dim("alpha", 60), dim("beta", 70), dim("gamma", 80)];
    const { container } = render(<RadarChart dimensions={dims} />);
    expect(container.querySelector(".radar-tooltip")).toBeNull();
    const hit = container.querySelector('[data-dim-id="beta"]');
    expect(hit).toBeTruthy();
    fireEvent.mouseEnter(hit!);
    const tooltip = container.querySelector(".radar-tooltip");
    expect(tooltip).toBeTruthy();
    // Tooltip surfaces the dimension title.
    expect(tooltip!.textContent).toContain("beta");
    // Setup row carries the raw score / target tuple.
    expect(tooltip!.textContent).toMatch(/Setup.*70.*raw 70\/90/);
    fireEvent.mouseLeave(hit!);
    expect(container.querySelector(".radar-tooltip")).toBeNull();
  });

  it("omits the Execution numeric row for unmeasured dims", () => {
    const dims = [
      { ...dim("a", 60), executionScore: 30, executionRawScore: 20 },
      { ...dim("b", 70), executionScore: null }, // unmeasured
    ];
    const { container } = render(
      <RadarChart dimensions={dims} showExecution />,
    );
    // Measured dim shows Execution row with numeric content.
    fireEvent.mouseEnter(container.querySelector('[data-dim-id="a"]')!);
    expect(container.querySelector(".radar-tooltip")!.textContent).toMatch(
      /Execution.*30/,
    );
    fireEvent.mouseLeave(container.querySelector('[data-dim-id="a"]')!);
    // Unmeasured dim's tooltip shows the "unmeasured (1)" placeholder, not raw
    // numbers.
    fireEvent.mouseEnter(container.querySelector('[data-dim-id="b"]')!);
    const t = container.querySelector(".radar-tooltip")!;
    expect(t.textContent).toContain("unmeasured (1)");
    expect(t.textContent).not.toMatch(/Execution.*\d+%.*\(raw/);
  });

  it("navigates to /dimensions/<id> when a vertex hit-area is clicked (mouse)", () => {
    pushMock.mockClear();
    const dims = [dim("alpha", 60), dim("beta", 70)];
    const { container } = render(<RadarChart dimensions={dims} />);
    const hit = container.querySelector('[data-dim-id="beta"]')!;
    fireEvent.pointerDown(hit, { pointerType: "mouse" });
    expect(pushMock).toHaveBeenCalledWith("/dimensions/beta");
  });

  it("makes axis labels clickable as a second hit target", () => {
    pushMock.mockClear();
    const dims = [dim("alpha", 60), dim("beta", 70)];
    const { container } = render(<RadarChart dimensions={dims} />);
    const labels = container.querySelectorAll("text.radar-label");
    expect(labels.length).toBe(2);
    fireEvent.pointerDown(labels[1], { pointerType: "mouse" });
    expect(pushMock).toHaveBeenCalledWith("/dimensions/beta");
  });

  // jsdom + @testing-library don't propagate pointerType through the init
  // object; force it onto the event before dispatch so React's synthetic
  // event reads "touch".
  function touchPointerDown(el: Element) {
    const event = createEvent.pointerDown(el);
    Object.defineProperty(event, "pointerType", { value: "touch" });
    fireEvent(el, event);
  }

  it("touch: first tap reveals tooltip without navigating; second tap navigates", () => {
    pushMock.mockClear();
    const dims = [dim("alpha", 60), dim("beta", 70)];
    const { container } = render(<RadarChart dimensions={dims} />);
    const hit = container.querySelector('[data-dim-id="beta"]')!;
    touchPointerDown(hit);
    expect(pushMock).not.toHaveBeenCalled();
    expect(container.querySelector(".radar-tooltip")).toBeTruthy();
    touchPointerDown(hit);
    expect(pushMock).toHaveBeenCalledWith("/dimensions/beta");
  });

  it("touch: tapping a different dim swaps the tooltip rather than navigating", () => {
    pushMock.mockClear();
    const dims = [dim("alpha", 60), dim("beta", 70), dim("gamma", 80)];
    const { container } = render(<RadarChart dimensions={dims} />);
    touchPointerDown(container.querySelector('[data-dim-id="beta"]')!);
    touchPointerDown(container.querySelector('[data-dim-id="gamma"]')!);
    expect(pushMock).not.toHaveBeenCalled();
    expect(container.querySelector(".radar-tooltip")!.textContent).toContain(
      "gamma",
    );
  });

  // Quantize SVG coords so Math.sin/cos ULP drift between Node V8 (SSR) and
  // Chrome V8 (hydration) can't trigger a React hydration mismatch. Path strings
  // already pass through .toFixed(1); this test pins the same contract on every
  // numeric SVG attribute the radar emits.
  it("quantizes every numeric SVG coord to at most one decimal place", () => {
    const dims = [
      { ...dim("a", 100), executionScore: 80 },
      { ...dim("b", 87), executionScore: 56 },
      { ...dim("c", 94), executionScore: 53 },
      { ...dim("d", 75), executionScore: 100 },
      { ...dim("e", 100), executionScore: 28 },
      { ...dim("f", 100), executionScore: null },
      { ...dim("g", 89), executionScore: null },
      { ...dim("h", 100), executionScore: 69 },
      { ...dim("i", 100), executionScore: null },
      { ...dim("j", 94), executionScore: null },
      { ...dim("k", 87), executionScore: 100 },
      { ...dim("l", 100), executionScore: 80 },
    ];
    const { container } = render(
      <RadarChart dimensions={dims} showExecution />,
    );
    const coordAttrs = ["cx", "cy", "x", "y", "x1", "y1", "x2", "y2"];
    const quantum = /^-?\d+(\.\d)?$/;
    const offenders: string[] = [];
    for (const el of container.querySelectorAll("circle, line, text")) {
      for (const attr of coordAttrs) {
        const v = el.getAttribute(attr);
        if (v != null && !quantum.test(v)) {
          offenders.push(`<${el.tagName.toLowerCase()} ${attr}="${v}">`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
