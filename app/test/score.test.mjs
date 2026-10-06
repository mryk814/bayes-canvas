import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCanvas } from '../dist-test/lib/documentAdapter.js';
import { applyJsonPatch } from '../dist-test/lib/core/json-patch.js';
import { compileModel } from '../dist-test/lib/core/compiler.js';
import { InMemoryDistributionRegistry } from '../dist-test/lib/core/registry.js';
import { DISTRIBUTIONS, toCompilerDistributionDefinition } from '../dist-test/lib/distributionRegistry.js';
import { evidenceMatch, findDuplicateAxes, groupBySemantics, meaningDiff, projectScore, queryOperations, questionsFor } from '../dist-test/score/scoreModel.js';
import { createStableFingerprint } from '../dist-test/lib/core/fingerprint.js';
import { semanticFingerprint } from '../dist-test/lib/core/semantic-fingerprint.js';
import { validateModelEvidence } from '../dist-test/lib/modelEvidence.js';
import { inverseNormal, learningOf, morphDraws, posteriorsByEntity, powerScaledQuantiles, powerScalingDiagnosis, powerScalingRange, splitNormalQuantile } from '../dist-test/score/learning.js';
import { buildModelSpace, compareConclusions, generateVariantsPrompt, qoiOptions, validateVariantsEnvelope } from '../dist-test/score/modelSpace.js';
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

test('prior geometry finds the hierarchical funnel and the non-centered coordinates remove the neck', async () => {
  const { findFunnels, funnelGeometry, pairGeometry } = await import('../dist-test/score/geometry.js');
  const document = sample();
  const projection = projectScore(document, compileModel(document, registry));
  const funnels = findFunnels(document, projection);
  assert.deepEqual(funnels.map((spec) => [spec.childId, spec.scaleId, spec.locationId, spec.nonCentered]), [['alpha', 'tau_alpha', 'alpha_bar', false]]);

  const sim = simulatePrior(document, projection);
  const geometry = funnelGeometry(funnels[0], sim, document);
  assert.ok(geometry.neck > 8, `centered neck ratio ${geometry.neck}`);
  const widths = geometry.nonCentered.envelope.map((bin) => bin.hi - bin.lo);
  assert.ok(Math.max(...widths) / Math.min(...widths) < 2, 'non-centered spread is roughly constant across the scale');

  const declared = patch(document, [{ op: 'add', path: '/entities/alpha/hints', value: [{ kind: 'parameterization', value: 'non_centered' }] }]);
  assert.equal(findFunnels(declared, projectScore(declared, compileModel(declared, registry)))[0].nonCentered, true);

  const pairs = pairGeometry(projection.byId.y, sim, document);
  assert.deepEqual(pairs.map((pair) => pair.parentId).sort(), ['sigma']);
  assert.equal(pairs[0].cloud.xLabel, 'log sigma');
});

const semantic = (document) => semanticFingerprint(document).value;

test('semantic fingerprint ignores how the same model is written down', () => {
  const document = sample();
  const rewritten = patch(document, [
    { op: 'replace', path: '/revision', value: document.revision + 7 },
    { op: 'replace', path: '/documentId', value: 'other_document' },
    { op: 'replace', path: '/model/name', value: 'renamed model' },
    { op: 'add', path: '/entities/alpha/label', value: 'group intercepts' },
    { op: 'add', path: '/entities/alpha/notes', value: 'a note' },
    { op: 'add', path: '/entities/alpha/hints', value: [{ kind: 'parameterization', value: 'non_centered' }] },
    { op: 'add', path: '/entities/beta/priorRationale', value: 'effects are small on the standardized scale' },
    { op: 'replace', path: '/entityOrder', value: [...document.entityOrder].reverse() },
  ]);
  assert.notEqual(createStableFingerprint(rewritten).value, createStableFingerprint(document).value);
  assert.equal(semantic(rewritten), semantic(document));
});

