import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileSpec, simulateWorld } from "../shared/sim.ts";
import { OBSERVATION_EXAMPLE } from "../shared/example.ts";
import {
  calibrationSets, calibrationSummary, calibrationTargets, chiSquareP, holdoutSplit, holdoutSplits, predictiveScores, targetValue,
} from "../shared/evaluate.ts";
import { HttpError, Store } from "../server/store.ts";
import type { Job } from "../shared/contracts.ts";

const compiled = () => {
  const r = compileSpec(OBSERVATION_EXAMPLE);
  if (!r.ok) throw new Error(r.problems.join("\n"));
  return r.compiled;
};
const freshStore = () => new Store(join(mkdtempSync(join(tmpdir(), "worlds-")), "worlds.json"));
const ALGORITHM = 'NAME = "test"\n\ndef make(mod, sizes, options):\n    return None\n';

test("calibration tracks margins and sums, so draws with broken correlation cannot pass", () => {
  const c = compiled();
  const w = simulateWorld(c, 1, 0);
  const ds = { plates: c.sizes, columns: { T: w.values.T, machine_of: w.values.machine_of, recorded: w.values.recorded } };
  const targets = calibrationTargets(c, ds);
  assert.ok(targets.includes("s20") && targets.includes("bias[2]") && targets.includes("true_strength[0]+true_strength[1]"));
  // the cross-plate pair follows the first record: specimen 0 was tested on machine machine_of[0]
  assert.ok(targets.includes(`true_strength[0]+bias[${ds.columns.machine_of[0]}]`));
  assert.equal(targetValue("true_strength[0]+bias[1]", w.values), w.values.true_strength[0] + w.values.bias[1]);

  const sets = calibrationSets(c, ds, 5, 3);
  assert.equal(sets.datasets.length, 5);
  for (const d of sets.datasets) {
    assert.deepEqual(d.columns.T, ds.columns.T, "known inputs stay those of the real data");
    assert.equal(d.columns.recorded.length, 36);
    assert.ok(Object.values(d.truth).every(Number.isFinite));
  }
});

test("rank uniformity: flat ranks raise no flag, ranks piled at one end do", () => {
  assert.ok(Math.abs(chiSquareP(3.841, 1) - 0.05) < 1e-3);
  assert.ok(Math.abs(chiSquareP(11.07, 5) - 0.05) < 1e-3);
  const flat = Array.from({ length: 40 }, (_, i) => Math.floor((i * 101) / 40));
  const piled = Array.from({ length: 40 }, (_, i) => (i < 32 ? 0 : 50));
  const ok = calibrationSummary({ a: flat, b: flat }, 100);
  assert.equal(ok.biasDetected, false);
  const bad = calibrationSummary({ a: flat, tau: piled }, 100);
  assert.equal(bad.biasDetected, true);
  assert.ok(bad.params.find((p) => p.name === "tau")!.p < 1e-6);
});

test("held-out splits: random records and whole groups are different questions", () => {
  const c = compiled();
  const w = simulateWorld(c, 1, 0);
  const ds = { plates: { specimen: 36, machine: 3 }, columns: { T: w.values.T, machine_of: w.values.machine_of, recorded: w.values.recorded } };
  assert.deepEqual(holdoutSplits(c), ["records", "groups:machine"]);
  const rec = holdoutSplit(c, ds, "records", 0.2, 5)!;
  assert.equal(rec.held.length, 7);
  assert.equal(rec.train.plates.specimen, 29);
  assert.equal(rec.train.columns.recorded.length, 29);
  assert.equal(rec.train.columns.T.length, 29);
  assert.equal(holdoutSplit(c, ds, "groups:machine", 0.2, 5), null, "20% of 3 machines is none");
  const groups = holdoutSplit(c, ds, "groups:machine", 0.34, 5)!;
  const heldMachine = ds.columns.machine_of[groups.held[0]];
  assert.ok(groups.held.every((i) => ds.columns.machine_of[i] === heldMachine), "a held-out machine is held out whole");
  assert.ok(!groups.train.columns.machine_of.includes(heldMachine));
  assert.equal(holdoutSplit(c, ds, "groups:specimen" as "records", 0.2, 5), null);
});

