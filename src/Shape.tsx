import { useMemo, useRef, useState, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import { IconPencil } from "@tabler/icons-react";
import type { Dataset, Mark, Run } from "../shared/contracts.ts";
import { bandWorlds, binnedCheck, functionBand, shapeArgs, type BandPoint, type CheckBin } from "../shared/shape.ts";
import type { Compiled } from "../shared/sim.ts";
import { fmt, groupName } from "./format.ts";
import { strokePath } from "./WorldPlot.tsx";

type Props = { compiled: Compiled; run: Run | null; dataset: Dataset | null; marks: Mark[]; onMark: (m: Mark) => void };

// Shape Lens: the model's function for one argument of the observation, a place to draw
// the shape the person believes, and a posterior predictive check that says what the data can tell.
export function Shape({ compiled, run, dataset, marks, onMark }: Props) {
  const args = shapeArgs(compiled);
  const [arg, setArg] = useState(args.find((a) => a.stat === "sd")?.arg ?? args[0]?.arg);
  const groupCol = compiled.spec.view.group;
  const groups = useMemo(() => {
    if (!groupCol) return [];
    const plate = compiled.data.find((d) => d.name === groupCol)?.indexOf;
    const size = plate ? (dataset?.plates[plate] ?? compiled.sizes[plate]) : 0;
    return Array.from({ length: size }, (_, g) => g);
  }, [compiled, groupCol, dataset]);
  const [group, setGroup] = useState<number | null>(null);
  const worlds = useMemo(() => bandWorlds(compiled, run, dataset, 160), [compiled, run, dataset]);
  const band = useMemo(() => (arg ? functionBand(compiled, worlds, arg, group) : []), [compiled, worlds, arg, group]);
  const spec = args.find((a) => a.arg === arg);
  const check = useMemo(
    () => (run && dataset && spec ? binnedCheck(compiled, run, dataset, spec.stat, group, 6, 160) : null),
    [compiled, run, dataset, spec, group],
  );
  const [drawing, setDrawing] = useState(false);
  const mine = marks.filter((m): m is Extract<Mark, { kind: "shape" }> => m.kind === "shape" && m.arg === arg && m.group === group);
  const xNode = [...compiled.spec.data, ...compiled.spec.nodes].find((n) => n.name === compiled.spec.view.x);
  const xLabel = `${xNode?.label ?? "x"}${xNode?.unit ? ` [${xNode.unit}]` : ""}`;
  const groupLabel = (g: number | null) => (g === null ? "全体" : groupCol ? groupName(compiled, groupCol, g) : String(g));

  if (!arg || !spec) return <p className="empty-note">観測ノードに分布の引数がないので、形を見られません。</p>;

  return (
    <section className="shape" aria-label="形のレンズ">
      <header className="lens-head">
        <h2>形を見る</h2>
        <p className="muted small">
          観測「{compiled.spec.nodes.find((n) => n.name === compiled.spec.view.y)?.label}」の{spec.label}が、{xNode?.label ?? "x"}に沿ってどんな形かを見ます。
          {run ? "上はモデルが事後に考えている形、下はデータの側からの手がかりです。" : "prior の世界でモデルが考えている形です。"}
        </p>
      </header>
      <div className="shape-controls">
        <div className="segmented" role="group" aria-label="見る量">
          {args.map((a) => (
            <button key={a.arg} className={`btn ${a.arg === arg ? "is-on" : ""}`} aria-pressed={a.arg === arg} onClick={() => setArg(a.arg)}>
              {a.label} <span className="mono muted">{a.arg}</span>
            </button>
          ))}
        </div>
        {groups.length > 0 && (
          <div className="segmented" role="group" aria-label="群">
            {[null, ...groups].map((g) => (
              <button key={String(g)} className={`btn ${g === group ? "is-on" : ""}`} aria-pressed={g === group} onClick={() => setGroup(g)}>
                {groupLabel(g)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shape-panel">
        <div className="shape-panel-head">
          <h3 className="section-title">モデルが考える{spec.label}の形 · {groupLabel(group)}</h3>
          <button className={`btn ${drawing ? "is-on" : ""}`} aria-pressed={drawing} onClick={() => setDrawing(!drawing)}>
            <IconPencil size={16} /> 信じる形をなぞる
          </button>
        </div>
        <BandPlot band={band} sketches={mine} drawing={drawing} xLabel={xLabel} yLabel={spec.label} onSketch={(points) => onMark({ kind: "shape", arg, group, points })} />
        <p className="muted small">
          濃い帯は 50%、薄い帯は 90%（{run ? "事後" : "prior"}の draw {worlds.length} 個）。なぞった線は「こうだと思う形」としてメモに入り、データにはなりません。
        </p>
      </div>

      {check && (
        <div className="shape-panel">
          <h3 className="section-title">データの側から：区間ごとの{spec.stat === "sd" ? "ばらつき（区間内の直線からのずれ）" : "平均"}</h3>
          <CheckPlot bins={check} onPoint={(b) => onMark({ kind: "bin", arg, group, from: round(b.lo), to: round(b.hi) })} marks={marks} arg={arg} group={group} />
          <p className="muted small">
            縦棒は新しい個体での複製の 90%、点がデータ。区間あたりの点が少ないと棒は長くなり、データは形をあまり語れません。区間が {check.length} 個あれば、問題がなくても 1 つくらいは外れます。外れた区間を押すとメモに入ります。
          </p>
        </div>
      )}
    </section>
  );
}

function round(v: number) {
  return Number(v.toPrecision(4));
}

function BandPlot({
  band,
  sketches,
  drawing,
  xLabel,
  yLabel,
  onSketch,
}: {
  band: BandPoint[];
  sketches: Extract<Mark, { kind: "shape" }>[];
  drawing: boolean;
  xLabel: string;
  yLabel: string;
  onSketch: (points: [number, number][]) => void;
}) {
  const W = 760;
  const H = 280;
  const m = { top: 12, right: 16, bottom: 32, left: 56 };
  const ref = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const xs = band.map((b) => b.x);
  const hiY = Math.max(...band.map((b) => b.q[4]), ...sketches.flatMap((s) => s.points.map((p) => p[1])), 1e-9);
  const loY = Math.min(0, ...band.map((b) => b.q[0]));
  const x = scaleLinear().domain([Math.min(...xs), Math.max(...xs)]).range([m.left, W - m.right]);
  const y = scaleLinear().domain([loY, hiY * 1.15]).nice().range([H - m.bottom, m.top]);
  const a90 = area<BandPoint>().x((d) => x(d.x)).y0((d) => y(d.q[0])).y1((d) => y(d.q[4]));
  const a50 = area<BandPoint>().x((d) => x(d.x)).y0((d) => y(d.q[1])).y1((d) => y(d.q[3]));
  const med = line<BandPoint>().x((d) => x(d.x)).y((d) => y(d.q[2]));
  const local = (e: PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  if (!band.length) return <p className="empty-note">この群には記録がありません。</p>;
  return (
    <svg
      ref={ref}
      className={`plot ${drawing ? "plot-sketch" : ""}`}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={`${yLabel} のモデル上の形`}
      onPointerDown={(e) => {
        if (!drawing) return;
        (e.target as Element).setPointerCapture(e.pointerId);
        setDraft([local(e)]);
      }}
      onPointerMove={(e) => {
        if (!draft) return;
        const p = local(e);
        const last = draft[draft.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 3) setDraft([...draft, p]);
      }}
      onPointerUp={() => {
        if (!draft) return;
        setDraft(null);
        if (draft.length < 2) return;
        const step = Math.max(1, Math.ceil(draft.length / 400));
        onSketch(draft.filter((_, i) => i % step === 0).map(([px, py]) => [round(x.invert(px)), round(y.invert(py))]));
      }}
      onPointerCancel={() => setDraft(null)}
    >
      {y.ticks(5).map((t) => (
        <g key={t}>
          <line className="grid" x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />
          <text className="tick" x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      {x.ticks(6).map((t) => (
        <text key={t} className="tick" x={x(t)} y={H - m.bottom + 16} textAnchor="middle">
          {t}
        </text>
      ))}
      <text className="axis-label" x={W - m.right} y={H - 4} textAnchor="end">
        {xLabel}
      </text>
      <path className="band-90" d={a90(band) ?? ""} />
      <path className="band-50" d={a50(band) ?? ""} />
      <path className="band-median-line" d={med(band) ?? ""} />
      {sketches.map((s, i) => (
        <path key={i} className="mark-sketch" d={strokePath(s.points.map(([a, b]) => [x(a), y(b)]), 7)} />
      ))}
      {draft && <path className="mark-sketch draft" d={strokePath(draft, 7)} />}
    </svg>
  );
}

function CheckPlot({ bins, onPoint, marks, arg, group }: { bins: CheckBin[]; onPoint: (b: CheckBin) => void; marks: Mark[]; arg: string; group: number | null }) {
  const W = 760;
  const H = 200;
  const m = { top: 12, right: 16, bottom: 34, left: 56 };
  const vals = bins.flatMap((b) => [b.rep[0], b.rep[2], b.data]).filter(Number.isFinite);
  const y = scaleLinear().domain([Math.min(0, ...vals), Math.max(...vals, 1) * 1.1]).nice().range([H - m.bottom, m.top]);
  const x = scaleLinear().domain([bins[0].lo, bins[bins.length - 1].hi]).range([m.left, W - m.right]);
  const marked = (b: CheckBin) => marks.some((k) => k.kind === "bin" && k.arg === arg && k.group === group && k.from === round(b.lo));
  return (
    <svg className="plot" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="区間ごとの事後予測チェック">
      {y.ticks(4).map((t) => (
        <g key={t}>
          <line className="grid" x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />
          <text className="tick" x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      {bins.map((b) => {
        const cx = (x(b.lo) + x(b.hi)) / 2;
        const out = Number.isFinite(b.p) && (b.p < 0.05 || b.p > 0.95);
        return (
          <g
            key={b.lo}
            className={`check-bin ${out ? "out" : ""} ${marked(b) ? "is-marked" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`${fmt(b.lo)}–${fmt(b.hi)}: データ ${fmt(b.data)}、複製 ${fmt(b.rep[0])}–${fmt(b.rep[2])}、${b.n} 点`}
            onClick={() => onPoint(b)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPoint(b);
              }
            }}
          >
            <rect className="check-hit" x={x(b.lo) + 2} width={x(b.hi) - x(b.lo) - 4} y={m.top} height={H - m.top - m.bottom} rx={4} />
            {Number.isFinite(b.rep[0]) && <line className="check-rep" x1={cx} x2={cx} y1={y(b.rep[0])} y2={y(b.rep[2])} />}
            {Number.isFinite(b.rep[1]) && <line className="check-rep-mid" x1={cx - 8} x2={cx + 8} y1={y(b.rep[1])} y2={y(b.rep[1])} />}
            {Number.isFinite(b.data) && <circle className="check-data" cx={cx} cy={y(b.data)} r={5} />}
            <text className="tick" x={cx} y={H - m.bottom + 14} textAnchor="middle">
              {fmt(b.lo)}–{fmt(b.hi)}
            </text>
            <text className="tick" x={cx} y={H - m.bottom + 27} textAnchor="middle">
              n={b.n}
              {out ? " · 外れ" : ""}
            </text>
          </g>
        );
      })}
      <text className="tick" x={W - m.right} y={m.top + 10} textAnchor="end">
        ● データ ｜ 複製 90%
      </text>
    </svg>
  );
}