test('semantic fingerprint normalizes the id of a generated observation binding', () => {
  const document = sample();
  const { obs_y: binding, ...rest } = document.entities;
  const renamed = {
    ...document,
    entities: { ...rest, y_data: { ...binding, id: 'y_data', authorship: 'imported' }, y: { ...document.entities.y, observedDataId: 'y_data' } },
    entityOrder: document.entityOrder.map((id) => (id === 'obs_y' ? 'y_data' : id)),
  };
  assert.equal(semantic(renamed), semantic(document));
});

test('semantic fingerprint changes when the probabilistic model changes', () => {
  const document = sample();
  const base = semantic(document);
  const changes = {
    distribution: [{ op: 'replace', path: '/entities/beta/distribution/distributionId', value: 'student_t' }],
    scale: [{ op: 'replace', path: '/entities/beta/distribution/args/sigma/source', value: '2.5' }],
    plate: [{ op: 'replace', path: '/entities/alpha/plateIds', value: [] }],
    observation: [{ op: 'add', path: '/entities/y/observationProcess', value: { kind: 'censored', direction: 'right' } }],
    assumption: [{ op: 'replace', path: '/plates/group/assumption', value: 'exchangeable' }],
  };
  for (const [name, operations] of Object.entries(changes)) {
    assert.notEqual(semantic(patch(document, operations)), base, name);
  }
});

test('evidence matches the implementation first, then the same probabilistic model', () => {
  const bundle = (fingerprint) => ({ specificationFingerprint: fingerprint });
  const keys = { implementation: 'impl-now', semantic: 'model-a', semanticOf: { 'impl-old': 'model-a', 'impl-other': 'model-b' } };
  assert.equal(evidenceMatch(bundle('impl-now'), keys), 'implementation');
  assert.equal(evidenceMatch(bundle('impl-old'), keys), 'semantic');
  assert.equal(evidenceMatch(bundle('impl-other'), keys), 'stale');
  assert.equal(evidenceMatch(bundle('impl-unknown'), keys), 'stale');
});

test('variants with the same semantic fingerprint are bundled in order', () => {
  const items = [{ id: 'a', key: 'x' }, { id: 'b', key: 'y' }, { id: 'c', key: 'x' }];
  assert.deepEqual(groupBySemantics(items, (item) => item.key).map((group) => group.map((item) => item.id)), [['a', 'c'], ['b']]);
});

const spaceInput = (id, label, document) => ({ id, label, document, implementation: createStableFingerprint(document).value, semantic: semantic(document) });
const posterior = (input, lo, mid, hi, assessment) => ({
  evidenceVersion: 'bayes-canvas-evidence@2',
  specificationFingerprint: input.implementation,
  runType: 'posterior_inference',
  createdAt: '2026-10-07T00:00:00.000Z',
  backend: 'fixture',
  status: 'passed',
  metrics: [],
  findings: [],
  notes: [],
  quantities: [{ entityId: 'beta', distribution: 'posterior', q05: lo, q50: mid, q95: hi }],
  ...(assessment ? { assessment } : {}),
});

