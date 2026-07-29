import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileCanvas,
  buildCanvasHandoff,
  buildCapabilityReport,
  isPortablePackageImportCandidate,
  previewPortablePackageImport,
  projectToReactFlow,
} from '../dist-test/lib/documentAdapter.js';
import { parseExpression } from '../dist-test/lib/core/expression.js';
import { assertJsonComplexity } from '../dist-test/lib/core/migrations.js';
import { previewPatchProposal } from '../dist-test/lib/core/patch-proposal.js';
import { buildPortablePackage } from '../dist-test/lib/core/portable.js';
import { compareReceiptFingerprint, validateImplementationReceipt } from '../dist-test/lib/core/receipt.js';
import { buildModelViewProjections } from '../dist-test/lib/modelViewProjections.js';
import { getDynamicEdgeHandles } from '../dist-test/lib/edgeRouting.js';
import { initialEdges, initialNodes } from '../dist-test/samples/hierarchicalRegression.js';
import { modelTemplates } from '../dist-test/samples/modelTemplates.js';
import { modelCorpus } from '../dist-test/samples/modelCorpus.js';
import { minimalDistributionRegistry } from '../dist-test/lib/core/registry.js';
import { hierarchicalRegression } from '../dist-test/lib/core/example.js';
import { builtInBlockRegistry } from '../dist-test/lib/core/block-registry.js';
import { BLOCK_PRESETS } from '../dist-test/lib/structureBlockPresets.js';
import { dataContractToNodes, formatDataContract, parseDataContractInput } from '../dist-test/lib/dataContract.js';
import { formatProfileContract, profileDelimitedData } from '../dist-test/lib/dataProfiler.js';
import { extractJsonCandidates, parseImportJsonText } from '../dist-test/lib/importText.js';
import {
  buildModelScorecard,
  buildSensitivityScenarios,
  generateCriticismPrompt,
  generateModelCardMarkdown,
  persistModelEvidence,
  validateModelEvidence,
} from '../dist-test/lib/modelEvidence.js';
import {
  applyModelingRecipe,
  buildPriorPredictivePlan,
  compareModelVariant,
  createModelVariant,
  generatePriorPredictivePrompt,
} from '../dist-test/lib/modelWorkbench.js';
import { compileModel } from '../dist-test/lib/core/compiler.js';
import { loadModelDocumentContract } from '../dist-test/lib/core/import-contract.js';
import { validateExternalDataContract } from '../dist-test/lib/core/security.js';
import { TARGET_PROFILES } from '../dist-test/lib/core/target-profiles.js';
import { createStableFingerprint, sha256Hex } from '../dist-test/lib/core/fingerprint.js';
import {
  DISTRIBUTIONS,
  formatDistributionTex,
  formatDistributionText,
  normalizeDistributionId,
  toCompilerDistributionDefinition,
} from '../dist-test/lib/distributionRegistry.js';
import {
  validateImplementationReceiptEnvelope,
  validateAiPatchProposalEnvelope,
  validateLayoutDocumentEnvelope,
  validateModelDocumentEnvelope,
} from '../dist-test/lib/core/schema-validation.js';

test('parses indexed Bayesian expressions', () => {
  const parsed = parseExpression('alpha[group_id[i]] + beta * x[i]');
  assert.equal(parsed.ok, true);
});

test('imports role-aware data contracts without inventing a model', () => {
  const contract = parseDataContractInput([
    'name,type,role,shape,unit,missing,levels',
    'temperature,real,predictor,N,C,none,',
    'failure,boolean,outcome,N,,possible,',
    'batch_id,category,index,N,,none,A|B',
  ].join('\n'));
  assert.equal(contract.fields.length, 3);
  assert.equal(contract.fields[1].role, 'outcome');
  const nodes = dataContractToNodes(contract, ['data_temperature'], 0);
  assert.equal(nodes[0].id, 'data_temperature_2');
  assert.equal(nodes[1].data.observationProcess.mechanism, 'unspecified');
  assert.match(nodes[2].data.notes, /Levels: A, B/u);
  assert.match(formatDataContract(contract), /temperature,real,predictor,N,C,none/u);
  assert.throws(
    () => parseDataContractInput('x,real,predictor,N,,none,'),
    /role=outcome/u,
  );
});

test('extracts balanced import JSON from natural AI responses', () => {
  const response = [
    'Here is the model. The note {outside JSON} is not the payload.',
    '```json',
    '{"schemaVersion":"1.0.0","nested":{"text":"brace } inside string"}}',
    '```',
    'You can import it now.',
  ].join('\n');
  assert.equal(extractJsonCandidates(response).length >= 2, true);
  assert.deepEqual(
    parseImportJsonText(response, { maxBytes: 10000, maxDepth: 20 }),
    { schemaVersion: '1.0.0', nested: { text: 'brace } inside string' } },
  );
});

test('profiles CSV data into an editable canonical data contract', () => {
  const profile = profileDelimitedData([
    'outcome,temperature,group_id,known_se,note',
    '12.5,20.1,A,0.3,"stable, measured"',
    'NA,21.4,B,0.4,"repeat"',
    '10.2,19.8,A,0.2,"stable, measured"',
  ].join('\n'));
  assert.equal(profile.rowCount, 3);
  assert.equal(profile.columns[0].field.role, 'outcome');
  assert.equal(profile.columns[0].field.missing, 'possible');
  assert.equal(profile.columns[2].field.role, 'index');
  assert.equal(profile.columns[3].field.role, 'known_error');
  assert.deepEqual(profile.columns[2].field.levels, ['A', 'B']);
  assert.match(formatProfileContract(profile), /known_se,positive,known_error,N,,none/u);

  const nodes = dataContractToNodes(profile.contract, [], 0);
  const compiled = compileCanvas(nodes, []);
  assert.equal(compiled.document.entities.data_outcome.dataRole, 'observed_value');
  assert.equal(compiled.document.entities.data_group_id.valueType.scalar, 'category');
  assert.equal(compiled.document.entities.data_known_se.dataRole, 'known_error');
  const projected = projectToReactFlow({ document: compiled.document, layout: compiled.layout });
  assert.equal(projected.nodes.find((node) => node.id === 'data_known_se').data.scalarType, 'real');
  assert.equal(projected.nodes.find((node) => node.id === 'data_known_se').data.dataRole, 'known_error');
  const roundTripped = compileCanvas(projected.nodes, projected.edges);
  assert.equal(roundTripped.document.entities.data_known_se.valueType.domain.kind, 'positive');
});

test('validates model evidence and builds scorecard, sensitivity, and model card outputs', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const fingerprint = 'abc123';
  const evidence = validateModelEvidence({
    evidenceVersion: 'bayes-canvas-evidence@1',
    specificationFingerprint: fingerprint,
    runType: 'prior_predictive',
    createdAt: '2026-07-29T00:00:00.000Z',
    backend: 'numpyro',
    status: 'review',
    metrics: [{
      id: 'range-y',
      label: 'y range',
      value: '[-3, 3]',
      status: 'pass',
      entityIds: ['y'],
    }],
    findings: [{
      id: 'wide-beta',
      severity: 'warning',
      title: 'beta prior is wide',
      detail: 'Prior predictive tails exceed the plausible range.',
      entityIds: ['beta'],
      suggestedPatch: [{
        op: 'replace',
        path: '/entities/beta/distribution/args/sigma/source',
        value: '0.5',
      }],
    }],
    notes: [],
  });
  assert.equal(evidence.metrics[0].status, 'pass');
  const scorecard = buildModelScorecard(compiled.document, compiled.semantic.diagnostics);
  assert.equal(scorecard.dimensions.length, 5);
  assert.ok(scorecard.overall > 0);
  const scenarios = buildSensitivityScenarios(compiled.document);
  assert.ok(scenarios.some((scenario) => scenario.id.includes('beta')));
  assert.ok(scenarios.some((scenario) => scenario.id.includes('student-t')));
  assert.match(generateCriticismPrompt(compiled.document, fingerprint, scenarios), /bayes-canvas-evidence@1/u);
  assert.match(generateModelCardMarkdown(compiled.document, [], scorecard, [evidence]), /Validation evidence/u);
});

