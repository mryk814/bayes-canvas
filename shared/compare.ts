// Checks that turn a finished run into plain warnings: MCMC diagnostics, and
// disagreement between a fast approximation and MCMC for the same version and data.
import type { ModelSpec, Run } from "./contracts.ts";

export const PARETO_K_LIMIT = 0.7;

export function approximationTrusted(d: Run["diagnostics"]) {
  return d.paretoK == null || d.paretoK <= PARETO_K_LIMIT;
}

export function diagnosticWarnings(d: Run["diagnostics"]): string[] {
  const out: string[] = [];
  if (!approximationTrusted(d)) out.push(`近似が信用できません（Pareto k = ${d.paretoK!.toFixed(2)} > ${PARETO_K_LIMIT}）。表示に使わず NUTS を待ちます`);
  if (d.maxRhat !== null && d.maxRhat > 1.01) out.push(`R̂ が ${d.maxRhat.toFixed(3)}（1.01 を超える）。chain が一致していません`);
  if (d.divergences !== null && d.divergences > 0) out.push(`発散が ${d.divergences} 回。事後分布の一部を探れていない可能性があります`);
  if (d.minEss !== null && d.minEss < 400) out.push(`有効標本数が ${Math.round(d.minEss)}（400 未満）。区間の端は不確か`);
  return out;
}

function summary(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, s.length - 1));
  return { median, sd };
}

// F21: an approximation may silently miss; say where it differs from MCMC, in posterior sds.
export function approximationGaps(spec: ModelSpec, approx: Pick<Run, "draws">, mcmc: Pick<Run, "draws">, threshold = 0.5): string[] {
  const out: string[] = [];
  for (const n of spec.nodes) {
    if (n.plate !== null || (n.role !== "param" && n.role !== "latent")) continue;
    const a = approx.draws[n.name]?.map((r) => r[0]);
    const m = mcmc.draws[n.name]?.map((r) => r[0]);
    if (!a?.length || !m?.length) continue;
    const sa = summary(a);
    const sm = summary(m);
    if (sm.sd === 0) continue;
    const shift = Math.abs(sa.median - sm.median) / sm.sd;
    const width = sa.sd / sm.sd;
    if (shift > threshold || width < 0.5 || width > 2) {
      out.push(
        `近似とずれ: ${n.label}（${n.name}）の中央値 近似 ${sa.median.toPrecision(3)} / NUTS ${sm.median.toPrecision(3)}、幅の比 ${width.toFixed(2)}`,
      );
    }
  }
  return out;
}
