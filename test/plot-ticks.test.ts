import { test } from "node:test";
import assert from "node:assert/strict";
import { plotTicks, spacedTickIndices } from "../src/plot-ticks.ts";

test("short ordinary ticks retain their text and existing plot margins", () => {
  assert.deepEqual(plotTicks([20, 100, 300], [-500, 0, 500]), { x: ["20", "100", "300"], y: ["-500", "0", "500"], left: 56, right: 16 });
});
test("extreme signed ticks retain signs and fit within dynamic side margins", () => {
  const ticks = plotTicks([-1.5e308, 0, 1.5e308], [-1.5e308, 1.79e308]);
  assert.equal(ticks.y[0], "-1.5e308");
  assert.equal(ticks.y[1], "1.79e308");
  assert.ok(ticks.left - 6 >= Math.max(...ticks.y.map(text => text.length * 7)));
  assert.ok(ticks.right >= Math.max(...ticks.x.map(text => text.length * 7 / 2)));
  assert.ok(ticks.left >= Math.max(...ticks.x.map(text => text.length * 7 / 2)));
});

test("nearby ticks at a large offset keep distinct labels on either axis", () => {
  const values = [1000000000, 1000000020, 1000000040];
  const ticks = plotTicks(values, values);
  assert.deepEqual(ticks.x, values.map(String));
  assert.deepEqual(ticks.y, values.map(String));
  assert.ok(ticks.left - 6 >= 10 * 7);
  assert.ok(ticks.right >= 10 * 7 / 2);
});

test("large-offset x labels are thinned to fit their actual drawing positions", () => {
  const values = Array.from({ length: 6 }, (_, i) => 1e9 + i * 20);
  const ticks = plotTicks(values, [0, 500]);
  const positions = values.map((_, i) => ticks.left + i * (340 - ticks.left - ticks.right) / 5);
  const visible = spacedTickIndices(ticks.x, positions);
  assert.ok(visible.length >= 2 && visible.length < values.length);
  for (let i = 1; i < visible.length; i++) {
    const before = visible[i - 1], after = visible[i];
    assert.ok(positions[after] - ticks.x[after].length * 7 / 2 >= positions[before] + ticks.x[before].length * 7 / 2 + 6);
  }
  assert.deepEqual(spacedTickIndices(["0", "50", "100"], [56, 170, 284]), [0, 1, 2]);
});
