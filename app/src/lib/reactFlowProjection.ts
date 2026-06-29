import type { AuthoringSnapshot } from './canvasProjector.js';
import { projectToReactFlow as projectSnapshotToReactFlow } from './canvasProjector.js';
import type { PortableCanvasEdge } from './core/portable.js';

export function projectToReactFlow(
  snapshot: AuthoringSnapshot,
  options: { annotationEdges?: PortableCanvasEdge[] } = {},
) {
  return projectSnapshotToReactFlow(snapshot, options);
}
