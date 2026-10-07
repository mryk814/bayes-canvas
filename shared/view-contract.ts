import type { ModelSpec } from "./contracts.ts";
import type { ViewPoint, World } from "./sim.ts";

export function displayDrawIndices(total: number, limit = 12): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error("draw数は0以上、表示上限は1以上の安全な整数にしてください。");
  const count = Math.min(total, limit);
  return Array.from({ length: count }, (_, j) => Math.round(j * (total - 1) / Math.max(1, count - 1)));
}

export function showsGeneratedPoints(showObs: boolean, overlay: boolean, linePointCount: number): boolean {
  return showObs && !(overlay && linePointCount > 1);
}

export type PointCounts = { total: number; nonFinite: number; outside: number };
type Point = { x: number; y: number };
type Domains = { x: [number, number]; y: [number, number] };
type Quantity = { name: string; label: string; unit: string };
type Counts = { generated: PointCounts; data: PointCounts; suppressedGenerated: number };
export type WorldViewInput = {
  spec: ModelSpec; worlds: World[]; points: ViewPoint[][]; data: Point[];
  domains: Domains; showObs: boolean; focus: number | "all" | null;
};
export type WorldViewSummary = {
  ok: true; worldIndices: number[]; brokenWorldIndices: number[];
  axes: { x: Quantity & { domain: [number, number] }; y: Quantity & { domain: [number, number] }; line: Quantity | null; group: Quantity | null };
  grid: Counts; focus: (Counts & { worldIndices: number[] }) | null;
};

/** Counts centers, not pixels; suppressed counts can overlap nonfinite/outside counts. */
export function summarizeWorldView(input: WorldViewInput): WorldViewSummary | { ok: false; problems: string[] } {
  const { spec, worlds, points, data, domains, showObs, focus } = input;
  const problems: string[] = [];
  const worldIndices = worlds.map(world => world.index);
  if (worlds.length !== points.length) problems.push("世界と点列の対応数が一致しません。");
  if (worldIndices.some(index => !Number.isSafeInteger(index) || index < 0) || new Set(worldIndices).size !== worlds.length) problems.push("世界番号は重複しない0以上の安全な整数である必要があります。");
  if (focus !== null && focus !== "all" && (!Number.isSafeInteger(focus) || !worldIndices.includes(focus))) problems.push("詳細の世界番号が表示対象にありません。");
  for (const axis of ["x", "y"] as const) {
    const domain = domains[axis];
    if (domain.length !== 2 || !domain.every(Number.isFinite) || domain[0] >= domain[1] || !Number.isFinite(domain[1] - domain[0])) problems.push(`${axis}軸の範囲は有限で正の幅を持つ必要があります。`);
  }
  const quantity = (name: string | undefined): Quantity | null => {
    if (name === undefined) return null;
    const matches = [...spec.data, ...spec.nodes].filter(item => item.name === name);
    if (matches.length !== 1) { problems.push(`表示量 ${name} の定義を一意に参照できません。`); return null; }
    const item = matches[0];
    return { name: item.name, label: item.label, unit: item.unit };
  };
  const x = quantity(spec.view.x), y = quantity(spec.view.y), line = quantity(spec.view.line), group = quantity(spec.view.group);
  if (problems.length) return { ok: false, problems };
  const count = (items: Point[]): PointCounts => {
    let nonFinite = 0, outside = 0;
    for (const p of items) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) nonFinite++;
      else if (p.x < domains.x[0] || p.x > domains.x[1] || p.y < domains.y[0] || p.y > domains.y[1]) outside++;
    }
    return { total: items.length, nonFinite, outside };
  };
  const summarize = (sets: ViewPoint[][], overlay: boolean): Counts => ({
    generated: count(sets.flat()), data: count(data),
    suppressedGenerated: sets.reduce((sum, set) => sum + (showsGeneratedPoints(showObs, overlay, set.filter(p => p.line !== null).length) ? 0 : set.length), 0),
  });
  const focused = focus === null ? null : focus === "all" ? points : [points[worldIndices.indexOf(focus)]];
  return { ok: true, worldIndices, brokenWorldIndices: worlds.filter(world => world.broken).map(world => world.index),
    axes: { x: { ...x!, domain: [...domains.x] }, y: { ...y!, domain: [...domains.y] }, line, group },
    grid: summarize(points, false), focus: focused === null ? null : { ...summarize(focused, focus === "all"), worldIndices: focus === "all" ? [...worldIndices] : [focus as number] } };
}
