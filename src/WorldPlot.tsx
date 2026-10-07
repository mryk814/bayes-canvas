import { useMemo, useRef, useState, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { quantile } from "d3-array";
import { getStroke } from "perfect-freehand";
import type { Mark } from "../shared/contracts.ts";
import type { ViewPoint } from "../shared/sim.ts";

export type Tool = "look" | "sketch" | "range";
export type Domains = { x: [number, number]; y: [number, number] };
export type DataPoint = { unit: number; x: number; y: number; group: number | null; censored: boolean };

export function sharedDomains(sets: ViewPoint[][], data: DataPoint[] = []): Domains {
  const pts = [...sets.flat(), ...data].filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return { x: [0, 1], y: [0, 1] };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y).concat(sets.flat().map((p) => p.line ?? NaN).filter(Number.isFinite));
  ys.sort((a, b) => a - b);
  const lo = quantile(ys, 0.02)!;
  const hi = quantile(ys, 0.98)!;
  const pad = (hi - lo) * 0.08 || 1;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const xpad = (x1 - x0) * 0.03 || 1;
  return {
    x: [x0 - xpad, x1 + xpad],
    y: scaleLinear().domain([lo - pad, hi + pad]).nice().domain() as [number, number],
  };
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

// Group identity is carried by shape as well as color, so it survives without color.
function Glyph({ x, y, r, group, className }: { x: number; y: number; r: number; group: number | null; className: string }) {
  const g = group === null ? 0 : group % 4;
  const cls = `${className} g${group === null ? "n" : g}`;
  if (g === 1) return <rect className={cls} x={x - r * 0.9} y={y - r * 0.9} width={r * 1.8} height={r * 1.8} />;
  if (g === 2) return <path className={cls} d={`M${x},${y - r * 1.2} L${x + r * 1.2},${y} L${x},${y + r * 1.2} L${x - r * 1.2},${y} Z`} />;
  if (g === 3) return <path className={cls} d={`M${x - r},${y - r} L${x + r},${y + r} M${x + r},${y - r} L${x - r},${y + r}`} />;
  return <circle className={cls} cx={x} cy={y} r={r} />;
}

type Props = {
  points: ViewPoint[][];
  data?: DataPoint[];
  domains: Domains;
  width: number;
  height: number;
  labels?: { x: string; y: string };
  detailed?: boolean;
  overlay?: boolean;
  marks?: Mark[];
  tool?: Tool;
  onMark?: (m: Mark) => void;
  onOpenPoint?: (unit: number) => void;
  openedUnit?: number | null;
  worldIndex?: number | null;
  showObs?: boolean;
};

export function WorldPlot({
  points,
  data = [],
  domains,
  width,
  height,
  labels,
  detailed = false,
  overlay = false,
  marks = [],
  tool = "look",
  onMark,
  onOpenPoint,
  openedUnit = null,
  worldIndex = null,
  showObs = true,
}: Props) {
  const m = detailed ? { top: 14, right: 16, bottom: 34, left: 56 } : { top: 6, right: 6, bottom: 6, left: 6 };
  const x = useMemo(() => scaleLinear().domain(domains.x).range([m.left, width - m.right]), [domains, width, m.left, m.right]);
  const y = useMemo(() => scaleLinear().domain(domains.y).range([height - m.bottom, m.top]), [domains, height, m.bottom, m.top]);
  const clampY = (v: number) => Math.max(Math.min(v, domains.y[1] + (domains.y[1] - domains.y[0]) * 3), domains.y[0] - (domains.y[1] - domains.y[0]) * 3);
  const path = line<[number, number]>()
    .x((d) => x(d[0]))
    .y((d) => y(clampY(d[1])));
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const clipId = useMemo(() => `clip-${Math.random().toString(36).slice(2)}`, []);
  const r = detailed ? 3.4 : 1.9;

  const toLocal = (e: PointerEvent): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * width, ((e.clientY - rect.top) / rect.height) * height];
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
      const pts = draft.filter((_, i) => i % step === 0).map(([px, py]) => [round(x.invert(px)), round(y.invert(py))] as [number, number]);
      onMark({ kind: "sketch", world: worldIndex, points: pts });
    }
    if (tool === "range") {
      const xs = draft.map((p) => x.invert(p[0]));
      const from = Math.max(domains.x[0], Math.min(...xs));
      const to = Math.min(domains.x[1], Math.max(...xs));
      if (to - from > (domains.x[1] - domains.x[0]) / 100) onMark({ kind: "range", world: worldIndex, from: round(from), to: round(to) });
    }
  };

  const all = points.flat();
  const above = all.filter((p) => p.y > domains.y[1]).length;
  const below = all.filter((p) => p.y < domains.y[0]).length;
  const zeroVisible = domains.y[0] < 0 && domains.y[1] > 0;
  const draftRange = tool === "range" && draft ? [Math.min(...draft.map((p) => p[0])), Math.max(...draft.map((p) => p[0]))] : null;
  const pickable = detailed && tool === "look" && !!onOpenPoint && !overlay;

  return (
    <svg
      ref={svgRef}
      className={`plot plot-${tool}`}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={overlay ? `${points.length} 世界の重ね表示` : "世界の図"}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDraft(null)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={m.left} y={m.top - 4} width={width - m.left - m.right} height={height - m.top - m.bottom + 8} />
        </clipPath>
      </defs>
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
      {detailed && labels && (
        <>
          <text className="axis-label" x={width - m.right} y={height - 4} textAnchor="end">
            {labels.x}
          </text>
          <text className="axis-label" x={m.left + 4} y={m.top + 12}>
            {labels.y}
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
        {points.map((pts, wi) => {
          const withLine = pts.filter((p) => p.line !== null).sort((a, b) => a.x - b.x);
          return (
            <g key={wi} className={overlay ? "world overlaid" : "world"}>
              {withLine.length > 1 && <path className="curve" d={path(withLine.map((p) => [p.x, p.line!])) ?? ""} />}
              {showObs &&
                !(overlay && withLine.length > 1) &&
                pts.map((p) =>
                  p.censored ? (
                    <path key={p.unit} className={`censored g${p.group ?? "n"}`} d={`M${x(p.x)},${y(clampY(p.y)) - r * 1.6} l${r * 1.4},${r * 2.4} l${-r * 2.8},0 Z`} />
                  ) : (
                    <Glyph key={p.unit} x={x(p.x)} y={y(clampY(p.y))} r={overlay ? r * 0.7 : r} group={p.group} className={overlay ? "obs faint" : "obs"} />
                  ),
                )}
            </g>
          );
        })}
        {data.map((p) =>
          p.censored ? (
            <path key={`d${p.unit}`} className="data censored-data" d={`M${x(p.x)},${y(p.y) - r * 1.8} l${r * 1.6},${r * 2.7} l${-r * 3.2},0 Z`} />
          ) : (
            <Glyph key={`d${p.unit}`} x={x(p.x)} y={y(clampY(p.y))} r={r * 1.15} group={p.group} className="data" />
          ),
        )}
        {openedUnit !== null &&
          (() => {
            const p = points[0]?.find((q) => q.unit === openedUnit);
            const d = data.find((q) => q.unit === openedUnit);
            const at = d ?? p;
            return at ? <circle className="opened-ring" cx={x(at.x)} cy={y(clampY(at.y))} r={r * 3} /> : null;
          })()}
        {pickable &&
          (data.length ? data : points[0] ?? []).map((p) => (
            <circle
              key={`hit${p.unit}`}
              className="hit"
              cx={x(p.x)}
              cy={y(clampY(p.y))}
              r={9}
              tabIndex={0}
              role="button"
              aria-label={`点 ${p.unit} を開く`}
              onClick={() => onOpenPoint!(p.unit)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenPoint!(p.unit);
                }
              }}
            />
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
