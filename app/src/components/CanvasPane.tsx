import {
  Background,
  Controls,
  type Edge,
  type EdgeTypes,
  MiniMap,
  type Node,
  type NodeTypes,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  type OnSelectionChangeParams,
  ReactFlow,
  SelectionMode,
  type Viewport,
} from '@xyflow/react';

import { ModelProjectionView } from './ModelProjectionView';
import type { ModelViewProjection, ModelViewProjectionId } from '../lib/modelViewProjections';
import type { BayesNodeData } from '../lib/modelIr';

export interface FlowViewportControls {
  fitView: (options?: { padding?: number; duration?: number }) => Promise<boolean>;
}

interface PlateOverlayRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIds: string[];
  data: {
    tone: string;
    label: string;
    index: string;
    size: string;
    nodeCount: number;
    isGlobal: boolean;
  };
}

interface CanvasPaneProps {
  activeModelView: ModelViewProjectionId;
  activeProjection: ModelViewProjection;
  nodes: Node<BayesNodeData>[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  plateOverlays: PlateOverlayRect[];
  viewport: Viewport;
  minZoom: number;
  onConnect: OnConnect;
  onEdgesChange: OnEdgesChange<Edge>;
  onNodesChange: OnNodesChange<Node<BayesNodeData>>;
  onSelectionChange: (params: OnSelectionChangeParams) => void;
  onViewportReady: (controls: FlowViewportControls, viewport: Viewport) => void;
  onViewportChange: (viewport: Viewport) => void;
  onSelectPlateNodes: (nodeIds: string[], additive: boolean) => void;
  onCopyProjection: (value: string) => void;
  onSelectProjectionEntity: (entityId: string) => void;
}

export function CanvasPane({
  activeModelView,
  activeProjection,
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  plateOverlays,
  viewport,
  minZoom,
  onConnect,
  onEdgesChange,
  onNodesChange,
  onSelectionChange,
  onViewportReady,
  onViewportChange,
  onSelectPlateNodes,
  onCopyProjection,
  onSelectProjectionEntity,
}: CanvasPaneProps) {
  if (activeModelView !== 'canvas') {
    return (
      <ModelProjectionView
        projection={activeProjection}
        onCopy={onCopyProjection}
        onSelectEntity={onSelectProjectionEntity}
      />
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onConnect={onConnect}
      onEdgesChange={onEdgesChange}
      onNodesChange={onNodesChange}
      onSelectionChange={onSelectionChange}
      onInit={(instance) => {
        onViewportReady(
          { fitView: (options) => instance.fitView(options) },
          instance.getViewport(),
        );
      }}
      onMove={(_, nextViewport) => onViewportChange(nextViewport)}
      multiSelectionKeyCode={['Control', 'Meta']}
      selectionKeyCode={null}
      selectionMode={SelectionMode.Partial}
      selectionOnDrag
      panOnDrag={[1, 2]}
      deleteKeyCode={['Backspace', 'Delete']}
      minZoom={minZoom}
      fitView
      fitViewOptions={{ padding: 0.18 }}
    >
      <Background color="var(--color-border)" gap={24} />
      <div
        className="plate-overlay-layer plate-overlay-frame-layer"
        aria-hidden="true"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        {plateOverlays.map((plate) => (
          <div
            className={`plate-overlay-box plate-tone-${plate.data.tone}`}
            key={plate.id}
            style={{
              left: plate.x,
              top: plate.y,
              width: plate.width,
              height: plate.height,
            }}
          />
        ))}
      </div>
      <div
        className="plate-overlay-layer plate-overlay-label-layer"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        {plateOverlays.map((plate) => (
          <button
            className={`plate-group-label plate-overlay-label plate-tone-${plate.data.tone}`}
            key={`${plate.id}-label`}
            onClick={(event) => {
              event.stopPropagation();
              onSelectPlateNodes(plate.nodeIds, event.ctrlKey || event.metaKey);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              onSelectPlateNodes(plate.nodeIds, event.ctrlKey || event.metaKey);
            }}
            style={{
              left: plate.x + 18,
              top: plate.y - 16,
            }}
            type="button"
          >
            <strong>{plate.data.label}</strong>
            {plate.data.isGlobal ? null : <span>{plate.data.index}</span>}
            <small>{plate.data.isGlobal ? '反復なし' : `${plate.data.index}=1..${plate.data.size}`} / {plate.data.nodeCount}要素</small>
          </button>
        ))}
      </div>
      <MiniMap />
      <Controls />
    </ReactFlow>
  );
}