test("prediction is scored per observed quantity in its own unit", () => {
  const c = compiled();
  const truth = simulateWorld(c, 1, 0);
  const ds = { plates: { specimen: 36, machine: 3 }, columns: { T: truth.values.T, machine_of: truth.values.machine_of, recorded: truth.values.recorded } };
  const split = holdoutSplit(c, ds, "records", 0.2, 5)!;
  const names = ["s20", "decline", "sigma_mat", "true_strength", "tau_bias", "bias", "sigma_meas"];
  // the true values as a run: prediction should be good
  const exact = { draws: Object.fromEntries(names.map((n) => [n, Array.from({ length: 50 }, () => truth.values[n])])) };
  const [score] = predictiveScores(c, exact, ds, split.plate, split.held, 50);
  assert.equal(score.node, "recorded");
  assert.equal(score.unit, "MPa");
  assert.equal(score.rows, 7);
  // a world far from the truth predicts worse
  const off = { draws: { ...exact.draws, s20: exact.draws.s20.map(() => [truth.values.s20[0] + 150]) } };
  const offScore = predictiveScores(c, { draws: Object.fromEntries(Object.entries(off.draws).map(([k, v]) => [k, k === "true_strength" ? v.map((x) => x.map((y) => y + 150)) : v])) }, ds, split.plate, split.held, 50)[0];
  assert.ok(offScore.crps > score.crps * 3, `${offScore.crps} vs ${score.crps}`);
  assert.ok(score.coverage90 >= 0 && score.coverage90 <= 1);
});

test("an algorithm goes through trial, calibration and prediction; only adoption puts it in charge", async () => {
  const { Ladder } = await import("../server/ladder.ts");
  const { runShown } = await import("../shared/compare.ts");
  const store = freshStore();
  const model = store.startExample("observation");
  const launched: Job[] = [];
  const ladder = new Ladder(store, mkdtempSync(join(tmpdir(), "auto-")), () => {}, { enabled: true, launch: (j) => launched.push(j) });
  const ds = store.synthesize({ modelId: model.id, label: "合成", note: "", truth: OBSERVATION_EXAMPLE, seed: 1, plates: {} });
  const v = model.currentVersionId;
  assert.deepEqual(
    ladder.jobs.map((j) => `${j.stage}:${j.subject}:${j.split ?? ""}`),
    ["approximate:approximate:", "mcmc:nuts:", "holdout:approximate:records", "holdout:nuts:records"],
    "machines are too few to hold one out, so only the records split",
  );

  assert.throws(() => store.proposeAlgorithm({ versionId: v, name: "x", note: "", code: "print(1)" }), HttpError);
  const alg = store.proposeAlgorithm({ versionId: v, name: "崩壊型", note: "", code: ALGORITHM });
  const mine = () => ladder.jobs.filter((j) => j.subject === alg.id).map((j) => j.stage);
  assert.deepEqual(mine(), ["trial", "calibrate", "holdout"]);

  // the worker reports a calibration: ranks piled at zero for one quantity
  const job = (stage: string) => ladder.jobs.find((j) => j.stage === stage && j.subject === alg.id)!;
  for (const j of ladder.jobs.filter((x) => x.status === "running")) (ladder as unknown as { finish: (j: Job, s: string, m: string) => void }).finish(j, "done", "");
  // finish everything queued before the calibration
  while (job("calibrate").status !== "running") {
    const running = ladder.jobs.find((x) => x.status === "running")!;
    (ladder as unknown as { finish: (j: Job, s: string, m: string) => void }).finish(running, "done", "");
  }
  const flat = Array.from({ length: 40 }, (_, i) => Math.floor((i * 101) / 40));
  ladder.settle(job("calibrate").id, { ranks: { s20: flat, tau_bias: flat.map(() => 0) }, draws: 100, divergences: flat.map(() => 0), seconds: 12 });
  const cal = store.state.evaluations.find((e) => e.kind === "calibration")!;
  assert.equal(cal.kind === "calibration" && cal.biasDetected, true);
  assert.equal(job("calibrate").status, "done");

  // a run from the algorithm is not shown unless the person adopted it
  const w = simulateWorld(compiled(), 1, 0);
  const draws = Object.fromEntries(["s20", "decline", "sigma_mat", "true_strength", "tau_bias", "bias", "sigma_meas"].map((k) => [k, [w.values[k]]]));
  const run = store.attachRun({ versionId: v, datasetId: ds.id, method: "崩壊型", note: "", warnings: [], algorithmId: alg.id, draws }, "auto");
  assert.equal(runShown(store.state.algorithms, run), false);
  store.decideAlgorithm(alg.id, "adopted");
  assert.equal(runShown(store.state.algorithms, store.state.runs.find((r) => r.id === run.id)!), true);
  assert.ok(!ladder.jobs.some((j) => j.stage === "mcmc" && j.subject === alg.id && j.status === "queued"), "a run of the adopted algorithm already exists");

  // rejecting stops its queued work
  const other = store.proposeAlgorithm({ versionId: v, name: "別案", note: "", code: ALGORITHM });
  store.decideAlgorithm(other.id, "rejected");
  assert.ok(ladder.jobs.filter((j) => j.subject === other.id).every((j) => j.status === "cancelled"));
});
