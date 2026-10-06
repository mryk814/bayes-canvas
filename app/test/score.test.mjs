import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCanvas } from '../dist-test/lib/documentAdapter.js';
import { applyJsonPatch } from '../dist-test/lib/core/json-patch.js';
import { compileModel } from '../dist-test/lib/core/compiler.js';
import { InMemoryDistributionRegistry } from '../dist-test/lib/core/registry.js';
import { DISTRIBUTIONS, toCompilerDistributionDefinition } from '../dist-test/lib/distributionRegistry.js';
import { findDuplicateAxes, meaningDiff, projectScore, questionsFor } from '../dist-test/score/scoreModel.js';
import { intervalShifts, simulatePrior } from '../dist-test/score/priorSim.js';
import { initialEdges, initialNodes } from '../dist-test/samples/hierarchicalRegression.js';

const registry = new InMemoryDistributionRegistry(DISTRIBUTIONS.map(toCompilerDistributionDefinition));
const sample = () => compileCanvas(initialNodes, initialEdges).document;
const patch = (document, operations) => applyJsonPatch(document, operations).value;

test('score orders statements generatively and folds the generated observation binding', () => {
  const document = sample();
  const projection = projectScore(document, compileModel(document, registry));
  assert.deepEqual(projection.stages.map((stage) => stage.rows.map((row) => row.id)), [
    ['alpha_bar', 'tau_alpha', 'beta', 'sigma'],
    ['alpha'],
    ['x', 'group_id', 'mu', 'y'],
  ]);
  assert.equal(projection.byId.y.observedData.id, 'obs_y');
  assert.equal(projection.byId.tau_alpha.role, 'hierarchy');
  assert.equal(projection.byId.beta.role, 'belief');
});

test('duplicate plate axes are found and the fix compiles without diagnostics', () => {
  const document = sample();
  const findings = findDuplicateAxes(document);
  const group = findings.find((finding) => finding.id === 'dup-axis-group');
  assert.ok(group, 'alpha carries both j and group axes');
  const fixed = patch(document, group.fix.operations);
  assert.deepEqual(fixed.entities.alpha.valueType.axes.map((use) => use.axisId), ['j']);
  assert.equal(fixed.plates.group.axisId, 'j');
  assert.equal(fixed.axes.group, undefined);
  assert.equal(compileModel(fixed, registry).diagnostics.filter((item) => item.severity === 'error').length, 0);
  assert.equal(findDuplicateAxes(fixed).some((finding) => finding.id === 'dup-axis-group'), false);
});

test('meaning diff describes likelihood, prior scale, hierarchy and rationale changes', () => {
  const document = sample();
  const projection = projectScore(document, compileModel(document, registry));
  const tails = questionsFor(projection.byId.y, document).find((question) => question.id === 'tails');
  const robust = patch(document, tails.alternative.operations);
  assert.match(meaningDiff(document, robust)[0].sentence, /Normal から StudentT/);

  const wider = patch(document, [{ op: 'replace', path: '/entities/alpha_bar/distribution/args/sigma/source', value: '4' }]);
  const [scale] = meaningDiff(document, wider);
  assert.equal(scale.kind, 'prior');
  assert.match(scale.sentence, /×2、より広い/);

  const pooling = questionsFor(projection.byId.alpha, document).find((question) => question.id === 'need-hierarchy');
  const unpooled = patch(document, pooling.alternative.operations);
  assert.equal(meaningDiff(document, unpooled)[0].kind, 'hierarchy');

  const reasoned = patch(document, [{ op: 'add', path: '/entities/beta/priorRationale', value: '標準化した x の効果は ±2 以内' }]);
  assert.equal(meaningDiff(document, reasoned)[0].kind, 'assumption');
});

test('prior simulation is deterministic and a wider hyperprior widens everything downstream', () => {
  const document = sample();
  const projection = projectScore(document, compileModel(document, registry));
  const a = simulatePrior(document, projection);
  const again = simulatePrior(document, projection);
  assert.deepEqual(a.fan.quantiles, again.fan.quantiles);
  assert.equal(a.unsupported.length, 0);
  assert.ok(a.marginals.tau_alpha.every((value) => value >= 0));

  const wider = patch(document, [{ op: 'replace', path: '/entities/alpha_bar/distribution/args/sigma/source', value: '4' }]);
  const b = simulatePrior(wider, projectScore(wider, compileModel(wider, registry)));
  const shifts = intervalShifts(a, b);
  for (const id of ['alpha_bar', 'alpha', 'mu', 'y']) assert.ok(shifts[id] > 1.2, `${id} widens`);
  assert.equal(shifts.beta, undefined);
});
