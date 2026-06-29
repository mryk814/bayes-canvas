import assert from 'node:assert/strict';
import { parseExpression, collectReferenceOccurrences } from '../dist-test/lib/core/expression.js';
import { validateJsonPatchOperations } from '../dist-test/lib/core/json-patch.js';
import { previewPortablePackageImport } from '../dist-test/lib/documentAdapter.js';
import { initialEdges, initialNodes } from '../dist-test/samples/hierarchicalRegression.js';
import { buildPortablePackage } from '../dist-test/lib/core/portable.js';
import { compileCanvas } from '../dist-test/lib/documentAdapter.js';

const expressions = [
  'normal_lpdf(y | mu, sigma)',
  'math.log(exposure[i])',
  'beta[1:K]',
  'X @ beta',
  'alpha[group_id[i]] + beta * x[i]',
];

for (const expression of expressions) {
  const parsed = parseExpression(expression);
  assert.equal(parsed.ok, true, expression);
  const refs = collectReferenceOccurrences(parsed.ast).map((ref) => ref.symbol);
  assert.ok(refs.length > 0, expression);
}

for (let seed = 0; seed < 100; seed += 1) {
  const expression = `alpha_${seed % 7} + beta[${(seed % 5) + 1}:K] * x_${seed}`;
  const parsed = parseExpression(expression);
  assert.equal(parsed.ok, true, expression);
}

const root = { entities: { beta: { id: 'beta', symbol: 'beta' } }, entityOrder: ['beta'] };
assert.doesNotThrow(() => validateJsonPatchOperations(root, [{ op: 'replace', path: '/entities/beta/symbol', value: 'slope' }]));
assert.throws(() => validateJsonPatchOperations(root, [{ op: 'replace', path: '/entities/missing/symbol', value: 'x' }]));

const compiled = compileCanvas(initialNodes, initialEdges);
const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic);
assert.equal(previewPortablePackageImport(pkg).projected.nodes.length, initialNodes.length);
assert.equal(previewPortablePackageImport({
  files: [
    { path: 'model.bayescanvas/model.json', content: compiled.document },
    { path: 'model.bayescanvas/layout.json', content: compiled.layout },
    { path: 'model.bayescanvas/canvasEdges.json', content: JSON.parse(pkg.files['canvasEdges.json']) },
  ],
}).projected.edges.length, initialEdges.length);
