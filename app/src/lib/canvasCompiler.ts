import type { Edge, Node } from '@xyflow/react';
import { compileCanvas as compileAuthoringCanvas } from './canvasProjector.js';
import type { HandoffTarget } from './core/handoff.js';
import type { BayesNodeData } from './modelIr.js';

export function deriveCanvasModel(
  nodes: Node<BayesNodeData>[],
  edges: Edge[],
  target: HandoffTarget = 'review',
) {
  return compileAuthoringCanvas(nodes, edges, target);
}
