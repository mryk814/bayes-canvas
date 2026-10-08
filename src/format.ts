import type { Compiled } from "../shared/sim.ts";

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function fmt(v: number) {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  return a !== 0 && (a < 0.01 || a >= 1e5) ? v.toExponential(2) : Number(v.toPrecision(4)).toString();
}

// Members of small plates get letters (試験機 A, B, C) so they read as names, not quantities.
export function groupName(c: Compiled, indexColumn: string, value: number) {
  const col = c.data.find((d) => d.name === indexColumn);
  const plate = c.spec.plates.find((p) => p.name === col?.indexOf);
  if (!plate) return String(value);
  const size = c.sizes[plate.name];
  return `${plate.label} ${size <= 26 ? String.fromCharCode(65 + value) : value}`;
}
