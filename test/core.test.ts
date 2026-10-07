import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, parseExpr } from "../shared/expr.ts";
import { anatomy, compileSpec, diffSpecs, runInputs, simulateWorld, viewPoints } from "../shared/sim.ts";
import { CURVE_EXAMPLE, OBSERVATION_EXAMPLE } from "../shared/example.ts";
import { numpyroScript } from "../shared/codegen.ts";
import { HttpError, Store } from "../server/store.ts";

const compile = (spec = OBSERVATION_EXAMPLE) => {
  const r = compileSpec(spec);
  if (!r.ok) throw new Error(r.problems.join("\n"));
  return r.compiled;
};

test("expressions follow precedence, read indexed values and reject unknown functions", () => {
  assert.equal(evaluate(parseExpr("2 + 3 * 4 ^ 2"), {}), 50);
  assert.equal(evaluate(parseExpr("-2 ^ 2"), {}), -4);
  assert.equal(evaluate(parseExpr("bias[m] + 1"), (name, index) => (name === "bias" && index === "m" ? 41 : NaN)), 42);
  assert.throws(() => parseExpr("system(1)"), /使えません/);
  assert.throws(() => parseExpr("a[1]"), /添字の列/);
});

test("both examples compile", () => {
  compile(CURVE_EXAMPLE);
  compile(OBSERVATION_EXAMPLE);
});

test("plate rules: other-plate values must be read through an index column", () => {
  const bad = structuredClone(OBSERVATION_EXAMPLE);
  bad.nodes[7].dist!.args.mu = "true_strength + bias";
  const r = compileSpec(bad);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.problems.join() : "", /bias\[添字の列\]/);
  const scalar = structuredClone(OBSERVATION_EXAMPLE);
  scalar.nodes[0].dist!.args.mu = "T";
  assert.match(compileSpec(scalar).ok ? "" : (compileSpec(scalar) as { problems: string[] }).problems.join(), /スカラー/);
});

test("worlds are reproducible and joint", () => {
  const c = compile();
  const a = simulateWorld(c, 42, 3);
  assert.deepEqual(a, simulateWorld(c, 42, 3));
  assert.notDeepEqual(a.values.s20, simulateWorld(c, 43, 3).values.s20);
  assert.equal(a.values.true_strength.length, 36);
  assert.equal(a.values.bias.length, 3);
});

test("records above the limit are censored, not dropped", () => {
  const c = compile();
  const hot = structuredClone(OBSERVATION_EXAMPLE);
  hot.nodes[0].dist!.args = { mu: "700", sigma: "1" };
  const w = simulateWorld(compile(hot), 1, 0);
  assert.ok(w.censored.recorded.some(Boolean));
  assert.ok(w.values.recorded.every((v) => v <= 520));
  assert.equal(viewPoints(c, simulateWorld(c, 1, 0)).length, 36);
});

test("anatomy walks from the record to everything that produced it", () => {
  const c = compile();
  const w = simulateWorld(c, 5, 0);
  const layers = anatomy(c, w, "recorded", 4);
  const names = layers.map((l) => l.name);
  for (const n of ["T", "machine_of", "s20", "decline", "sigma_mat", "true_strength", "tau_bias", "bias", "sigma_meas", "recorded"]) assert.ok(names.includes(n), n);
  const bias = layers.find((l) => l.name === "bias")!;
  assert.equal(bias.element, w.values.machine_of[4]);
  assert.equal(bias.value, w.values.bias[w.values.machine_of[4]]);
  assert.equal(names[names.length - 1], "recorded");
});

test("posterior-predictive worlds keep the draw and re-simulate only observations", () => {
  const c = compile();
  const truth = simulateWorld(c, 9, 0);
  const run = { draws: { s20: [[400]], decline: [[0.5]], sigma_mat: [[10]], true_strength: [truth.values.true_strength], tau_bias: [[5]], bias: [[1, 2, 3]], sigma_meas: [[4]] } };
  const ds = { plates: { specimen: 36, machine: 3 }, columns: { T: truth.values.T, machine_of: truth.values.machine_of, recorded: truth.values.recorded } };
  const w = simulateWorld(c, 1, 0, runInputs(c, run, ds, 0));
  assert.deepEqual(w.values.bias, [1, 2, 3]);
  assert.deepEqual(w.values.true_strength, truth.values.true_strength);
  assert.notDeepEqual(w.values.recorded, truth.values.recorded);
});

