import test from "node:test";
import assert from "node:assert/strict";
import { buildGenerativeStory } from "../shared/generative-story.ts";
import { CURVE_EXAMPLE, OBSERVATION_EXAMPLE } from "../shared/example.ts";
import { DIST_ARGS, type Family } from "../shared/contracts.ts";

test("both examples retain inputs then generation order, original expressions, metadata, scope and immutability", () => {
  for (const spec of [CURVE_EXAMPLE, OBSERVATION_EXAMPLE]) {
    const before = structuredClone(spec), result = buildGenerativeStory(spec);
    assert.ok(result.ok); if (!result.ok) return;
    assert.deepEqual(result.steps.map(s => s.name), [...spec.data, ...spec.nodes].map(n => n.name));
    for (const step of result.steps) {
      const original = [...spec.data, ...spec.nodes].find(n => n.name === step.name)!;
      assert.equal(step.label, original.label); assert.equal(step.unit, original.unit);
      if (original.plate) {
        const plate = spec.plates.find(p => p.name === original.plate)!;
        for (const value of [plate.name, plate.label, String(plate.size)]) assert.ok(step.scope.includes(value));
      } else assert.match(step.scope, /scalar/);
      if ("role" in original) {
        assert.equal(step.role, original.role); assert.equal(step.note, original.note);
        if (original.expr) assert.ok(step.formula.includes(original.expr));
      } else { assert.equal(step.role, "input"); assert.match(step.narrative, /事前世界/); assert.match(step.narrative, /実測/); }
    }
    assert.deepEqual(spec, before);
  }
});

test("all eleven distributions preserve canonical argument order and distinguish scale, log scale and rate", () => {
  const cases: Record<Family, { args: Record<string, string>; words: string[] }> = {
    normal: { args: { sigma: "2", mu: "1" }, words: ["正規", "平均", "標準偏差"] },
    lognormal: { args: { sigma: "2", mu: "1" }, words: ["対数正規", "対数", "標準偏差"] },
    halfnormal: { args: { sigma: "2" }, words: ["半正規", "元の正規", "標準偏差"] },
    exponential: { args: { rate: "2" }, words: ["指数", "率"] },
    uniform: { args: { upper: "3", lower: "1" }, words: ["一様", "下限", "上限"] },
    studentt: { args: { sigma: "2", mu: "1", nu: "5" }, words: ["Student", "自由度", "位置", "尺度"] },
    gamma: { args: { rate: "2", shape: "3" }, words: ["Gamma", "形状", "率"] },
    beta: { args: { b: "3", a: "2" }, words: ["Beta", "形状"] },
    poisson: { args: { rate: "2" }, words: ["Poisson", "平均", "件数"] },
    bernoulli: { args: { p: "0.5" }, words: ["Bernoulli", "確率", "0", "1"] },
    binomial: { args: { p: "0.5", n: "4" }, words: ["二項", "試行", "確率", "成功"] },
  };
  for (const family of Object.keys(cases) as Family[]) {
    const spec = structuredClone(CURVE_EXAMPLE); spec.nodes[0].dist = { family, args: cases[family].args };
    const result = buildGenerativeStory(spec); assert.ok(result.ok); if (!result.ok) return;
    const step = result.steps.find(s => s.name === "s20")!;
    assert.ok(step.formula.includes(`${family}(${DIST_ARGS[family].map(arg => `${arg}=${cases[family].args[arg]}`).join(", ")})`));
    for (const word of cases[family].words) assert.ok(step.narrative.includes(word), `${family}: ${word}`);
    assert.deepEqual(step.references, []);
  }
});

test("indexed and censor references are direct, unique and stable; constants create no edges", () => {
  const spec = structuredClone(OBSERVATION_EXAMPLE);
  spec.nodes.splice(-1, 0, { name: "limit", label: "上限", unit: "MPa", plate: null, role: "deterministic", expr: "520 + 0 * pi", note: "" });
  const recorded = spec.nodes.at(-1)!;
  recorded.dist!.args.mu = "true_strength + bias[machine_of] + 0 * bias[machine_of]";
  recorded.censorAbove = "limit";
  const result = buildGenerativeStory(spec); assert.ok(result.ok); if (!result.ok) return;
  const step = result.steps.find(s => s.name === "recorded")!;
  assert.deepEqual(step.references, ["true_strength", "bias", "machine_of", "sigma_meas", "limit"]);
  assert.ok(step.formula.includes(recorded.dist!.args.mu));
  assert.match(step.formula, /> limit/); assert.match(step.narrative, /厳密に超え/);
  assert.match(step.narrative, /等しい/);
  assert.deepEqual(result.steps.find(s => s.name === "limit")!.references, []);
});

test("input generators are prior examples and invalid definitions cannot produce a story", () => {
  for (const generate of [{ kind: "linspace", from: 20, to: 30 }, { kind: "uniform", lower: 20, upper: 30 }, { kind: "values", values: [20, 30] }] as const) {
    const spec = structuredClone(CURVE_EXAMPLE);
    spec.data[0].generate = structuredClone(generate) as typeof spec.data[0]["generate"];
    const result = buildGenerativeStory(spec); assert.ok(result.ok); if (!result.ok) return;
    assert.ok(result.steps[0].formula.includes(generate.kind));
    assert.match(result.steps[0].narrative, /事前世界/);
  }
  const cycle = buildGenerativeStory(OBSERVATION_EXAMPLE); assert.ok(cycle.ok);
  if (cycle.ok) assert.match(cycle.steps.find(s => s.name === "machine_of")!.formula, /cycle/);
  const invalid = structuredClone(CURVE_EXAMPLE); invalid.nodes[0].dist!.args.mu = "missing";
  assert.equal(buildGenerativeStory(invalid).ok, false);
  invalid.nodes[0].dist!.args.mu = "0"; invalid.nodes[0].dist!.args.sigma = "-1";
  assert.equal(buildGenerativeStory(invalid).ok, false);
});
