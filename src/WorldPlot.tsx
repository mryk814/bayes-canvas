import { useMemo, useRef, useState, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { quantile } from "d3-array";
import { getStroke } from "perfect-freehand";
import type { Mark, ModelSpec } from "../shared/contracts.ts";
import type { World } from "../shared/sim.ts";

export type Tool = "look" | "sketch" | "range";

export function sharedYDomain(worlds: World[]): [number, number] {
  const ys = worlds.filter((w) => !w.broken).flatMap((w) => w.obs.map((o) => o[1]));
  if (!ys.length) return [0, 1];
  ys.sort((a, b) => a - b);
  const lo = quantile(ys, 0.02)!;
  const hi = quantile(ys, 0.98)!;
  const pad = (hi - lo) * 0.08 || 1;
  return scaleLinear().domain([lo - pad, hi + pad]).nice().domain() as [number, number];
}

function strokePath(points: [number, number][], size: number) {
  const outline = getStroke(points, { size, thinning: 0.55, smoothing: 0.6, streamline: 0.45, simulatePressure: true });
  if (!outline.length) return "";
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...outline[0], "Q"] as (string | number)[],
  );
  return d.join(" ") + " Z";
}

type Props = {
  spec: ModelSpec;
  worlds: World[];
  yDomain: [number, number];
  width: number;
  height: number;
  detailed?: boolean;
  overlay?: boolean;
  marks?: Mark[];
  tool?: Tool;
  onMark?: (m: Mark) => void;
  worldIndex?: number | null;
  showObs?: boolean;
};

export function WorldPlot({
  spec,
  worlds,
  yDomain,
  width,
  height,
  detailed = false,
  overlay = false,
  marks = [],
  tool = "look",
  onMark,
  worldIndex = null,
  showObs = true,
}: Props) {
  const m = detailed ? { top: 14, right: 16, bottom: 34, left: 56 } : { top: 6, right: 6, bottom: 6, left: 6 };
  const x = useMemo(() => scaleLinear().domain([spec.x.min, spec.x.max]).range([m.left, width - m.right]), [spec, width, m.left, m.right]);
  const y = useMemo(() => scaleLinear().domain(yDomain).range([height - m.bottom, m.top]), [yDomain, height, m.bottom, m.top]);
  const path = line<[number, number]>()
    .x((d) => x(d[0]))
    .y((d) => y(Math.max(Math.min(d[1], yDomain[1] * 4), yDomain[0] * 4)));
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const clipId = useMemo(() => `clip-${Math.random().toString(36).slice(2)}`, []);

  const toLocal = (e: PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height];
  };

  const onDown = (e: PointerEvent) => {
    if (tool === "look" || !onMark) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    setDraft([toLocal(e)]);
  };
  const onMove = (e: PointerEvent) => {
    if (!draft) return;
    const p = toLocal(e);
    const last = draft[draft.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 3) setDraft([...draft, p]);
  };
  const onUp = () => {
    if (!draft || !onMark) return;
    setDraft(null);
    if (tool === "sketch" && draft.length >= 2) {
      const step = Math.max(1, Math.ceil(draft.length / 400));
      const points = draft
        .filter((_, i) => i % step === 0)
        .map(([px, py]) => [round(x.invert(px)), round(y.invert(py))] as [number, number]);
      onMark({ kind: "sketch", world: worldIndex, points });
    }
    if (tool === "range") {
      const xs = draft.map((p) => x.invert(p[0]));
      const from = Math.max(spec.x.min, Math.min(...xs));
      const to = Math.min(spec.x.max, Math.max(...xs));
      if (to - from > (spec.x.max - spec.x.min) / 100) onMark({ kind: "range", world: worldIndex, from: round(from), to: round(to) });
    }
  };

  const above = worlds.reduce((n, w) => n + w.obs.filter((o) => o[1] > yDomain[1]).length, 0);
  const below = worlds.reduce((n, w) => n + w.obs.filter((o) => o[1] < yDomain[0]).length, 0);
  const zeroVisible = yDomain[0] < 0 && yDomain[1] > 0;
  const draftRange = tool === "range" && draft ? [Math.min(...draft.map((p) => p[0])), Math.max(...draft.map((p) => p[0]))] : null;

  return (
    <svg
      ref={svgRef}
      className={`plot plot-${tool}`}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={overlay ? `${worlds.length} 世界の重ね表示` : `世界 ${worlds[0]?.index ?? ""}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDraft(null)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={m.left} y={m.top} width={width - m.left - m.right} height={height - m.top - m.bottom} />
        </clipPath>
      </defs>
      <rect className="plot-bg" x={m.left} y={m.top} width={width - m.left - m.right} height={height - m.top - m.bottom} />
      {detailed &&
        y.ticks(5).map((t) => (
          <g key={`y${t}`}>
            <line className="grid" x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} />
            <text className="tick" x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
      {detailed &&
        x.ticks(6).map((t) => (
          <text key={`x${t}`} className="tick" x={x(t)} y={height - m.bottom + 16} textAnchor="middle">
            {t}
          </text>
        ))}
      {detailed && (
        <>
          <text className="axis-label" x={width - m.right} y={height - 4} textAnchor="end">
            {spec.x.label} {spec.x.unit && `[${spec.x.unit}]`}
          </text>
          <text className="axis-label" x={m.left + 4} y={m.top + 12}>
            {spec.y.label} {spec.y.unit && `[${spec.y.unit}]`}
          </text>
        </>
      )}
      {zeroVisible && <line className="zero" x1={m.left} x2={width - m.right} y1={y(0)} y2={y(0)} />}

      <g clipPath={`url(#${clipId})`}>
        {marks
          .filter((k) => k.kind === "range")
          .map((k, i) => (
            <rect key={`r${i}`} className="mark-range" x={x(k.from)} width={x(k.to) - x(k.from)} y={m.top} height={height - m.top - m.bottom} />
          ))}
        {draftRange && <rect className="mark-range draft" x={draftRange[0]} width={draftRange[1] - draftRange[0]} y={m.top} height={height - m.top - m.bottom} />}
        {worlds.map((w) => (
          <g key={w.index} className={overlay ? "world overlaid" : "world"}>
            <path className="curve" d={path(w.curve) ?? ""} />
            {showObs &&
              !overlay &&
              w.obs.map(([ox, oy], i) => <circle key={i} className="obs" cx={x(ox)} cy={y(oy)} r={detailed ? 3.2 : 1.9} />)}
          </g>
        ))}
        {marks
          .filter((k) => k.kind === "sketch")
          .map((k, i) => (
            <path key={`s${i}`} className="mark-sketch" d={strokePath(k.points.map(([a, b]) => [x(a), y(b)]), detailed ? 7 : 4)} />
          ))}
        {tool === "sketch" && draft && <path className="mark-sketch draft" d={strokePath(draft, detailed ? 7 : 4)} />}
      </g>
      {above > 0 && (
        <text className="clipped" x={width - m.right - 4} y={m.top + 10} textAnchor="end">
          ▲{above}
        </text>
      )}
      {below > 0 && (
        <text className="clipped" x={width - m.right - 4} y={height - m.bottom - 4} textAnchor="end">
          ▼{below}
        </text>
      )}
    </svg>
  );
}

function round(v: number) {
  return Number(v.toPrecision(4));
}
