import test from "node:test";
import assert from "node:assert/strict";
import { priorTargets, buildPriorSpec, validatePriorPreview } from "../shared/prior-workbench.ts";
import { CURVE_EXAMPLE, OBSERVATION_EXAMPLE } from "../shared/example.ts";
import type { Family } from "../shared/contracts.ts";
import { compileSpec, simulateWorld } from "../shared/sim.ts";

test("targets are only scalar parameters with complete finite literal arguments", () => {
  assert.deepEqual(priorTargets(CURVE_EXAMPLE).map(n => n.nodeName), ["s20", "slope", "curv", "sigma"]);
  assert.ok(!priorTargets(OBSERVATION_EXAMPLE).some(n => n.nodeName === "bias"));
  for (const expression of ["slope", "pi", "400 + 1", "Infinity", "0x10", "1e999"]) {
    const spec = structuredClone(CURVE_EXAMPLE); spec.nodes[0].dist!.args.mu = expression;
    assert.ok(!priorTargets(spec).some(n => n.nodeName === "s20"));
  }
  const spec = structuredClone(CURVE_EXAMPLE); spec.nodes[0].dist!.args.mu = " -4.0e+2 ";
  assert.equal(priorTargets(spec)[0].args.mu, -400);
  for (const patch of [{ plate: "point" }, { role: "latent" as const }, { expr: "1" }, { censorAbove: "500" }]) {
    const bad = structuredClone(CURVE_EXAMPLE); Object.assign(bad.nodes[0], patch);
    assert.ok(!priorTargets(bad).some(n => n.nodeName === "s20"));
  }
});

test("building preserves all other fields, family and order and owns an independent clone", () => {
  const original = structuredClone(OBSERVATION_EXAMPLE), before = structuredClone(original);
  const next = buildPriorSpec(original, "s20", { mu: 500, sigma: 70 });
  const expected = structuredClone(original); expected.nodes[0].dist!.args = { mu: "500", sigma: "70" };
  assert.deepEqual(next, expected); assert.deepEqual(original, before);
  const listed = priorTargets(original); listed[0].args.mu = 123;
  assert.deepEqual(original, before);
  next.nodes[0].label = "changed"; assert.deepEqual(original, before);
});

test("all eleven families enforce their own parameter domains, including probability and count endpoints", () => {
  const cases: Record<Family, { initial: Record<string, string>; valid: Record<string, number>; invalid: Record<string, number>[] }> = {
    normal: { initial: { mu: "0", sigma: "1" }, valid: { mu: -1, sigma: 2 }, invalid: [{ mu: 0, sigma: 0 }] },
    lognormal: { initial: { mu: "0", sigma: "1" }, valid: { mu: -1, sigma: 2 }, invalid: [{ mu: 0, sigma: -1 }] },
    halfnormal: { initial: { sigma: "1" }, valid: { sigma: 2 }, invalid: [{ sigma: 0 }] },
    exponential: { initial: { rate: "1" }, valid: { rate: 2 }, invalid: [{ rate: 0 }] },
    uniform: { initial: { lower: "0", upper: "1" }, valid: { lower: -1, upper: 2 }, invalid: [{ lower: 1, upper: 1 }, { lower: 2, upper: 1 }] },
    studentt: { initial: { nu: "5", mu: "0", sigma: "1" }, valid: { nu: 6, mu: -1, sigma: 2 }, invalid: [{ nu: 0, mu: 0, sigma: 1 }, { nu: 1, mu: 0, sigma: 0 }] },
    gamma: { initial: { shape: "1", rate: "1" }, valid: { shape: 2, rate: 3 }, invalid: [{ shape: 0, rate: 1 }, { shape: 1, rate: 0 }] },
    beta: { initial: { a: "1", b: "1" }, valid: { a: 2, b: 3 }, invalid: [{ a: 0, b: 1 }, { a: 1, b: 0 }] },
    poisson: { initial: { rate: "1" }, valid: { rate: 0 }, invalid: [{ rate: -1 }] },
    bernoulli: { initial: { p: "0.5" }, valid: { p: 0 }, invalid: [{ p: -0.1 }, { p: 1.1 }] },
    binomial: { initial: { n: "2", p: "0.5" }, valid: { n: 0, p: 1 }, invalid: [{ n: 1.5, p: 0.5 }, { n: -1, p: 0.5 }, { n: Number.MAX_SAFE_INTEGER + 1, p: 0.5 }, { n: 2, p: -1 }, { n: 2, p: 2 }] },
  };
  for (const family of Object.keys(cases) as Family[]) {
    const spec = structuredClone(CURVE_EXAMPLE); spec.nodes[0].dist = { family, args: cases[family].initial };
    assert.equal(buildPriorSpec(spec, "s20", cases[family].valid).nodes[0].dist!.family, family);
    for (const args of cases[family].invalid) assert.throws(() => buildPriorSpec(spec, "s20", args), family);
  }
});

test("unknown, unchanged, missing/extra or nonfinite args reject without mutation", () => {
  const before = structuredClone(CURVE_EXAMPLE);
  for (const args of [{ mu: 400, sigma: 150 }, { mu: 500 }, { mu: 500, sigma: 150, extra: 1 }, { mu: NaN, sigma: 1 }, { mu: Infinity, sigma: 1 }, { mu: 0, sigma: -Infinity }] as Record<string, number>[]) assert.throws(() => buildPriorSpec(CURVE_EXAMPLE, "s20", args));
  assert.throws(() => buildPriorSpec(CURVE_EXAMPLE, "missing", { mu: 0, sigma: 1 }));
  assert.throws(() => buildPriorSpec(OBSERVATION_EXAMPLE, "bias", { mu: 0, sigma: 2 }));
  assert.deepEqual(CURVE_EXAMPLE, before);
});

test("six-world preview gate is deterministic, rejects invalid seeds and broken values without mutation", () => {
  const before = structuredClone(CURVE_EXAMPLE), after = buildPriorSpec(before, "s20", { mu: 500, sigma: 60 });
  const snapshot = structuredClone({ before, after });
  assert.doesNotThrow(() => validatePriorPreview(before, after, 1));
  assert.doesNotThrow(() => validatePriorPreview(before, after, 1));
  for (const seed of [-1, 0.5, NaN, Infinity, 2147483648]) assert.throws(() => validatePriorPreview(before, after, seed));
  const broken = structuredClone(after); broken.nodes[0].dist!.args.mu = "1e999";
  assert.throws(() => validatePriorPreview(before, broken, 1));
  const finiteOverflow = structuredClone(after); finiteOverflow.nodes[0].dist = { family: "lognormal", args: { mu: "1000", sigma: "1" } };
  assert.throws(() => validatePriorPreview(before, finiteOverflow, 1));
  const partialOverflow = structuredClone(after); partialOverflow.nodes[0].dist = { family: "lognormal", args: { mu: "700", sigma: "20" } };
  assert.ok(compileSpec(partialOverflow).ok, "the general compile probe permits a minority of broken worlds");
  assert.throws(() => validatePriorPreview(before, partialOverflow, 1), /プレビュー世界 2/);
  const c = compileSpec(after); assert.ok(c.ok); if (c.ok) assert.deepEqual(simulateWorld(c.compiled, 1, 0), simulateWorld(c.compiled, 1, 0));
  assert.deepEqual({ before, after }, snapshot);
});