test('bounds the local Evidence ledger while preserving the newest runs', () => {
  const previousLocalStorage = globalThis.localStorage;
  let stored = '';
  globalThis.localStorage = {
    getItem: () => stored || null,
    removeItem: () => {
      stored = '';
    },
    setItem: (_key, value) => {
      stored = value;
    },
  };
  try {
    const runs = Array.from({ length: 31 }, (_, index) => ({
      evidenceVersion: 'bayes-canvas-evidence@1',
      specificationFingerprint: `fingerprint-${index}`,
      runType: 'prior_predictive',
      createdAt: '2026-07-29T00:00:00.000Z',
      backend: 'numpyro',
      status: 'passed',
      metrics: [],
      findings: [],
      notes: [],
    }));
    const bounded = persistModelEvidence(runs);
    assert.equal(bounded.length, 30);
    assert.equal(bounded[0].specificationFingerprint, 'fingerprint-0');
    assert.equal(JSON.parse(stored).at(-1).specificationFingerprint, 'fingerprint-29');

    const largeRuns = runs.slice(0, 3).map((run) => ({ ...run, notes: ['x'.repeat(900_000)] }));
    const sizeBounded = persistModelEvidence(largeRuns);
    assert.equal(sizeBounded.length, 2);
    assert.equal(sizeBounded[0].specificationFingerprint, 'fingerprint-0');
  } finally {
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});

test('compares persisted model variants and builds prior predictive review prompts', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const variant = createModelVariant('baseline', compiled.document, compiled.layout, 0);
  const changed = structuredClone(compiled.document);
  changed.entities.beta.distribution.args.sigma.source = '5';
  const comparison = compareModelVariant(variant, changed);
  assert.ok(comparison.changes.some((item) => item.kind === 'entity_distribution_changed'));
  assert.equal(comparison.critical, 0);

  const checks = buildPriorPredictivePlan(compiled.document);
  assert.ok(checks.some((item) => item.id.startsWith('prior-')));
  assert.ok(checks.some((item) => item.id.startsWith('likelihood-') && item.status === 'ready'));
  assert.match(generatePriorPredictivePrompt(compiled.document), /Do not fit posterior inference/u);
});

test('applies reusable modeling recipes as reversible canvas replacements', () => {
  const robust = applyModelingRecipe('robust_likelihood', initialNodes, initialEdges);
  assert.equal(robust.nodes.find((node) => node.data.kind === 'likelihood').data.distribution.id, 'student_t');
  assert.equal(initialNodes.find((node) => node.data.kind === 'likelihood').data.distribution.id, 'normal');

  const nonCentered = applyModelingRecipe('non_centered_hierarchy', initialNodes, initialEdges);
  assert.ok(nonCentered.nodes.some((node) =>
    node.data.hints?.some((hint) => hint.kind === 'parameterization' && hint.value === 'non_centered')));
});

test('parses extended expression syntax used by model blocks', () => {
  for (const expression of [
    'GP(x; kernel=RBF, lengthscale=ell)',
    'lower <= y[i]',
    'beta[1:K]',
    'dot(X[i,], beta)',
    'math.log(exposure[i])',
    'X @ beta + alpha',
    'normal_lpdf(y | mu, sigma)',
  ]) {
    const parsed = parseExpression(expression);
    assert.equal(parsed.ok, true, expression);
  }
});

test('compiles the canvas sample through ModelDocument and LayoutDocument', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  assert.equal(compiled.document.schemaVersion, '1.0.0');
  assert.equal(compiled.layout.modelDocumentId, compiled.document.documentId);
  assert.ok(compiled.semantic.symbols.alpha);
  assert.ok(compiled.semantic.dependencyEdges.some((edge) => edge.from === 'beta' && edge.to === 'mu'));
});

test('compiles model templates into canvas documents', () => {
  assert.ok(modelTemplates.length >= 3);
  assert.equal(new Set(modelTemplates.map((template) => template.id)).size, modelTemplates.length);
  const handoffTargets = ['review', 'pymc', 'numpyro', 'stan'];
  for (const template of modelTemplates) {
    assert.ok(template.track.length > 0, template.id);
    assert.ok(template.learningGoals.length > 0 && template.learningGoals.length <= 2, template.id);
    assert.ok(template.description.length > 0, template.id);
    for (const node of template.nodes.filter((candidate) => candidate.data.kind === 'hyperparameter')) {
      assert.ok(node.data.distribution, `${template.id}:${node.id} hyperparameter must have a prior`);
    }
    const compiled = compileCanvas(template.nodes, template.edges);
    assert.equal(compiled.layout.modelDocumentId, compiled.document.documentId, template.id);
    assert.ok(compiled.document.entityOrder.length >= 4, template.id);
    assert.ok(Array.isArray(compiled.semantic.diagnostics), template.id);
    if (template.status === 'clean') {
      assert.equal(compiled.semantic.readiness.summary.errors, template.expectedDiagnostics.errors, template.id);
      assert.equal(compiled.semantic.readiness.summary.warnings, template.expectedDiagnostics.warnings, template.id);
    }
    for (const target of handoffTargets) {
      const targetCompiled = compileCanvas(template.nodes, template.edges, target);
      assert.equal(targetCompiled.semantic.readiness.handoff, 'ready', `${template.id}:${target}`);
    }
  }
  assert.equal(modelTemplates.filter((template) => template.sampleKind === 'case-study').length, 1);
});

test('preserves event axes for multivariate template nodes', () => {
  const template = modelTemplates.find((candidate) => candidate.id === 'correlated-outcome-panel');
  assert.ok(template);

  const compiled = compileCanvas(template.nodes, template.edges);
  assert.deepEqual(
    compiled.document.entities.beta.valueType.axes.map((axis) => `${axis.role}:${axis.axisId}`),
    ['event:k'],
  );
  assert.deepEqual(
    compiled.document.entities.coef_chol.valueType.axes.map((axis) => `${axis.role}:${axis.axisId}`),
    ['event:k', 'event:k'],
  );
  assert.deepEqual(
    compiled.document.entities.outcome_chol.valueType.axes.map((axis) => `${axis.role}:${axis.axisId}`),
    ['event:k', 'event:k'],
  );
  assert.equal(compiled.document.entities.outcome_chol.valueType.domain?.kind, 'cholesky_factor_corr');
  assert.deepEqual(
    compiled.document.entities.y.valueType.axes.map((axis) => `${axis.role}:${axis.axisId}`),
    ['batch:n', 'batch:obs', 'event:k'],
  );
  assert.equal(compiled.semantic.readiness.summary.errors, 0);

  const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic, 'review');
  const preview = previewPortablePackageImport(pkg);
  const projectedOutcome = preview.projected.nodes.find((node) => node.id === 'y');
  const projectedOutcomeChol = preview.projected.nodes.find((node) => node.id === 'outcome_chol');
  assert.deepEqual(projectedOutcome?.data.eventShape, ['K']);
  assert.deepEqual(projectedOutcomeChol?.data.eventShape, ['K', 'K']);
});

