import { useCallback, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { previewCanvasPatch as previewCanvasPatchProposal } from '../lib/canvasProjector';
import type { PatchPreview } from '../lib/core/patch-proposal';
import type { BayesNodeData } from '../lib/modelIr';

export interface PendingPatchState {
  preview: PatchPreview;
  nodes: Node<BayesNodeData>[];
  edges: Edge[];
  summary: string;
}

export function usePatchPreview(nodes: Node<BayesNodeData>[], edges: Edge[]) {
  const [patchInput, setPatchInput] = useState('');
  const [pendingPatch, setPendingPatch] = useState<PendingPatchState | null>(null);
  const [patchInbox, setPatchInbox] = useState<Array<{ id: string; label: string; value: string }>>([]);

  const previewPatchInput = useCallback(() => {
    const preview = previewCanvasPatchProposal(nodes, edges, JSON.parse(patchInput));
    return {
      preview,
      nodes: preview.projected.nodes,
      edges: preview.projected.edges,
      summary: [
        `${preview.semanticDiff.length} semantic changes`,
        `${preview.before.diagnostics.length} diagnostics before`,
        `${preview.after.diagnostics.length} diagnostics after`,
      ].join(' / '),
    };
  }, [edges, nodes, patchInput]);

  return {
    patchInput,
    setPatchInput,
    pendingPatch,
    setPendingPatch,
    patchInbox,
    setPatchInbox,
    previewPatchInput,
  };
}