test("diffSpecs speaks in model terms", () => {
  const next = structuredClone(OBSERVATION_EXAMPLE);
  next.nodes[6].dist!.args.sigma = "20";
  assert.deepEqual(diffSpecs(OBSERVATION_EXAMPLE, next).map((c) => c.what), ["sigma_meas"]);
});

test("the NumPyro script keeps node names as sites and handles censoring", () => {
  const { code, warnings } = numpyroScript(OBSERVATION_EXAMPLE, "ver_x");
  assert.deepEqual(warnings, []);
  for (const site of ['"s20"', '"bias"', '"true_strength"', '"recorded"']) assert.ok(code.includes(site), site);
  assert.match(code, /v_bias\[d_machine_of\]/);
  assert.match(code, /log_sf/);
  assert.match(code, /KEEP = \["s20","decline","sigma_mat","true_strength","tau_bias","bias","sigma_meas"\]/);
});

function freshStore() {
  return new Store(join(mkdtempSync(join(tmpdir(), "worlds-")), "worlds.json"));
}

test("the full loop: open a point → candidates → choose → adopt → reload", () => {
  const store = freshStore();
  const model = store.startExample("observation");
  const v1 = model.currentVersionId;
  const intent = store.createIntent({
    scene: { modelVersionId: v1, seed: 7, runId: null },
    marks: [{ kind: "layer", world: 2, unit: 30, node: "sigma_meas" }],
    utterance: "高温だとこの試験機だけ測定が安定しない",
  });

  const [pending] = store.pendingIntents();
  assert.equal(pending.id, intent.id);
  assert.ok(pending.opened[0].layers.some((l) => l.name === "sigma_meas"));

  const next = structuredClone(OBSERVATION_EXAMPLE);
  next.nodes[6] = { ...next.nodes[6], name: "sigma_meas", plate: "machine", role: "latent", dist: { family: "halfnormal", args: { sigma: "10" } } };
  next.nodes[7].dist!.args.sigma = "sigma_meas[machine_of]";
  store.reply({
    intentId: intent.id,
    message: "",
    candidates: [
      { label: "試験機ごとの測定誤差", kind: "observation_process", statement: "測定誤差は試験機ごとに違う", reasoning: "", edit: { spec: next, summary: "sigma_meas を試験機ごとに" } },
      { label: "材料の問題", kind: "hypothesis", statement: "高温で材料自体のばらつきが増える", reasoning: "" },
    ],
  });
  const answered = store.state.intents[0];
  const { knowledgeId, proposalId } = store.choose(intent.id, { candidateId: answered.candidates[0].id });
  const v2 = store.adopt(proposalId!);
  assert.equal(v2.number, 2);
  assert.deepEqual(v2.origin, { kind: "proposal", proposalId, knowledgeIds: [knowledgeId] });

  const reloaded = new Store(store.path);
  assert.equal(reloaded.state.models[0].currentVersionId, v2.id);
  assert.equal(reloaded.state.knowledge[0].kind, "observation_process");
});

test("datasets and runs are checked against the version", () => {
  const store = freshStore();
  const model = store.startExample("observation");
  const truth = structuredClone(OBSERVATION_EXAMPLE);
  const ds = store.synthesize({ modelId: model.id, label: "合成", note: "", truth, seed: 3, plates: { specimen: 24 } });
  assert.equal(ds.provenance, "synthetic");
  assert.equal(ds.columns.recorded.length, 24);
  assert.throws(() => store.attachRun({ versionId: model.currentVersionId, datasetId: ds.id, method: "x", note: "", diagnostics: { maxRhat: null, minEss: null, divergences: null, chains: null }, draws: { s20: [[1]] } }), HttpError);
  const good = {
    s20: [[400], [410]], decline: [[0.5], [0.6]], sigma_mat: [[10], [11]], true_strength: [Array(24).fill(300), Array(24).fill(310)],
    tau_bias: [[5], [6]], bias: [[0, 1, 2], [1, 1, 1]], sigma_meas: [[4], [5]],
  };
  const run = store.attachRun({ versionId: model.currentVersionId, datasetId: ds.id, method: "test", note: "", diagnostics: { maxRhat: 1.0, minEss: 500, divergences: 0, chains: 2 }, draws: good });
  const { world } = store.worldOf({ modelVersionId: model.currentVersionId, seed: 1, runId: run.id }, 1);
  assert.deepEqual(world.values.bias, [1, 1, 1]);
  assert.equal(world.values.recorded.length, 24);
});