test('keeps template model semantics explicit enough for handoff', () => {
  const hierarchical = modelTemplates.find((candidate) => candidate.id === 'hierarchical-regression');
  const measurementError = modelTemplates.find((candidate) => candidate.id === 'measurement-error-regression');
  const smallBnn = modelTemplates.find((candidate) => candidate.id === 'small-bnn-regression');
  const choiceSet = modelTemplates.find((candidate) => candidate.id === 'variable-choice-set');
  const trajectory = modelTemplates.find((candidate) => candidate.id === 'latent-trajectory-series');
  assert.ok(hierarchical);
  assert.ok(measurementError);
  assert.ok(smallBnn);
  assert.ok(choiceSet);
  assert.ok(trajectory);

  const hierarchicalById = new Map(hierarchical.nodes.map((node) => [node.id, node]));
  assert.equal(hierarchicalById.get('alpha')?.data.plate, 'group');
  assert.equal(hierarchicalById.has('x_true'), false);
  assert.equal(hierarchicalById.has('y_limit'), false);
  assert.match(String(hierarchicalById.get('mu')?.data.expression), /x\[i\]/u);

  const measurementById = new Map(measurementError.nodes.map((node) => [node.id, node]));
  assert.equal(measurementById.get('x_true')?.data.kind, 'latent');
  assert.equal(measurementById.get('x_obs')?.data.observationProcess?.kind, 'measurement_error');
  assert.match(String(measurementById.get('mu')?.data.expression), /x_true\[i\]/u);

  const bnnById = new Map(smallBnn.nodes.map((node) => [node.id, node]));
  assert.equal(bnnById.get('tau_hidden')?.data.kind, 'hyperparameter');
  assert.equal(bnnById.get('tau_output')?.data.kind, 'hyperparameter');
  assert.equal(bnnById.get('hidden_weight')?.data.distribution?.args.sigma, 'tau_hidden');
  assert.equal(bnnById.get('output_weight')?.data.distribution?.args.sigma, 'tau_output');
  assert.deepEqual(bnnById.get('hidden')?.data.eventShape, ['H']);
  assert.match(String(bnnById.get('hidden')?.data.expression), /inv_logit/u);
  assert.match(String(bnnById.get('mu')?.data.expression), /dot\(hidden\[i\], output_weight\)/u);

  const choiceById = new Map(choiceSet.nodes.map((node) => [node.id, node]));
  assert.equal(choiceById.has('person_bias'), false);
  assert.match(String(choiceById.get('choice_prob')?.data.expression), /person_quality_shift\[person_id\[i\]\]/u);
  assert.match(String(choiceById.get('qoi_price_tradeoff')?.data.expression), /mean\(person_quality_shift\)/u);

  const trajectoryById = new Map(trajectory.nodes.map((node) => [node.id, node]));
  assert.equal(trajectoryById.get('level_innovation')?.data.kind, 'latent');
  assert.equal(trajectoryById.get('level')?.data.kind, 'deterministic');
  assert.match(String(trajectoryById.get('level')?.data.expression), /cumulative_sum\(level_innovation\[t\]\)/u);
});

test('keeps generated observation data out of the projected canvas', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  assert.equal(compiled.document.entities.obs_y?.authorship, 'generated');
  assert.equal(compiled.document.entities.y.observedDataId, 'obs_y');
  assert.ok(compiled.layout.hiddenEntityIds?.includes('obs_y'));

  const projected = projectToReactFlow({ document: compiled.document, layout: compiled.layout });
  assert.ok(!projected.nodes.some((node) => node.id === 'obs_y'));
  assert.ok(projected.nodes.some((node) => node.id === 'y'));
});

test('builds a contract-backed handoff bundle', () => {
  const bundle = buildCanvasHandoff(initialNodes, initialEdges, 'pymc');
  assert.equal(bundle.manifest.bundleVersion, '1.0.0');
  assert.equal(bundle.manifest.fingerprintAlgorithm, 'sha256');
  assert.match(bundle.manifest.specificationFingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(bundle.implementationContract.preserveEntityIds, true);
  assert.ok(bundle.capabilityReport.length >= 2);
  assert.ok(bundle.capabilityReport.some((item) => (
    item.feature === 'halfnormal distribution'
    && item.support === 'native'
    && item.note === 'Backend name: pm.HalfNormal'
  )));
});

test('projects the sample model into synchronized model views', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const handoff = buildCanvasHandoff(initialNodes, initialEdges, 'review');
  const projections = buildModelViewProjections({
    document: compiled.document,
    semantic: compiled.semantic,
    handoff,
  });

  assert.deepEqual(
    projections.map((projection) => projection.id),
    ['canvas', 'equations', 'story', 'structure', 'contract'],
  );

  const diagnosticFingerprints = compiled.semantic.diagnostics.map((diagnostic) =>
    `${diagnostic.code}|${diagnostic.path}|${diagnostic.message}`,
  );
  for (const projection of projections) {
    assert.equal(projection.source.documentId, compiled.document.documentId, projection.id);
    assert.equal(projection.source.revision, compiled.document.revision, projection.id);
    assert.ok(projection.consumes.length > 0, projection.id);
    assert.ok(projection.sections.length > 0, projection.id);
    assert.deepEqual(
      projection.diagnosticLinks.map((diagnostic) => `${diagnostic.code}|${diagnostic.path}|${diagnostic.message}`),
      diagnosticFingerprints,
      projection.id,
    );
  }

  const story = projections.find((projection) => projection.id === 'story');
  const equations = projections.find((projection) => projection.id === 'equations');
  const structure = projections.find((projection) => projection.id === 'structure');
  const contract = projections.find((projection) => projection.id === 'contract');
  assert.ok(story?.copyText.includes('alpha'));
  assert.ok(equations?.sections.some((section) => section.id === 'equation-compiler'));
  assert.ok(structure?.sections.some((section) => section.id === 'structure-index-mapping'));
  assert.ok(contract?.sections.some((section) => section.id === 'contract-observed'));
});

test('routes canvas edges through the shortest readable handle pair', () => {
  assert.deepEqual(
    getDynamicEdgeHandles(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 120, y: 150, width: 100, height: 100 },
    ),
    { sourceHandle: 'source-bottom', targetHandle: 'target-left' },
  );
  assert.deepEqual(
    getDynamicEdgeHandles(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 130, y: -120, width: 100, height: 100 },
    ),
    { sourceHandle: 'source-right', targetHandle: 'target-bottom' },
  );
  assert.deepEqual(
    getDynamicEdgeHandles(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: -120, y: 130, width: 100, height: 100 },
    ),
    { sourceHandle: 'source-bottom', targetHandle: 'target-right' },
  );
});

test('rejects over-large imports before replacing current work', () => {
  assert.throws(
    () => assertJsonComplexity(JSON.stringify({ nodes: [], edges: [] }), { maxBytes: 4, maxDepth: 8 }),
    /too large/u,
  );
});

test('previews AI patch proposals through sandbox compile and semantic diff', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const preview = previewPatchProposal(compiled.document, {
    proposalVersion: '1.0.0',
    baseDocumentId: compiled.document.documentId,
    baseRevision: compiled.document.revision,
    intent: 'Rename beta',
    author: 'ai',
    operations: [{ op: 'replace', path: '/entities/beta/symbol', value: 'slope' }],
  }, minimalDistributionRegistry);
  assert.ok(preview.semanticDiff.some((item) => item.kind === 'entity_symbol_changed'));

  const shapePreview = previewPatchProposal(compiled.document, {
    proposalVersion: '1.0.0',
    baseDocumentId: compiled.document.documentId,
    baseRevision: compiled.document.revision,
    intent: 'Change beta value type',
    author: 'ai',
    operations: [{ op: 'add', path: '/entities/beta/valueType/axes/-', value: { axisId: 'group', role: 'batch' } }],
  }, minimalDistributionRegistry);
  assert.ok(shapePreview.semanticDiff.some((item) => (
    item.kind === 'entity_value_type_changed'
    && item.severity === 'critical'
  )));
});