test('model space groups candidates by assumption kind and names the assumption that flips the conclusion', () => {
  const document = sample();
  const current = spaceInput('current', '現在', document);
  const robust = spaceInput('v-robust', 'Student-t', patch(document, [
    { op: 'replace', path: '/entities/y/distribution/distributionId', value: 'student_t' },
    { op: 'add', path: '/entities/y/distribution/args/nu', value: { language: 'bayes-expr@1', source: '4' } },
  ]));
  const wide = spaceInput('v-wide', 'beta 広い', patch(document, [{ op: 'replace', path: '/entities/beta/distribution/args/sigma/source', value: '10' }]));
  const rewritten = spaceInput('v-nc', 'non-centered', patch(document, [
    { op: 'replace', path: '/revision', value: 9 },
    { op: 'add', path: '/entities/alpha/hints', value: [{ kind: 'parameterization', value: 'non_centered' }] },
  ]));
  const untested = spaceInput('v-pool', 'プールなし', patch(document, [{ op: 'replace', path: '/entities/alpha/distribution/args/sigma/source', value: '5' }]));
  const evidence = [
    posterior(current, 0.2, 0.5, 0.8, { stackingWeight: 0.6, divergences: 3 }),
    posterior(robust, -0.8, -0.5, -0.2, { stackingWeight: 0.4 }),
    posterior(wide, 0.1, 0.45, 0.9),
    { ...posterior(wide, -9, -9, -9), specificationFingerprint: 'unrelated' },
  ].map(validateModelEvidence);
  const semanticOf = Object.fromEntries([current, robust, wide, rewritten, untested].map((item) => [item.implementation, item.semantic]));
  const space = buildModelSpace({
    current,
    variants: [robust, wide, rewritten, untested],
    evidence,
    semanticOf,
    qoi: 'beta',
    priorInterval: () => ({ lo: -1, mid: 0, hi: 1 }),
  });

  assert.equal(space.groups[0].label, '基準（現在のモデル）');
  assert.deepEqual(space.groups[0].rows[0].candidate.memberLabels, ['non-centered']);
  const byLabel = Object.fromEntries(space.groups.flatMap((group) => group.rows.map((row) => [row.candidate.label, { group: group.label, row }])));
  assert.equal(byLabel['Student-t'].group, '観測モデル');
  assert.equal(byLabel['Student-t'].row.agreement, 'sign_flip');
  assert.equal(byLabel['beta 広い'].group, 'priorの信念');
  assert.equal(byLabel['beta 広い'].row.agreement, 'agree');
  assert.equal(byLabel['プールなし'].row.conclusion.source, 'prior_simulation');
  assert.equal(byLabel['プールなし'].row.agreement, 'incomparable');
  assert.equal(byLabel['プールなし'].row.assessment.evaluated, false);
  assert.deepEqual(space.groups[0].rows[0].assessment.flags, ['divergence 3']);
  assert.equal(space.headline, '観測モデルを変えた案だけ beta の符号が反転する。');
  assert.ok(space.domain[0] < -0.8 && space.domain[1] > 0.9);
  const onlyRobust = buildModelSpace({ current, variants: [robust, untested], evidence, semanticOf, qoi: 'beta', priorInterval: () => ({ lo: -1, mid: 0, hi: 1 }) });
  assert.equal(onlyRobust.headline, '観測モデルを変えた案で beta の符号が反転する。');
  const priorOnly = buildModelSpace({ current, variants: [untested], evidence: [], semanticOf, qoi: 'beta', priorInterval: () => ({ lo: -1, mid: 0, hi: 1 }) });
  assert.equal(priorOnly.basis, 'prior');
  assert.match(priorOnly.headline, /事前分布は揃っている/u);
});

test('conclusions compare like with like', () => {
  const post = (lo, hi) => ({ source: 'posterior', interval: { lo, mid: (lo + hi) / 2, hi } });
  assert.equal(compareConclusions(post(0.2, 0.8), post(1.5, 2)), 'shifted');
  assert.equal(compareConclusions(post(0.2, 0.8), post(-0.1, 2)), 'width');
  assert.equal(compareConclusions(post(0.2, 0.8), { source: 'prior_simulation', interval: { lo: -1, mid: 0, hi: 1 } }), 'incomparable');
  assert.equal(compareConclusions(post(0.2, 0.8), { source: 'none' }), 'missing');
});

