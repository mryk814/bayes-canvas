import { useCallback, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { previewCanvasPatch as previewCanvasPatchProposal } from '../lib/canvasProjector';
import type { AiPatchProposal, PatchPreview } from '../lib/core/patch-proposal';
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

  const previewProposal = useCallback((proposal: AiPatchProposal) => {
    const preview = previewCanvasPatchProposal(nodes, edges, proposal);
    const pending = {
      preview,
      nodes: preview.projected.nodes,
      edges: preview.projected.edges,
      summary: [
        `${preview.semanticDiff.length} semantic changes`,
        `${preview.before.diagnostics.length} diagnostics before`,
        `${preview.after.diagnostics.length} diagnostics after`,
      ].join(' / '),
    };
    setPendingPatch(pending);
    return pending;
  }, [edges, nodes]);

  const previewPatchInput = useCallback(() => {
    return previewProposal(JSON.parse(patchInput));
  }, [patchInput, previewProposal]);

  const previewExternalProposal = useCallback((proposal: AiPatchProposal) => {
    setPatchInput(JSON.stringify(proposal, null, 2));
    return previewProposal(proposal);
  }, [previewProposal]);

  return {
    patchInput,
    setPatchInput,
    pendingPatch,
    setPendingPatch,
    patchInbox,
    setPatchInbox,
    previewPatchInput,
    previewProposal: previewExternalProposal,
  };
}