test('builds a portable package with model and layout separated', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const capabilityReport = buildCapabilityReport(compiled.document, 'pymc');
  const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic, 'pymc', capabilityReport);
  assert.equal(pkg.manifest.fingerprintAlgorithm, 'sha256');
  assert.match(pkg.manifest.fingerprint, /^[0-9a-f]{64}$/u);
  assert.ok(pkg.files['model.json']);
  assert.ok(pkg.files['layout.json']);
  assert.ok(pkg.files['canvasEdges.json']);
  assert.ok(pkg.files['handoff.json']);

  const restoredModel = JSON.parse(pkg.files['model.json']);
  const restoredLayout = JSON.parse(pkg.files['layout.json']);
  const restoredEdges = JSON.parse(pkg.files['canvasEdges.json']);
  const restoredHandoff = JSON.parse(pkg.files['handoff.json']);
  assert.equal(JSON.stringify(restoredModel), JSON.stringify(compiled.document));
  assert.equal(JSON.stringify(restoredLayout), JSON.stringify(compiled.layout));
  assert.equal(restoredEdges.length, initialEdges.length);
  assert.deepEqual(restoredHandoff.capabilityReport, capabilityReport);
  assert.equal(pkg.manifest.fingerprint, createStableFingerprint({ model: restoredModel, layout: restoredLayout }).value);
});

test('rejects unsafe AI patch operations before applying them', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const base = {
    proposalVersion: '1.0.0',
    baseDocumentId: compiled.document.documentId,
    baseRevision: compiled.document.revision,
    intent: 'invalid edit',
    author: 'ai',
  };

  assert.throws(
    () => previewPatchProposal(compiled.document, {
      ...base,
      operations: [{ op: 'replace', path: '/documentId', value: 'other' }],
    }, minimalDistributionRegistry),
    /documentId/u,
  );
  assert.throws(
    () => previewPatchProposal(compiled.document, {
      ...base,
      operations: [{ op: 'add', path: '/entityOrder/999', value: 'ghost' }],
    }, minimalDistributionRegistry),
    /Array index out of range/u,
  );
  assert.throws(
    () => previewPatchProposal(compiled.document, {
      ...base,
      operations: [{ op: 'replace', path: '/entities/beta/id', value: 'renamed_beta' }],
    }, minimalDistributionRegistry),
    /stable entity IDs/u,
  );
});

test('previews portable package imports after strict validation', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic);
  const preview = previewPortablePackageImport(pkg);
  assert.equal(preview.document.documentId, compiled.document.documentId);
  assert.equal(preview.projected.nodes.length, initialNodes.length);
  assert.equal(preview.projected.edges.length, initialEdges.length);
  assert.equal(preview.edgeSummary.source, 'canvasEdges.json');
  assert.ok(preview.summary.includes('diagnostics'));

  assert.throws(
    () => previewPortablePackageImport({
      ...pkg,
      files: {
        ...pkg.files,
        'model.json': JSON.stringify({ ...compiled.document, typo: true }),
      },
    }),
    /model\.json\/typo/u,
  );
  assert.throws(
    () => previewPortablePackageImport({
      ...pkg,
      files: {
        ...pkg.files,
        'layout.json': JSON.stringify({ ...compiled.layout, typo: true }),
      },
    }),
    /layout\.json\/typo/u,
  );
});

test('previews natural AI import packages with nested JSON values', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic);
  const naturalPackage = {
    packageVersion: 'bayes-canvas-ai-import@1',
    model: compiled.document,
    canvasEdges: JSON.parse(pkg.files['canvasEdges.json']),
    decisions: [
      {
        id: 'note_source',
        kind: 'implementation_note',
        text: 'Converted from an external AI response.',
        status: 'open',
        relatedEntityIds: [],
        author: 'ai',
      },
    ],
  };

  assert.equal(isPortablePackageImportCandidate(naturalPackage), true);
  const preview = previewPortablePackageImport(naturalPackage);
  assert.equal(preview.projected.nodes.length, initialNodes.length);
  assert.equal(preview.projected.edges.length, initialEdges.length);
  assert.equal(preview.edgeSummary.source, 'canvasEdges.json');
  assert.ok(preview.importWarnings.some((warning) => warning.includes('layout.json was missing')));
});

test('projects tagged AI import hyperparameters as hyperparameter nodes', () => {
  const preview = previewPortablePackageImport({
    packageVersion: 'bayes-canvas-ai-import@1',
    model: {
      schemaVersion: '1.0.0',
      documentId: 'model_tagged_hierarchy',
      revision: 1,
      model: { id: 'tagged_hierarchy', name: 'Tagged hierarchy' },
      axes: {
        group: { id: 'group', symbol: 'j', label: 'Groups', size: { language: 'bayes-expr@1', source: 'J' } },
      },
      plates: {
        group: { id: 'group', label: 'Groups', axisId: 'group', indexSymbol: 'j', parentPlateIds: [], assumption: 'exchangeable' },
      },
      entities: {
        alpha_bar: {
          id: 'alpha_bar',
          symbol: 'alpha_bar',
          kind: 'random_variable',
          role: 'parameter',
          tags: ['hyperparameter'],
          valueType: { scalar: 'real', axes: [] },
          plateIds: [],
          distribution: { distributionId: 'normal', args: { mu: 0, sigma: 2 } },
        },
        tau_alpha: {
          id: 'tau_alpha',
          symbol: 'tau_alpha',
          kind: 'random_variable',
          role: 'parameter',
          tags: ['hyperparameter'],
          valueType: { scalar: 'real', axes: [], domain: { kind: 'positive' } },
          plateIds: [],
          distribution: { distributionId: 'halfnormal', args: { sigma: 1 } },
        },
        alpha: {
          id: 'alpha',
          symbol: 'alpha',
          kind: 'random_variable',
          role: 'parameter',
          valueType: { scalar: 'real', axes: [{ axisId: 'group', role: 'batch' }] },
          plateIds: ['group'],
          distribution: {
            distributionId: 'normal',
            args: {
              mu: { language: 'bayes-expr@1', source: 'alpha_bar' },
              sigma: { language: 'bayes-expr@1', source: 'tau_alpha' },
            },
          },
        },
      },
      entityOrder: ['alpha_bar', 'tau_alpha', 'alpha'],
      notes: {},
      noteOrder: [],
    },
    canvasEdges: [
      { id: 'alpha-bar-to-alpha', from: 'alpha_bar', to: 'alpha', role: 'prior-parameter' },
      { id: 'tau-alpha-to-alpha', from: 'tau_alpha', to: 'alpha', role: 'prior-parameter' },
    ],
  });

  assert.equal(preview.projected.nodes.find((node) => node.id === 'alpha_bar')?.data.kind, 'hyperparameter');
  assert.equal(preview.projected.nodes.find((node) => node.id === 'tau_alpha')?.data.kind, 'hyperparameter');
  assert.equal(preview.projected.nodes.find((node) => node.id === 'alpha')?.data.kind, 'parameter');
});

test('previews raw ModelDocument imports by deriving layout and links', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  assert.equal(isPortablePackageImportCandidate(compiled.document), true);

  const preview = previewPortablePackageImport(compiled.document);
  assert.equal(preview.document.documentId, compiled.document.documentId);
  assert.equal(preview.projected.nodes.length, initialNodes.length);
  assert.equal(preview.projected.edges.length, initialEdges.length);
  assert.equal(preview.edgeSummary.source, 'model extension');
  assert.ok(preview.importWarnings.some((warning) => warning.includes('raw ModelDocument')));
});

test('previews file-entry portable packages without stringified nested JSON', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic);
  const fileEntryPackage = {
    files: [
      { path: 'model.bayescanvas/model.json', content: compiled.document },
      { path: 'model.bayescanvas/layout.json', content: compiled.layout },
      { path: 'model.bayescanvas/canvasEdges.json', content: JSON.parse(pkg.files['canvasEdges.json']) },
    ],
  };

  const preview = previewPortablePackageImport(fileEntryPackage);
  assert.equal(preview.projected.nodes.length, initialNodes.length);
  assert.equal(preview.projected.edges.length, initialEdges.length);
  assert.equal(preview.edgeSummary.source, 'canvasEdges.json');
});

