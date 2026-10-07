import test from "node:test";
import assert from "node:assert/strict";
import { displayDrawIndices, showsGeneratedPoints, summarizeWorldView } from "../shared/view-contract.ts";
import { CURVE_EXAMPLE, OBSERVATION_EXAMPLE } from "../shared/example.ts";
import type { ViewPoint, World } from "../shared/sim.ts";

const point = (x: number, y: number, line: number | null = null): ViewPoint => ({ unit: 0, x, y, line, group: null, censored: false });
function input() {
  const worlds: World[] = [{ index: 3, broken: false, values: {}, censored: {} }, { index: 9, broken: true, values: {}, censored: {} }];
  return { spec: CURVE_EXAMPLE, worlds, points: [[point(0, 0, 0), point(10, 10, NaN), point(-1, 4)], [point(NaN, 2), point(4, Infinity), point(4, 11)]],
    data: [{ x: 0, y: 10 }, { x: 11, y: 0 }, { x: Infinity, y: 0 }], domains: { x: [0, 10] as [number, number], y: [0, 10] as [number, number] }, showObs: true, focus: null as number | "all" | null };
}

test("display extraction keeps every small run and evenly samples both ends of larger runs", () => {
  assert.deepEqual(displayDrawIndices(4), [0, 1, 2, 3]);
  for (let total = 0; total <= 12; total++) assert.deepEqual(displayDrawIndices(total), Array.from({ length: total }, (_, i) => i));
  assert.deepEqual(displayDrawIndices(32), [0, 3, 6, 8, 11, 14, 17, 20, 23, 25, 28, 31]);
  assert.deepEqual(displayDrawIndices(100, 3), [0, 50, 99]);
  assert.deepEqual(displayDrawIndices(8, 1), [0]);
  for (const total of [-1, 1.5, Infinity, NaN]) assert.throws(() => displayDrawIndices(total));
  for (const limit of [0, -1, 1.5, Infinity, NaN]) assert.throws(() => displayDrawIndices(4, limit));
});

test("point suppression mirrors drawing: showObs and overlay with at least two non-null line values", () => {
  for (const overlay of [false, true]) for (const count of [0, 1, 2, 5]) {
    assert.equal(showsGeneratedPoints(false, overlay, count), false);
    assert.equal(showsGeneratedPoints(true, overlay, count), !(overlay && count >= 2));
  }
});

test("grid and focus counts preserve world identity, boundaries, nonfinite centers and independent suppression", () => {
  const source = input(), before = structuredClone(source);
  const grid = summarizeWorldView(source); assert.ok(grid.ok); if (!grid.ok) return;
  assert.deepEqual(grid.worldIndices, [3, 9]); assert.deepEqual(grid.brokenWorldIndices, [9]);
  assert.deepEqual(grid.grid, { generated: { total: 6, nonFinite: 2, outside: 2 }, data: { total: 3, nonFinite: 1, outside: 1 }, suppressedGenerated: 0 });
  assert.equal(grid.focus, null);
  const all = summarizeWorldView({ ...source, focus: "all" }); assert.ok(all.ok); if (!all.ok) return;
  assert.deepEqual(all.focus, { worldIndices: [3, 9], generated: grid.grid.generated, data: grid.grid.data, suppressedGenerated: 3 });
  const single = summarizeWorldView({ ...source, focus: 9 }); assert.ok(single.ok); if (!single.ok) return;
  assert.deepEqual(single.focus, { worldIndices: [9], generated: { total: 3, nonFinite: 2, outside: 1 }, data: grid.grid.data, suppressedGenerated: 0 });
  const hidden = summarizeWorldView({ ...source, showObs: false, focus: 9 }); assert.ok(hidden.ok); if (!hidden.ok) return;
  assert.equal(hidden.grid.suppressedGenerated, 6); assert.equal(hidden.focus!.suppressedGenerated, 3);
  assert.deepEqual(hidden.grid.data, grid.grid.data); assert.deepEqual(source, before);
});

test("axis names labels units and supplied domains retain scalar and indexed group identities", () => {
  const first = summarizeWorldView(input()); assert.ok(first.ok); if (!first.ok) return;
  assert.deepEqual(first.axes.x, { name: "T", label: "試験温度", unit: "°C", domain: [0, 10] });
  assert.equal(first.axes.line!.name, "mu"); assert.equal(first.axes.group, null);
  const group = summarizeWorldView({ ...input(), spec: OBSERVATION_EXAMPLE }); assert.ok(group.ok); if (!group.ok) return;
  assert.equal(group.axes.group!.name, "machine_of"); assert.equal(group.axes.group!.label, "使った試験機"); assert.equal(group.axes.line, null);
  const scalar = structuredClone(CURVE_EXAMPLE); scalar.view = { x: "s20", y: "sigma" };
  const result = summarizeWorldView({ ...input(), spec: scalar }); assert.ok(result.ok); if (!result.ok) return;
  assert.equal(result.axes.x.name, "s20"); assert.equal(result.axes.y.unit, "MPa");
});

test("misaligned worlds, duplicate IDs, absent focus and invalid axis domains fail closed", () => {
  const source = input();
  const cases = [{ ...source, points: source.points.slice(1) }, { ...source, worlds: [source.worlds[0], source.worlds[0]] },
    { ...source, focus: 0 }, { ...source, focus: 3.5 }, { ...source, worlds: [{ ...source.worlds[0], index: NaN }, source.worlds[1]] },
    ...([[0, 0], [10, 0], [0, Infinity], [NaN, 10]] as [number, number][]).map(x => ({ ...source, domains: { ...source.domains, x } })),
    { ...source, spec: { ...source.spec, view: { x: "missing", y: "strength" } } }];
  for (const invalid of cases) assert.equal(summarizeWorldView(invalid).ok, false);
});
