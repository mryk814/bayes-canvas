import test from 'node:test';
import assert from 'node:assert/strict';
import { CURVE_EXAMPLE } from '../shared/example.ts';
import type { Dataset, ModelVersion, Run } from '../shared/contracts.ts';
import { queryRunJoint } from '../shared/run-joint.ts';

const version: ModelVersion = { id: 'v1', modelId: 'm', number: 1, spec: CURVE_EXAMPLE, createdAt: '', origin: { kind: 'example', exampleId: 'curve' }, summary: '' };
const dataset: Dataset = { id: 'd', modelId: 'm', createdAt: '', label: 'test', provenance: 'synthetic', note: '', plates: { point: 2 }, columns: { T: [20, 40], strength: [400, 380] } };
const run: Run = { id: 'r', modelId: 'm', versionId: 'v1', datasetId: 'd', createdAt: '', method: 'synthetic', note: '', diagnostics: { maxRhat: null, minEss: null, divergences: null, chains: null }, draws: { s20: [[1], [2], [3], [4]], slope: [[4], [3], [2], [1]], curv: [[0], [0], [0], [0]], sigma: [[1], [1], [1], [1]] } };
const conditions = [{ node: 's20', index: 0, op: 'gt' as const, threshold: 2 }, { node: 'slope', index: 0, op: 'gt' as const, threshold: 2 }];

test('live query preserves joint rows and exact run/version/dataset references', () => {
  const q = queryRunJoint(version, dataset, run, conditions);
  assert.equal(q.ok, true);
  if (!q.ok) return;
  assert.equal(q.result.ok, true);
  if (!q.result.ok) return;
  assert.equal(q.result.totalDraws, 4);
  assert.equal(q.result.joint.probability, 0);
  assert.deepEqual(q.result.marginals.map(x => x.probability), [0.5, 0.5]);
  assert.equal(q.datasetId, 'd');
  assert.equal(q.result.modelRef, 'v1');
  assert.equal(q.result.runRef, 'r');
  assert.equal(q.quantities[0].unit, 'MPa');
});

test('plate elements retain their index instead of mixing across elements', () => {
  const v = structuredClone(version);
  v.spec.nodes.find(n => n.name === 's20')!.plate = 'point';
  const r = structuredClone(run); r.draws.s20 = [[1, 10], [2, 20], [3, 30], [4, 40]];
  const q = queryRunJoint(v, dataset, r, [{ node: 's20', index: 1, op: 'gte', threshold: 30 }]);
  assert.equal(q.ok, true);
  if (q.ok && q.result.ok) { assert.equal(q.result.joint.count, 2); assert.equal(q.dataset.draws[0].values['s20[1]'], 10); }
});

test('foreign references, broken unselected sites and invalid selections reject the entire query', () => {
  assert.equal(queryRunJoint(version, dataset, { ...run, datasetId: 'wrong' }, conditions).ok, false);
  assert.equal(queryRunJoint(version, { ...dataset, modelId: 'foreign' }, run, conditions).ok, false);
  assert.equal(queryRunJoint(version, dataset, { ...run, versionId: 'old' }, conditions).ok, false);
  assert.equal(queryRunJoint(version, dataset, { ...run, draws: { ...run.draws, sigma: [[NaN]] } }, conditions).ok, false);
  for (const selection of [{node:'strength',index:0}, {node:'s20',index:1}, {node:'s20',index:-1}]) {
    assert.equal(queryRunJoint(version, dataset, run, [{...selection,op:'gt',threshold:0}]).ok, false);
  }
});