test('normalizes common AI-authored ModelDocument aliases before previewing imports', () => {
  const preview = previewPortablePackageImport({
    packageVersion: 'bayes-canvas-ai-import@1',
    model: {
      schemaVersion: '1.0.0',
      documentId: 'model_ai_alias_regression',
      revision: 1,
      model: { id: 'ai_alias_regression', name: 'AI alias regression' },
      axes: {
        obs: { id: 'obs', name: 'Observations', symbol: 'i', description: 'Rows.' },
      },
      plates: {
        obs: { id: 'obs', name: 'Observation plate', axisIds: ['obs'], indexSymbol: 'i', sizeSymbol: 'N' },
      },
      entities: {
        x: {
          id: 'x',
          symbol: 'x',
          kind: 'data',
          valueType: 'vector',
          plateIds: ['obs'],
          description: 'Predictor.',
        },
        y: {
          id: 'y',
          symbol: 'y',
          kind: 'data',
          valueType: 'vector',
          plateIds: ['obs'],
          description: 'Observed response.',
        },
        alpha: {
          id: 'alpha',
          symbol: 'alpha',
          kind: 'random_variable',
          valueType: 'scalar',
          plateIds: [],
          role: 'parameter',
          distribution: { distributionId: 'normal', args: { mu: 0, sigma: 1 } },
        },
        beta: {
          id: 'beta',
          symbol: 'beta',
          kind: 'random_variable',
          valueType: 'scalar',
          plateIds: [],
          role: 'parameter',
          distribution: { distributionId: 'normal', args: { mu: 0, sigma: 1 } },
        },
        sigma: {
          id: 'sigma',
          symbol: 'sigma',
          kind: 'random_variable',
          valueType: 'positive_scalar',
          plateIds: [],
          role: 'parameter',
          distribution: { distributionId: 'exponential', args: { rate: 1 } },
        },
        mu: {
          id: 'mu',
          symbol: 'mu',
          kind: 'deterministic',
          valueType: 'vector',
          plateIds: ['obs'],
          expression: { language: 'bayes-expr@1', source: 'x @ beta + alpha' },
        },
        y_likelihood: {
          id: 'y_likelihood',
          symbol: 'y_likelihood',
          kind: 'factor',
          valueType: 'log_density',
          plateIds: [],
          logDensity: { language: 'bayes-expr@1', source: 'normal_lpdf(y | mu, sigma)' },
        },
      },
      entityOrder: ['x', 'y', 'alpha', 'beta', 'sigma', 'mu', 'y_likelihood'],
      notes: {},
      noteOrder: [],
    },
    canvasEdges: [
      { id: 'x-to-mu', from: 'x', to: 'mu', role: 'expression' },
      { id: 'beta-to-mu', from: 'beta', to: 'mu', role: 'expression' },
      { id: 'mu-to-y-likelihood', from: 'mu', to: 'y_likelihood', role: 'expression' },
    ],
  });

  assert.equal(preview.projected.nodes.length, 7);
  assert.equal(preview.edgeSummary.source, 'canvasEdges.json');
  assert.equal(preview.semantic.diagnostics.some((diagnostic) => diagnostic.blocksHandoff), false);
  const likelihoodNode = preview.projected.nodes.find((node) => node.id === 'y_likelihood');
  assert.equal(likelihoodNode?.data.kind, 'likelihood');
  assert.equal(likelihoodNode?.data.distribution.id, 'normal');
  assert.equal(likelihoodNode?.data.distribution.args.mu, 'mu');
});

test('projects standard factor log densities as editable likelihood nodes', () => {
  const preview = previewPortablePackageImport({
    packageVersion: 'bayes-canvas-ai-import@1',
    model: {
      schemaVersion: '1.0.0',
      documentId: 'model_factor_student_t',
      revision: 1,
      model: { id: 'factor_student_t', name: 'Factor Student-t' },
      axes: {
        obs: { id: 'obs', symbol: 'i', label: 'Rows', size: { language: 'bayes-expr@1', source: 'N' } },
      },
      plates: {
        obs: { id: 'obs', label: 'Rows', axisId: 'obs', indexSymbol: 'i', parentPlateIds: [], assumption: 'conditionally_independent' },
      },
      entities: {
        y: {
          id: 'y',
          symbol: 'y',
          kind: 'data',
          dataRole: 'observed_value',
          valueType: { scalar: 'real', axes: [{ axisId: 'obs', role: 'batch' }] },
          plateIds: ['obs'],
        },
        nu_y: {
          id: 'nu_y',
          symbol: 'nu_y',
          kind: 'random_variable',
          role: 'parameter',
          valueType: { scalar: 'real', axes: [], domain: { kind: 'positive' } },
          plateIds: [],
          distribution: { distributionId: 'exponential', args: { rate: { language: 'bayes-expr@1', source: '0.1' } } },
        },
        mu_y: {
          id: 'mu_y',
          symbol: 'mu_y',
          kind: 'deterministic',
          valueType: { scalar: 'real', axes: [{ axisId: 'obs', role: 'batch' }] },
          plateIds: ['obs'],
          expression: { language: 'bayes-expr@1', source: '0' },
        },
        sigma_y: {
          id: 'sigma_y',
          symbol: 'sigma_y',
          kind: 'random_variable',
          role: 'parameter',
          valueType: { scalar: 'real', axes: [], domain: { kind: 'positive' } },
          plateIds: [],
          distribution: { distributionId: 'halfnormal', args: { sigma: { language: 'bayes-expr@1', source: '1' } } },
        },
        y_likelihood: {
          id: 'y_likelihood',
          symbol: 'y_likelihood',
          kind: 'factor',
          valueType: { scalar: 'real', axes: [] },
          plateIds: [],
          logDensity: { language: 'bayes-expr@1', source: 'student_t_lpdf(y | nu_y + 2, mu_y, sigma_y)' },
          normalization: 'not_required',
        },
      },
      entityOrder: ['y', 'nu_y', 'mu_y', 'sigma_y', 'y_likelihood'],
      notes: {},
      noteOrder: [],
    },
  });

  const likelihoodNode = preview.projected.nodes.find((node) => node.id === 'y_likelihood');
  assert.equal(likelihoodNode?.data.kind, 'likelihood');
  assert.equal(likelihoodNode?.data.distribution.id, 'student_t');
  assert.equal(likelihoodNode?.data.distribution.args.nu, 'nu_y + 2');
  assert.equal(likelihoodNode?.data.distribution.args.mu, 'mu_y');
  assert.equal(likelihoodNode?.data.distribution.args.sigma, 'sigma_y');
});

test('reconstructs missing portable visual edges from semantic dependencies with preview warning', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const packageDocument = {
    ...compiled.document,
    extensions: {},
  };
  const pkg = buildPortablePackage(packageDocument, compiled.layout, compiled.semantic);
  const missingEdgePackage = {
    ...pkg,
    files: {
      ...pkg.files,
      'model.json': JSON.stringify(packageDocument),
    },
  };
  delete missingEdgePackage.files['canvasEdges.json'];

  const preview = previewPortablePackageImport(missingEdgePackage);
  assert.equal(preview.edgeSummary.source, 'semantic reconstruction');
  assert.equal(preview.edgeSummary.declared, 0);
  assert.ok(preview.projected.edges.length > 0);
  assert.ok(preview.importWarnings.some((warning) => warning.includes('reconstructed')));
});

test('rejects portable packages with invalid visual edge references', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic);
  assert.throws(
    () => previewPortablePackageImport({
      ...pkg,
      files: {
        ...pkg.files,
        'canvasEdges.json': JSON.stringify([
          { id: 'broken-edge', from: 'alpha', to: 'missing_target', role: 'deterministic-input' },
        ]),
      },
    }),
    /canvasEdges\.json\/0\/to/u,
  );
});

