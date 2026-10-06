import { useMemo } from 'react';
import type { JsonPatchOperation } from '../lib/core/diagnostics';
import type { ModelDocument, RandomVariableEntity } from '../lib/core/model';
import { funnelGeometry, pairGeometry, type Cloud, type FunnelGeometry, type FunnelSpec } from './geometry';
import type { PriorSimulation } from './priorSim';
import type { ScoreRow } from './scoreModel';

const W = 300;
const H = 168;
const P = { l: 34, r: 8, t: 8, b: 26 };

function quantile(sorted: number[], p: number) {
  return sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
}

function fmt(value: number) {
  const abs = Math.abs(value);
  return abs >= 10 ? value.toFixed(0) : abs >= 1 ? value.toFixed(1) : value.toFixed(2);
}

export function Scatter({ cloud, emphasis = 'normal', caption, step = false }: { cloud: Cloud; emphasis?: 'normal' | 'quiet' | 'strong'; caption?: string; step?: boolean }) {
  const view = useMemo(() => {
    const xsSorted = [...cloud.xs].sort((a, b) => a - b);
    const ysSorted = [...cloud.ys].sort((a, b) => a - b);
    const x0 = quantile(xsSorted, 0.005);
    const x1 = quantile(xsSorted, 0.995) || x0 + 1;
    const y0 = quantile(ysSorted, 0.01);
    const y1 = quantile(ysSorted, 0.99) || y0 + 1;
    const sx = (x: number) => P.l + ((x - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
    const sy = (y: number) => H - P.b - ((y - y0) / (y1 - y0 || 1)) * (H - P.t - P.b);
    const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const points: string[] = [];
    let clipped = 0;
    cloud.xs.forEach((x, index) => {
      const y = cloud.ys[index]!;
      if (!inside(x, y)) {
        clipped += 1;
        return;
      }
      points.push(`M${sx(x).toFixed(1)},${sy(y).toFixed(1)}h0.01`);
    });
    const clamp = (y: number) => Math.min(H - P.b, Math.max(P.t, sy(y)));
    const hi = cloud.envelope.map((bin, index) => `${index ? 'L' : 'M'}${sx(bin.x).toFixed(1)},${clamp(bin.hi).toFixed(1)}`).join('');
    const lo = cloud.envelope.map((bin, index) => `${index ? 'L' : 'M'}${sx(bin.x).toFixed(1)},${clamp(bin.lo).toFixed(1)}`).join('');
    // One step sized for the large-scale end, drawn again at the small-scale end (same x in both panels).
    let steps: Array<{ x: number; y1: number; y2: number; over: boolean; label: string }> = [];
    if (step && cloud.envelope.length > 2) {
      const mouth = cloud.envelope[cloud.envelope.length - 1]!;
      const neck = cloud.envelope[0]!;
      const length = (mouth.hi - mouth.lo) / 4;
      steps = [mouth, neck].map((bin, index) => {
        const center = (bin.hi + bin.lo) / 2;
        return {
          x: sx(bin.x),
          y1: clamp(center + length / 2),
          y2: clamp(center - length / 2),
          over: length > bin.hi - bin.lo,
          label: index === 0 ? '大' : '小',
        };
      });
    }
    return { points: points.join(''), hi, lo, x0, x1, y0, y1, clipped, zero: y0 < 0 && y1 > 0 ? sy(0) : null, steps };
  }, [cloud, step]);

  return (
    <figure className={`scatter scatter-${emphasis}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${cloud.xLabel} と ${cloud.yLabel} の事前の同時分布`}>
        {view.zero !== null && <line className="plot-zero" x1={P.l} x2={W - P.r} y1={view.zero} y2={view.zero} />}
        <path className="scatter-points" d={view.points} />
        <path className="scatter-envelope" d={view.hi} />
        <path className="scatter-envelope" d={view.lo} />
        {view.steps.map((item) => (
          <g key={item.label} className={`step${item.over ? ' is-over' : ''}`}>
            <line x1={item.x} x2={item.x} y1={item.y1} y2={item.y2} />
            <line x1={item.x - 4} x2={item.x + 4} y1={item.y1} y2={item.y1} />
            <line x1={item.x - 4} x2={item.x + 4} y1={item.y2} y2={item.y2} />
            <text x={item.x + 6} y={item.y1 + 4}>{item.label}</text>
          </g>
        ))}
        <line className="plot-axis" x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} />
        <line className="plot-axis" x1={P.l} x2={P.l} y1={P.t} y2={H - P.b} />
        <text className="plot-tick" x={P.l} y={H - P.b + 11}>{fmt(view.x0)}</text>
        <text className="plot-tick" x={W - P.r} y={H - P.b + 11} textAnchor="end">{fmt(view.x1)}</text>
        <text className="scatter-label" x={(P.l + W - P.r) / 2} y={H - 3} textAnchor="middle">{cloud.xLabel}</text>
        <text className="plot-tick" x={P.l - 4} y={P.t + 6} textAnchor="end">{fmt(view.y1)}</text>
        <text className="plot-tick" x={P.l - 4} y={H - P.b} textAnchor="end">{fmt(view.y0)}</text>
        <text className="scatter-label" transform={`translate(10 ${(P.t + H - P.b) / 2}) rotate(-90)`} textAnchor="middle">{cloud.yLabel}</text>
      </svg>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/* ------------------------------------------------------------------ */

export function GeometryStrip({ row, document, sim, funnels, onEdit }: {
  row: ScoreRow;
  document: ModelDocument;
  sim: PriorSimulation;
  funnels: FunnelSpec[];
  onEdit: (label: string, operations: JsonPatchOperation[]) => void;
}) {
  const funnel = useMemo(() => {
    const spec = funnels.find((item) => item.childId === row.id || item.scaleId === row.id);
    return spec ? funnelGeometry(spec, sim, document) : null;
  }, [funnels, row.id, sim, document]);
  const pairs = useMemo(() => (funnel ? [] : pairGeometry(row, sim, document)), [funnel, row, sim, document]);

  if (funnel) return <Funnel geometry={funnel} document={document} onEdit={onEdit} />;
  if (!pairs.length) return null;
  return (
    <section className="geometry">
      <header className="geometry-head">
        <h3>依存の形</h3>
        <span className="geometry-note">事前分布からの同時 draw。帯は ±2 sd</span>
      </header>
      <div className="geometry-plots">
        {pairs.map((pair) => (
          <Scatter
            key={pair.parentId}
            cloud={pair.cloud}
            caption={`r = ${pair.correlation.toFixed(2)}${Math.abs(pair.correlation) < 0.1 ? '（相関がなくても、幅が変われば独立ではない）' : ''}`}
          />
        ))}
      </div>
    </section>
  );
}

function Funnel({ geometry, document, onEdit }: { geometry: FunnelGeometry; document: ModelDocument; onEdit: DossierEdit }) {
  const { spec, neck } = geometry;
  const child = document.entities[spec.childId] as RandomVariableEntity;
  const scaleSymbol = document.entities[spec.scaleId]?.symbol ?? spec.scaleId;
  const severe = neck > 8;
  return (
    <section className="geometry">
      <header className="geometry-head">
        <h3>事前の幾何</h3>
        <span className="geometry-hero">
          <span className="geometry-num num">×{Number.isFinite(neck) ? neck.toFixed(neck >= 10 ? 0 : 1) : '∞'}</span>
          <span className="geometry-caption">漏斗の首の細さ（{scaleSymbol} 上位10% と 下位10% での幅の比）</span>
        </span>
      </header>
      <div className="geometry-plots">
        <Scatter
          cloud={geometry.centered}
          emphasis={spec.nonCentered ? 'quiet' : 'strong'}
          step
          caption={`centered: ${scaleSymbol} が小さいと ${child.symbol} は細い首に押し込まれる。${scaleSymbol} が大きい所に合わせた1歩（大）は、小さい所（小）では壁を越える。`}
        />
        <span className="geometry-arrow" aria-hidden="true">
          <span className="num">÷ {scaleSymbol}</span>
          <svg width="40" height="12"><path d="M2,6 H36 M31,1 L36,6 L31,11" /></svg>
        </span>
        <Scatter
          cloud={geometry.nonCentered}
          emphasis={spec.nonCentered ? 'strong' : 'normal'}
          step
          caption={`non-centered: 同じ draw を ${scaleSymbol} で割ると首が消え、大でも小でも同じ1歩が収まる。`}
        />
        <div className="geometry-verdict">
          <p>
            {severe
              ? `首の幅が ×${neck.toFixed(0)} 変わる。グループあたりのデータが少ない間は、事後分布もこの形を引き継ぐ。`
              : '首はまだ太い。データがグループを強く決めるなら centered のままでもよい。'}
          </p>
          {spec.nonCentered ? (
            <p className="geometry-state">non-centered で実装すると宣言済み。右の形が実装される座標です。</p>
          ) : (
            <button
              type="button"
              className="act"
              onClick={() => onEdit(`${child.symbol} を non-centered で実装すると明示`, [{
                op: 'add',
                path: `/entities/${spec.childId}/hints`,
                value: [...(child.hints ?? []), { kind: 'parameterization', value: 'non_centered' }],
              }])}
            >
              右の座標で実装すると宣言する
            </button>
          )}
          <p className="geometry-note">確率モデルは変わらない。handoff に実装方針として渡る。</p>
        </div>
      </div>
    </section>
  );
}

type DossierEdit = (label: string, operations: JsonPatchOperation[]) => void;