test('evidence @2 carries quantity summaries and assessment; @1 stays readable', () => {
  const base = { specificationFingerprint: 'abc', runType: 'posterior_inference', createdAt: '2026-10-07T00:00:00.000Z', backend: 'fixture', status: 'passed', metrics: [], findings: [] };
  const v2 = validateModelEvidence({ ...base, evidenceVersion: 'bayes-canvas-evidence@2', quantities: [{ entityId: 'beta', distribution: 'posterior', q05: -1, q50: 0, q95: 1, draws: 4000 }], assessment: { stackingWeight: 0.3, maxRhat: 1.02 } });
  assert.equal(v2.quantities[0].draws, 4000);
  assert.equal(v2.assessment.maxRhat, 1.02);
  assert.throws(() => validateModelEvidence({ ...base, evidenceVersion: 'bayes-canvas-evidence@2', quantities: [{ entityId: 'beta', distribution: 'posterior', q05: 1, q50: 0, q95: 2 }] }), /q05/u);
  assert.throws(() => validateModelEvidence({ ...base, evidenceVersion: 'bayes-canvas-evidence@2', assessment: { stackingWeight: 1.5 } }), /stackingWeight/u);
  assert.throws(() => validateModelEvidence({ ...base, evidenceVersion: 'bayes-canvas-evidence@1' }), /runType/u);
  const v1 = validateModelEvidence({ ...base, evidenceVersion: 'bayes-canvas-evidence@1', runType: 'prior_predictive', quantities: [{ entityId: 'beta' }] });
  assert.equal(v1.quantities, undefined);
});

test('variants envelope and prompt ask for whole models that change one kind of assumption', () => {
  const document = sample();
  assert.deepEqual(qoiOptions(document), ['alpha_bar', 'tau_alpha', 'alpha', 'beta', 'sigma']);
  const withQuery = patch(document, queryOperations(document, 'beta'));
  assert.equal(qoiOptions(withQuery)[0], 'beta');
  const prompt = generateVariantsPrompt(withQuery, 'fp', ['beta'], 3);
  assert.match(prompt, /bayes-canvas-variants@1/u);
  assert.match(prompt, /Propose 3 alternative/u);
  const envelope = validateVariantsEnvelope({ variantsVersion: 'bayes-canvas-variants@1', variants: [{ label: 'A', model: document }] });
  assert.equal(envelope.variants[0].label, 'A');
  assert.throws(() => validateVariantsEnvelope({ variantsVersion: 'bayes-canvas-variants@1', variants: [] }), /1つ以上/u);
  assert.throws(() => validateVariantsEnvelope({ variantsVersion: 'bayes-canvas-variants@1', variants: [{ label: 'B' }] }), /model/u);
});