test('validates implementation receipts', () => {
  const receipt = validateImplementationReceipt({
    receiptVersion: '1.0.0',
    inputSpecificationFingerprintAlgorithm: 'sha256',
    inputSpecificationFingerprint: 'abc',
    backend: 'pymc',
    mappings: [{ entityId: 'beta', implementationSymbol: 'beta', file: 'model.py' }],
    deviations: [],
    addedAssumptions: [],
    approximations: [],
    unresolvedQuestions: [],
  });
  assert.equal(receipt.mappings.length, 1);
  assert.equal(compareReceiptFingerprint(receipt, 'abc', 'sha256').matches, true);
  assert.equal(compareReceiptFingerprint(receipt, 'def', 'sha256').matches, false);
});

test('flags unknown schema envelope properties at runtime boundaries', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  assert.deepEqual(validateModelDocumentEnvelope(compiled.document), []);
  assert.deepEqual(validateLayoutDocumentEnvelope(compiled.layout), []);
  assert.deepEqual(validateModelDocumentEnvelope({ ...compiled.document, typo: true }), [
    { path: '/typo', message: 'Unknown property "typo".' },
  ]);
  assert.deepEqual(validateLayoutDocumentEnvelope({ ...compiled.layout, typo: true }), [
    { path: '/typo', message: 'Unknown property "typo".' },
  ]);
  assert.deepEqual(validateImplementationReceiptEnvelope({
    receiptVersion: '1.0.0',
    inputSpecificationFingerprintAlgorithm: 'sha256',
    inputSpecificationFingerprint: 'abc',
    backend: 'pymc',
    mappings: [],
    deviations: [],
    addedAssumptions: [],
    approximations: [],
    unresolvedQuestions: [],
    extra: true,
  }), [{ path: '/extra', message: 'Unknown property "extra".' }]);

  assert.ok(validateModelDocumentEnvelope({
    ...compiled.document,
    revision: '1',
  }).some((issue) => issue.path === '/revision' && issue.message === 'Expected a finite number.'));
  assert.ok(validateModelDocumentEnvelope({
    ...compiled.document,
    entities: {
      ...compiled.document.entities,
      beta: { ...compiled.document.entities.beta, id: 'other_beta' },
    },
  }).some((issue) => issue.path === '/entities/beta/id'));
});

test('checks the model corpus against expected diagnostics budgets', () => {
  assert.ok(modelCorpus.length >= 3);
  for (const entry of modelCorpus) {
    const template = modelTemplates.find((candidate) => candidate.id === entry.templateId);
    assert.ok(template, entry.id);
    const compiled = compileCanvas(template.nodes, template.edges);
    assert.ok(compiled.semantic.readiness.summary.errors <= entry.expectedMaxErrors, entry.id);
    assert.ok(compiled.semantic.readiness.summary.warnings <= entry.expectedMaxWarnings, entry.id);
    if (entry.status === 'clean') {
      assert.equal(compiled.semantic.readiness.summary.errors, 0, entry.id);
      assert.equal(compiled.semantic.readiness.summary.warnings, 0, entry.id);
    }
  }
});

