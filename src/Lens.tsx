import { useMemo, useState } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import { IconHandFinger } from "@tabler/icons-react";
import type { Dataset, Mark, Run } from "../shared/contracts.ts";
import { identifiability, ridgeEnds, type ParamTeaching, type Ridge } from "../shared/identify.ts";
import { datasetPoints, runInputs, simulateWorld, viewPoints, type Compiled } from "../shared/sim.ts";
import { fmt } from "./format.ts";
import { WorldPlot, sharedDomains } from "./WorldPlot.tsx";

type Props = { compiled: Compiled; run: Run; dataset: Dataset; seed: number; marks: Mark[]; onMark: (m: Mark) => void };

function verdict(p: ParamTeaching) {
  if (p.contraction < 0) return { cls: "bad", text: "prior より広い：計算か尺度を疑う" };
  if (p.contraction < 0.3) return { cls: "prior", text: "prior のまま：値は事前の知識が決めている" };
  if (p.contraction < 0.8) return { cls: "partial", text: "データが一部を絞った" };
  return { cls: "data", text: "データで決まった" };
}

// Identifiability Lens (Atlas U08): what the data taught, what moves together,
// and two worlds from opposite ends of a ridge that produce near-identical records.
export function Lens({ compiled, run, dataset, seed, marks, onMark }: Props) {
  const lens = useMemo(() => identifiability(compiled, run), [compiled, run]);
  const byName = new Map(lens.params.map((p) => [p.name, p]));
  const [open, setOpen] = useState<Ridge | null>(null);
  const weak = (r: Ridge) => Math.min(byName.get(r.a)!.contraction, byName.get(r.b)!.contraction) < 0.9;

  return (
    <section className="lens" aria-label="識別性のレンズ">
      <header className="lens-head">
        <h2>識別性のレンズ</h2>
        <p className="muted small">
          事後の draw {lens.draws} 個と、同じモデルの prior の draw から計算しています。相関や2次元の図は局所的な手がかりで、識別できる・できないことの証明ではありません。
        </p>
      </header>

      <h3 className="section-title">データが教えたこと</h3>
      <table className="teach">
        <thead>
          <tr>
            <th>量</th>
            <th>
              <span className="legend-band prior" /> prior 90% <span className="legend-band post" /> 事後 90%
            </th>
            <th>縮み</th>
          </tr>
        </thead>
        <tbody>
          {lens.params.map((p) => {
            const v = verdict(p);
            return (
              <tr key={p.name}>
                <th>
                  {p.label} <span className="mono muted">{p.name}</span>
                </th>
                <td>
                  <Band p={p} />
                </td>
                <td>
                  <span className="num">{Math.round(p.contraction * 100)}%</span> <span className={`teach-chip ${v.cls}`}>{v.text}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 className="section-title">一緒に動く組</h3>
      {lens.ridges.length === 0 ? (
        <p className="empty-note">事後の draw で強く一緒に動く組（|ρ| ≥ 0.5）はありません。</p>
      ) : (
        <div className="ridges">
          {lens.ridges.slice(0, 4).map((r) => (
            <article key={`${r.a}-${r.b}`} className={`card ridge ${open?.a === r.a && open?.b === r.b ? "is-open" : ""}`}>
              <header>
                <strong>
                  {byName.get(r.a)!.label} と {byName.get(r.b)!.label}
                </strong>
                <span className="num muted">ρ = {r.rho.toFixed(2)}</span>
              </header>
              <p className="small">
                {weak(r)
                  ? r.rho < 0
                    ? "片方が大きいと片方が小さい。データはこの二つの組み合わせしか決めていない可能性があります。"
                    : "二つが一緒に増減する。データはこの二つの比か組み合わせしか決めていない可能性があります。"
                  : "一緒に動きますが、どちらもデータで絞られています。パラメータの置き方から来る相関かもしれません（例：切片を測定範囲の中央に置く）。"}
              </p>
              <Scatter compiled={compiled} run={run} ridge={r} a={byName.get(r.a)!} b={byName.get(r.b)!} />
              <button className="btn" aria-expanded={open?.a === r.a && open?.b === r.b} onClick={() => setOpen(open?.a === r.a && open?.b === r.b ? null : r)}>
                両端の二つの世界を並べる
              </button>
            </article>
          ))}
        </div>
      )}

      {open && <TwoWorlds compiled={compiled} run={run} dataset={dataset} seed={seed} ridge={open} params={byName} marks={marks} onMark={onMark} />}
    </section>
  );
}

function axis(p: ParamTeaching, lo: number, hi: number, range: [number, number]) {
  return p.logScale && lo > 0 ? scaleLog().domain([lo, hi]).range(range).clamp(true) : scaleLinear().domain([lo, hi]).range(range).clamp(true);
}

function Band({ p }: { p: ParamTeaching }) {
  const W = 260;
  const lo = Math.min(p.prior[0], p.posterior[0]);
  const hi = Math.max(p.prior[2], p.posterior[2]);
  const x = axis(p, p.logScale ? Math.max(lo, hi * 1e-4) : lo, hi, [6, W - 6]);
  return (
    <svg className="band" viewBox={`0 0 ${W} 26`} width={W} height={26} role="img" aria-label={`prior ${fmt(p.prior[0])}–${fmt(p.prior[2])}、事後 ${fmt(p.posterior[0])}–${fmt(p.posterior[2])}`}>
      <rect className="band-prior" x={x(p.prior[0])} width={Math.max(1, x(p.prior[2]) - x(p.prior[0]))} y={4} height={8} rx={3} />
      <rect className="band-post" x={x(p.posterior[0])} width={Math.max(2, x(p.posterior[2]) - x(p.posterior[0]))} y={14} height={8} rx={3} />
      <line className="band-median" x1={x(p.posterior[1])} x2={x(p.posterior[1])} y1={12} y2={24} />
      <title>{`prior 90%: ${fmt(p.prior[0])}–${fmt(p.prior[2])} / 事後 90%: ${fmt(p.posterior[0])}–${fmt(p.posterior[2])}${p.logScale ? "（対数軸）" : ""}`}</title>
    </svg>
  );
}

function Scatter({ compiled, run, ridge, a, b }: { compiled: Compiled; run: Run; ridge: Ridge; a: ParamTeaching; b: ParamTeaching }) {
  const W = 260;
  const H = 170;
  const pa = run.draws[ridge.a].map((r) => r[0]);
  const pb = run.draws[ridge.b].map((r) => r[0]);
  const prior = useMemo(
    () => Array.from({ length: 300 }, (_, i) => simulateWorld(compiled, 7_331, i)).map((w) => [w.values[ridge.a][0], w.values[ridge.b][0]] as const),
    [compiled, ridge.a, ridge.b],
  );
  const ends = ridgeEnds(run, ridge.a, ridge.b, ridge.rho);
  // Frame on the posterior, with the prior shown as faint context around it.
  const span = (xs: number[], p: ParamTeaching) => {
    const s = [...xs].sort((u, v) => u - v);
    const lo = s[Math.floor(s.length * 0.005)];
    const hi = s[Math.ceil(s.length * 0.995) - 1];
    const pad = p.logScale ? 1.6 : (hi - lo) * 0.5 || 1;
    return p.logScale ? [Math.max(lo / pad, 1e-6), hi * pad] : [lo - pad, hi + pad];
  };
  const [xa0, xa1] = span(pa, a);
  const [yb0, yb1] = span(pb, b);
  const x = axis(a, xa0, xa1, [30, W - 6]);
  const y = axis(b, yb0, yb1, [H - 22, 6]);
  return (
    <svg className="scatter" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${a.label} と ${b.label} の事後 draw の散布図`}>
      {prior.map(([u, v], i) => (
        <circle key={`p${i}`} className="sc-prior" cx={x(u)} cy={y(v)} r={1.6} />
      ))}
      {pa.map((u, i) => (
        <circle key={i} className="sc-post" cx={x(u)} cy={y(pb[i])} r={1.8} />
      ))}
      {ends.map((k, i) => (
        <g key={`e${i}`}>
          <circle className="sc-end" cx={x(pa[k])} cy={y(pb[k])} r={5} />
          <text className="sc-end-label" x={x(pa[k]) + 7} y={y(pb[k]) - 6}>
            {i === 0 ? "α" : "β"}
          </text>
        </g>
      ))}
      <text className="tick" x={W - 6} y={H - 6} textAnchor="end">
        {a.name}
        {a.logScale ? "（対数）" : ""}
      </text>
      <text className="tick" x={32} y={12}>
        {b.name}
        {b.logScale ? "（対数）" : ""}
      </text>
    </svg>
  );
}

function TwoWorlds(p: {
  compiled: Compiled;
  run: Run;
  dataset: Dataset;
  seed: number;
  ridge: Ridge;
  params: Map<string, ParamTeaching>;
  marks: Mark[];
  onMark: (m: Mark) => void;
}) {
  const { compiled, run, dataset, seed, ridge } = p;
  const ends = ridgeEnds(run, ridge.a, ridge.b, ridge.rho);
  const worlds = ends.map((k) => simulateWorld(compiled, seed, k, runInputs(compiled, run, dataset, k)));
  const points = worlds.map((w) => viewPoints(compiled, w));
  const data = datasetPoints(compiled, dataset, worlds[0]);
  const domains = sharedDomains(points, data);
  const y = compiled.spec.view.y;
  const stats = (xs: number[]) => {
    const m = xs.reduce((s, v) => s + v, 0) / xs.length;
    return [m, Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1))];
  };
  const dataStats = stats(dataset.columns[y]);
  const marked = p.marks.some((m) => m.kind === "ridge" && m.a === ridge.a && m.b === ridge.b);
  const a = p.params.get(ridge.a)!;
  const b = p.params.get(ridge.b)!;
  const yLabel = compiled.spec.nodes.find((n) => n.name === y)?.label ?? y;

  return (
    <section className="two-worlds" aria-label="同じ観測を作る二つの世界">
      <h3 className="section-title">同じ観測を作る二つの世界</h3>
      <p className="small muted">
        尾根の両端にある事後の draw です。中身は違っても、記録の見た目がほとんど同じなら、データだけではこの二つを見分けられません。見分けるには、別の測定か、事前の知識が要ります。
      </p>
      <div className="two-worlds-grid">
        {worlds.map((w, i) => (
          <figure key={w.index}>
            <figcaption>
              <strong>{i === 0 ? "α" : "β"}</strong> <span className="muted">draw {w.index}</span>
            </figcaption>
            <WorldPlot points={[points[i]]} data={data} domains={domains} width={380} height={190} />
          </figure>
        ))}
      </div>
      <table className="compare">
        <thead>
          <tr>
            <th />
            <th>α</th>
            <th>β</th>
            <th>データ</th>
          </tr>
        </thead>
        <tbody>
          {[a, b].map((q) => (
            <tr key={q.name}>
              <th>
                {q.label} <span className="mono muted">{q.name}</span>
              </th>
              {worlds.map((w) => (
                <td key={w.index} className="num">
                  {fmt(w.values[q.name][0])}
                </td>
              ))}
              <td className="muted">観測されない</td>
            </tr>
          ))}
          <tr>
            <th>{yLabel} の平均 / 標準偏差</th>
            {worlds.map((w) => {
              const [m, s] = stats(w.values[y]);
              return (
                <td key={w.index} className="num">
                  {fmt(m)} / {fmt(s)}
                </td>
              );
            })}
            <td className="num">
              {fmt(dataStats[0])} / {fmt(dataStats[1])}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="row-actions">
        <button
          className={`btn ${marked ? "is-on" : ""}`}
          aria-pressed={marked}
          onClick={() => p.onMark({ kind: "ridge", a: ridge.a, b: ridge.b, worlds: [ends[0], ends[1]] })}
        >
          <IconHandFinger size={16} /> この組を指す
        </button>
        <span className="muted small">右のメモに、どちらが現実に近いか・何を知っているかを添えて渡します。</span>
      </div>
    </section>
  );
}
