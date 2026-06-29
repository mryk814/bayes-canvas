import assert from 'node:assert/strict';
import { compileCanvas, previewPortablePackageImport } from '../dist-test/lib/documentAdapter.js';
import { buildPortablePackage } from '../dist-test/lib/core/portable.js';
import { modelTemplates } from '../dist-test/samples/modelTemplates.js';

const template = modelTemplates.reduce((largest, candidate) =>
  candidate.nodes.length > largest.nodes.length ? candidate : largest,
);
const multipliedNodes = Array.from({ length: 10 }).flatMap((_, copyIndex) =>
  template.nodes.map((node) => ({
    ...node,
    id: `${node.id}_${copyIndex}`,
    position: {
      x: node.position.x + copyIndex * 30,
      y: node.position.y + copyIndex * 20,
    },
    data: {
      ...node.data,
      name: `${node.data.name.replace(/\[[^\]]+\]/u, '')}_${copyIndex}`,
    },
  })),
);
const multipliedEdges = Array.from({ length: 10 }).flatMap((_, copyIndex) =>
  template.edges.map((edge) => ({
    ...edge,
    id: `${edge.id}_${copyIndex}`,
    source: `${edge.source}_${copyIndex}`,
    target: `${edge.target}_${copyIndex}`,
  })),
);
const compiled = compileCanvas(multipliedNodes, multipliedEdges);
const pkg = buildPortablePackage(compiled.document, compiled.layout, compiled.semantic);
const preview = previewPortablePackageImport(pkg);
assert.equal(preview.projected.nodes.length, multipliedNodes.length);
assert.equal(preview.edgeSummary.projected, multipliedEdges.length);
assert.equal(preview.document.documentId, compiled.document.documentId);