test('hashes stable fingerprint input with SHA-256', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('uses canonical distribution ids across registry and target profiles', () => {
  assert.equal(normalizeDistributionId('Half Normal'), 'halfnormal');
  assert.equal(normalizeDistributionId('StudentT'), 'student_t');
  assert.equal(toCompilerDistributionDefinition({
    id: 'Half Normal',
    name: 'Half Normal',
    support: 'positive',
    family: 'continuous',
    params: [{ name: 'sigma', required: true }],
    latexTemplate: '',
    textTemplate: '',
  }).id, 'halfnormal');
  assert.equal(minimalDistributionRegistry.get('halfnormal')?.label, 'HalfNormal');
  assert.equal(minimalDistributionRegistry.get('half_normal')?.id, 'halfnormal');
  assert.equal(TARGET_PROFILES.pymc.distributionNames.halfnormal, 'pm.HalfNormal');
  assert.equal(TARGET_PROFILES.numpyro.distributionNames.halfnormal, 'dist.HalfNormal');
  assert.equal(TARGET_PROFILES.stan.distributionNames.halfnormal, 'normal<lower=0>');

  const compiled = compileModel(hierarchicalRegression, minimalDistributionRegistry);
  assert.equal(compiled.readiness.summary.errors, 0);
  assert.equal(hierarchicalRegression.entities.rv_sigma.distribution.distributionId, 'halfnormal');

  const unsupportedReport = buildCapabilityReport({
    ...hierarchicalRegression,
    entities: {
      ...hierarchicalRegression.entities,
      rv_sigma: {
        ...hierarchicalRegression.entities.rv_sigma,
        distribution: {
          ...hierarchicalRegression.entities.rv_sigma.distribution,
          distributionId: 'wishart',
        },
      },
    },
  }, 'pymc');
  assert.ok(unsupportedReport.some((item) => (
    item.feature === 'wishart distribution'
    && item.support === 'unsupported'
    && item.note === 'No backend-specific distribution name is registered.'
  )));
});

test('covers common continuous families and preserves canonical truncation', () => {
  for (const distributionId of ['uniform', 'gamma', 'inverse_gamma', 'weibull', 'logistic']) {
    assert.ok(DISTRIBUTIONS.some((distribution) => distribution.id === distributionId), distributionId);
    assert.ok(TARGET_PROFILES.pymc.distributionNames[distributionId], `pymc:${distributionId}`);
    assert.ok(TARGET_PROFILES.numpyro.distributionNames[distributionId], `numpyro:${distributionId}`);
    assert.ok(TARGET_PROFILES.stan.distributionNames[distributionId], `stan:${distributionId}`);
  }

  const nodes = [{
    id: 'bounded_theta',
    type: 'bayesNode',
    position: { x: 10, y: 20 },
    data: {
      kind: 'parameter',
      name: 'theta',
      distribution: {
        id: 'normal',
        name: 'Normal',
        args: { mu: '0', sigma: '1' },
        truncation: { lower: '0', upper: 'upper_bound' },
      },
    },
  }];
  const compiled = compileCanvas(nodes, []);
  const entity = compiled.document.entities.bounded_theta;
  assert.equal(entity.kind, 'random_variable');
  assert.equal(entity.distribution.distributionId, 'normal');
  assert.equal(entity.distribution.truncation.lower.source, '0');
  assert.equal(entity.distribution.truncation.upper.source, 'upper_bound');
  assert.equal(entity.valueType.domain.kind, 'custom');

  const projected = projectToReactFlow({ document: compiled.document, layout: compiled.layout });
  assert.deepEqual(projected.nodes[0].data.distribution.truncation, { lower: '0', upper: 'upper_bound' });
  assert.equal(
    formatDistributionText(projected.nodes[0].data.distribution),
    'Normal(0, 1) T[0, upper_bound]',
  );
  assert.match(formatDistributionTex(projected.nodes[0].data.distribution), /\\mathcal\{T\}/u);

  const pymcReport = buildCapabilityReport(compiled.document, 'pymc');
  const stanReport = buildCapabilityReport(compiled.document, 'stan');
  assert.ok(pymcReport.some((item) => item.feature === 'normal truncation' && item.support === 'native'));
  assert.ok(stanReport.some((item) => item.feature === 'normal truncation' && item.support === 'native'));
});

test('round-trips detailed observation processes through the authoring contract', () => {
  const nodes = [{
    id: 'observed_y',
    type: 'bayesNode',
    position: { x: 10, y: 20 },
    data: {
      kind: 'likelihood',
      name: 'y[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } },
      observationProcess: {
        kind: 'missing',
        mechanism: 'MAR',
        strategy: 'latent_imputation',
      },
    },
  }];
  const compiled = compileCanvas(nodes, []);
  const entity = compiled.document.entities.observed_y;
  assert.deepEqual(entity.observationProcess, {
    kind: 'missing',
    mechanism: 'MAR',
    strategy: 'latent_imputation',
  });

  const projected = projectToReactFlow({ document: compiled.document, layout: compiled.layout });
  assert.deepEqual(projected.nodes[0].data.observationProcess, {
    kind: 'missing',
    mechanism: 'MAR',
    strategy: 'latent_imputation',
  });
});

test('registers and round-trips every advanced process contract', () => {
  const advancedTypes = ['survival', 'competing_risks', 'spatial_gmrf', 'differential_process', 'copula'];
  for (const [index, blockTypeId] of advancedTypes.entries()) {
    const definition = builtInBlockRegistry.get(blockTypeId, '1.0.0');
    assert.ok(definition, blockTypeId);
    assert.ok(definition.ports.some((port) => port.direction === 'input'), blockTypeId);
    assert.ok(definition.ports.some((port) => port.direction === 'output'), blockTypeId);

    const nodes = [{
      id: `advanced_${blockTypeId}`,
      type: 'bayesNode',
      position: { x: 20 + index * 10, y: 30 },
      data: structuredClone(BLOCK_PRESETS[blockTypeId]),
    }];
    const compiled = compileCanvas(nodes, []);
    const entity = compiled.document.entities[`advanced_${blockTypeId}`];
    assert.equal(entity.kind, 'block_instance');
    assert.equal(entity.blockTypeId, blockTypeId);
    assert.deepEqual(entity.config, {
      expression: BLOCK_PRESETS[blockTypeId].expression,
      validationLevel: 'structured',
      ...BLOCK_PRESETS[blockTypeId].blockConfig,
    });

    const projected = projectToReactFlow({ document: compiled.document, layout: compiled.layout });
    assert.equal(projected.nodes[0].data.blockTypeId, blockTypeId);
    assert.deepEqual(projected.nodes[0].data.blockConfig, BLOCK_PRESETS[blockTypeId].blockConfig);

    const projections = buildModelViewProjections({
      document: compiled.document,
      semantic: compiled.semantic,
      handoff: buildCanvasHandoff(nodes, [], 'pymc'),
    });
    assert.match(projections.find((projection) => projection.id === 'equations').copyText, new RegExp(blockTypeId, 'u'));
    assert.match(projections.find((projection) => projection.id === 'story').copyText, new RegExp(blockTypeId, 'u'));
    assert.ok(buildCapabilityReport(compiled.document, 'pymc').some((item) =>
      item.feature === `${blockTypeId} block` && item.support === 'approximate'));
  }
});

test('diagnoses invalid advanced process semantics', () => {
  const cases = [
    ['survival', { censoring: 'future' }, 'BC-SURVIVAL-001'],
    ['competing_risks', { risk_count: 1 }, 'BC-SURVIVAL-002'],
    ['spatial_gmrf', { intrinsic: true, constraint: 'none' }, 'BC-SPATIAL-002'],
    ['differential_process', { equation_type: 'PDE' }, 'BC-DIFFERENTIAL-001'],
    ['copula', { dimension: 1 }, 'BC-COPULA-001'],
    ['causal_estimand', { estimand: 'effect' }, 'BC-CAUSAL-001'],
    ['dirichlet_process_mixture', { truncation_level: 1 }, 'BC-DP-002'],
  ];
  for (const [blockTypeId, configPatch, code] of cases) {
    const preset = structuredClone(BLOCK_PRESETS[blockTypeId]);
    preset.blockConfig = { ...preset.blockConfig, ...configPatch };
    const compiled = compileCanvas([{
      id: `invalid_${blockTypeId}`,
      type: 'bayesNode',
      position: { x: 0, y: 0 },
      data: preset,
    }], []);
    const issue = compiled.semantic.diagnostics.find((item) => item.code === code);
    assert.ok(issue, `${blockTypeId}: ${code}`);
    assert.ok(issue.fixes?.[0]?.patch.length, `${blockTypeId}: ${code} should provide an actionable patch`);
    const preview = previewPatchProposal(
      compiled.document,
      {
        proposalVersion: '1.0.0',
        baseDocumentId: compiled.document.documentId,
        baseRevision: issue.fixes[0].expectedRevision,
        intent: issue.fixes[0].title,
        author: 'user',
        operations: issue.fixes[0].patch,
      },
      minimalDistributionRegistry,
    );
    assert.ok(
      !preview.after.diagnostics.some((item) => item.code === code),
      `${blockTypeId}: ${code} fix should clear the diagnostic`,
    );
  }
});

test('keeps explicit transforms and MNAR selection assumptions across all projections', () => {
  const nodes = [{
    id: 'mnar_y',
    type: 'bayesNode',
    position: { x: 10, y: 20 },
    data: {
      kind: 'likelihood',
      name: 'y[i]',
      shape: ['N'],
      plate: 'obs',
      observed: true,
      distribution: { id: 'normal', name: 'Normal', args: { mu: '0', sigma: '1' } },
      transform: {
        kind: 'log',
        forward: 'log(y)',
        inverse: 'exp(y)',
        jacobianOwner: 'model',
      },
      observationProcess: {
        kind: 'missing',
        mechanism: 'MNAR',
        strategy: 'latent_imputation',
        selectionModelSymbol: 'alpha_missing + beta_missing * y',
      },
    },
  }];
  const compiled = compileCanvas(nodes, []);
  const entity = compiled.document.entities.mnar_y;
  assert.equal(entity.transform.kind, 'log');
  assert.equal(entity.transform.jacobianOwner, 'model');
  assert.equal(entity.observationProcess.selectionModel.source, 'alpha_missing + beta_missing * y');
  assert.ok(!compiled.semantic.diagnostics.some((item) => item.code === 'BC-OBS-001'));

  const projected = projectToReactFlow({ document: compiled.document, layout: compiled.layout });
  assert.deepEqual(projected.nodes[0].data.transform, nodes[0].data.transform);
  assert.deepEqual(projected.nodes[0].data.observationProcess, nodes[0].data.observationProcess);

  const handoff = buildCanvasHandoff(nodes, [], 'pymc');
  const projections = buildModelViewProjections({
    document: compiled.document,
    semantic: compiled.semantic,
    handoff,
  });
  assert.match(projections.find((projection) => projection.id === 'equations').copyText, /Jacobian model/u);
  assert.match(projections.find((projection) => projection.id === 'story').copyText, /selection alpha_missing/u);
  assert.match(projections.find((projection) => projection.id === 'contract').copyText, /MNAR selection model/u);
  assert.ok(handoff.capabilityReport.some((item) => item.feature === 'log transform' && item.support === 'lowered'));
  assert.ok(handoff.capabilityReport.some((item) => item.feature === 'MNAR selection model'));
});

test('blocks MNAR handoff when its selection equation is absent', () => {
  const document = structuredClone(hierarchicalRegression);
  document.entities.obs_y.observationProcess = {
    kind: 'missing',
    mechanism: 'MNAR',
    strategy: 'latent_imputation',
  };
  const compiled = compileModel(document, minimalDistributionRegistry);
  const diagnostic = compiled.diagnostics.find((item) => item.code === 'BC-OBS-001');
  assert.ok(diagnostic);
  assert.equal(diagnostic.blocksHandoff, true);
});

test('keeps structured block ports distinct and rejects empty truncation bounds', () => {
  const nodes = [{
    id: 'hmm',
    type: 'bayesNode',
    position: { x: 10, y: 20 },
    data: {
      kind: 'model_block',
      name: 'state[t]',
      shape: ['T'],
      plate: 'time',
      expression: 'state[t] ~ Categorical(transition_matrix[state[t-1]])',
      blockTypeId: 'hidden_markov',
      blockInputs: {
        initial_probs: 'initial_probs',
        transition_matrix: 'transition_matrix',
        emission: 'emission[state[t]]',
      },
      blockOutputPort: 'state_sequence',
      blockConfig: { state_count: 3, marginalize_states: true },
      validationLevel: 'structured',
    },
  }];
  const compiledBlock = compileCanvas(nodes, [], 'review');
  const block = compiledBlock.document.entities.hmm;
  assert.equal(block.blockTypeId, 'hidden_markov');
  assert.deepEqual(Object.keys(block.inputs), ['initial_probs', 'transition_matrix', 'emission']);
  assert.deepEqual(block.outputs, { state_sequence: 'hmm' });
  assert.equal(
    compiledBlock.semantic.diagnostics.some((item) => item.code === 'BC-BLOCK-MISSING-PORT'),
    false,
  );

  const invalid = {
    ...hierarchicalRegression,
    entities: {
      ...hierarchicalRegression.entities,
      rv_alpha: {
        ...hierarchicalRegression.entities.rv_alpha,
        distribution: {
          ...hierarchicalRegression.entities.rv_alpha.distribution,
          truncation: {},
        },
      },
    },
  };
  const compiledInvalid = compileModel(invalid, minimalDistributionRegistry);
  assert.ok(compiledInvalid.diagnostics.some((item) => item.code === 'BC-DIST-005' && item.blocksHandoff));
});

test('validates block instances through compiler diagnostics', () => {
  const blockDocument = {
    ...hierarchicalRegression,
    entities: {
      ...hierarchicalRegression.entities,
      block_gp: {
        id: 'block_gp',
        symbol: 'gp_block',
        kind: 'block_instance',
        valueType: { scalar: 'real', axes: [] },
        plateIds: [],
        blockTypeId: 'gp_regression',
        blockVersion: '1.0.0',
        inputs: {
          input: { portId: 'input', entityId: 'data_x' },
          extra: { portId: 'extra', entityId: 'missing_entity' },
        },
        outputs: {
          output: 'det_mu',
        },
        config: {},
      },
    },
    entityOrder: [...hierarchicalRegression.entityOrder, 'block_gp'],
  };
  const compiled = compileModel(blockDocument, minimalDistributionRegistry, { targetBackend: 'unknown_backend' });
  assert.ok(compiled.diagnostics.some((item) => item.code === 'BC-BLOCK-UNKNOWN-PORT'));
  assert.ok(compiled.diagnostics.some((item) => item.code === 'BC-BLOCK-MISSING-ENTITY'));
  assert.ok(compiled.diagnostics.some((item) => item.code === 'BC-BLOCK-BACKEND-CAPABILITY'));
});

test('blocks unsafe external package contracts before import or handoff', () => {
  const issues = validateExternalDataContract({
    model: hierarchicalRegression,
    plugin: {
      javascriptCode: 'fetch("https://example.com/run.js")',
      filesystemAccess: true,
    },
  }, 'malicious fixture');
  assert.ok(issues.some((issue) => issue.path.includes('javascriptCode')));
  assert.ok(issues.some((issue) => issue.path.includes('filesystemAccess')));
  assert.throws(
    () => previewPortablePackageImport({
      model: hierarchicalRegression,
      remoteUrl: 'https://example.com/model.json',
    }),
    /Unsafe external data contract rejected/u,
  );
});

test('full runtime validation catches nested invalid fixtures with paths', () => {
  assert.ok(validateModelDocumentEnvelope({
    ...hierarchicalRegression,
    entities: {
      ...hierarchicalRegression.entities,
      rv_alpha: {
        ...hierarchicalRegression.entities.rv_alpha,
        kind: 'surprise_entity',
      },
    },
  }).some((issue) => issue.path === '/entities/rv_alpha/kind'));

  assert.ok(validateModelDocumentEnvelope({
    ...hierarchicalRegression,
    entities: {
      ...hierarchicalRegression.entities,
      rv_alpha: {
        ...hierarchicalRegression.entities.rv_alpha,
        distribution: { distributionId: 'normal', args: { mu: { language: 'python', source: 'os.system("x")' } } },
      },
    },
  }).some((issue) => issue.path === '/entities/rv_alpha/distribution/args/mu/language'));

  assert.ok(validateModelDocumentEnvelope({
    ...hierarchicalRegression,
    entities: {
      ...hierarchicalRegression.entities,
      obs_y: {
        ...hierarchicalRegression.entities.obs_y,
        observationProcess: { kind: 'telepathy' },
      },
    },
  }).some((issue) => issue.path === '/entities/obs_y/observationProcess/kind'));

  assert.ok(validateAiPatchProposalEnvelope({
    proposalVersion: '1.0.0',
    baseDocumentId: hierarchicalRegression.documentId,
    baseRevision: hierarchicalRegression.revision,
    intent: 'bad patch',
    author: 'ai',
    operations: [{ op: 'replace' }],
  }).some((issue) => issue.path === '/operations/0/path'));

  assert.ok(validateImplementationReceiptEnvelope({
    receiptVersion: '1.0.0',
    inputSpecificationFingerprint: 'abc',
    backend: 'pymc',
    mappings: [{ entityId: 'rv_alpha', implementationSymbol: 'alpha' }],
    deviations: [],
    addedAssumptions: [],
    approximations: [],
    unresolvedQuestions: [],
  }).some((issue) => issue.path === '/mappings/0/file'));
});

test('unknown and unsupported blocks are target-aware across compiler and handoff', () => {
  const document = {
    ...hierarchicalRegression,
    entities: {
      ...hierarchicalRegression.entities,
      block_unknown: {
        id: 'block_unknown',
        symbol: 'external_unknown',
        kind: 'block_instance',
        valueType: { scalar: 'real', axes: [] },
        plateIds: [],
        blockTypeId: 'external_unknown',
        blockVersion: '1.0.0',
        inputs: {},
        outputs: {},
        config: {},
      },
    },
    entityOrder: [...hierarchicalRegression.entityOrder, 'block_unknown'],
  };
  const review = compileModel(document, minimalDistributionRegistry, { targetBackend: 'review' });
  const pymc = compileModel(document, minimalDistributionRegistry, { targetBackend: 'pymc' });
  assert.equal(review.diagnostics.find((item) => item.code === 'BC-BLOCK-UNKNOWN')?.blocksHandoff, false);
  assert.equal(pymc.diagnostics.find((item) => item.code === 'BC-BLOCK-UNKNOWN')?.blocksHandoff, true);
});

test('macro lowering remaps generated diagnostics to editable macro source paths', () => {
  const document = {
    ...hierarchicalRegression,
    macros: {
      bad_horseshoe: {
        id: 'bad_horseshoe',
        macroTypeId: 'horseshoe_prior',
        macroVersion: '1.0.0',
        bindings: {
          target: 'beta',
          scale: { language: 'bayes-expr@1', source: 'missing_scale' },
        },
        config: {},
      },
    },
  };
  const compiled = compileModel(document, minimalDistributionRegistry);
  const remapped = compiled.diagnostics.find((item) => item.sourceMacroPath === '/macros/bad_horseshoe/bindings/scale');
  assert.ok(remapped);
  assert.equal(remapped.displayPath, '/macros/bad_horseshoe/bindings/scale');
  assert.match(remapped.generatedPath, /^\/entities\/bad_horseshoe_local_scale/u);
});

test('CLI loader accepts raw model, portable package, and folder-like file maps', () => {
  const raw = loadModelDocumentContract(hierarchicalRegression);
  assert.equal(raw.sourceKind, 'raw-model');
  const compiled = compileCanvas(initialNodes, initialEdges);
  const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic);
  assert.equal(loadModelDocumentContract(pkg).sourceKind, 'portable-package');
  assert.equal(loadModelDocumentContract({
    files: [
      { path: 'model.bayescanvas/model.json', content: compiled.document },
      { path: 'model.bayescanvas/layout.json', content: compiled.layout },
    ],
  }).sourceKind, 'file-map');
});