test("stale proposals are refused; new-model proposals create a model", () => {
  const store = freshStore();
  const model = store.startExample("curve");
  const a = store.propose({ modelId: model.id, spec: CURVE_EXAMPLE, summary: "A", knowledgeIds: [] });
  const b = store.propose({ modelId: model.id, spec: CURVE_EXAMPLE, summary: "B", knowledgeIds: [] });
  store.adopt(a.id);
  assert.throws(() => store.adopt(b.id), (e: unknown) => e instanceof HttpError && e.status === 409);
  const fresh = store.propose({ modelId: null, spec: OBSERVATION_EXAMPLE, summary: "new", knowledgeIds: [] });
  store.adopt(fresh.id);
  assert.equal(store.state.models.length, 2);
});

test("invalid agent edits are rejected without changing state", () => {
  const store = freshStore();
  const model = store.startExample("curve");
  const intent = store.createIntent({ scene: { modelVersionId: model.currentVersionId, seed: 1, runId: null }, marks: [], utterance: "?" });
  const before = JSON.stringify(store.state);
  const broken = structuredClone(CURVE_EXAMPLE);
  broken.nodes[4].expr = "nope(";
  assert.throws(() => store.reply({ intentId: intent.id, message: "", candidates: [{ label: "x", kind: "constraint", statement: "x", reasoning: "", edit: { spec: broken, summary: "x" } }] }), HttpError);
  assert.equal(JSON.stringify(store.state), before);
});

test("a possible-worlds@1 file is upgraded and stays readable", () => {
  const dir = mkdtempSync(join(tmpdir(), "worlds-"));
  const path = join(dir, "worlds.json");
  const v1spec = {
    title: "旧", question: "", x: { name: "T", label: "温度", unit: "°C", min: 20, max: 300, points: 15 }, y: { name: "strength", label: "強度", unit: "MPa" },
    params: [{ name: "a", label: "a", unit: "", prior: { family: "normal", mu: 0, sigma: 1 }, note: "" }, { name: "sigma", label: "s", unit: "", prior: { family: "halfnormal", sigma: 1 }, note: "" }],
    mean: "a * T", noise: { family: "normal", sigma: "sigma" },
  };
  writeFileSync(path, JSON.stringify({
    schema: "possible-worlds@1", currentVersionId: "ver_1",
    versions: [{ id: "ver_1", number: 1, spec: v1spec, createdAt: "2026-10-07T00:00:00Z", origin: { kind: "example" }, summary: "s" }],
    intents: [{
      id: "int_1", createdAt: "2026-10-07T00:00:00Z", scene: { modelVersionId: "ver_1", seed: 1 }, marks: [],
      thread: [{ from: "human", text: "x", at: "2026-10-07T00:00:00Z" }], status: "answered",
      candidates: [{ id: "c1", label: "l", kind: "constraint", statement: "s", reasoning: "", edit: { spec: v1spec, summary: "e" } }], resolution: null,
    }],
    knowledge: [], proposals: [],
  }));
  const store = new Store(path);
  assert.equal(store.state.models.length, 1);
  compile(store.state.versions[0].spec);
  compile(store.state.intents[0].candidates[0].edit!.spec);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).schema, "possible-worlds@1", "file is only rewritten on the next change");
});

test("an unreadable data file stops startup instead of being overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "worlds-"));
  const path = join(dir, "worlds.json");
  writeFileSync(path, JSON.stringify({ schema: "something-else" }));
  assert.throws(() => new Store(path), /読めません/);
  assert.equal(readFileSync(path, "utf8"), JSON.stringify({ schema: "something-else" }));
});

