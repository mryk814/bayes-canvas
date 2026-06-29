import type { Edge, Node } from '@xyflow/react';
import { buildCanvasPortablePackage as buildPortablePackageFromCanvas } from './canvasProjector.js';
import type { HandoffTarget } from './core/handoff.js';
import type { BayesNodeData } from './modelIr.js';

export type CanvasPortablePackage = ReturnType<typeof buildPortablePackageFromCanvas>;

export function makePortablePackage(
  nodes: Node<BayesNodeData>[],
  edges: Edge[],
  target: HandoffTarget,
): CanvasPortablePackage {
  return buildPortablePackageFromCanvas(nodes, edges, target);
}
