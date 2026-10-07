import type { Dataset, ModelSpec, Run } from "./contracts.ts";

export function runSites(spec: ModelSpec) {
  return spec.nodes.filter((n) => n.role === "param" || n.role === "latent");
}

// Browser and server use the same shape boundary for attached evidence.
export function datasetProblems(spec: ModelSpec, ds: Pick<Dataset, "plates" | "columns">): string[] {
  const problems: string[] = [];
  for (const p of spec.plates) {
    if (!(p.name in ds.plates)) problems.push(`データにプレート ${p.name} の大きさがありません`);
    else if (!Number.isInteger(ds.plates[p.name]) || ds.plates[p.name] < 1 || ds.plates[p.name] > 5000) problems.push(`プレート ${p.name} の大きさは 1〜5000 の整数にしてください`);
  }
  for (const [name, values] of Object.entries(ds.columns)) {
    if (values.some((v) => !Number.isFinite(v))) problems.push(`列 ${name} に有限でない値があります`);
  }
  const need = [
    ...spec.data.map((d) => ({ name: d.name, plate: d.plate as string | null, indexOf: d.indexOf })),
    ...spec.nodes.filter((n) => n.role === "observed").map((n) => ({ name: n.name, plate: n.plate, indexOf: null as string | null })),
  ];
  for (const c of need) {
    const col = ds.columns[c.name];
    const size = c.plate ? ds.plates[c.plate] : 1;
    if (!col) problems.push(`データに列 ${c.name} がありません`);
    else if (col.length !== size) problems.push(`列 ${c.name} の長さ ${col.length} が ${c.plate} の大きさ ${size} と合いません`);
    else if (c.indexOf) {
      const m = ds.plates[c.indexOf] ?? 0;
      if (col.some((v) => !Number.isInteger(v) || v < 0 || v >= m)) problems.push(`添字の列 ${c.name} は 0〜${m - 1} の整数にしてください`);
    }
  }
  return problems;
}

export function runProblems(spec: ModelSpec, ds: Pick<Dataset, "plates" | "columns">, run: Pick<Run, "draws">): string[] {
  const problems = datasetProblems(spec, ds);
  const sites = runSites(spec);
  let k: number | null = null;
  for (const n of sites) {
    const draws = run.draws[n.name];
    const size = n.plate ? ds.plates[n.plate] : 1;
    if (!draws) {
      problems.push(`draws に ${n.name} がありません`);
      continue;
    }
    if (k === null) k = draws.length;
    if (draws.length !== k) problems.push(`${n.name} の draw 数 ${draws.length} が他と揃っていません（${k}）`);
    if (draws.some((row) => row.length !== size)) problems.push(`${n.name} の各 draw は長さ ${size} にしてください`);
    if (draws.some((row) => row.some((v) => !Number.isFinite(v)))) problems.push(`${n.name} の draw に有限でない値があります`);
  }
  if (k !== null && (k < 1 || k > 1000)) problems.push("draw 数は 1〜1000 にしてください");
  for (const name of Object.keys(run.draws)) {
    if (!sites.some((n) => n.name === name)) problems.push(`${name} はこの版のパラメータ・潜在変数ではありません`);
  }
  return problems;
}
