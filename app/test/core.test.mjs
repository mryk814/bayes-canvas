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
import { compileModel } from '../dist-test/lib/core/compiler.js';
import { TARGET_PROFILES } from '../dist-test/lib/core/target-profiles.js';
import { sha256Hex } from '../dist-test/lib/core/fingerprint.js';
import {
  validateImplementationReceiptEnvelope,
  validateLayoutDocumentEnvelope,
  validateModelDocumentEnvelope,
} from '../dist-test/lib/core/schema-validation.js';

test('parses indexed Bayesian expressions', () => {
  const parsed = parseExpression('alpha[group_id[i]] + beta * x[i]');
  assert.equal(parsed.ok, true);
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
  for (const template of modelTemplates) {
    const compiled = compileCanvas(template.nodes, template.edges);
    assert.equal(compiled.layout.modelDocumentId, compiled.document.documentId, template.id);
    assert.ok(compiled.document.entityOrder.length >= 4, template.id);
    assert.ok(Array.isArray(compiled.semantic.diagnostics), template.id);
    if (template.status === 'clean') {
      assert.equal(compiled.semantic.readiness.summary.errors, template.expectedDiagnostics.errors, template.id);
      assert.equal(compiled.semantic.readiness.summary.warnings, template.expectedDiagnostics.warnings, template.id);
    }
  }
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
    compiled.document.entities.y.valueType.axes.map((axis) => `${axis.role}:${axis.axisId}`),
    ['batch:n', 'batch:obs', 'event:k'],
  );
  assert.equal(compiled.semantic.readiness.summary.errors, 0);

  const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic, 'review');
  const preview = previewPortablePackageImport(pkg);
  const projectedOutcome = preview.projected.nodes.find((node) => node.id === 'y');
  assert.deepEqual(projectedOutcome?.data.eventShape, ['K']);
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
    ['canvas', 'story', 'equations', 'structure', 'contract'],
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
});

test('builds a portable package with model and layout separated', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic);
  assert.equal(pkg.manifest.fingerprintAlgorithm, 'sha256');
  assert.match(pkg.manifest.fingerprint, /^[0-9a-f]{64}$/u);
  assert.ok(pkg.files['model.json']);
  assert.ok(pkg.files['layout.json']);
  assert.ok(pkg.files['canvasEdges.json']);
  assert.ok(pkg.files['handoff.json']);

  const restoredModel = JSON.parse(pkg.files['model.json']);
  const restoredLayout = JSON.parse(pkg.files['layout.json']);
  const restoredEdges = JSON.parse(pkg.files['canvasEdges.json']);
  assert.equal(JSON.stringify(restoredModel), JSON.stringify(compiled.document));
  assert.equal(JSON.stringify(restoredLayout), JSON.stringify(compiled.layout));
  assert.equal(restoredEdges.length, initialEdges.length);
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
