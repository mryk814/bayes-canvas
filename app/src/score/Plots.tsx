import { useMemo } from 'react';
import { density } from './priorSim';

const W = 280;
const H = 92;
const PAD = { l: 6, r: 6, t: 8, b: 18 };

function fmt(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(abs < 1 && abs > 0 ? 2 : 1);
}

function quantile(sorted: number[], p: number) {
  return sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
}

/**
 * Implied (marginal) prior density. When `ghost` is given, it is the other
 * version (baseline or variant A); `t` morphs from ghost (0) to current (1).
 */
export function DensityPlot({ samples, ghost, t = 1, label, ghostLabel = '比較元', subject = '含意された事前分布' }: { samples: number[]; ghost?: number[]; t?: number; label: string; ghostLabel?: string; subject?: string }) {
  const view = useMemo(() => {
    if (!samples.length) return null;
    const all = [...samples, ...(ghost ?? [])].sort((a, b) => a - b);
    const range: [number, number] = [quantile(all, 0.005), quantile(all, 0.995)];
    if (range[0] === range[1]) range[1] = range[0] + 1;
    const now = density(samples, 96, range);
    const before = ghost?.length ? density(ghost, 96, range) : null;
    const ys = before ? now.ys.map((y, k) => (1 - t) * before.ys[k]! + t * y) : now.ys;
    const top = Math.max(...ys, ...(before?.ys ?? [])) || 1;
    const sx = (x: number) => PAD.l + ((x - range[0]) / (range[1] - range[0])) * (W - PAD.l - PAD.r);
    const sy = (y: number) => H - PAD.b - (y / top) * (H - PAD.t - PAD.b);
    const line = (values: number[]) => values.map((y, k) => `${k ? 'L' : 'M'}${sx(now.xs[k]!).toFixed(1)},${sy(y).toFixed(1)}`).join('');
    const sorted = [...samples].sort((a, b) => a - b);
    const q05 = quantile(sorted, 0.05);
    const q95 = quantile(sorted, 0.95);
    const zero = range[0] < 0 && range[1] > 0 ? sx(0) : null;
    return {
      area: `${line(ys)}L${sx(range[1])},${sy(0)}L${sx(range[0])},${sy(0)}Z`,
      path: line(ys),
      ghostPath: before ? line(before.ys) : null,
      range,
      band: [sx(q05), sx(q95)] as const,
      q05,
      q95,
      zero,
      baseline: sy(0),
    };
  }, [samples, ghost, t]);

  if (!view) return <div className="plot-empty">抽出できる prior がありません。</div>;
  return (
    <figure className="plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} の${subject}。90%区間 ${fmt(view.q05)} から ${fmt(view.q95)}`}>
        <rect className="plot-band" x={view.band[0]} y={PAD.t} width={Math.max(1, view.band[1] - view.band[0])} height={H - PAD.t - PAD.b} />
        {view.zero !== null && <line className="plot-zero" x1={view.zero} x2={view.zero} y1={PAD.t} y2={view.baseline} />}
        {view.ghostPath && <path className="plot-ghost" d={view.ghostPath} />}
        <path className="plot-area" d={view.area} />
        <path className="plot-line" d={view.path} />
        <line className="plot-axis" x1={PAD.l} x2={W - PAD.r} y1={view.baseline} y2={view.baseline} />
        <text className="plot-tick" x={PAD.l} y={H - 4}>{fmt(view.range[0])}</text>
        <text className="plot-tick" x={W - PAD.r} y={H - 4} textAnchor="end">{fmt(view.range[1])}</text>
        {view.zero !== null && <text className="plot-tick" x={view.zero} y={H - 4} textAnchor="middle">0</text>}
      </svg>
      <figcaption>
        <span>90% <span className="num">{fmt(view.q05)} 〜 {fmt(view.q95)}</span></span>
        {view.ghostPath && <span className="plot-legend-ghost">{ghostLabel}</span>}
      </figcaption>
    </figure>
  );
}

const FW = 300;
const FH = 132;
const FP = { l: 30, r: 8, t: 8, b: 20 };

