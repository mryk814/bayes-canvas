import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';

import type { BayesNodeData } from '../lib/modelIr';

type BayesCanvasNode = Node<BayesNodeData>;

interface UndoSnapshot {
  message: string;
  nodes: BayesCanvasNode[];
  edges: Edge[];
}

interface UseInspectorEditingArgs {
  nodes: BayesCanvasNode[];
  edges: Edge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  setNodes: Dispatch<SetStateAction<BayesCanvasNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setSelectedNodeId: (nodeId: string | null) => void;
  setSelectedEdgeId: (edgeId: string | null) => void;
  setUndoState: (snapshot: UndoSnapshot) => void;
}

export function useInspectorEditing({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  setNodes,
  setEdges,
  setSelectedNodeId,
  setSelectedEdgeId,
  setUndoState,
}: UseInspectorEditingArgs) {
  const updateSelectedNodeData = useCallback(
    (changes: Partial<BayesNodeData>) => {
      if (!selectedNodeId) {
        return;
      }

      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...changes,
                },
              }
            : node,
        ),
      );
    },
    [selectedNodeId, setNodes],
  );

  const updateSelectedEdgeRole = useCallback(
    (role: string) => {
      if (!selectedEdgeId) {
        return;
      }

      setEdges((currentEdges) =>
        currentEdges.map((edge) =>
          edge.id === selectedEdgeId
            ? {
                ...edge,
                data: {
                  ...edge.data,
                  role,
                },
              }
            : edge,
        ),
      );
    },
    [selectedEdgeId, setEdges],
  );

  const deleteSelectedItem = useCallback(() => {
    if (selectedNodeId) {
      const targetName = nodes.find((node) => node.id === selectedNodeId)?.data.name ?? selectedNodeId;
      setUndoState({
        message: `${targetName} を削除しました。`,
        nodes,
        edges,
      });
      setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId));
      setEdges((currentEdges) =>
        currentEdges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
      );
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      return;
    }

    if (selectedEdgeId) {
      setUndoState({
        message: `${selectedEdgeId} を削除しました。`,
        nodes,
        edges,
      });
      setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    }
  }, [
    edges,
    nodes,
    selectedEdgeId,
    selectedNodeId,
    setEdges,
    setNodes,
    setSelectedEdgeId,
    setSelectedNodeId,
    setUndoState,
  ]);

  return {
    updateSelectedNodeData,
    updateSelectedEdgeRole,
    deleteSelectedItem,
  };
}