test('the prior morphs into the posterior along the optimal transport path', () => {
  assert.ok(Math.abs(inverseNormal(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(inverseNormal(0.001) + 3.090232) < 1e-5);
  const posterior = { q05: 0.2, q50: 0.5, q95: 0.9 };
  assert.ok(Math.abs(splitNormalQuantile(posterior, 0.05) - 0.2) < 1e-9);
  assert.ok(Math.abs(splitNormalQuantile(posterior, 0.95) - 0.9) < 1e-9);
  const prior = Array.from({ length: 2000 }, (_, index) => inverseNormal((index + 0.5) / 2000) * 2).reverse();
  assert.deepEqual(morphDraws(prior, posterior, 0), prior);
  const end = [...morphDraws(prior, posterior, 1)].sort((a, b) => a - b);
  assert.ok(Math.abs(end[100] - 0.2) < 0.01 && Math.abs(end[1000] - 0.5) < 0.01 && Math.abs(end[1900] - 0.9) < 0.01);
  const half = [...morphDraws(prior, posterior, 0.5)].sort((a, b) => a - b);
  assert.ok(Math.abs(half[1000] - 0.25) < 0.02);
});

test('learning separates statements the data informed from those the prior decides', () => {
  const prior = Array.from({ length: 2000 }, (_, index) => inverseNormal((index + 0.5) / 2000));
  const learned = learningOf(prior, { q05: 0.1, q50: 0.2, q95: 0.3 });
  assert.equal(learned.verdict, 'learned');
  assert.ok(Math.abs(learned.ratio - 0.2 / 3.29) < 0.01);
  assert.equal(learned.conflict, false);
  assert.equal(learningOf(prior, { q05: -1.6, q50: 0, q95: 1.6 }).verdict, 'prior_dominated');
  assert.equal(learningOf(prior, { q05: 1.0, q50: 1.2, q95: 1.4 }).verdict, 'learned');
  assert.equal(learningOf(prior, { q05: 1.9, q50: 2.1, q95: 2.3 }).conflict, true);
  assert.equal(learningOf([1, 2], { q05: 0, q50: 1, q95: 2 }), null);
});

test('power-scaling is diagnosed and interpolated in log alpha', () => {
  assert.equal(powerScalingDiagnosis({ priorSensitivity: 0.08, likelihoodSensitivity: 0.12 }), 'prior_data_conflict');
  assert.equal(powerScalingDiagnosis({ priorSensitivity: 0.08, likelihoodSensitivity: 0.01 }), 'strong_prior');
  assert.equal(powerScalingDiagnosis({ priorSensitivity: 0.01, likelihoodSensitivity: 0.2 }), 'ok');
  assert.equal(powerScalingDiagnosis(undefined), 'unknown');
  const quantity = {
    entityId: 'beta', distribution: 'posterior', q05: 0.2, q50: 0.5, q95: 0.8,
    powerScaling: { sequence: [{ component: 'prior', alpha: 0.5, q05: 0.3, q50: 0.6, q95: 0.9 }, { component: 'prior', alpha: 2, q05: 0.1, q50: 0.4, q95: 0.7 }] },
  };
  assert.deepEqual(powerScalingRange(quantity.powerScaling, 'prior'), [0.5, 2]);
  assert.equal(powerScalingRange(quantity.powerScaling, 'likelihood'), null);
  assert.equal(powerScaledQuantiles(quantity, 'prior', 1).q50, 0.5);
  assert.ok(Math.abs(powerScaledQuantiles(quantity, 'prior', Math.SQRT2).q50 - 0.45) < 1e-9);
  assert.equal(powerScaledQuantiles(quantity, 'prior', 4).q50, 0.4);
});

test('posterior summaries attach to entities directly or through a query', () => {
  const document = patch(sample(), queryOperations(sample(), 'beta'));
  const base = { evidenceVersion: 'bayes-canvas-evidence@2', specificationFingerprint: 'x', runType: 'posterior_inference', backend: 'fixture', status: 'passed', metrics: [], findings: [] };
  const older = validateModelEvidence({ ...base, createdAt: '2026-10-01T00:00:00.000Z', quantities: [{ entityId: 'qoi_beta', distribution: 'posterior', q05: 0, q50: 1, q95: 2 }, { entityId: 'sigma', distribution: 'posterior', q05: 0.5, q50: 0.7, q95: 0.9 }] });
  const newer = validateModelEvidence({ ...base, createdAt: '2026-10-07T00:00:00.000Z', quantities: [{ entityId: 'beta', distribution: 'posterior', q05: 0.2, q50: 0.5, q95: 0.8, powerScaling: { priorSensitivity: 0.02, likelihoodSensitivity: 0.1 } }, { entityId: 'tau_alpha', distribution: 'prior', q05: 0, q50: 1, q95: 2 }] });
  const posteriors = posteriorsByEntity(document, [older, newer]);
  assert.equal(posteriors.beta.quantity.q50, 0.5);
  assert.equal(posteriors.beta.quantity.powerScaling.likelihoodSensitivity, 0.1);
  assert.equal(posteriors.sigma.quantity.q50, 0.7);
  assert.equal(posteriors.tau_alpha, undefined);
  assert.throws(() => validateModelEvidence({ ...base, createdAt: '2026-10-07T00:00:00.000Z', quantities: [{ entityId: 'beta', distribution: 'posterior', q05: 0, q50: 1, q95: 2, powerScaling: { sequence: [{ component: 'prior', alpha: 0, q05: 0, q50: 1, q95: 2 }] } }] }), /alpha/u);
});