export function FanPlot({ probes, quantiles, ghost, predictor, outcome }: {
  probes: number[];
  quantiles: number[][];
  ghost?: number[][];
  predictor: string;
  outcome: string;
}) {
  const view = useMemo(() => {
    const values = [...quantiles, ...(ghost ?? [])].flatMap((row) => [row[0]!, row[4]!]);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) hi = lo + 1;
    const span = hi - lo;
    lo -= span * 0.05;
    hi += span * 0.05;
    const sx = (x: number) => FP.l + ((x - probes[0]!) / (probes[probes.length - 1]! - probes[0]!)) * (FW - FP.l - FP.r);
    const sy = (y: number) => FH - FP.b - ((y - lo) / (hi - lo)) * (FH - FP.t - FP.b);
    const band = (rows: number[][], a: number, b: number) =>
      `${rows.map((row, k) => `${k ? 'L' : 'M'}${sx(probes[k]!).toFixed(1)},${sy(row[a]!).toFixed(1)}`).join('')}${[...rows].reverse().map((row, k) => `L${sx(probes[rows.length - 1 - k]!).toFixed(1)},${sy(row[b]!).toFixed(1)}`).join('')}Z`;
    const median = (rows: number[][]) => rows.map((row, k) => `${k ? 'L' : 'M'}${sx(probes[k]!).toFixed(1)},${sy(row[2]!).toFixed(1)}`).join('');
    const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
    return {
      outer: band(quantiles, 0, 4),
      inner: band(quantiles, 1, 3),
      median: median(quantiles),
      ghostOuter: ghost ? band(ghost, 0, 4) : null,
      ticks: ticks.map((value) => ({ value, y: sy(value) })),
      zero: lo < 0 && hi > 0 ? sy(0) : null,
      xTicks: [probes[0]!, 0, probes[probes.length - 1]!].map((value) => ({ value, x: sx(value) })),
    };
  }, [probes, quantiles, ghost]);

  return (
    <figure className="plot plot-fan">
      <svg viewBox={`0 0 ${FW} ${FH}`} role="img" aria-label={`${outcome} の prior predictive。${predictor} に対する90%帯と50%帯`}>
        {view.zero !== null && <line className="plot-zero" x1={FP.l} x2={FW - FP.r} y1={view.zero} y2={view.zero} />}
        {view.ghostOuter && <path className="plot-ghost-band" d={view.ghostOuter} />}
        <path className="plot-fan-outer" d={view.outer} />
        <path className="plot-fan-inner" d={view.inner} />
        <path className="plot-line" d={view.median} />
        {view.ticks.map((tick) => (
          <text key={tick.value} className="plot-tick" x={FP.l - 4} y={tick.y + 3} textAnchor="end">{fmt(tick.value)}</text>
        ))}
        {view.xTicks.map((tick) => (
          <text key={tick.value} className="plot-tick" x={tick.x} y={FH - 6} textAnchor="middle">{fmt(tick.value)}</text>
        ))}
      </svg>
      <figcaption>
        <span>横軸 <span className="num">{predictor}</span>（標準化を仮定）・帯は 50% / 90%</span>
        {view.ghostOuter && <span className="plot-legend-ghost">比較元</span>}
      </figcaption>
    </figure>
  );
}

/** The shape of a belief, inline in its statement row. */
export function Spark({ samples, ghost, t = 1 }: { samples?: number[]; ghost?: number[]; t?: number }) {
  const view = useMemo(() => {
    if (!samples?.length) return null;
    const thin = (values: number[]) => (values.length > 1600 ? values.filter((_, index) => index % Math.ceil(values.length / 1600) === 0) : values);
    const now = thin(samples);
    const before = ghost?.length ? thin(ghost) : null;
    const all = [...now, ...(before ?? [])].sort((a, b) => a - b);
    const range: [number, number] = [quantile(all, 0.01), quantile(all, 0.99)];
    if (range[0] === range[1]) range[1] = range[0] + 1;
    const a = density(now, 40, range);
    const b = before ? density(before, 40, range) : null;
    const ys = b ? a.ys.map((y, k) => (1 - t) * b.ys[k]! + t * y) : a.ys;
    const top = Math.max(...ys, ...(b?.ys ?? [])) || 1;
    const sx = (k: number) => 1 + (k / 39) * 70;
    const sy = (y: number) => 17 - (y / top) * 15;
    const line = (values: number[]) => values.map((y, k) => `${k ? 'L' : 'M'}${sx(k).toFixed(1)},${sy(y).toFixed(1)}`).join('');
    const zero = range[0] < 0 && range[1] > 0 ? 1 + ((0 - range[0]) / (range[1] - range[0])) * 70 : null;
    return { path: line(ys), area: `${line(ys)}L71,17L1,17Z`, ghost: b ? line(b.ys) : null, zero };
  }, [samples, ghost, t]);
  if (!view) return <span className="spark spark-empty" />;
  return (
    <svg className="spark" width="72" height="18" viewBox="0 0 72 18" aria-hidden="true">
      {view.zero !== null && <line className="spark-zero" x1={view.zero} x2={view.zero} y1={2} y2={17} />}
      {view.ghost && <path className="spark-ghost" d={view.ghost} />}
      <path className="spark-area" d={view.area} />
      <path className="spark-line" d={view.path} />
    </svg>
  );
}
