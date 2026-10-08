import { test } from "node:test";
import assert from "node:assert/strict";
import { shutterDomain } from "../src/shutter-domain.ts";

test("normal and constant domains provide finite positive spans", () => {
  for (const values of [[20, 30, 40], [0, 0], [5, 5], [1.79e308, 1.79e308], [-1.79e308, -1.79e308]]) {
    const domain = shutterDomain(values);
    assert.ok(domain);
    assert.ok(Number.isFinite(domain[1] - domain[0]));
    assert.ok(domain[1] > domain[0]);
    assert.ok(domain[0] <= Math.min(...values));
    assert.ok(domain[1] >= Math.max(...values));
  }
});

test("overflowing ranges stop plotting while padding overflow falls back to exact extent", () => {
  assert.equal(shutterDomain([-1.79e308, 1.79e308]), null);
  assert.equal(shutterDomain([NaN, 1]), null);
  assert.equal(shutterDomain([]), null);
  const domain = shutterDomain([-1.79e308, 500]);
  assert.deepEqual(domain, [-1.79e308, 500]);
});
