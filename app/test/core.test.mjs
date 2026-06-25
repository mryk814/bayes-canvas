import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCanvas, buildCanvasHandoff, buildCapabilityReport } from '../dist-test/lib/documentAdapter.js';
import { parseExpression } from '../dist-test/lib/core/expression.js';
import { assertJsonComplexity } from '../dist-test/lib/core/migrations.js';
import { previewPatchProposal } from '../dist-test/lib/core/patch-proposal.js';
import { buildPortablePackage } from '../dist-test/lib/core/portable.js';
import { validateImplementationReceipt } from '../dist-test/lib/core/receipt.js';
import { initialEdges, initialNodes } from '../dist-test/samples/hierarchicalRegression.js';
import { minimalDistributionRegistry } from '../dist-test/lib/core/registry.js';
import { hierarchicalRegression } from '../dist-test/lib/core/example.js';
import { compileModel } from '../dist-test/lib/core/compiler.js';
import { TARGET_PROFILES } from '../dist-test/lib/core/target-profiles.js';

test('parses indexed Bayesian expressions', () => {
  const parsed = parseExpression('alpha[group_id[i]] + beta * x[i]');
  assert.equal(parsed.ok, true);
});

test('compiles the canvas sample through ModelDocument and LayoutDocument', () => {
  const compiled = compileCanvas(initialNodes, initialEdges);
  assert.equal(compiled.document.schemaVersion, '1.0.0');
  assert.equal(compiled.layout.modelDocumentId, compiled.document.documentId);
  assert.ok(compiled.semantic.symbols.alpha);
  assert.ok(compiled.semantic.dependencyEdges.some((edge) => edge.from === 'beta' && edge.to === 'mu'));
});

test('builds a contract-backed handoff bundle', () => {
  const bundle = buildCanvasHandoff(initialNodes, initialEdges, 'pymc');
  assert.equal(bundle.manifest.bundleVersion, '1.0.0');
  assert.equal(bundle.implementationContract.preserveEntityIds, true);
  assert.ok(bundle.capabilityReport.length >= 2);
  assert.ok(bundle.capabilityReport.some((item) => (
    item.feature === 'halfnormal distribution'
    && item.support === 'native'
    && item.note === 'Backend name: pm.HalfNormal'
  )));
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
  assert.ok(pkg.files['model.json']);
  assert.ok(pkg.files['layout.json']);
  assert.ok(pkg.files['handoff.json']);
});

test('validates implementation receipts', () => {
  const receipt = validateImplementationReceipt({
    receiptVersion: '1.0.0',
    inputSpecificationFingerprint: 'abc',
    backend: 'pymc',
    mappings: [{ entityId: 'beta', implementationSymbol: 'beta', file: 'model.py' }],
    deviations: [],
    addedAssumptions: [],
    approximations: [],
    unresolvedQuestions: [],
  });
  assert.equal(receipt.mappings.length, 1);
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
