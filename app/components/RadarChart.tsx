"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Dimension } from "@/app/lib/assessment";

interface Props {
  dimensions: Dimension[];
  size?: number;
  showExecution?: boolean;
}

// Right side gets more room because the longest label anchors there.
const PAD_L = 60;
const PAD_R = 80;
const PAD_T = 24;
const PAD_B = 40;

const TT_W = 220;
const TT_LINE_H = 16;
const TT_PAD_X = 10;
const TT_PAD_Y = 10;

// Math.sin/Math.cos are implementation-defined per ECMAScript; Node and
// Chrome's V8 can disagree by ~1 ULP, which breaks SSR hydration on raw SVG
// coords. Quantize to 0.1px so the drift is rounded away. Math.round is fully
// spec'd (unlike toFixed's banker-rounding ties), so q() is deterministic.
const q = (v: number) => Math.round(v * 10) / 10;

export default function RadarChart({
  dimensions,
  size = 480,
  showExecution = false,
}: Props) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 70;
  const n = dimensions.length;

  const pointAt = (value: number, i: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (value / 100) * radius;
    return [q(cx + Math.cos(angle) * r), q(cy + Math.sin(angle) * r)] as const;
  };

  const scorePath =
    dimensions
      .map((d, i) => {
        const [x, y] = pointAt(d.score, i);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ") + " Z";

  const targetPath =
    dimensions
      .map((d, i) => {
        const [x, y] = pointAt(d.target, i);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ") + " Z";

  const executionVertices: Array<{ x: number; y: number; i: number }> =
    showExecution
      ? dimensions
          .map((d, i) => {
            if (d.executionScore == null) return null;
            const [x, y] = pointAt(d.executionScore, i);
            return { x, y, i };
          })
          .filter((v): v is { x: number; y: number; i: number } => v !== null)
      : [];

  const executionPath =
    executionVertices.length >= 2
      ? executionVertices
          .map(
            (v, i) =>
              `${i === 0 ? "M" : "L"}${v.x.toFixed(1)},${v.y.toFixed(1)}`,
          )
          .join(" ") + " Z"
      : null;

  const rings = [20, 40, 60, 80, 100];

  const navigate = (id: string) => router.push(`/dimensions/${id}`);

  const handleActivate = (id: string) => setActiveId(id);
  const handleDeactivate = () => setActiveId(null);
  // Touch fallback: first tap reveals tooltip, second tap on same dim navigates.
  const handleTap = (id: string) => (e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation();
    if (e.pointerType !== "touch") {
      navigate(id);
      return;
    }
    if (activeId === id) navigate(id);
    else setActiveId(id);
  };

  const activeIndex =
    activeId != null ? dimensions.findIndex((d) => d.id === activeId) : -1;
  const activeDim = activeIndex >= 0 ? dimensions[activeIndex] : null;

  return (
    <svg
      viewBox={`${-PAD_L} ${-PAD_T} ${size + PAD_L + PAD_R} ${size + PAD_T + PAD_B}`}
      className="w-full h-auto"
      onPointerDown={() => setActiveId(null)}
    >
      {rings.map((v) => (
        <circle
          key={v}
          cx={cx}
          cy={cy}
          r={(v / 100) * radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={v === 100 ? 1 : 0.5}
          strokeDasharray={v === 100 ? undefined : "2 3"}
        />
      ))}
      {dimensions.map((_, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={q(cx + Math.cos(angle) * radius)}
            y2={q(cy + Math.sin(angle) * radius)}
            stroke="var(--color-line)"
            strokeWidth={0.5}
          />
        );
      })}

      <path
        d={targetPath}
        fill="var(--color-accent)"
        fillOpacity={0.08}
        stroke="var(--color-accent)"
        strokeOpacity={0.6}
        strokeDasharray="4 3"
        strokeWidth={1}
      />
      <path
        d={scorePath}
        fill="var(--color-good)"
        fillOpacity={0.2}
        stroke="var(--color-good)"
        strokeWidth={1.5}
      />

      {executionPath && (
        <path
          d={executionPath}
          fill="var(--color-warn)"
          fillOpacity={0.1}
          stroke="var(--color-warn)"
          strokeWidth={1.25}
          strokeDasharray="3 3"
        />
      )}

      {dimensions.map((d, i) => {
        const [x, y] = pointAt(d.score, i);
        return (
          <circle
            key={d.id}
            cx={x}
            cy={y}
            r={3}
            fill="var(--color-good)"
            pointerEvents="none"
          />
        );
      })}

      {executionVertices.map((v) => (
        <circle
          key={`exec-${dimensions[v.i].id}`}
          cx={v.x}
          cy={v.y}
          r={2.5}
          fill="var(--color-warn)"
          pointerEvents="none"
        />
      ))}

      {dimensions.map((d, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const lx = q(cx + Math.cos(angle) * (radius + 26));
        const ly = q(cy + Math.sin(angle) * (radius + 26));
        const anchor =
          Math.abs(Math.cos(angle)) < 0.2
            ? "middle"
            : Math.cos(angle) > 0
              ? "start"
              : "end";
        const label = d.title.split(" — ")[0].split("&")[0].trim();
        const unmeasured = showExecution && d.executionScore == null;
        return (
          <text
            key={`lbl-${d.id}`}
            x={lx}
            y={ly}
            fontSize={11}
            fill="var(--color-mute)"
            fontStyle={unmeasured ? "italic" : undefined}
            opacity={unmeasured ? 0.65 : 1}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="radar-label cursor-pointer"
            onMouseEnter={() => handleActivate(d.id)}
            onMouseLeave={handleDeactivate}
            onPointerDown={handleTap(d.id)}
          >
            {label}
            {unmeasured ? (
              <tspan dx={4} fontSize={11}>
                (1)
              </tspan>
            ) : null}
          </text>
        );
      })}

      {dimensions.map((d, i) => {
        const [sx, sy] = pointAt(d.score, i);
        const [ex, ey] =
          d.executionScore != null ? pointAt(d.executionScore, i) : [sx, sy];
        const mx = q((sx + ex) / 2);
        const my = q((sy + ey) / 2);
        return (
          <circle
            key={`hit-${d.id}`}
            cx={mx}
            cy={my}
            r={16}
            fill="transparent"
            className="radar-hit cursor-pointer"
            data-dim-id={d.id}
            onMouseEnter={() => handleActivate(d.id)}
            onMouseLeave={handleDeactivate}
            onPointerDown={handleTap(d.id)}
          />
        );
      })}

      {activeDim != null && (
        <Tooltip
          dim={activeDim}
          vertex={pointAt(activeDim.score, activeIndex)}
          chartCenter={[cx, cy]}
          showExecution={showExecution}
          bounds={{ size }}
        />
      )}
    </svg>
  );
}

interface TooltipProps {
  dim: Dimension;
  vertex: readonly [number, number];
  chartCenter: readonly [number, number];
  showExecution: boolean;
  bounds: { size: number };
}

function Tooltip({
  dim,
  vertex,
  chartCenter,
  showExecution,
  bounds,
}: TooltipProps) {
  const [vx, vy] = vertex;
  const [cx, cy] = chartCenter;

  const dx = vx - cx;
  const dy = vy - cy;
  const mag = Math.hypot(dx, dy) || 1;
  const ux = dx / mag;
  const uy = dy / mag;

  const offsetX = ux > 0 ? 12 : -TT_W - 12;
  const hasExecution = dim.executionScore != null;
  // Row count must match what's actually rendered below: title, setup,
  // exec (whenever showExecution), meta.
  const totalLines = 1 + 1 + (showExecution ? 1 : 0) + 1;
  const boxH = TT_PAD_Y * 2 + TT_LINE_H * totalLines;
  const offsetY = uy > 0 ? 8 : -boxH - 8;

  // Clamp inside the padded viewBox so the box doesn't clip on edge vertices.
  const minX = -PAD_L;
  const maxX = bounds.size + PAD_R - TT_W;
  const minY = -PAD_T;
  const maxY = bounds.size + PAD_B - boxH;
  const tx = q(Math.max(minX, Math.min(maxX, vx + offsetX)));
  const ty = q(Math.max(minY, Math.min(maxY, vy + offsetY)));

  const setupLine = `${Math.round(dim.score)}%  (raw ${dim.rawScore}/${dim.rawTarget})`;
  const execLineText = hasExecution
    ? `${Math.round(dim.executionScore ?? 0)}%${
        dim.executionRawScore != null ? `  (raw ${dim.executionRawScore})` : ""
      }`
    : "unmeasured (1)";

  return (
    <g className="radar-tooltip" pointerEvents="none">
      <rect
        x={tx}
        y={ty}
        width={TT_W}
        height={boxH}
        rx={6}
        ry={6}
        fill="var(--color-bg, #0b0d10)"
        fillOpacity={0.94}
        stroke="var(--color-line)"
        strokeWidth={1}
      />
      <text
        x={tx + TT_PAD_X}
        y={ty + TT_PAD_Y + 11}
        fontSize={12}
        fontWeight={600}
        fill="var(--color-fg, #e5e7eb)"
      >
        {dim.title.split(" — ")[0].trim()}
      </text>
      <line
        x1={tx + TT_PAD_X}
        y1={ty + TT_PAD_Y + 18}
        x2={tx + TT_W - TT_PAD_X}
        y2={ty + TT_PAD_Y + 18}
        stroke="var(--color-line)"
        strokeOpacity={0.5}
        strokeWidth={1}
      />
      <text
        x={tx + TT_PAD_X}
        y={ty + TT_PAD_Y + 18 + TT_LINE_H}
        fontSize={11}
        fill="var(--color-good)"
      >
        <tspan fontWeight={600}>Setup</tspan>
        <tspan dx={8} fill="var(--color-fg, #e5e7eb)">
          {setupLine}
        </tspan>
      </text>
      {showExecution && (
        <text
          x={tx + TT_PAD_X}
          y={ty + TT_PAD_Y + 18 + TT_LINE_H * 2}
          fontSize={11}
          fill={hasExecution ? "var(--color-warn)" : "var(--color-mute)"}
          fontStyle={hasExecution ? undefined : "italic"}
        >
          <tspan fontWeight={600}>Execution</tspan>
          <tspan dx={8} fill="var(--color-fg, #e5e7eb)">
            {execLineText}
          </tspan>
        </text>
      )}
      <text
        x={tx + TT_PAD_X}
        y={ty + boxH - TT_PAD_Y - 2}
        fontSize={10}
        fill="var(--color-mute)"
        fontStyle="italic"
      >
        weight ×{dim.weight} • click to drill in
      </text>
    </g>
  );
}