test("the Stan program is typed, non-centred, censored and uses prefixed names", async () => {
  const { stanProgram } = await import("../shared/stan.ts");
  const { files, warnings } = stanProgram(OBSERVATION_EXAMPLE, "ver_x");
  const p = files["model.stan"];
  assert.deepEqual(warnings, []);
  assert.match(p, /array\[N_specimen\] int<lower=1, upper=N_machine> d_machine_of;/);
  assert.match(p, /real<lower=0> n_decline;/);
  assert.match(p, /vector\[N_specimen\] n_true_strength_raw;/);
  assert.match(p, /n_bias\[d_machine_of\]/);
  assert.match(p, /normal_lccdf\(cap\[i\]/);
  assert.ok(/^[\x00-\x7f]*$/.test(p), "the Stan program must be ASCII");
  for (const [name, code] of [["run_stan.py", files["run_stan.py"]], ["model.py", (await import("../shared/codegen.ts")).numpyroScript(OBSERVATION_EXAMPLE, "v").code]]) {
    const r = (await import("node:child_process")).spawnSync("python", ["-c", "import ast,sys; ast.parse(sys.stdin.buffer.read().decode(\"utf-8\"))"], { input: code, encoding: "utf8" });
    assert.equal(r.status, 0, `${name} is not valid Python: ${r.stderr}`);
  }
  assert.match(files["run_stan.py"], /KEEP = \["s20","decline","sigma_mat","true_strength","tau_bias","bias","sigma_meas"\]/);
});

test("the identifiability lens finds a sum-only ridge and prior-carried quantities", async () => {
  const { identifiability, ridgeEnds } = await import("../shared/identify.ts");
  const c = compile();
  const K = 300;
  const u = Array.from({ length: K }, (_, k) => (k + 0.5) / K);
  // sigma_mat + sigma_meas = 30 in every draw: only the sum is known
  const sm = u.map((v) => 5 + 20 * v);
  const draws = {
    s20: u.map((v) => [450 + 0.01 * Math.sin(v * 50)]),
    decline: u.map((v) => [0.6 + 0.001 * Math.cos(v * 70)]),
    sigma_mat: sm.map((v) => [v]),
    sigma_meas: sm.map((v) => [30 - v]),
    tau_bias: u.map((v) => [Math.abs(15 * Math.tan(Math.PI * (v - 0.5) * 0.9)) + 0.01]),
    true_strength: u.map(() => Array(36).fill(400)),
    bias: u.map(() => [0, 0, 0]),
  };
  const lens = identifiability(c, { draws });
  const ridge = lens.ridges.find((r) => [r.a, r.b].sort().join() === "sigma_mat,sigma_meas");
  assert.ok(ridge && ridge.rho < -0.99, "sum-only ridge found");
  const [lo, hi] = ridgeEnds({ draws }, ridge!.a, ridge!.b, ridge!.rho);
  const a = (k: number) => draws[ridge!.a as "sigma_mat"][k][0];
  assert.ok(Math.abs(a(lo) - a(hi)) > 10, "ends sit at opposite ends of the ridge");
  const s20 = lens.params.find((p) => p.name === "s20")!;
  assert.ok(s20.contraction > 0.99, "a tightly known quantity is marked as taught by the data");
  const tau = lens.params.find((p) => p.name === "tau_bias")!;
  assert.ok(tau.contraction < 0.3, "a quantity left as wide as its prior is marked as prior-carried");
});

test("the shape lens evaluates the model's own function and checks bins with new-unit replicates", async () => {
  const { bandWorlds, binnedCheck, functionBand, shapeArgs } = await import("../shared/shape.ts");
  const c = compile();
  assert.deepEqual(shapeArgs(c).map((a) => [a.arg, a.stat]), [["mu", "mean"], ["sigma", "sd"]]);
  const band = functionBand(c, bandWorlds(c, null, null, 50), "sigma", null);
  assert.equal(band.length, 36);
  assert.ok(band.every((b, i) => i === 0 || b.x >= band[i - 1].x), "sorted along x");
  assert.ok(band.every((b) => b.q[2] === band[0].q[2]), "constant measurement error gives a flat band");
  // data simulated from the model itself: bins cover every record of the group
  const w = simulateWorld(c, 3, 0);
  const ds = { plates: { specimen: 36, machine: 3 }, columns: { T: w.values.T, machine_of: w.values.machine_of, recorded: w.values.recorded } };
  const run = { draws: Object.fromEntries(["s20", "decline", "sigma_mat", "true_strength", "tau_bias", "bias", "sigma_meas"].map((k) => [k, Array.from({ length: 40 }, () => w.values[k])])) };
  const bins = binnedCheck(c, run, ds, "sd", 2, 4, 40);
  assert.equal(bins.reduce((s, b) => s + b.n, 0), 12);
  assert.ok(bins.every((b) => b.rep[0] <= b.rep[2]));
});
