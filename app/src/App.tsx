import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import {
  addEdge,
  Background,
  BaseEdge,
  type Connection,
  Controls,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  SelectionMode,
  type Edge,
  type Node,
  type NodeProps,
  type OnSelectionChangeParams,
  type Viewport,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import {
  createDefaultDistribution,
  formatDistributionTex,
  formatDistributionText,
} from './lib/distributionRegistry';
import {
  exportModelIr,
  generateAiPrompt,
  generateModelTex,
  getPromptTargetLabel,
  parseSymbolName,
  type BayesNodeData,
  type Constraint,
  type IndexMapping,
  type ModelHint,
  type ObservationProcess,
  type PromptTarget,
} from './lib/modelIr';
import { initialEdges, initialNodes } from './samples/hierarchicalRegression';
import { modelTemplates, type ModelTemplate } from './samples/modelTemplates';
import { TexMath } from './components/TexMath';
import { DistributionEditor } from './components/DistributionEditor';
import { MathView } from './components/MathView';
import { ModelProjectionView } from './components/ModelProjectionView';
import {
  buildCanvasHandoff,
  buildCanvasPortablePackage,
  compileCanvas,
  previewPortablePackageImport,
  projectToReactFlow,
  previewCanvasPatch,
  type PortablePackageImportPreview,
} from './lib/documentAdapter';
import { assertJsonComplexity } from './lib/core/migrations.js';
import type { HandoffBundle, HandoffTarget } from './lib/core/handoff.js';
import type { PatchPreview } from './lib/core/patch-proposal.js';
import { diffModelDocuments } from './lib/core/semantic-diff.js';
import { compareReceiptFingerprint, validateImplementationReceipt, type ImplementationReceipt } from './lib/core/receipt.js';
import { loadLatestAutosave, saveAutosave, type StoredSnapshot } from './lib/storage';
import { buildModelViewProjections, type ModelViewProjectionId } from './lib/modelViewProjections';
import { getDynamicEdgeHandles } from './lib/edgeRouting';

const NODE_KIND_LABELS: Record<BayesNodeData['kind'], string> = {
  data: 'データ',
  deterministic: '決定式',
  derived_quantity: '確認量',
  hyperparameter: 'ハイパーパラメータ',
  latent: '潜在変数',
  likelihood: '尤度',
  model_block: 'モデルブロック',
  parameter: 'パラメータ',
};

type PaletteItem =
  | { type: 'node'; kind: BayesNodeData['kind']; label: string; note: string }
  | { type: 'preset'; preset: 'horseshoe_prior' | 'linear_term' | 'group_effect' | 'interaction_term'; label: string; note: string };

type LeftPanelTab = 'add' | 'structure' | 'inspector' | 'library';
type CommandAction = {
  id: string;
  label: string;
  group: string;
  run: () => void;
};

const LEFT_PANEL_TABS: Array<{ id: LeftPanelTab; label: string }> = [
  { id: 'add', label: '追加' },
  { id: 'structure', label: '構造' },
  { id: 'inspector', label: '編集' },
  { id: 'library', label: '保存' },
];

const PALETTE_GROUPS: Array<{
  title: string;
  items: PaletteItem[];
}> = [
  {
    title: '変数',
    items: [
      { type: 'node', kind: 'data', label: 'データ', note: '観測された値' },
      { type: 'node', kind: 'parameter', label: 'パラメータ', note: '推定したい未知量' },
      { type: 'node', kind: 'latent', label: '潜在変数', note: '直接は観測しない値' },
      { type: 'node', kind: 'deterministic', label: '決定式', note: '式から決まる値' },
      { type: 'node', kind: 'likelihood', label: '尤度', note: '観測データの生成過程' },
      { type: 'node', kind: 'hyperparameter', label: 'ハイパーパラメータ', note: '事前分布の調整値' },
    ],
  },
  {
    title: '型',
    items: [
      { type: 'preset', preset: 'horseshoe_prior', label: 'Horseshoe事前分布', note: 'パラメータへ適用' },
      { type: 'preset', preset: 'linear_term', label: '線形項', note: '予測子へ追加' },
      { type: 'preset', preset: 'group_effect', label: 'グループ効果', note: '階層効果を追加' },
      { type: 'preset', preset: 'interaction_term', label: '交互作用', note: '積の項を追加' },
      { type: 'node', kind: 'model_block', label: 'モデルブロック', note: '詳細をまとめる構造' },
    ],
  },
  {
    title: '出力',
    items: [
      { type: 'node', kind: 'derived_quantity', label: '確認量', note: '見たい指標や目的量' },
    ],
  },
];

const LEGACY_STORAGE_KEY = 'bayes-canvas:model';
const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_IMPORT_DEPTH = 32;
const PROMPT_TARGETS: PromptTarget[] = ['generic', 'pymc', 'numpyro', 'stan', 'review'];
const CONSTRAINT_OPTIONS: Array<{ kind: Exclude<Constraint['kind'], 'sum_to_zero' | 'custom'>; label: string; note: string }> = [
  { kind: 'positive', label: '正の値', note: '> 0' },
  { kind: 'unit_interval', label: '0から1', note: '[0, 1]' },
  { kind: 'simplex', label: '合計1', note: 'simplex' },
  { kind: 'ordered', label: '順序あり', note: 'ordered' },
  { kind: 'correlation_matrix', label: '相関行列', note: 'corr' },
];

const OBSERVATION_OPTIONS = [
  { value: '', label: '通常の観測' },
  { value: 'exact', label: 'そのまま観測' },
  { value: 'missing', label: '欠測を潜在変数で補う' },
  { value: 'measurement_error', label: '測定誤差あり' },
  { value: 'censored', label: '打ち切りあり' },
  { value: 'truncated', label: '切断あり' },
  { value: 'rounded', label: '丸められた値' },
] as const;

const EDGE_ROUTE_SPACING = 18;
const EDGE_ENDPOINT_SPACING = 12;

interface PlateRow {
  id: string;
  label: string;
  index: string;
  size: string;
  nodeCount: number;
  nodeNames: string[];
  tone: PlateTone;
  isGlobal: boolean;
}

type PlateTone = 'global' | 'default' | 'group' | 'obs' | 'time';

interface NodePlateContext {
  id: string;
  label: string;
  index: string;
  size: string;
  tone: PlateTone;
  isGlobal: boolean;
}

interface IndexAccessContext {
  label: string;
  fromPlateId: string;
  toPlateId: string;
  tone: PlateTone;
}

interface PlateGroupData extends Record<string, unknown> {
  id: string;
  label: string;
  index: string;
  size: string;
  nodeCount: number;
  nodeNames: string[];
  tone: PlateTone;
  isGlobal: boolean;
}

const GREEK_UNICODE: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', lambda: 'λ', mu: 'μ', nu: 'ν',
  sigma: 'σ', tau: 'τ', theta: 'θ', phi: 'φ',
  psi: 'ψ', omega: 'ω',
};

function formatParamLabel(name: string): string {
  if (GREEK_UNICODE[name]) return GREEK_UNICODE[name];
  const parts = name.split('_');
  return parts.map((p) => GREEK_UNICODE[p] ?? p).join('_');
}

function resolveEdgeParam(
  sourceId: string,
  targetData: BayesNodeData,
): string | undefined {
  if (targetData.expression) {
    const escaped = sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`).test(targetData.expression)) {
      return formatParamLabel(sourceId);
    }
  }

  if (targetData.distribution?.args) {
    for (const [paramKey, paramValue] of Object.entries(targetData.distribution.args)) {
      const baseValue = paramValue.replace(/\[.*$/, '');
      if (baseValue === sourceId) {
        return formatParamLabel(paramKey);
      }
    }
  }

  return undefined;
}

type EdgeRelationKind = 'dependency' | 'indexed-reference' | 'mapping';

interface EdgeRelation {
  kind: EdgeRelationKind;
  label: string;
  tone: string;
}

function getEdgeTone(targetKind: BayesNodeData['kind']): string {
  if (targetKind === 'likelihood') return 'var(--color-success-strong)';
  if (targetKind === 'deterministic' || targetKind === 'derived_quantity') return 'var(--color-chart-5)';
  if (targetKind === 'parameter') return 'color-mix(in srgb, var(--color-chart-2) 54%, var(--color-chart-3))';
  if (targetKind === 'data') return 'var(--color-info-strong)';
  if (targetKind === 'model_block') return 'var(--color-text-secondary)';
  return 'var(--color-accent)';
}

function getEdgeDirectionLabel(paramLabel: string | undefined): string {
  return paramLabel ? `-> ${paramLabel}` : '->';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNodeReferenceText(data: BayesNodeData): string {
  return [
    data.expression,
    ...Object.values(data.distribution?.args ?? {}),
  ].filter((value): value is string => Boolean(value)).join(' ');
}

function getEdgeRelation(
  edge: Edge,
  sourceNode: BayesCanvasNode,
  targetNode: BayesCanvasNode,
  mappings: IndexMapping[],
  paramLabel: string | undefined,
): EdgeRelation {
  const role = String(edge.data?.role ?? '');
  const sourceSymbol = parseSymbolName(sourceNode.data.name).baseSymbol;
  const referenceText = getNodeReferenceText(targetNode.data);
  const sourceMapping = mappings.find((mapping) => mapping.symbol === sourceSymbol);

  if (role === 'index' || (sourceMapping && referenceText.includes(`${sourceSymbol}[`))) {
    return {
      kind: 'mapping',
      label: sourceMapping ? `${sourceMapping.fromPlateId}->${sourceMapping.toPlateId}` : 'index',
      tone: 'var(--color-chart-5)',
    };
  }

  const indexedReference = mappings.find((mapping) => (
    referenceText.includes(`${sourceSymbol}[${mapping.symbol}[${mapping.inputIndex}]]`)
    || referenceText.includes(`${sourceSymbol}[${mapping.symbol}[`)
  ));

  if (indexedReference) {
    return {
      kind: 'indexed-reference',
      label: `${sourceSymbol}[${indexedReference.symbol}]`,
      tone: 'var(--color-chart-5)',
    };
  }

  return {
    kind: 'dependency',
    label: getEdgeDirectionLabel(paramLabel),
    tone: getEdgeTone(targetNode.data.kind),
  };
}

const edgeTypes = {
  paramEdge: memo(function ParamEdge({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    markerEnd, style, data,
  }: EdgeProps) {
    const routeOffset = Number(data?.routeOffset ?? 0);
    const sourceLaneOffset = Number(data?.sourceLaneOffset ?? 0);
    const targetLaneOffset = Number(data?.targetLaneOffset ?? 0);
    const adjustedSource = getLaneAdjustedPoint(sourceX, sourceY, sourcePosition, sourceLaneOffset);
    const adjustedTarget = getLaneAdjustedPoint(targetX, targetY, targetPosition, targetLaneOffset);
    const [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX: adjustedSource.x,
      sourceY: adjustedSource.y,
      targetX: adjustedTarget.x,
      targetY: adjustedTarget.y,
      sourcePosition, targetPosition,
      offset: 26 + Math.abs(routeOffset),
    });

    const paramLabel = data?.paramLabel as string | undefined;
    const directionLabel = data?.directionLabel as string | undefined;
    const relationKind = data?.relationKind as EdgeRelationKind | undefined;

    return (
      <>
        <BaseEdge
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            ...style,
            strokeWidth: 2.6,
          }}
        />
        {directionLabel ? (
          <EdgeLabelRenderer>
            <div
              className={['edge-direction-label', relationKind ? `edge-relation-${relationKind}` : undefined].filter(Boolean).join(' ')}
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX + routeOffset}px, ${labelY}px)`,
              }}
            >
              {directionLabel}
            </div>
          </EdgeLabelRenderer>
        ) : null}
      </>
    );
  }),
};

function getLaneAdjustedPoint(x: number, y: number, position: Position, laneOffset: number): { x: number; y: number } {
  if (position === Position.Top || position === Position.Bottom) {
    return { x: x + laneOffset, y };
  }

  return { x, y: y + laneOffset };
}

type BayesCanvasNode = Node<BayesNodeData>;

interface CanvasState {
  nodes: BayesCanvasNode[];
  edges: Edge[];
}

interface ImportErrorState {
  title: string;
  detail: string;
}

interface UndoState {
  message: string;
  nodes: BayesCanvasNode[];
  edges: Edge[];
}

interface PendingPatchState {
  preview: PatchPreview;
  nodes: BayesCanvasNode[];
  edges: Edge[];
  summary: string;
}

interface PendingImportState {
  sourceName: string;
  sourceKind: 'portable package' | 'legacy canvas';
  nodes: BayesCanvasNode[];
  edges: Edge[];
  summary: string;
  importWarnings: string[];
  diagnostics: number;
  blockingDiagnostics: number;
  preview?: PortablePackageImportPreview;
}

interface RestorePromptState {
  snapshot: StoredSnapshot;
  nodes: BayesCanvasNode[];
  edges: Edge[];
  summary: string;
}

interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FlowViewportControls {
  fitView: (options?: { padding?: number; duration?: number }) => Promise<boolean>;
}

const NODE_LAYOUT_WIDTH: Record<BayesNodeData['kind'], number> = {
  data: 190,
  deterministic: 190,
  derived_quantity: 190,
  hyperparameter: 190,
  latent: 190,
  likelihood: 210,
  model_block: 210,
  parameter: 190,
};

const NODE_LAYOUT_HEIGHT = 156;
const GLOBAL_SCOPE_ID = 'global';
const PLATE_GROUP_PADDING_X = 44;
const PLATE_GROUP_PADDING_TOP = 58;
const PLATE_GROUP_PADDING_BOTTOM = 36;
const PLATE_GROUP_MIN_WIDTH = 310;
const PLATE_GROUP_MIN_HEIGHT = 230;
const NODE_LAYOUT_GAP_X = 72;
const NODE_LAYOUT_GAP_Y = 34;
const NODE_LAYOUT_ORIGIN_X = 96;
const NODE_LAYOUT_ORIGIN_Y = 110;
const NODE_LAYOUT_COLUMN_STEP = Math.max(...Object.values(NODE_LAYOUT_WIDTH)) + NODE_LAYOUT_GAP_X;
const NODE_LAYOUT_ROW_STEP = NODE_LAYOUT_HEIGHT + NODE_LAYOUT_GAP_Y;
const NODE_LAYOUT_SINK_BASE_ROW = 1;
const elk = new ELK();

const initialCanvasNodes: BayesCanvasNode[] = initialNodes.map((node) => ({
  ...node,
  type: 'bayesNode',
}));

const initialCanvasEdges = initialEdges.map((edge) => ({
  ...edge,
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed },
}));

function migrateLegacyNodeData(data: BayesNodeData): BayesNodeData {
  const kind = String(data.kind);

  if (kind === 'prior_recipe') {
    return {
      ...data,
      kind: 'parameter',
      name: data.name === 'beta_horseshoe' ? 'beta' : data.name,
      expression: undefined,
      distribution: { id: 'horseshoe', name: 'Horseshoe', args: { scale: 'tau0' } },
      notes: data.notes || 'Migrated from Prior recipe. Connect or define tau0 when the scale should be explicit.',
    };
  }

  if (kind === 'regression_term') {
    return {
      ...data,
      kind: 'deterministic',
      name: data.name,
      expression: data.expression || 'beta * x[i]',
      notes: data.notes || 'Migrated from Regression term preset.',
    };
  }

  return data;
}

function prepareCanvasNode(node: BayesCanvasNode): BayesCanvasNode {
  return {
    ...node,
    type: 'bayesNode',
    data: migrateLegacyNodeData(node.data),
  };
}

function getNodeRect(node: BayesCanvasNode): CanvasRect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: NODE_LAYOUT_WIDTH[node.data.kind],
    height: NODE_LAYOUT_HEIGHT,
  };
}

interface PlateOverlayRect {
  id: string;
  data: PlateGroupData;
  nodeIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

function buildPlateOverlays(nodes: BayesCanvasNode[]): PlateOverlayRect[] {
  const grouped = new Map<string, BayesCanvasNode[]>();
  for (const node of nodes) {
    const scopeId = node.data.plate ?? GLOBAL_SCOPE_ID;
    grouped.set(scopeId, [...(grouped.get(scopeId) ?? []), node]);
  }

  const scopeOrder = new Map([[GLOBAL_SCOPE_ID, 0], ['group', 1], ['obs', 2], ['observation', 2]]);
  return [...grouped.entries()].sort(([a], [b]) => (
    (scopeOrder.get(a) ?? 10) - (scopeOrder.get(b) ?? 10) || a.localeCompare(b)
  )).map(([plateId, plateNodes]) => {
    const rects = plateNodes.map(getNodeRect);
    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
    const size = getPlateSizeFromNodes(plateId, plateNodes);
    const width = Math.max(PLATE_GROUP_MIN_WIDTH, maxX - minX + PLATE_GROUP_PADDING_X * 2);
    const height = Math.max(PLATE_GROUP_MIN_HEIGHT, maxY - minY + PLATE_GROUP_PADDING_TOP + PLATE_GROUP_PADDING_BOTTOM);
    return {
      id: `plate-overlay-${plateId}`,
      x: minX - PLATE_GROUP_PADDING_X,
      y: minY - PLATE_GROUP_PADDING_TOP,
      width,
      height,
      data: getPlateGroupData(plateId, size, plateNodes),
      nodeIds: plateNodes.map((node) => node.id),
    };
  });
}

function rectsOverlap(a: CanvasRect, b: CanvasRect, padding = 12): boolean {
  return (
    a.x < b.x + b.width + padding
    && a.x + a.width + padding > b.x
    && a.y < b.y + b.height + padding
    && a.y + a.height + padding > b.y
  );
}

function countNodeOverlaps(nodes: BayesCanvasNode[]): number {
  let count = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (rectsOverlap(getNodeRect(nodes[i]), getNodeRect(nodes[j]))) {
        count += 1;
      }
    }
  }
  return count;
}

function getPreferredEdgeHandles(
  sourceNode: BayesCanvasNode,
  targetNode: BayesCanvasNode,
): Pick<Edge, 'sourceHandle' | 'targetHandle'> {
  return getDynamicEdgeHandles(getNodeRect(sourceNode), getNodeRect(targetNode));
}

function getEdgeRouteOffset(index: number): number {
  return getSymmetricLaneOffset(index, EDGE_ROUTE_SPACING);
}

function getEdgeEndpointOffset(index: number): number {
  return getSymmetricLaneOffset(index, EDGE_ENDPOINT_SPACING);
}

function getSymmetricLaneOffset(index: number, spacing: number): number {
  if (index === 0) return 0;
  const lane = Math.ceil(index / 2) * spacing;
  return index % 2 === 0 ? lane : -lane;
}

function getNodeLayoutDepths(nodes: BayesCanvasNode[], edges: Edge[]): Map<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const distanceToSink = new Map(nodes.map((node) => [node.id, 0]));

  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      if (!edge.source || !edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
      const sourceDistance = distanceToSink.get(edge.source) ?? 0;
      const targetDistance = distanceToSink.get(edge.target) ?? 0;
      const nextDistance = Math.min(targetDistance + 1, nodes.length - 1);
      if (nextDistance > sourceDistance) {
        distanceToSink.set(edge.source, nextDistance);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const connectedNodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const maxDistance = Math.max(0, ...[...distanceToSink.entries()]
    .filter(([nodeId]) => connectedNodeIds.has(nodeId))
    .map(([, distance]) => distance));
  const depths = new Map<string, number>();
  for (const node of nodes) {
    const hasEdges = connectedNodeIds.has(node.id);
    depths.set(node.id, hasEdges ? maxDistance - (distanceToSink.get(node.id) ?? 0) : 0);
  }

  return depths;
}

function arrangeCanvasNodes(nodes: BayesCanvasNode[], edges: Edge[]): BayesCanvasNode[] {
  const depths = getNodeLayoutDepths(nodes, edges);
  const columns = new Map<number, BayesCanvasNode[]>();
  const outgoing = new Map<string, string[]>();
  const placedYByNode = new Map<string, number>();

  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    columns.set(depth, [...(columns.get(depth) ?? []), node]);
  }

  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const arrangedById = new Map<string, BayesCanvasNode>();
  const sortedColumns = [...columns.entries()].sort(([a], [b]) => b - a);
  const maxDepth = Math.max(0, ...[...columns.keys()]);

  for (const [depth, columnNodes] of sortedColumns) {
    const occupiedYs: number[] = [];
    const sortedNodes = [...columnNodes].sort((a, b) => {
      const aTargetY = getDesiredNodeY(a.id, outgoing, placedYByNode);
      const bTargetY = getDesiredNodeY(b.id, outgoing, placedYByNode);
      return aTargetY - bTargetY || getNodeLayoutPriority(a) - getNodeLayoutPriority(b) || a.position.y - b.position.y;
    });

    for (const [index, node] of sortedNodes.entries()) {
      const isSinkColumn = depth === maxDepth;
      const desiredY = isSinkColumn
        ? NODE_LAYOUT_ORIGIN_Y + (NODE_LAYOUT_SINK_BASE_ROW + index) * NODE_LAYOUT_ROW_STEP
        : getDesiredNodeY(node.id, outgoing, placedYByNode);
      const y = takeNearestFreeY(desiredY, occupiedYs);
      occupiedYs.push(y);
      placedYByNode.set(node.id, y);
      arrangedById.set(node.id, {
        ...node,
        position: {
          x: NODE_LAYOUT_ORIGIN_X + depth * NODE_LAYOUT_COLUMN_STEP,
          y,
        },
      });
    }
  }

  return nodes.map((node) => arrangedById.get(node.id) ?? node);
}

function arrangeCanvasNodesByPlate(nodes: BayesCanvasNode[], edges: Edge[]): BayesCanvasNode[] {
  const depths = getNodeLayoutDepths(nodes, edges);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layoutScopeByNodeId = new Map(nodes.map((node) => [node.id, getLayoutScopeId(node, edges, nodeById)]));
  const scopeGroups = new Map<string, BayesCanvasNode[]>();
  const baseY = NODE_LAYOUT_ORIGIN_Y;
  const scopeGapY = 112;
  const rowGapY = NODE_LAYOUT_HEIGHT + 38;
  const depthStepX = NODE_LAYOUT_COLUMN_STEP + 54;
  const originX = NODE_LAYOUT_ORIGIN_X;

  for (const node of nodes) {
    const scopeId = layoutScopeByNodeId.get(node.id) ?? GLOBAL_SCOPE_ID;
    scopeGroups.set(scopeId, [...(scopeGroups.get(scopeId) ?? []), node]);
  }

  const arrangedById = new Map<string, BayesCanvasNode>();
  const orderedScopes = [...scopeGroups.entries()].sort(([a, aNodes], [b, bNodes]) => (
    getScopeLayoutScore(aNodes) - getScopeLayoutScore(bNodes)
    || getScopeFallbackOrder(a) - getScopeFallbackOrder(b)
    || a.localeCompare(b)
  ));

  let nextScopeTop = baseY;
  for (const [, scopeNodes] of orderedScopes) {
    const nodesByDepth = new Map<number, BayesCanvasNode[]>();
    const rowByNodeId = new Map<string, number>();
    let maxRow = 0;

    for (const node of scopeNodes) {
      const depth = depths.get(node.id) ?? 0;
      nodesByDepth.set(depth, [...(nodesByDepth.get(depth) ?? []), node]);
    }

    for (const [depth, columnNodes] of [...nodesByDepth.entries()].sort(([a], [b]) => a - b)) {
      const orderedColumnNodes = [...columnNodes].sort((a, b) => (
        a.position.y - b.position.y
        || getNodeLayoutPriority(a) - getNodeLayoutPriority(b)
        || a.position.x - b.position.x
      ));
      const usedRows = new Set<number>();

      for (const node of orderedColumnNodes) {
        const preferredRow = getPreferredConnectedRow(node, edges, layoutScopeByNodeId, rowByNodeId);
        const row = getAvailableLayoutRow(usedRows, preferredRow ?? 0);
        usedRows.add(row);
        maxRow = Math.max(maxRow, row);
        rowByNodeId.set(node.id, row);
        arrangedById.set(node.id, {
          ...node,
          selected: false,
          position: {
            x: originX + depth * depthStepX,
            y: nextScopeTop + row * rowGapY,
          },
        });
      }
    }

    nextScopeTop += Math.max(PLATE_GROUP_MIN_HEIGHT, (maxRow + 1) * rowGapY + PLATE_GROUP_PADDING_TOP + PLATE_GROUP_PADDING_BOTTOM) + scopeGapY;
  }

  return nodes.map((node) => arrangedById.get(node.id) ?? node);
}

function getAvailableLayoutRow(usedRows: Set<number>, preferredRow: number): number {
  let row = Math.max(0, preferredRow);
  while (usedRows.has(row)) row += 1;
  return row;
}

function getPreferredConnectedRow(
  node: BayesCanvasNode,
  edges: Edge[],
  layoutScopeByNodeId: Map<string, string>,
  rowByNodeId: Map<string, number>,
): number | null {
  const nodeScope = layoutScopeByNodeId.get(node.id);
  if (!nodeScope) return null;

  const connectedRows = edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => (edge.source === node.id ? edge.target : edge.source))
    .filter((connectedId) => layoutScopeByNodeId.get(connectedId) === nodeScope)
    .map((connectedId) => rowByNodeId.get(connectedId))
    .filter((row): row is number => row !== undefined);

  return connectedRows.length === 1 ? connectedRows[0] : null;
}

function getScopeLayoutScore(nodes: BayesCanvasNode[]): number {
  if (!nodes.length) return Number.POSITIVE_INFINITY;
  return nodes.reduce((total, node) => total + node.position.y, 0) / nodes.length;
}

function getScopeFallbackOrder(scopeId: string): number {
  const order = new Map([[GLOBAL_SCOPE_ID, 0], ['group', 1], ['obs', 2], ['observation', 2], ['time', 3]]);
  return order.get(scopeId) ?? 10;
}

function getLayoutScopeId(node: BayesCanvasNode, edges: Edge[], nodeById: Map<string, BayesCanvasNode>): string {
  if (node.data.plate) return node.data.plate;
  const connectedScopeIds = new Set<string>();

  for (const edge of edges) {
    if (edge.source !== node.id && edge.target !== node.id) continue;
    const otherNodeId = edge.source === node.id ? edge.target : edge.source;
    const otherScopeId = nodeById.get(otherNodeId)?.data.plate;
    if (otherScopeId) connectedScopeIds.add(otherScopeId);
  }

  return connectedScopeIds.size === 1 ? [...connectedScopeIds][0] : GLOBAL_SCOPE_ID;
}

function getDesiredNodeY(
  nodeId: string,
  outgoing: Map<string, string[]>,
  placedYByNode: Map<string, number>,
): number {
  const childYs = (outgoing.get(nodeId) ?? [])
    .map((childId) => placedYByNode.get(childId))
    .filter((y): y is number => y !== undefined);

  if (!childYs.length) {
    return NODE_LAYOUT_ORIGIN_Y + NODE_LAYOUT_SINK_BASE_ROW * NODE_LAYOUT_ROW_STEP;
  }

  return childYs.reduce((total, y) => total + y, 0) / childYs.length;
}

function getNodeLayoutPriority(node: BayesCanvasNode): number {
  const priorities: Partial<Record<BayesNodeData['kind'], number>> = {
    hyperparameter: 0,
    parameter: 1,
    latent: 2,
    data: 3,
    deterministic: 4,
    model_block: 5,
    likelihood: 6,
    derived_quantity: 7,
  };
  return priorities[node.data.kind] ?? 10;
}

function takeNearestFreeY(desiredY: number, occupiedYs: number[]): number {
  const minY = NODE_LAYOUT_ORIGIN_Y;
  const baseY = Math.max(minY, desiredY);
  const offsets = [0];
  for (let step = 1; step <= occupiedYs.length + 3; step += 1) {
    offsets.push(step, -step);
  }

  for (const offset of offsets) {
    const candidate = Math.max(minY, baseY + offset * NODE_LAYOUT_ROW_STEP);
    if (occupiedYs.every((occupiedY) => Math.abs(occupiedY - candidate) >= NODE_LAYOUT_ROW_STEP - 1)) {
      return candidate;
    }
  }

  return minY + occupiedYs.length * NODE_LAYOUT_ROW_STEP;
}

async function layoutCanvasNodesWithElk(nodes: BayesCanvasNode[], edges: Edge[]): Promise<BayesCanvasNode[]> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const graph: ElkNode = {
    id: 'bayes-canvas-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '76',
      'elk.layered.spacing.nodeNodeBetweenLayers': '132',
      'elk.layered.spacing.edgeNodeBetweenLayers': '56',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '24',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.padding': '[top=36,left=36,bottom=36,right=36]',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: NODE_LAYOUT_WIDTH[node.data.kind],
      height: NODE_LAYOUT_HEIGHT,
      layoutOptions: {
        'elk.layered.priority.direction': String(getNodeDownstreamPriority(node)),
      },
    })),
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge, index) => ({
        id: edge.id || `edge-${index}`,
        sources: [edge.source],
        targets: [edge.target],
      })),
  };

  const layout = await elk.layout(graph);
  const layoutById = new Map((layout.children ?? []).map((node) => [node.id, node]));

  return nodes.map((node) => {
    const layoutNode = layoutById.get(node.id);
    if (layoutNode?.x === undefined || layoutNode.y === undefined) return node;
    return {
      ...node,
      position: {
        x: Math.round(layoutNode.x),
        y: Math.round(layoutNode.y),
      },
    };
  });
}

function getNodeDownstreamPriority(node: BayesCanvasNode): number {
  if (node.data.kind === 'likelihood') return 100;
  if (node.data.kind === 'derived_quantity') return 90;
  if (node.data.kind === 'model_block') return 80;
  if (node.data.kind === 'deterministic') return 70;
  if (node.data.observed && node.data.kind === 'data') return 10;
  return 40;
}

function loadInitialCanvas(): CanvasState {
  try {
    const stored = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) {
      return { nodes: initialCanvasNodes, edges: initialCanvasEdges };
    }

    const parsed = JSON.parse(stored) as Partial<CanvasState>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return { nodes: initialCanvasNodes, edges: initialCanvasEdges };
    }

    return {
      nodes: (parsed.nodes as BayesCanvasNode[]).map(prepareCanvasNode),
      edges: parsed.edges.map((edge) => ({
        ...edge,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    };
  } catch {
    return { nodes: initialCanvasNodes, edges: initialCanvasEdges };
  }
}

interface SavedModelEntry {
  id: string;
  name: string;
  savedAt: string;
  nodeCount: number;
  edgeCount: number;
}

const SAVED_MODELS_KEY = 'bayes-canvas:saved-models';

function loadSavedModelsList(): SavedModelEntry[] {
  try {
    const stored = localStorage.getItem(SAVED_MODELS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveModelSnapshot(name: string, nodes: BayesCanvasNode[], edges: Edge[]): SavedModelEntry[] {
  const models = loadSavedModelsList();
  const id = `snap_${Date.now()}`;
  models.unshift({
    id,
    name,
    savedAt: new Date().toISOString(),
    nodeCount: nodes.length,
    edgeCount: edges.length,
  });
  localStorage.setItem(SAVED_MODELS_KEY, JSON.stringify(models));
  localStorage.setItem(`bayes-canvas:saved:${id}`, JSON.stringify({ nodes, edges }));
  return models;
}

function loadModelSnapshot(id: string): CanvasState | null {
  try {
    const stored = localStorage.getItem(`bayes-canvas:saved:${id}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return {
      nodes: (parsed.nodes as BayesCanvasNode[]).map(prepareCanvasNode),
      edges: parsed.edges.map((edge: Edge) => ({
        ...edge,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    };
  } catch {
    return null;
  }
}

function deleteModelSnapshot(id: string): SavedModelEntry[] {
  const models = loadSavedModelsList().filter((m) => m.id !== id);
  localStorage.setItem(SAVED_MODELS_KEY, JSON.stringify(models));
  localStorage.removeItem(`bayes-canvas:saved:${id}`);
  return models;
}

function exportCanvasToFile(nodes: BayesCanvasNode[], edges: Edge[]) {
  const data = JSON.stringify({ nodes, edges }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bayes-canvas-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPortablePackageToFile(packageData: ReturnType<typeof buildCanvasPortablePackage>) {
  const data = JSON.stringify(packageData, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bayes-canvas-${new Date().toISOString().slice(0, 10)}.bayescanvas.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCanvasFile(file: File): Promise<PendingImportState> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMPORT_BYTES) {
      reject(new Error(`ファイルが大きすぎます。上限は ${Math.round(MAX_IMPORT_BYTES / 1024)}KB です。`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = assertJsonComplexity(String(reader.result), {
          maxBytes: MAX_IMPORT_BYTES,
          maxDepth: MAX_IMPORT_DEPTH,
        });
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('Bayes CanvasのJSONオブジェクトではありません。'));
          return;
        }
        const modelFile = parsed as Partial<CanvasState>;
        const portableFile = parsed as {
          files?: Record<string, string>;
        };
        if (portableFile.files?.['model.json'] && portableFile.files?.['layout.json']) {
          const preview = previewPortablePackageImport(portableFile);
          resolve({
            sourceName: file.name,
            sourceKind: 'portable package',
            nodes: preview.projected.nodes.map(prepareCanvasNode),
            edges: preview.projected.edges.map((edge: Edge) => ({
              ...edge,
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed },
            })),
            summary: preview.summary,
            importWarnings: preview.importWarnings,
            diagnostics: preview.semantic.diagnostics.length,
            blockingDiagnostics: preview.semantic.diagnostics.filter((diagnostic) => diagnostic.blocksHandoff).length,
            preview,
          });
          return;
        }
        if (!Array.isArray(modelFile.nodes) || !Array.isArray(modelFile.edges)) {
          reject(new Error('必須field `nodes` / `edges` または portable package の `files.model.json` / `files.layout.json` がありません。'));
          return;
        }
        resolve({
          sourceName: file.name,
          sourceKind: 'legacy canvas',
          nodes: modelFile.nodes.map(prepareCanvasNode),
          edges: modelFile.edges.map((edge: Edge) => ({
            ...edge,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
          })),
          summary: `${modelFile.nodes.length} nodes / ${modelFile.edges.length} links`,
          importWarnings: [],
          diagnostics: compileCanvas(modelFile.nodes.map(prepareCanvasNode), modelFile.edges).semantic.diagnostics.length,
          blockingDiagnostics: compileCanvas(modelFile.nodes.map(prepareCanvasNode), modelFile.edges).semantic.diagnostics.filter((diagnostic) => diagnostic.blocksHandoff).length,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('JSON形式が正しくありません。'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読み込めませんでした。'));
    reader.readAsText(file);
  });
}

function addImportProvenance(nodes: BayesCanvasNode[], sourceName: string): BayesCanvasNode[] {
  if (!nodes.length) return nodes;
  const provenance = `Imported from ${sourceName} at ${new Date().toISOString()}.`;
  return nodes.map((node, index) => {
    if (index > 0) return node;
    return {
      ...node,
      data: {
        ...node.data,
        notes: node.data.notes ? `${node.data.notes}\n${provenance}` : provenance,
      },
    };
  });
}

const EXTERNAL_MODEL_IMPORT_PROMPT = `Convert the following external Bayesian model into a Bayes Canvas portable package.

Return only JSON with this shape:
{
  "manifest": {
    "packageVersion": "1.0.0",
    "modelDocumentId": "model_imported",
    "sourceRevision": 1,
    "schemaVersion": "1.0.0",
    "createdAt": "ISO-8601 timestamp",
    "fingerprintAlgorithm": "sha256",
    "fingerprint": "sha256 of { model, layout } if available",
    "files": ["manifest.json", "model.json", "layout.json", "canvasEdges.json", "diagnostics.json", "handoff.json", "decisions.jsonl"]
  },
  "files": {
    "manifest.json": "stringified manifest JSON",
    "model.json": "stringified Bayes Canvas ModelDocument JSON",
    "layout.json": "stringified Bayes Canvas LayoutDocument JSON",
    "canvasEdges.json": "stringified array of { id, from, to, role } visual links",
    "diagnostics.json": "[]",
    "handoff.json": "{}",
    "decisions.jsonl": "one JSON object per provenance, assumption, warning, or review question"
  }
}

Rules:
- Preserve source provenance in ModelDocument notes or decisions.jsonl.
- Use stable entity IDs and put layout.modelDocumentId equal to model.documentId.
- Preserve every canvas link in files["canvasEdges.json"]. Each edge must use entity IDs from model.json: { "id": "alpha-mu", "from": "alpha", "to": "mu", "role": "deterministic-input" }.
- Also mirror the same edge array in model.extensions["bayes-canvas"].annotationEdges for older importers.
- Keep layout.nodes entries for every visible entity so imported nodes do not collapse to one position.
- If visual links are unknown, derive them from semantic dependencies and add a warning note explaining that reconstruction was needed.
- Keep ambiguous modeling choices as open review_question notes instead of inventing assumptions.
- Do not omit model.json or layout.json.`;

function createNodeData(kind: BayesNodeData['kind'], count: number): BayesNodeData {
  const baseName = `${kind}_${count}`;

  if (kind === 'data') {
    return { kind, name: `${baseName}[i]`, shape: ['N'], observed: true };
  }

  if (kind === 'deterministic') {
    return { kind, name: `${baseName}[i]`, shape: ['N'], expression: 'replace_with_expression' };
  }

  if (kind === 'likelihood') {
    return {
      kind,
      name: `${baseName}[i]`,
      distribution: { id: 'normal', name: 'Normal', args: { mu: 'mu[i]', sigma: 'sigma' } },
      observed: true,
    };
  }

  if (kind === 'hyperparameter') {
    return { kind, name: baseName, distribution: createDefaultDistribution('normal') };
  }

  if (kind === 'model_block') {
    return {
      kind,
      name: 'f_gp[i]',
      shape: ['N'],
      plate: 'obs',
      expression: 'GP(time[i]; kernel=RBF, lengthscale=ell, amplitude=rho)',
      notes: 'Structured block. Keep inputs, outputs, and implementation detail explicit for handoff.',
      validationLevel: 'structured',
    };
  }

  if (kind === 'derived_quantity') {
    return {
      kind,
      name: 'treatment_effect',
      expression: 'beta',
      notes: 'Quantity to report or inspect after inference.',
    };
  }

  return { kind, name: baseName, distribution: createDefaultDistribution('normal') };
}

function parseList(value: string): string[] | undefined {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length ? items : undefined;
}

function hasConstraint(constraints: Constraint[] | undefined, kind: Constraint['kind']): boolean {
  return Boolean(constraints?.some((constraint) => constraint.kind === kind));
}

function toggleSimpleConstraint(
  constraints: Constraint[] | undefined,
  kind: Exclude<Constraint['kind'], 'sum_to_zero' | 'custom'>,
  enabled: boolean,
): Constraint[] | undefined {
  const current = constraints ?? [];
  const next = enabled
    ? [...current.filter((constraint) => constraint.kind !== kind), { kind } satisfies Constraint]
    : current.filter((constraint) => constraint.kind !== kind);

  return next.length ? next : undefined;
}

function updateSumToZeroConstraint(constraints: Constraint[] | undefined, overPlateId: string): Constraint[] | undefined {
  const current = constraints ?? [];
  const withoutSumToZero = current.filter((constraint) => constraint.kind !== 'sum_to_zero');
  const trimmedPlate = overPlateId.trim();
  const next = trimmedPlate
    ? [...withoutSumToZero, { kind: 'sum_to_zero', overPlateId: trimmedPlate } satisfies Constraint]
    : withoutSumToZero;

  return next.length ? next : undefined;
}

function getSumToZeroPlate(constraints?: Constraint[]): string {
  const constraint = constraints?.find((item) => item.kind === 'sum_to_zero');
  return constraint?.kind === 'sum_to_zero' ? constraint.overPlateId ?? '' : '';
}

function appendTerm(expression: string | undefined, term: string): string {
  const trimmedExpression = expression?.trim();
  if (!trimmedExpression || trimmedExpression === 'replace_with_expression') {
    return term;
  }

  if (trimmedExpression.includes(term)) {
    return trimmedExpression;
  }

  return `${trimmedExpression} + ${term}`;
}

function parseHints(value: string): ModelHint[] | undefined {
  const hints = parseList(value)?.map((item) => {
    if (['centered', 'non_centered', 'unspecified'].includes(item)) {
      return { kind: 'parameterization', value: item as 'centered' | 'non_centered' | 'unspecified' } satisfies ModelHint;
    }
    if (item.startsWith('warning:')) return { kind: 'warning', value: item.slice('warning:'.length) } satisfies ModelHint;
    return { kind: 'implementation', value: item } satisfies ModelHint;
  });

  return hints?.length ? hints : undefined;
}

function formatHintsForInput(hints?: ModelHint[]): string {
  return (hints ?? []).map((hint) => {
    if (hint.kind === 'parameterization') return hint.value;
    if (hint.kind === 'warning') return `warning:${hint.value}`;
    return hint.value;
  }).join(', ');
}

function createObservationProcess(kind: string): ObservationProcess | undefined {
  if (!kind) return undefined;
  if (kind === 'exact') return { kind: 'exact' };
  if (kind === 'missing') return { kind: 'missing', strategy: 'latent_imputation' };
  if (kind === 'measurement_error') return { kind: 'measurement_error', latentTrueSymbol: 'x_true', errorScaleSymbol: 'sigma_x' };
  if (kind === 'censored') return { kind: 'censored', direction: 'right', boundSymbol: 'limit' };
  if (kind === 'truncated') return { kind: 'truncated', lower: 'lower', upper: 'upper' };
  if (kind === 'rounded') return { kind: 'rounded', unit: 'unit' };
  return { kind: 'custom', description: kind };
}


const nodeTypes = {
  plateGroup: memo(function PlateGroupNode({ data }: NodeProps<Node<PlateGroupData>>) {
    return (
      <div className={`plate-group-node plate-tone-${data.tone}`}>
        <div className="plate-group-label">
          <strong>{data.label}</strong>
          {data.isGlobal ? null : <span>{data.index}</span>}
          <small>{data.isGlobal ? '反復なし' : `${data.index}=1..${data.size}`} / {data.nodeCount}要素</small>
        </div>
      </div>
    );
  }),
  bayesNode: memo(function BayesNode({ data }: NodeProps<Node<BayesNodeData>>) {
    const distributionText = data.distribution ? formatDistributionText(data.distribution) : data.expression;
    const distributionTex = data.distribution ? formatDistributionTex(data.distribution) : undefined;
    const diagnosticCount = Number(data.diagnosticCount ?? 0);
    const plateContext = data.plateContext as NodePlateContext | undefined;
    const mappingSource = data.mappingSourceContext as IndexAccessContext | undefined;
    const indexAccesses = data.indexAccesses as IndexAccessContext[] | undefined;
    const nodeClassName = [
      'bayes-node',
      `bayes-node-${data.kind}`,
      plateContext ? 'has-plate' : undefined,
      plateContext ? `plate-tone-${plateContext.tone}` : undefined,
    ].filter(Boolean).join(' ');

    return (
      <div className={nodeClassName}>
        <Handle className="node-handle node-handle-top" id="target-top" type="target" position={Position.Top} />
        <Handle className="node-handle node-handle-right" id="target-right" type="target" position={Position.Right} />
        <Handle className="node-handle node-handle-bottom" id="target-bottom" type="target" position={Position.Bottom} />
        <Handle className="node-handle node-handle-left" id="target-left" type="target" position={Position.Left} />
        <div className="node-heading">
          <span className="node-kind">{NODE_KIND_LABELS[data.kind]}</span>
          <span className="node-heading-badges">
            {data.observed ? <span className="node-chip">観測済み</span> : null}
            {diagnosticCount ? <span className="node-chip node-chip-warning">!{diagnosticCount}</span> : null}
          </span>
        </div>
        <div className="node-name">{renderIndexedNodeName(data.name, plateContext)}</div>
        {distributionText ? <div className="node-formula">{distributionText}</div> : null}
        {distributionTex ? (
          <div className="node-tex">
            <TexMath tex={distributionTex} />
          </div>
        ) : null}
        {mappingSource ? (
          <div className="node-mapping-note">
            <span>map</span>
            <strong>{mappingSource.fromPlateId} → {mappingSource.toPlateId}</strong>
          </div>
        ) : null}
        {indexAccesses?.length ? (
          <div className="node-mapping-note">
            <span>uses</span>
            <strong>{indexAccesses.map((access) => access.label).join(', ')}</strong>
          </div>
        ) : null}
        <div className="node-meta">
          {data.shape?.length ? <span className="node-meta-chip">{data.shape.join(' x ')}</span> : <span className="node-meta-chip">scalar</span>}
          {data.eventShape?.length ? <span className="node-meta-chip">event: {data.eventShape.join(' x ')}</span> : null}
        </div>
        <Handle className="node-handle node-handle-top" id="source-top" type="source" position={Position.Top} />
        <Handle className="node-handle node-handle-right" id="source-right" type="source" position={Position.Right} />
        <Handle className="node-handle node-handle-bottom" id="source-bottom" type="source" position={Position.Bottom} />
        <Handle className="node-handle node-handle-left" id="source-left" type="source" position={Position.Left} />
      </div>
    );
  }),
};

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function inferPlateIndexForUi(plateId: string): string {
  if (plateId === GLOBAL_SCOPE_ID) return '';
  if (plateId === 'obs' || plateId === 'observation') return 'i';
  if (plateId === 'group') return 'j';
  if (plateId === 'time') return 't';
  return plateId.slice(0, 1).toLowerCase() || 'i';
}

function getPlateTone(plateId: string): PlateTone {
  const normalizedId = plateId.trim().toLowerCase();
  if (normalizedId === GLOBAL_SCOPE_ID) return 'global';
  if (normalizedId === 'group') return 'group';
  if (normalizedId === 'obs' || normalizedId === 'observation') return 'obs';
  if (normalizedId === 'time') return 'time';
  return 'default';
}

function getPlateSizeFromNodes(plateId: string, plateNodes: BayesCanvasNode[]): string {
  if (plateId === GLOBAL_SCOPE_ID) return '1';
  return plateNodes.find((node) => node.data.shape?.length)?.data.shape?.[0] ?? plateId.toUpperCase();
}

function getPlateGroupData(plateId: string, size: string, plateNodes: BayesCanvasNode[]): PlateGroupData {
  const normalizedId = plateId.trim().toLowerCase();
  const labels: Record<string, string> = {
    channel: 'チャネル',
    global: 'グローバル',
    group: 'グループ',
    market: '市場',
    obs: '観測',
    observation: '観測',
    time: '時点',
  };
  return {
    id: plateId,
    label: labels[normalizedId] ?? plateId,
    index: inferPlateIndexForUi(normalizedId),
    size,
    nodeCount: plateNodes.length,
    nodeNames: plateNodes.map((node) => node.data.name),
    tone: getPlateTone(normalizedId),
    isGlobal: normalizedId === GLOBAL_SCOPE_ID,
  };
}

function getPlateContextForNode(node: BayesCanvasNode, groupedNodes: Map<string, BayesCanvasNode[]>): NodePlateContext | undefined {
  const scopeId = node.data.plate ?? GLOBAL_SCOPE_ID;
  const plateNodes = groupedNodes.get(scopeId) ?? [node];
  const plateData = getPlateGroupData(scopeId, getPlateSizeFromNodes(scopeId, plateNodes), plateNodes);
  return {
    id: plateData.id,
    label: plateData.label,
    index: plateData.index,
    size: plateData.size,
    tone: plateData.tone,
    isGlobal: plateData.isGlobal,
  };
}

function getMappingSourceContext(data: BayesNodeData, mappings: IndexMapping[]): IndexAccessContext | undefined {
  const symbol = parseSymbolName(data.name).baseSymbol;
  const mapping = mappings.find((candidate) => candidate.symbol === symbol);
  if (!mapping) return undefined;
  return {
    label: `${mapping.symbol}[${mapping.inputIndex}]`,
    fromPlateId: mapping.fromPlateId,
    toPlateId: mapping.toPlateId,
    tone: getPlateTone(mapping.fromPlateId),
  };
}

function getIndexAccessContexts(data: BayesNodeData, mappings: IndexMapping[]): IndexAccessContext[] {
  const referenceText = getNodeReferenceText(data);
  return mappings.flatMap((mapping) => {
    const pattern = new RegExp(`\\b([A-Za-z][A-Za-z0-9_]*)\\[${escapeRegex(mapping.symbol)}\\[${escapeRegex(mapping.inputIndex)}\\]\\]`, 'g');
    return [...referenceText.matchAll(pattern)].map((match) => ({
      label: `${match[1]}[${mapping.symbol}[${mapping.inputIndex}]]`,
      fromPlateId: mapping.fromPlateId,
      toPlateId: mapping.toPlateId,
      tone: getPlateTone(mapping.fromPlateId),
    }));
  });
}

function renderIndexedNodeName(name: string, plateContext?: NodePlateContext) {
  const match = /^(.*?)(\[[^\]]+\])$/.exec(name);
  if (!match || !plateContext) return name;
  return (
    <>
      {match[1]}
      <span className="node-name-index">{match[2]}</span>
    </>
  );
}

function renameIndexedSymbol(name: string, nextIndex: string): string {
  const trimmed = name.trim();
  if (!nextIndex.trim()) return trimmed;
  if (/\[[^\]]+\]/.test(trimmed)) return trimmed.replace(/\[[^\]]+\]/, `[${nextIndex.trim()}]`);
  return `${trimmed}[${nextIndex.trim()}]`;
}

function formatReviewPanel(diagnostics: ReturnType<typeof compileCanvas>['semantic']['diagnostics']): string {
  if (!diagnostics.length) {
    return 'compiler診断はありません。受け渡しできます。';
  }

  return diagnostics
    .map((diagnostic) => {
      const fixText = diagnostic.fixes?.length
        ? `\n  fixes: ${diagnostic.fixes.map((fix) => fix.title).join(', ')}`
        : '';
      const relatedText = diagnostic.related?.length
        ? `\n  related: ${diagnostic.related.map((related) => `${related.path} ${related.message}`).join(' / ')}`
        : '';
      return [
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code} [${diagnostic.stage}]`,
        `  path: ${diagnostic.path}`,
        `  blocks handoff: ${diagnostic.blocksHandoff ? 'yes' : 'no'}`,
        `  ${diagnostic.message}${fixText}${relatedText}`,
      ].join('\n');
    })
    .join('\n\n');
}

function formatHandoffMarkdown(bundle: HandoffBundle): string {
  const blockingDiagnostics = bundle.diagnostics.filter((diagnostic) => diagnostic.blocksHandoff);
  const unresolvedQuestions = bundle.unresolvedQuestions.filter((question) => question.blocking);
  const capabilityRows = bundle.capabilityReport.length
    ? bundle.capabilityReport.map((item) => (
      `| ${escapeMarkdownCell(item.feature)} | ${item.support} | ${escapeMarkdownCell(item.relatedEntityIds.join(', ') || '-')} | ${escapeMarkdownCell(item.note ?? '-')} |`
    ))
    : ['| - | - | - | - |'];
  const diagnosticRows = blockingDiagnostics.length
    ? blockingDiagnostics.map((diagnostic) => (
      `| ${diagnostic.severity} | ${escapeMarkdownCell(diagnostic.code)} | ${escapeMarkdownCell(diagnostic.path)} | ${escapeMarkdownCell(diagnostic.message)} |`
    ))
    : ['| - | - | - | handoffを止める診断はありません。 |'];
  const questionRows = unresolvedQuestions.length
    ? unresolvedQuestions.map((question) => (
      `| ${escapeMarkdownCell(question.id)} | ${escapeMarkdownCell(question.relatedEntityIds.join(', ') || '-')} | ${escapeMarkdownCell(question.text)} |`
    ))
    : ['| - | - | handoff前に必須確認の質問はありません。 |'];

  return [
    `# 受け渡しレビュー: ${bundle.manifest.target}`,
    '',
    `- Model: ${bundle.manifest.modelDocumentId}`,
    `- Revision: ${bundle.manifest.sourceRevision}`,
    `- Fingerprint: \`${bundle.manifest.fingerprintAlgorithm}:${bundle.manifest.specificationFingerprint}\``,
    `- 診断: ${bundle.diagnostics.length}`,
    `- 受け渡し停止の診断: ${blockingDiagnostics.length}`,
    `- 必須確認の質問: ${unresolvedQuestions.length}`,
    '',
    '## 出力先の対応状況',
    '',
    '| 機能 | 対応 | 要素 | メモ |',
    '| --- | --- | --- | --- |',
    ...capabilityRows,
    '',
    '## 受け渡し停止の診断',
    '',
    '| 重要度 | Code | Path | Message |',
    '| --- | --- | --- | --- |',
    ...diagnosticRows,
    '',
    '## 未解決の質問',
    '',
    '| 質問 | 要素 | 内容 |',
    '| --- | --- | --- |',
    ...questionRows,
  ].join('\n');
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatSemanticDiff(items: ReturnType<typeof diffModelDocuments>): string {
  if (!items.length) return '初期サンプルからの意味的な変更はありません。';
  return items
    .map((item) => [
      `${item.kind}: ${item.label}`,
      `  path: ${item.path}`,
      item.before !== undefined ? `  before: ${JSON.stringify(item.before)}` : undefined,
      item.after !== undefined ? `  after: ${JSON.stringify(item.after)}` : undefined,
    ].filter(Boolean).join('\n'))
    .join('\n\n');
}

export function App() {
  const initialCanvas = useMemo(() => loadInitialCanvas(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<BayesCanvasNode>(initialCanvas.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialCanvas.edges);
  const reactFlowRef = useRef<FlowViewportControls | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelTab>('add');
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const [promptTarget, setPromptTarget] = useState<PromptTarget>('generic');
  const modelIr = useMemo(() => exportModelIr(nodes, edges), [nodes, edges]);
  const compiledCanvas = useMemo(() => compileCanvas(nodes, edges), [nodes, edges]);
  const handoffBundle = useMemo(
    () => buildCanvasHandoff(nodes, edges, promptTarget as HandoffTarget),
    [edges, nodes, promptTarget],
  );
  const modelViewProjections = useMemo(
    () => buildModelViewProjections({
      document: compiledCanvas.document,
      semantic: compiledCanvas.semantic,
      handoff: handoffBundle,
    }),
    [compiledCanvas.document, compiledCanvas.semantic, handoffBundle],
  );
  const prompt = useMemo(() => generateAiPrompt(modelIr, promptTarget), [modelIr, promptTarget]);
  const [activeModelView, setActiveModelView] = useState<ModelViewProjectionId>('canvas');
  const [activeOutput, setActiveOutput] = useState<'math' | 'review' | 'handoff' | 'advanced'>('math');
  const [advancedOutput, setAdvancedOutput] = useState<'ir' | 'prompt' | 'package' | 'diff'>('ir');
  const [handoffPreviewFormat, setHandoffPreviewFormat] = useState<'markdown' | 'json'>('markdown');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [importError, setImportError] = useState<ImportErrorState | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [patchInput, setPatchInput] = useState('');
  const [pendingPatch, setPendingPatch] = useState<PendingPatchState | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImportState | null>(null);
  const [restorePrompt, setRestorePrompt] = useState<RestorePromptState | null>(null);
  const [patchInbox, setPatchInbox] = useState<Array<{ id: string; label: string; value: string }>>([]);
  const [schemaInput, setSchemaInput] = useState('x, real, N\ny, real, N');
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ImplementationReceipt | null>(null);
  const [flowViewport, setFlowViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const receiptFingerprintStatus = useMemo(
    () => receipt
      ? compareReceiptFingerprint(
        receipt,
        handoffBundle.manifest.specificationFingerprint,
        handoffBundle.manifest.fingerprintAlgorithm,
      )
      : null,
    [
      handoffBundle.manifest.fingerprintAlgorithm,
      handoffBundle.manifest.specificationFingerprint,
      receipt,
    ],
  );
  const fullTex = useMemo(() => generateModelTex(modelIr), [modelIr]);
  const activeProjection = useMemo(
    () => modelViewProjections.find((projection) => projection.id === activeModelView) ?? modelViewProjections[0]!,
    [activeModelView, modelViewProjections],
  );
  const reviewText = useMemo(() => formatReviewPanel(compiledCanvas.semantic.diagnostics), [compiledCanvas.semantic.diagnostics]);
  const initialCompiledCanvas = useMemo(() => compileCanvas(initialCanvasNodes, initialCanvasEdges), []);
  const semanticDiff = useMemo(
    () => diffModelDocuments(initialCompiledCanvas.document, compiledCanvas.document),
    [compiledCanvas.document, initialCompiledCanvas.document],
  );
  const portablePackage = useMemo(
    () => buildCanvasPortablePackage(nodes, edges, promptTarget as HandoffTarget),
    [edges, nodes, promptTarget],
  );
  const blockingDiagnostics = useMemo(
    () => compiledCanvas.semantic.diagnostics.filter((diagnostic) => diagnostic.blocksHandoff),
    [compiledCanvas.semantic.diagnostics],
  );
  const blockingQuestions = useMemo(
    () => handoffBundle.unresolvedQuestions.filter((question) => question.blocking),
    [handoffBundle.unresolvedQuestions],
  );
  const handoffReadiness = blockingDiagnostics.length || blockingQuestions.length || compiledCanvas.semantic.readiness.summary.errors
    ? {
        state: 'blocked',
        label: '要修正',
        message: 'Handoff前に止めている項目があります。',
      }
    : compiledCanvas.semantic.readiness.summary.warnings || handoffBundle.unresolvedQuestions.length
      ? {
          state: 'review',
          label: '要確認',
          message: 'Handoff前に確認したい項目があります。',
        }
      : {
          state: 'ready',
          label: '準備OK',
          message: 'このtargetへ受け渡しできます。',
        };
  const advancedOutputText = advancedOutput === 'ir'
    ? JSON.stringify({ modelIr, modelDocument: compiledCanvas.document, layout: compiledCanvas.layout }, null, 2)
    : advancedOutput === 'prompt'
      ? prompt
      : advancedOutput === 'package'
        ? JSON.stringify(portablePackage, null, 2)
        : formatSemanticDiff(semanticDiff);
  const outputText = activeOutput === 'review'
    ? reviewText
    : activeOutput === 'handoff'
      ? handoffPreviewFormat === 'markdown'
        ? formatHandoffMarkdown(handoffBundle)
        : JSON.stringify(handoffBundle, null, 2)
      : activeOutput === 'advanced'
        ? advancedOutputText
        : fullTex;
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );
  const selectedData = selectedNode?.data;
  const selectedKindLabel = selectedData ? NODE_KIND_LABELS[selectedData.kind] : selectedEdge ? 'リンク' : '未選択';
  const showsDistributionEditor = Boolean(
    selectedData && ['parameter', 'hyperparameter', 'latent', 'likelihood'].includes(selectedData.kind),
  );
  const showsExpressionEditor = Boolean(
    selectedData && [
      'deterministic',
      'latent',
      'model_block',
      'derived_quantity',
    ].includes(selectedData.kind),
  );
  const showsObservationEditor = Boolean(
    selectedData && selectedData.observed && (selectedData.kind === 'data' || selectedData.kind === 'likelihood'),
  );
  const showsObservedEditor = Boolean(
    selectedData && ['data', 'likelihood'].includes(selectedData.kind),
  );
  const showsConstraintsEditor = Boolean(
    selectedData && ['parameter', 'hyperparameter', 'latent'].includes(selectedData.kind),
  );
  const plateCount = useMemo(() => new Set(nodes.map((node) => node.data.plate).filter(Boolean)).size, [nodes]);
  const plateRows = useMemo<PlateRow[]>(() => {
    const byPlate = new Map<string, BayesCanvasNode[]>();
    for (const node of nodes) {
      if (!node.data.plate) continue;
      byPlate.set(node.data.plate, [...(byPlate.get(node.data.plate) ?? []), node]);
    }
    return [...byPlate.entries()].map(([id, plateNodes]) => {
      const plateData = getPlateGroupData(id, getPlateSizeFromNodes(id, plateNodes), plateNodes);
      return {
        id: plateData.id,
        label: plateData.label,
        index: plateData.index,
        size: plateData.size,
        nodeCount: plateData.nodeCount,
        nodeNames: plateData.nodeNames,
        tone: plateData.tone,
        isGlobal: false,
      };
    });
  }, [nodes]);
  const [savedModels, setSavedModels] = useState<SavedModelEntry[]>(loadSavedModelsList);
  const diagnosticCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const diagnostic of modelIr.diagnostics) {
      const nodeId = diagnostic.target.nodeId;
      if (!nodeId) continue;
      counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
    }
    for (const diagnostic of compiledCanvas.semantic.diagnostics) {
      const match = /^\/entities\/([^/]+)/.exec(diagnostic.path);
      if (!match) continue;
      const nodeId = match[1].replaceAll('~1', '/').replaceAll('~0', '~');
      counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
    }
    return counts;
  }, [compiledCanvas.semantic.diagnostics, modelIr.diagnostics]);
  const queryNodes = useMemo(() => nodes.filter((node) => node.data.kind === 'derived_quantity'), [nodes]);
  const blockNodes = useMemo(() => nodes.filter((node) => node.data.kind === 'model_block'), [nodes]);
  const decisionNotes = useMemo(
    () => nodes
      .filter((node) => node.data.notes || node.data.hints?.length)
      .map((node) => ({
        id: node.id,
        name: node.data.name,
        text: node.data.notes ?? formatHintsForInput(node.data.hints),
      })),
    [nodes],
  );
  const reviewChecklist = useMemo(() => [
    {
      label: '受け渡しを止める診断がない',
      done: blockingDiagnostics.length === 0,
      detail: `${blockingDiagnostics.length}件`,
    },
    {
      label: '観測済みの尤度がある',
      done: nodes.some((node) => node.data.kind === 'likelihood' && node.data.observed),
      detail: '観測データとの接続',
    },
    {
      label: '確認量が定義されている',
      done: queryNodes.length > 0,
      detail: `${queryNodes.length} QoI`,
    },
    {
      label: '判断メモが残っている',
      done: decisionNotes.length > 0,
      detail: `${decisionNotes.length}件`,
    },
    {
      label: '出力先の対応状況を確認済み',
      done: handoffBundle.capabilityReport.every((item) => item.support !== 'unsupported'),
      detail: `未対応 ${handoffBundle.capabilityReport.filter((item) => item.support === 'unsupported').length}件`,
    },
  ], [blockingDiagnostics.length, decisionNotes.length, handoffBundle.capabilityReport, nodes, queryNodes.length]);
  const overlapCount = useMemo(() => countNodeOverlaps(nodes), [nodes]);
  const focusedNodeIds = useMemo(() => {
    if (!focusNodeId) return null;
    const related = new Set([focusNodeId]);
    for (const edge of edges) {
      if (edge.source === focusNodeId) related.add(edge.target);
      if (edge.target === focusNodeId) related.add(edge.source);
    }
    return related;
  }, [edges, focusNodeId]);
  const visibleFlowNodes = useMemo(
    () => {
      const groupedByPlate = new Map<string, BayesCanvasNode[]>();
      for (const node of nodes) {
        const scopeId = node.data.plate ?? GLOBAL_SCOPE_ID;
        groupedByPlate.set(scopeId, [...(groupedByPlate.get(scopeId) ?? []), node]);
      }

      return nodes
        .filter((node) => !focusedNodeIds || focusedNodeIds.has(node.id))
        .map((node) => ({
          ...node,
          data: {
            ...node.data,
            diagnosticCount: diagnosticCounts.get(node.id) ?? 0,
            plateContext: getPlateContextForNode(node, groupedByPlate),
            mappingSourceContext: getMappingSourceContext(node.data, modelIr.indexMappings),
            indexAccesses: getIndexAccessContexts(node.data, modelIr.indexMappings),
          },
        }));
    },
    [diagnosticCounts, focusedNodeIds, modelIr.indexMappings, nodes],
  );
  const plateOverlays = useMemo(() => buildPlateOverlays(visibleFlowNodes), [visibleFlowNodes]);
  const selectedDiagnostics = useMemo(
    () => modelIr.diagnostics.filter((diagnostic) => diagnostic.target.nodeId === selectedNodeId || diagnostic.target.expressionId === selectedNodeId),
    [modelIr.diagnostics, selectedNodeId],
  );
  const selectedCompilerDiagnostics = useMemo(
    () => compiledCanvas.semantic.diagnostics.filter((diagnostic) => selectedNodeId && diagnostic.path.startsWith(`/entities/${selectedNodeId}`)),
    [compiledCanvas.semantic.diagnostics, selectedNodeId],
  );
  const reviewDiagnosticGroups = useMemo(() => {
    const diagnostics = compiledCanvas.semantic.diagnostics;
    return [
      {
        id: 'blocking',
        label: '受け渡し停止',
        diagnostics: diagnostics.filter((diagnostic) => diagnostic.blocksHandoff),
      },
      {
        id: 'error',
        label: 'エラー',
        diagnostics: diagnostics.filter((diagnostic) => diagnostic.severity === 'error' && !diagnostic.blocksHandoff),
      },
      {
        id: 'warning',
        label: '確認',
        diagnostics: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning' && !diagnostic.blocksHandoff),
      },
      {
        id: 'info',
        label: '情報',
        diagnostics: diagnostics.filter((diagnostic) => diagnostic.severity === 'info' && !diagnostic.blocksHandoff),
      },
    ];
  }, [compiledCanvas.semantic.diagnostics]);

  const labeledEdges = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const visibleEdges = edges.filter((edge) => !focusedNodeIds || (focusedNodeIds.has(edge.source) && focusedNodeIds.has(edge.target)));
    const laneCounts = new Map<string, number>();
    const sourceEndpointLaneCounts = new Map<string, number>();
    const targetEndpointLaneCounts = new Map<string, number>();

    return visibleEdges.map((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) return { ...edge, type: 'paramEdge' as const };
      const handles = getPreferredEdgeHandles(sourceNode, targetNode);
      const sourceEndpointKey = `${edge.source}:${handles.sourceHandle}`;
      const targetEndpointKey = `${edge.target}:${handles.targetHandle}`;
      const sourceLaneIndex = sourceEndpointLaneCounts.get(sourceEndpointKey) ?? 0;
      const targetLaneIndex = targetEndpointLaneCounts.get(targetEndpointKey) ?? 0;
      sourceEndpointLaneCounts.set(sourceEndpointKey, sourceLaneIndex + 1);
      targetEndpointLaneCounts.set(targetEndpointKey, targetLaneIndex + 1);
      const laneKey = [
        handles.sourceHandle,
        handles.targetHandle,
        Math.round(sourceNode.position.x / 40),
        Math.round(targetNode.position.x / 40),
      ].join(':');
      const routeIndex = laneCounts.get(laneKey) ?? 0;
      laneCounts.set(laneKey, routeIndex + 1);
      const paramLabel = resolveEdgeParam(edge.source, targetNode.data);
      const edgeRelation = getEdgeRelation(edge, sourceNode, targetNode, modelIr.indexMappings, paramLabel);
      const edgeTone = edgeRelation.tone;
      return {
        ...edge,
        ...handles,
        type: 'paramEdge' as const,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: edgeTone,
        },
        style: {
          ...edge.style,
          stroke: edgeTone,
          strokeDasharray: edgeRelation.kind === 'dependency' ? undefined : edgeRelation.kind === 'mapping' ? '3 5' : '8 6',
        },
        data: {
          ...edge.data,
          paramLabel,
          directionLabel: edgeRelation.label,
          relationKind: edgeRelation.kind,
          routeOffset: getEdgeRouteOffset(routeIndex),
          sourceLaneOffset: getEdgeEndpointOffset(sourceLaneIndex),
          targetLaneOffset: getEdgeEndpointOffset(targetLaneIndex),
        },
      };
    });
  }, [nodes, edges, focusedNodeIds, modelIr.indexMappings]);

  useEffect(() => {
    let cancelled = false;
    void loadLatestAutosave()
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        const projected = projectToReactFlow({
          document: snapshot.document,
          layout: snapshot.layout,
        });
        setRestorePrompt({
          snapshot,
          nodes: projected.nodes.map(prepareCanvasNode),
          edges: projected.edges.map((edge: Edge) => ({
            ...edge,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
          })),
          summary: `${projected.nodes.length} nodes / ${projected.edges.length} links / ${new Date(snapshot.savedAt).toLocaleString()}`,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setImportError({
          title: '自動保存を確認できません',
          detail: error instanceof Error ? error.message : 'IndexedDBの復元候補を読み込めませんでした。',
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void saveAutosave(compiledCanvas.document, compiledCanvas.layout).catch((error) => {
        if (cancelled) return;
        setImportError({
          title: '自動保存に失敗しました',
          detail: error instanceof Error ? error.message : 'IndexedDBへ保存できませんでした。',
        });
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [compiledCanvas.document, compiledCanvas.layout]);

  const addNodeFromPalette = useCallback(
    (kind: BayesNodeData['kind']) => {
      const count = nodes.filter((node) => node.data.kind === kind).length + 1;
      const id = `${kind}_${Date.now()}`;
      const column = (nodes.length % 4) * 210 + 120;
      const row = Math.floor(nodes.length / 4) * 150 + 80;

      setNodes((currentNodes) => [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        {
          id,
          type: 'bayesNode',
          position: { x: column, y: row },
          selected: true,
          data: createNodeData(kind, count),
        },
      ]);
      setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: false })));
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      setActiveLeftPanel('inspector');
    },
    [nodes, setEdges, setNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            id: `${connection.source}-${connection.target}-${Date.now()}`,
            type: 'smoothstep',
            data: { role: 'dependency' },
            markerEnd: { type: MarkerType.ArrowClosed },
          },
          currentEdges,
        ),
      );
    },
    [setEdges],
  );

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedNodeId(params.nodes[0]?.id ?? null);
    setSelectedEdgeId(params.nodes.length ? null : (params.edges[0]?.id ?? null));
    if (params.nodes.length || params.edges.length) {
      setActiveLeftPanel('inspector');
    }
  }, []);

  const focusEditorHeading = useCallback(() => {
    window.setTimeout(() => editorHeadingRef.current?.focus(), 0);
  }, []);

  const selectNodeForEditing = useCallback(
    (nodeId: string, options: { focusEditor?: boolean } = {}) => {
      if (!nodes.some((node) => node.id === nodeId)) return;
      setNodes((currentNodes) =>
        currentNodes.map((node) => ({ ...node, selected: node.id === nodeId })),
      );
      setEdges((currentEdges) =>
        currentEdges.map((edge) => ({ ...edge, selected: false })),
      );
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      if (options.focusEditor) {
        setActiveLeftPanel('inspector');
        focusEditorHeading();
      }
    },
    [focusEditorHeading, nodes, setEdges, setNodes],
  );

  const selectPlateNodes = useCallback((nodeIds: string[], additive: boolean) => {
    const nodeIdSet = new Set(nodeIds);
    let firstSelectedId: string | null = null;
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const nextSelected = nodeIdSet.has(node.id)
          ? (additive ? !node.selected : true)
          : (additive ? Boolean(node.selected) : false);
        if (nextSelected && !firstSelectedId) firstSelectedId = node.id;
        return { ...node, selected: nextSelected };
      }),
    );
    setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: false })));
    setSelectedNodeId(firstSelectedId);
    setSelectedEdgeId(null);
    setActiveLeftPanel('inspector');
  }, [setEdges, setNodes]);

  const selectProjectionEntity = useCallback(
    (entityId: string) => {
      const candidateIds = [
        entityId,
        entityId.startsWith('obs_') ? entityId.slice(4) : undefined,
      ].filter((candidate): candidate is string => Boolean(candidate));
      const nodeId = candidateIds.find((candidate) => nodes.some((node) => node.id === candidate));

      if (nodeId) {
        setActiveModelView('canvas');
        selectNodeForEditing(nodeId, { focusEditor: true });
        return;
      }

      setImportError({
        title: '対応するキャンバスノードがありません',
        detail: `${entityId} は生成または契約用のentityです。Contract viewで内容を確認できます。`,
      });
    },
    [nodes, selectNodeForEditing],
  );

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

  const renamePlate = useCallback((plateId: string, nextId: string) => {
    const trimmed = nextId.trim();
    if (!trimmed || trimmed === plateId) return;
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          plate: node.data.plate === plateId ? trimmed : node.data.plate,
        },
      })),
    );
  }, [setNodes]);

  const updatePlateSize = useCallback((plateId: string, nextSize: string) => {
    const trimmed = nextSize.trim();
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.data.plate !== plateId) return node;
        const currentShape = node.data.shape ?? [];
        return {
          ...node,
          data: {
            ...node.data,
            shape: trimmed ? [trimmed, ...currentShape.slice(1)] : currentShape.slice(1),
          },
        };
      }),
    );
  }, [setNodes]);

  const updatePlateIndex = useCallback((plateId: string, nextIndex: string) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.data.plate !== plateId) return node;
        return {
          ...node,
          data: {
            ...node.data,
            name: renameIndexedSymbol(node.data.name, nextIndex),
          },
        };
      }),
    );
  }, [setNodes]);

  const addPlateToSelection = useCallback(() => {
    if (!selectedNodeId) return;
    updateSelectedNodeData({ plate: 'time', shape: ['T'] });
  }, [selectedNodeId, updateSelectedNodeData]);

  const applyHorseshoePrior = useCallback(() => {
    const horseshoeDistribution = {
      id: 'horseshoe',
      name: 'Horseshoe',
      args: { scale: 'tau0' },
    };

    if (selectedNodeId && selectedData && ['parameter', 'latent'].includes(selectedData.kind)) {
      updateSelectedNodeData({
        distribution: horseshoeDistribution,
        notes: selectedData.notes ?? 'Horseshoe prior. Connect or define tau0 when the scale should be explicit.',
      });
      return;
    }

    const count = nodes.filter((node) => node.data.kind === 'parameter').length + 1;
    const id = `parameter_${Date.now()}`;
    const column = (nodes.length % 4) * 210 + 120;
    const row = Math.floor(nodes.length / 4) * 150 + 80;

    setNodes((currentNodes) => [
      ...currentNodes.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: 'bayesNode',
        position: { x: column, y: row },
        selected: true,
        data: {
          kind: 'parameter',
          name: count === 1 ? 'beta' : `beta_${count}`,
          distribution: horseshoeDistribution,
          notes: 'Horseshoe prior. Connect or define tau0 when the scale should be explicit.',
        },
      },
    ]);
    setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: false })));
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setActiveLeftPanel('inspector');
  }, [nodes, selectedData, selectedNodeId, setEdges, setNodes, updateSelectedNodeData]);

  const applyRegressionTermPreset = useCallback(
    (term: string) => {
      if (selectedNodeId && selectedData?.kind === 'deterministic') {
        updateSelectedNodeData({ expression: appendTerm(selectedData.expression, term) });
        return;
      }

      const count = nodes.filter((node) => node.data.kind === 'deterministic').length + 1;
      const id = `deterministic_${Date.now()}`;
      const column = (nodes.length % 4) * 210 + 120;
      const row = Math.floor(nodes.length / 4) * 150 + 80;

      setNodes((currentNodes) => [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        {
          id,
          type: 'bayesNode',
          position: { x: column, y: row },
          selected: true,
          data: {
            kind: 'deterministic',
            name: `mu_${count}[i]`,
            shape: ['N'],
            plate: 'obs',
            expression: term,
          },
        },
      ]);
      setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: false })));
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      setActiveLeftPanel('inspector');
    },
    [nodes, selectedData, selectedNodeId, setEdges, setNodes, updateSelectedNodeData],
  );

  const applyPaletteItem = useCallback(
    (item: PaletteItem) => {
      if (item.type === 'node') {
        addNodeFromPalette(item.kind);
        return;
      }

      if (item.preset === 'horseshoe_prior') {
        applyHorseshoePrior();
        return;
      }

      if (item.preset === 'linear_term') {
        applyRegressionTermPreset('beta * x[i]');
        return;
      }

      if (item.preset === 'group_effect') {
        applyRegressionTermPreset('alpha[group_id[i]]');
        return;
      }

      applyRegressionTermPreset('beta_interaction * x1[i] * x2[i]');
    },
    [addNodeFromPalette, applyHorseshoePrior, applyRegressionTermPreset],
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
  }, [edges, nodes, selectedEdgeId, selectedNodeId, setEdges, setNodes]);

  const restoreUndo = useCallback(() => {
    if (!undoState) return;
    setNodes(undoState.nodes);
    setEdges(undoState.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setUndoState(null);
  }, [setEdges, setNodes, undoState]);

  const applyRestorePrompt = useCallback(() => {
    if (!restorePrompt) return;
    setUndoState({ message: '自動保存を復元しました。', nodes, edges });
    setNodes(restorePrompt.nodes);
    setEdges(restorePrompt.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setRestorePrompt(null);
  }, [edges, nodes, restorePrompt, setEdges, setNodes]);

  const copyExternalImportPrompt = useCallback(() => {
    copyText(EXTERNAL_MODEL_IMPORT_PROMPT);
    setImportError({
      title: '外部モデル変換promptをコピーしました',
      detail: 'AI toolの出力JSONを読み込み、previewを確認してから適用してください。',
    });
  }, []);

  const insertPatchTemplate = useCallback(() => {
    setPatchInput(JSON.stringify({
      proposalVersion: '1.0.0',
      baseDocumentId: compiledCanvas.document.documentId,
      baseRevision: compiledCanvas.document.revision,
      intent: 'Rename beta to slope as a reviewed semantic rename.',
      author: 'ai',
      operations: [
        { op: 'replace', path: '/entities/beta/symbol', value: 'slope' },
        { op: 'replace', path: '/entities/beta/label', value: 'slope' },
      ],
      reviewNotes: ['Preview diagnostics and semantic diff before applying.'],
    }, null, 2));
  }, [compiledCanvas.document.documentId, compiledCanvas.document.revision]);

  const previewPatch = useCallback(() => {
    try {
      const preview = previewCanvasPatch(nodes, edges, JSON.parse(patchInput));
      setPendingPatch({
        preview,
        nodes: preview.projected.nodes,
        edges: preview.projected.edges,
        summary: [
          `${preview.semanticDiff.length} semantic changes`,
          `${preview.before.diagnostics.length} diagnostics before`,
          `${preview.after.diagnostics.length} diagnostics after`,
        ].join(' / '),
      });
      setImportError(null);
    } catch (error) {
      setPendingPatch(null);
      setImportError({
        title: 'パッチをプレビューできません',
        detail: error instanceof Error ? error.message : 'JSON Patch proposalを確認してください。',
      });
    }
  }, [edges, nodes, patchInput]);

  const applyPendingPatch = useCallback(() => {
    if (!pendingPatch) return;
    setUndoState({ message: 'パッチを適用しました。', nodes, edges });
    setNodes(pendingPatch.nodes);
    setEdges(pendingPatch.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPendingPatch(null);
  }, [edges, nodes, pendingPatch, setEdges, setNodes]);

  const applyPendingImport = useCallback(() => {
    if (!pendingImport) return;
    setUndoState({ message: `${pendingImport.sourceName} を読み込みました。`, nodes, edges });
    setNodes(addImportProvenance(pendingImport.nodes, pendingImport.sourceName));
    setEdges(pendingImport.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPendingImport(null);
    setActiveLeftPanel('inspector');
    setActiveOutput('review');
  }, [edges, nodes, pendingImport, setEdges, setNodes]);

  const handleReceiptImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const raw = assertJsonComplexity(await file.text(), { maxBytes: MAX_IMPORT_BYTES, maxDepth: MAX_IMPORT_DEPTH });
        setReceipt(validateImplementationReceipt(raw));
        setImportError(null);
      } catch (error) {
        setImportError({
          title: 'Receiptを読み込めません',
          detail: error instanceof Error ? error.message : 'Implementation Receiptの形式を確認してください。',
        });
      }
    };
    input.click();
  }, []);

  const resetSample = useCallback(() => {
    if (!window.confirm('現在のキャンバスを初期サンプルへ戻します。元に戻せます。')) return;
    setUndoState({ message: '初期サンプルへ戻しました。', nodes, edges });
    setNodes(initialCanvasNodes);
    setEdges(initialCanvasEdges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [edges, nodes, setEdges, setNodes]);

  const handleSave = useCallback(() => {
    const name = window.prompt('保存名:', `モデル ${new Date().toLocaleString()}`);
    if (!name) return;
    setSavedModels(saveModelSnapshot(name, nodes, edges));
  }, [nodes, edges]);

  const handleLoad = useCallback(
    (id: string) => {
      const state = loadModelSnapshot(id);
      if (!state) return;
      setNodes(state.nodes);
      setEdges(state.edges);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    },
    [setNodes, setEdges],
  );

  const handleDeleteSnapshot = useCallback((id: string) => {
    setSavedModels(deleteModelSnapshot(id));
  }, []);

  const applyModelTemplate = useCallback((template: ModelTemplate) => {
    setUndoState({ message: `${template.name} テンプレートを適用しました。`, nodes, edges });
    setNodes(template.nodes.map(prepareCanvasNode));
    setEdges(template.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setActiveLeftPanel('inspector');
    setActiveOutput('review');
  }, [edges, nodes, setEdges, setNodes]);

  const handleExport = useCallback(() => {
    exportCanvasToFile(nodes, edges);
  }, [nodes, edges]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const state = await parseCanvasFile(file);
        setPendingImport(state);
        setImportError(null);
      } catch (error) {
        setPendingImport(null);
        setImportError({
          title: '読み込みに失敗しました',
          detail: error instanceof Error ? error.message : 'JSON形式とBayes Canvas形式を確認してください。',
        });
      }
    };
    input.click();
  }, []);

  const addQoIFromSelection = useCallback(() => {
    const sourceNode = selectedNode ?? nodes.find((node) => ['parameter', 'deterministic', 'likelihood'].includes(node.data.kind));
    const id = `qoi_${Date.now()}`;
    setUndoState({ message: 'QoIを追加しました。', nodes, edges });
    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id,
        type: 'bayesNode',
        position: {
          x: (sourceNode?.position.x ?? 520) + 220,
          y: sourceNode?.position.y ?? 220,
        },
        data: {
          kind: 'derived_quantity',
          name: sourceNode ? `${sourceNode.data.name.replace(/\[[^\]]+\]/u, '')}_qoi` : 'quantity_of_interest',
          expression: sourceNode?.data.name.replace(/\[[^\]]+\]/u, '') ?? 'target',
          notes: 'QoI generated from the builder. Confirm scale before handoff.',
        },
      },
    ]);
    if (sourceNode) {
      setEdges((currentEdges) => [
        ...currentEdges,
        { id: `${sourceNode.id}-${id}`, source: sourceNode.id, target: id, data: { role: 'query-source' } },
      ]);
    }
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setActiveLeftPanel('inspector');
  }, [edges, nodes, selectedNode, setEdges, setNodes]);

  const addModelBlock = useCallback(() => {
    const id = `block_${Date.now()}`;
    setUndoState({ message: 'Model Blockを追加しました。', nodes, edges });
    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id,
        type: 'bayesNode',
        position: { x: 620, y: 120 + (blockNodes.length * 130) },
        data: {
          kind: 'model_block',
          name: `custom_block_${blockNodes.length + 1}`,
          expression: 'inputs -> outputs',
          notes: 'Block boundary. Fill in inputs, outputs, validation coverage, and backend support notes.',
        },
      },
    ]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setActiveLeftPanel('inspector');
  }, [blockNodes.length, edges, nodes, setNodes]);

  const importSchemaColumns = useCallback(() => {
    const rows = schemaInput.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!rows.length) return;
    setUndoState({ message: 'SchemaからDataノードを追加しました。', nodes, edges });
    setNodes((currentNodes) => [
      ...currentNodes,
      ...rows.map((row, index) => {
        const [name = `column_${index + 1}`, scalar = 'real', shape = 'N'] = row.split(',').map((item) => item.trim());
        const id = `data_${name.replace(/[^a-zA-Z0-9_]/gu, '_')}_${Date.now()}_${index}`;
        return {
          id,
          type: 'bayesNode' as const,
          position: { x: 80 + (index % 2) * 220, y: 120 + Math.floor(index / 2) * 150 },
          data: {
            kind: 'data' as const,
            name: shape ? `${name}[i]` : name,
            shape: shape ? [shape] : undefined,
            plate: shape ? 'obs' : undefined,
            observed: true,
            notes: `Imported column. Type: ${scalar}. Confirm role before handoff.`,
          },
        };
      }),
    ]);
    setActiveLeftPanel('inspector');
  }, [edges, nodes, schemaInput, setNodes]);

  const savePatchToInbox = useCallback(() => {
    if (!patchInput.trim()) return;
    setPatchInbox((items) => [
      ...items,
      {
        id: `patch_${Date.now()}`,
        label: `Proposal ${items.length + 1}`,
        value: patchInput,
      },
    ]);
  }, [patchInput]);

  const resolveCanvasOverlaps = useCallback(async () => {
    if (nodes.length < 2) return;
    const previousPositions = new Map(nodes.map((node) => [node.id, node.position]));
    const undoMessage = '依存関係とプレートを考慮してノード配置を整理しました。';

    setImportError(null);

    let arrangedNodes: BayesCanvasNode[];
    try {
      arrangedNodes = arrangeCanvasNodesByPlate(await layoutCanvasNodesWithElk(nodes, edges), edges);
    } catch (error) {
      setImportError({
        title: '配置整理に失敗しました',
        detail: error instanceof Error ? error.message : '依存関係のレイアウトを計算できませんでした。現在の配置は変更していません。',
      });
      return;
    }

    const movedCount = arrangedNodes.filter((node) => {
      const previous = previousPositions.get(node.id);
      return previous && (previous.x !== node.position.x || previous.y !== node.position.y);
    }).length;
    if (!movedCount) return;
    setUndoState({ message: undoMessage, nodes, edges });
    setNodes(arrangedNodes);
    setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: false })));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    window.setTimeout(() => {
      reactFlowRef.current?.fitView({ padding: 0.18, duration: 220 });
    }, 0);
  }, [edges, nodes, setEdges, setNodes]);

  const commands = useMemo<CommandAction[]>(() => [
    {
      id: 'add-data',
      label: 'データを追加',
      group: '追加',
      run: () => addNodeFromPalette('data'),
    },
    {
      id: 'add-parameter',
      label: 'パラメータを追加',
      group: '追加',
      run: () => addNodeFromPalette('parameter'),
    },
    {
      id: 'add-likelihood',
      label: '尤度を追加',
      group: '追加',
      run: () => addNodeFromPalette('likelihood'),
    },
    {
      id: 'add-deterministic',
      label: '決定式を追加',
      group: '追加',
      run: () => addNodeFromPalette('deterministic'),
    },
    {
      id: 'open-add',
      label: '追加パネルを開く',
      group: '移動',
      run: () => setActiveLeftPanel('add'),
    },
    ...modelTemplates.map((template) => ({
      id: `template-${template.id}`,
      label: `${template.name} から始める`,
      group: 'テンプレート',
      run: () => applyModelTemplate(template),
    })),
    {
      id: 'open-structure',
      label: '構造パネルを開く',
      group: '移動',
      run: () => setActiveLeftPanel('structure'),
    },
    ...modelViewProjections.map((projection) => ({
      id: `view-${projection.id}`,
      label: `${projection.title} ビューを開く`,
      group: 'ビュー',
      run: () => setActiveModelView(projection.id),
    })),
    {
      id: 'resolve-overlaps',
      label: '重なり解消',
      group: 'キャンバス',
      run: () => {
        void resolveCanvasOverlaps();
      },
    },
    {
      id: 'go-review',
      label: '診断へ移動',
      group: '移動',
      run: () => setActiveOutput('review'),
    },
    {
      id: 'add-qoi',
      label: '確認量を追加',
      group: '補助',
      run: addQoIFromSelection,
    },
    {
      id: 'add-model-block',
      label: 'モデルブロックを追加',
      group: '補助',
      run: addModelBlock,
    },
    {
      id: 'prepare-handoff',
      label: '受け渡しを準備',
      group: '移動',
      run: () => setActiveOutput('handoff'),
    },
    {
      id: 'export-package',
      label: 'Packageを書き出し',
      group: 'ファイル',
      run: () => exportPortablePackageToFile(portablePackage),
    },
    {
      id: 'import-canvas',
      label: 'キャンバスを読み込み',
      group: 'ファイル',
      run: handleImport,
    },
    {
      id: 'external-model-import-prompt',
      label: '外部モデル取り込みプロンプトをコピー',
      group: 'ファイル',
      run: copyExternalImportPrompt,
    },
    {
      id: 'copy-ir',
      label: 'IR をコピー',
      group: '高度',
      run: () => copyText(JSON.stringify(modelIr, null, 2)),
    },
    {
      id: 'save-model',
      label: 'モデルを保存',
      group: 'ファイル',
      run: handleSave,
    },
    {
      id: 'export-file',
      label: 'キャンバスを書き出し',
      group: 'ファイル',
      run: handleExport,
    },
    {
      id: 'reset-sample',
      label: '初期サンプルへ戻す',
      group: '高度',
      run: resetSample,
    },
    {
      id: 'import-receipt',
      label: '実装対応表を読み込み',
      group: '高度',
      run: handleReceiptImport,
    },
    {
      id: 'horseshoe-prior',
      label: 'Horseshoe事前分布を適用',
      group: '補助',
      run: applyHorseshoePrior,
    },
    {
      id: 'schema-import',
      label: 'スキーマ取り込みを開く',
      group: '補助',
      run: () => setActiveLeftPanel('structure'),
    },
    {
      id: 'focus-dependencies',
      label: '選択ノードの依存関係だけ表示',
      group: 'キャンバス',
      run: () => setFocusNodeId(selectedNodeId),
    },
    {
      id: 'clear-focus',
      label: '絞り込み解除',
      group: 'キャンバス',
      run: () => setFocusNodeId(null),
    },
    {
      id: 'go-advanced',
      label: '詳細出力を開く',
      group: '移動',
      run: () => setActiveOutput('advanced'),
    },
  ], [
    addModelBlock,
    addNodeFromPalette,
    addQoIFromSelection,
    applyHorseshoePrior,
    applyModelTemplate,
    copyExternalImportPrompt,
    handleExport,
    handleImport,
    handleReceiptImport,
    handleSave,
    modelIr,
    modelViewProjections,
    portablePackage,
    resetSample,
    resolveCanvasOverlaps,
    selectedNodeId,
  ]);

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return commands;
    return commands.filter((command) =>
      `${command.group} ${command.label}`.toLowerCase().includes(query),
    );
  }, [commandQuery, commands]);

  const runCommand = useCallback((command: CommandAction) => {
    command.run();
    setCommandPaletteOpen(false);
    setCommandQuery('');
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      if (event.key === '/' && !isTyping) {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
      if (event.key === 'Escape') {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <h1>Bayes Canvas</h1>
          <p>ベイズモデルを図で組み、実装へ渡すためのキャンバス。</p>
        </div>
        <div className="model-summary" aria-label="モデル概要">
          <div className="summary-secondary">
            <span className="summary-value">{nodes.length}</span>
            <span className="summary-label">ノード</span>
          </div>
          <div className="summary-secondary">
            <span className="summary-value">{edges.length}</span>
            <span className="summary-label">リンク</span>
          </div>
          <div className="summary-secondary">
            <span className="summary-value">{plateCount}</span>
            <span className="summary-label">反復範囲</span>
          </div>
          <div className={compiledCanvas.semantic.readiness.summary.errors ? 'summary-danger' : 'summary-quiet'}>
            <span className="summary-value">{compiledCanvas.semantic.readiness.summary.errors}</span>
            <span className="summary-label">エラー</span>
          </div>
          <div className={modelIr.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length + compiledCanvas.semantic.readiness.summary.warnings ? 'summary-warning' : 'summary-quiet'}>
            <span className="summary-value">{modelIr.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length + compiledCanvas.semantic.readiness.summary.warnings}</span>
            <span className="summary-label">確認</span>
          </div>
        </div>
      </header>

      <div className="status-stack" aria-live="polite">
        {importError ? (
          <div className="status-banner status-error" role="alert">
            <strong>{importError.title}</strong>
            <span>{importError.detail}</span>
            <button type="button" onClick={() => setImportError(null)}>
              閉じる
            </button>
          </div>
        ) : null}

        {undoState ? (
          <div className="status-banner status-undo" role="status">
            <span>{undoState.message}</span>
            <button type="button" onClick={restoreUndo}>
              元に戻す
            </button>
            <button type="button" onClick={() => setUndoState(null)}>
              確定
            </button>
          </div>
        ) : null}

        {restorePrompt ? (
          <div className="status-banner status-undo" role="status">
            <strong>自動保存があります</strong>
            <span>{restorePrompt.summary}</span>
            <button type="button" onClick={applyRestorePrompt}>
              復元
            </button>
            <button type="button" onClick={() => setRestorePrompt(null)}>
              閉じる
            </button>
          </div>
        ) : null}

        {pendingImport ? (
          <div className="status-banner status-undo" role="status">
            <strong>読み込みプレビュー: {pendingImport.sourceName}</strong>
            <span>
              {pendingImport.sourceKind} / {pendingImport.summary} / 停止 {pendingImport.blockingDiagnostics}件
              {pendingImport.preview ? ` / edge: ${pendingImport.preview.edgeSummary.source}` : ''}
            </span>
            {pendingImport.importWarnings.length ? (
              <span>{pendingImport.importWarnings.join(' ')}</span>
            ) : null}
            <button type="button" onClick={applyPendingImport}>
              適用
            </button>
            <button type="button" onClick={() => setPendingImport(null)}>
              閉じる
            </button>
          </div>
        ) : null}
      </div>

      {commandPaletteOpen ? (
        <div className="command-backdrop" role="presentation" onMouseDown={() => setCommandPaletteOpen(false)}>
          <div
            aria-label="コマンドパレット"
            aria-modal="true"
            className="command-palette"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <input
              autoFocus
              placeholder="操作を検索"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
            />
            <div className="command-list">
              {filteredCommands.length ? filteredCommands.map((command) => (
                <button key={command.id} type="button" onClick={() => runCommand(command)}>
                  <span>{command.label}</span>
                  <small>{command.group}</small>
                </button>
              )) : (
                <p className="empty-note">一致する操作はありません。</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <section className="workspace">
        <aside className="panel left-panel">
          <div className="panel-title">
            <h2>
              {activeLeftPanel === 'add'
                ? '追加'
                : activeLeftPanel === 'structure'
                  ? '構造'
                  : activeLeftPanel === 'library'
                    ? '保存'
                    : '編集'}
            </h2>
            <span>
              {activeLeftPanel === 'add'
                ? 'モデル要素'
                : activeLeftPanel === 'structure'
                  ? `${plateRows.length}件の反復範囲`
                  : activeLeftPanel === 'library'
                    ? `${savedModels.length}件のsnapshot`
                    : selectedKindLabel}
            </span>
          </div>
          <div className="panel-tabs" role="tablist" aria-label="左ペイン">
            {LEFT_PANEL_TABS.map((tab) => (
              <button
                aria-selected={activeLeftPanel === tab.id}
                className={activeLeftPanel === tab.id ? 'is-active' : undefined}
                key={tab.id}
                onClick={() => setActiveLeftPanel(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
          {activeLeftPanel === 'add' ? (
            <div className="add-panel">
              <div className="palette-groups">
                {PALETTE_GROUPS.map((group) => (
                  <div className="palette-group" key={group.title}>
                    <h3>{group.title}</h3>
                    <div className="palette-list">
                      {group.items.map((item) => (
                        <button
                          className={`palette-item ${item.type === 'node' ? `palette-${item.kind}` : 'palette-preset'}`}
                          key={item.type === 'node' ? item.kind : item.preset}
                          onClick={() => applyPaletteItem(item)}
                          type="button"
                        >
                          <span>{item.label}</span>
                          <small>{item.note}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {activeLeftPanel === 'structure' ? (
            <div className="plate-panel">
              <div className="panel-title compact">
                <h2>反復範囲</h2>
                <span>{plateRows.length}</span>
              </div>
              <div className="plate-list">
                {plateRows.map((plate) => (
                  <div className={`plate-row plate-tone-${plate.tone}`} key={plate.id}>
                    <div className="plate-row-heading">
                      <strong>{plate.label}</strong>
                      <span>{plate.index}=1..{plate.size}</span>
                    </div>
                    <label>
                      範囲ID
                      <input
                        defaultValue={plate.id}
                        onBlur={(event) => renamePlate(plate.id, event.target.value)}
                      />
                    </label>
                    <label>
                      添字
                      <input
                        defaultValue={plate.index}
                        onBlur={(event) => updatePlateIndex(plate.id, event.target.value)}
                      />
                    </label>
                    <label>
                      サイズ
                      <input
                        defaultValue={plate.size}
                        onBlur={(event) => updatePlateSize(plate.id, event.target.value)}
                      />
                    </label>
                    <span>{plate.nodeCount}ノード: {plate.nodeNames.join(', ')}</span>
                  </div>
                ))}
                {!plateRows.length ? <p className="empty-note">反復範囲を持つノードはまだありません。</p> : null}
              </div>
              <button disabled={!selectedNodeId} type="button" onClick={addPlateToSelection}>
                選択ノードをtimeの反復範囲に入れる
              </button>
              {modelIr.indexMappings.length ? (
                <div className="mapping-list">
                  <div className="panel-title compact">
                    <h2>インデックス対応</h2>
                    <span>{modelIr.indexMappings.length}</span>
                  </div>
                  {modelIr.indexMappings.map((mapping) => (
                    <div className={`mapping-row plate-tone-${getPlateTone(mapping.fromPlateId)}`} key={mapping.id}>
                      <span>{mapping.symbol}[{mapping.inputIndex}]</span>
                      <strong>{mapping.fromPlateId} → {mapping.toPlateId}</strong>
                      {mapping.outputIndex ? <small>target index {mapping.outputIndex}</small> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {activeLeftPanel === 'library' ? (
            <div className="library-panel">
              <div className="template-panel">
                <div className="panel-title compact">
                  <h2>テンプレート</h2>
                  <span>{modelTemplates.length}</span>
                </div>
                <div className="template-list">
                  {modelTemplates.map((template) => (
                    <button key={template.id} type="button" onClick={() => applyModelTemplate(template)}>
                      <strong>{template.name}</strong>
                      <span>{template.family} / {template.status}</span>
                      <small>{template.reviewQuestions[0]}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="snapshots-panel">
                <div className="panel-title compact">
                  <h2>保存済み</h2>
                  <span>{savedModels.length}</span>
                </div>
                {savedModels.length > 0 ? (
                  <div className="snapshots-list">
                    {savedModels.map((model) => (
                      <div className="snapshot-row" key={model.id}>
                        <div className="snapshot-info">
                          <span className="snapshot-name">{model.name}</span>
                          <span className="snapshot-meta">
                            {model.nodeCount}n {model.edgeCount}e · {new Date(model.savedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="snapshot-actions">
                          <button type="button" onClick={() => handleLoad(model.id)}>
                            読込
                          </button>
                          <button type="button" onClick={() => handleDeleteSnapshot(model.id)}>
                            削除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-note">保存済みsnapshotはまだありません。</p>
                )}
              </div>
            </div>
          ) : null}
          {activeLeftPanel === 'inspector' ? (
            <div className="editor-panel">
              <div className="panel-title compact">
                <h2 ref={editorHeadingRef} tabIndex={-1}>編集</h2>
                <span>{selectedKindLabel}</span>
              </div>
            {selectedData ? (
              <div className="node-editor">
                <button className="danger-button compact-danger" onClick={deleteSelectedItem} type="button">
                  選択中を削除
                </button>
                <div className="inspector-section">
                  <div className="inspector-section-title">基本</div>
                  <label>
                    名前
                    <input
                      value={selectedData.name}
                      onChange={(event) => updateSelectedNodeData({ name: event.target.value })}
                    />
                  </label>
                  <span className={`kind-pill palette-${selectedData.kind}`}>{NODE_KIND_LABELS[selectedData.kind]}</span>
                </div>
                <div className="inspector-section">
                  <div className="inspector-section-title">次元と反復範囲</div>
                  <label>
                    Batch shape
                    <input
                      placeholder="N, J"
                      value={selectedData.shape?.join(', ') ?? ''}
                      onChange={(event) => updateSelectedNodeData({ shape: parseList(event.target.value) })}
                    />
                  </label>
                  <label>
                    Event shape
                    <input
                      placeholder="K"
                      value={selectedData.eventShape?.join(', ') ?? ''}
                      onChange={(event) => updateSelectedNodeData({ eventShape: parseList(event.target.value) })}
                    />
                  </label>
                  <label>
                    反復範囲
                    <input
                      placeholder="obs"
                      value={selectedData.plate ?? ''}
                      onChange={(event) => updateSelectedNodeData({ plate: event.target.value || undefined })}
                    />
                  </label>
                  {showsConstraintsEditor ? (
                    <div className="field-group">
                      <div className="field-group-title">制約</div>
                      <div className="option-grid">
                        {CONSTRAINT_OPTIONS.map((option) => (
                          <label className="choice-card" key={option.kind}>
                            <input
                              checked={hasConstraint(selectedData.constraints, option.kind)}
                              onChange={(event) =>
                                updateSelectedNodeData({
                                  constraints: toggleSimpleConstraint(
                                    selectedData.constraints,
                                    option.kind,
                                    event.target.checked,
                                  ),
                                })
                              }
                              type="checkbox"
                            />
                            <span>{option.label}</span>
                            <small>{option.note}</small>
                          </label>
                        ))}
                      </div>
                      <label>
                        和を0にする反復範囲
                        <input
                          placeholder="group"
                          value={getSumToZeroPlate(selectedData.constraints)}
                          onChange={(event) =>
                            updateSelectedNodeData({
                              constraints: updateSumToZeroConstraint(selectedData.constraints, event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
                <div className="inspector-section">
                  <div className="inspector-section-title">モデル定義</div>
                  {showsObservedEditor ? (
                    <label className="checkbox-row">
                      <input
                        checked={Boolean(selectedData.observed)}
                        onChange={(event) =>
                          updateSelectedNodeData({
                            observed: event.target.checked || undefined,
                            observationProcess: event.target.checked ? selectedData.observationProcess : undefined,
                          })
                        }
                        type="checkbox"
                      />
                      観測済み
                    </label>
                  ) : null}
                  {showsObservationEditor ? (
                    <label>
                      観測の扱い
                      <select
                        value={selectedData.observationProcess?.kind ?? ''}
                        onChange={(event) => updateSelectedNodeData({ observationProcess: createObservationProcess(event.target.value) })}
                      >
                        {OBSERVATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {showsDistributionEditor ? (
                    <DistributionEditor
                      distribution={selectedData.distribution}
                      onChange={(distribution) => updateSelectedNodeData({ distribution })}
                    />
                  ) : null}
                  {showsExpressionEditor ? (
                    <label>
                      式
                      <textarea
                        placeholder="alpha + beta * x"
                        value={selectedData.expression ?? ''}
                        onChange={(event) => updateSelectedNodeData({ expression: event.target.value || undefined })}
                      />
                    </label>
                  ) : null}
                  {!showsObservedEditor && !showsDistributionEditor && !showsExpressionEditor ? (
                    <p className="empty-note">この種類に追加のモデル定義はありません。</p>
                  ) : null}
                </div>
                <div className="inspector-section">
                  <div className="inspector-section-title">メモ</div>
                  <label>
                    実装メモ
                    <input
                      placeholder="non_centered, sparse GP, warning:識別性を確認"
                      value={formatHintsForInput(selectedData.hints)}
                      onChange={(event) => updateSelectedNodeData({ hints: parseHints(event.target.value) })}
                    />
                  </label>
                  <label>
                    ノート
                    <textarea
                      placeholder="仮定、実装へ渡す注意、あとで確認すること"
                      value={selectedData.notes ?? ''}
                      onChange={(event) => updateSelectedNodeData({ notes: event.target.value || undefined })}
                    />
                  </label>
                </div>
                <div className="inspector-section">
                  <div className="inspector-section-title">診断</div>
                  {selectedDiagnostics.length || selectedCompilerDiagnostics.length ? (
                    <div className="diagnostic-list">
                      {selectedDiagnostics.map((diagnostic) => (
                        <div className={`diagnostic-item diagnostic-${diagnostic.severity}`} key={diagnostic.id}>
                          <strong>{diagnostic.severity}</strong>
                          <span>{diagnostic.message}</span>
                          {diagnostic.suggestion ? <small>{diagnostic.suggestion}</small> : null}
                        </div>
                      ))}
                      {selectedCompilerDiagnostics.map((diagnostic) => (
                        <div className={`diagnostic-item diagnostic-${diagnostic.severity}`} key={`${diagnostic.code}-${diagnostic.path}`}>
                          <strong>{diagnostic.code}</strong>
                          <span>{diagnostic.message}</span>
                          <small>{diagnostic.path}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-note">選択中の問題はありません。</p>
                  )}
                </div>
              </div>
            ) : selectedEdge ? (
              <div className="node-editor">
                <button className="danger-button compact-danger" onClick={deleteSelectedItem} type="button">
                  選択中を削除
                </button>
                <label>
                  関係
                  <input
                    placeholder="依存"
                    value={String(selectedEdge.data?.role ?? '依存')}
                    onChange={(event) => updateSelectedEdgeRole(event.target.value)}
                  />
                </label>
                <p className="empty-note">
                  {selectedEdge.source} から {selectedEdge.target}
                </p>
              </div>
            ) : (
              <p className="empty-note">ノードかリンクを選ぶと編集できます。</p>
            )}
            </div>
          ) : null}
        </aside>

        <section className="canvas">
          <div className="canvas-toolbar">
            <div className="toolbar-title">
              <strong>{compiledCanvas.document.model.name}</strong>
              <span>{activeProjection.title}ビュー</span>
              <span className={overlapCount ? 'layout-status layout-status-warning' : 'layout-status'}>
                重なり {overlapCount}
              </span>
            </div>
            <div className="model-view-tabs" role="tablist" aria-label="モデルビュー">
              {modelViewProjections.map((projection) => (
                <button
                  aria-selected={activeModelView === projection.id}
                  className={activeModelView === projection.id ? 'is-active' : undefined}
                  key={projection.id}
                  onClick={() => setActiveModelView(projection.id)}
                  role="tab"
                  type="button"
                >
                  {projection.title}
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              <div className="toolbar-group toolbar-primary" aria-label="主要操作">
                <button type="button" onClick={() => setCommandPaletteOpen(true)}>
                  操作検索
                </button>
                <button type="button" onClick={() => setActiveOutput('review')}>
                  診断
                </button>
                <button type="button" onClick={() => setActiveOutput('handoff')}>
                  受け渡し
                </button>
              </div>
              <div className="toolbar-group" aria-label="ファイル操作">
                <button type="button" onClick={handleSave}>
                  保存
                </button>
                <button type="button" onClick={handleImport}>
                  読み込み
                </button>
                <button type="button" onClick={copyExternalImportPrompt}>
                  変換プロンプト
                </button>
                <button type="button" onClick={handleExport}>
                  書き出し
                </button>
              </div>
              <div className="toolbar-group" aria-label="編集操作">
                <button
                  disabled={nodes.length < 2}
                  type="button"
                  onClick={() => {
                    void resolveCanvasOverlaps();
                  }}
                >
                  配置整理
                </button>
                <button disabled={!selectedNode && !selectedEdge} type="button" onClick={deleteSelectedItem}>
                  削除
                </button>
              </div>
            </div>
          </div>
          {activeModelView === 'canvas' ? (
            <ReactFlow
              nodes={visibleFlowNodes}
              edges={labeledEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onConnect={onConnect}
              onEdgesChange={onEdgesChange}
              onNodesChange={onNodesChange}
              onSelectionChange={onSelectionChange}
              onInit={(instance) => {
                reactFlowRef.current = {
                  fitView: (options) => instance.fitView(options),
                };
                setFlowViewport(instance.getViewport());
              }}
              onMove={(_, viewport) => setFlowViewport(viewport)}
              multiSelectionKeyCode={['Control', 'Meta']}
              selectionKeyCode={null}
              selectionMode={SelectionMode.Partial}
              selectionOnDrag
              panOnDrag={[1, 2]}
              deleteKeyCode={['Backspace', 'Delete']}
              fitView
              fitViewOptions={{ padding: 0.18 }}
            >
              <Background color="var(--color-border)" gap={24} />
              <div
                className="plate-overlay-layer plate-overlay-frame-layer"
                aria-hidden="true"
                style={{
                  transform: `translate(${flowViewport.x}px, ${flowViewport.y}px) scale(${flowViewport.zoom})`,
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
                  >
                  </div>
                ))}
              </div>
              <div
                className="plate-overlay-layer plate-overlay-label-layer"
                style={{
                  transform: `translate(${flowViewport.x}px, ${flowViewport.y}px) scale(${flowViewport.zoom})`,
                }}
              >
                {plateOverlays.map((plate) => (
                  <button
                    className={`plate-group-label plate-overlay-label plate-tone-${plate.data.tone}`}
                    key={`${plate.id}-label`}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectPlateNodes(plate.nodeIds, event.ctrlKey || event.metaKey);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      event.stopPropagation();
                      selectPlateNodes(plate.nodeIds, event.ctrlKey || event.metaKey);
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
          ) : (
            <ModelProjectionView
              projection={activeProjection}
              onCopy={copyText}
              onSelectEntity={selectProjectionEntity}
            />
          )}
        </section>

        <aside className="panel right-panel">
          <div className="panel-title">
            <h2>受け渡し</h2>
            <span>生成される内容</span>
          </div>
          <section className={`readiness-card readiness-${handoffReadiness.state}`} aria-label="受け渡し準備状況">
            <div className="readiness-heading">
              <span>{handoffReadiness.label}</span>
              <strong>{getPromptTargetLabel(promptTarget)}</strong>
            </div>
            <p>{handoffReadiness.message}</p>
            <div className="readiness-metrics">
              <span>{compiledCanvas.semantic.readiness.summary.errors}エラー</span>
              <span>{compiledCanvas.semantic.readiness.summary.warnings}確認</span>
              <span>{blockingQuestions.length}質問</span>
            </div>
            {blockingDiagnostics.length ? (
              <div className="readiness-blockers">
                {blockingDiagnostics.slice(0, 3).map((diagnostic) => (
                  <button
                    key={`${diagnostic.code}-${diagnostic.path}`}
                    type="button"
                    onClick={() => {
                      const nodeId = /^\/entities\/([^/]+)/.exec(diagnostic.path)?.[1];
                      if (nodeId) selectNodeForEditing(nodeId, { focusEditor: true });
                      setActiveOutput('review');
                    }}
                  >
                    <strong>{diagnostic.code}</strong>
                    <span>{diagnostic.message}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="readiness-actions">
              <button type="button" onClick={() => setActiveOutput('review')}>
                診断を見る
              </button>
              <button type="button" onClick={() => setActiveOutput('handoff')}>
                受け渡しを準備
              </button>
            </div>
          </section>
          <div className="outline-panel">
            <div className="panel-title compact">
              <h2>構成</h2>
              <span>{compiledCanvas.document.entityOrder.length}</span>
            </div>
            <div className="outline-list">
              {compiledCanvas.document.entityOrder
                .filter((entityId) => nodes.some((node) => node.id === entityId))
                .map((entityId) => {
                  const entity = compiledCanvas.document.entities[entityId];
                  const references = compiledCanvas.semantic.dependencyEdges.filter((edge) => edge.from === entityId || edge.to === entityId);
                  return (
                    <button
                      className={selectedNodeId === entityId ? 'outline-row is-active' : 'outline-row'}
                      key={entityId}
                      onClick={() => {
                        selectNodeForEditing(entityId);
                      }}
                      type="button"
                    >
                      <strong>{entity.symbol}</strong>
                      <span>{entity.kind}</span>
                      <small>{references.length}参照</small>
                    </button>
                  );
                })}
            </div>
          </div>
          <div className="issues-panel">
            <div className="panel-title compact">
              <h2>診断</h2>
              <span>{compiledCanvas.semantic.readiness.handoff === 'ready' ? '準備OK' : '要修正'}</span>
            </div>
            <div className="issue-summary">
              <span>{compiledCanvas.semantic.readiness.summary.errors}エラー</span>
              <span>{compiledCanvas.semantic.readiness.summary.warnings}確認</span>
              <span>{compiledCanvas.semantic.readiness.summary.infos}情報</span>
              <span>{blockingDiagnostics.length}停止</span>
            </div>
            {compiledCanvas.semantic.diagnostics.length ? (
              <div className="issue-list">
                {reviewDiagnosticGroups.map((group) => (
                  group.diagnostics.length ? (
                    <section className="issue-group" key={group.id}>
                      <div className="issue-group-title">
                        <span>{group.label}</span>
                        <strong>{group.diagnostics.length}</strong>
                      </div>
                      {group.diagnostics.map((diagnostic) => {
                        const nodeId = /^\/entities\/([^/]+)/.exec(diagnostic.path)?.[1];
                        return (
                          <button
                            className={`issue-row diagnostic-${diagnostic.severity}`}
                            key={`${group.id}-${diagnostic.code}-${diagnostic.path}-${diagnostic.message}`}
                            onClick={() => {
                              if (!nodeId) return;
                              selectNodeForEditing(nodeId, { focusEditor: true });
                            }}
                            type="button"
                          >
                            <div>
                              <strong>{diagnostic.code}</strong>
                              <small>{diagnostic.stage}{diagnostic.blocksHandoff ? ' / 受け渡し停止' : ''}</small>
                            </div>
                            <span>{diagnostic.message}</span>
                          </button>
                        );
                      })}
                    </section>
                  ) : null
                ))}
              </div>
            ) : (
              <div className="empty-note">handoffを止める診断はありません。</div>
            )}
          </div>
          <div className="checklist-panel">
            <div className="panel-title compact">
              <h2>チェックリスト</h2>
              <span>{reviewChecklist.filter((item) => item.done).length}/{reviewChecklist.length}</span>
            </div>
            <div className="checklist-list">
              {reviewChecklist.map((item) => (
                <div className={item.done ? 'checklist-item is-done' : 'checklist-item'} key={item.label}>
                  <strong>{item.done ? '完了' : '未了'}</strong>
                  <span>{item.label}</span>
                  <small>{item.detail}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="output-tabs" role="tablist" aria-label="出力">
            <button
              aria-controls="output-panel"
              aria-selected={activeOutput === 'math'}
              className={activeOutput === 'math' ? 'is-active' : ''}
              id="output-tab-math"
              onClick={() => setActiveOutput('math')}
              role="tab"
              tabIndex={activeOutput === 'math' ? 0 : -1}
              type="button"
            >
              数式
            </button>
            <button
              aria-controls="output-panel"
              aria-selected={activeOutput === 'review'}
              className={activeOutput === 'review' ? 'is-active' : ''}
              id="output-tab-review"
              onClick={() => setActiveOutput('review')}
              role="tab"
              tabIndex={activeOutput === 'review' ? 0 : -1}
              type="button"
            >
              診断
            </button>
            <button
              aria-controls="output-panel"
              aria-selected={activeOutput === 'handoff'}
              className={activeOutput === 'handoff' ? 'is-active' : ''}
              id="output-tab-handoff"
              onClick={() => setActiveOutput('handoff')}
              role="tab"
              tabIndex={activeOutput === 'handoff' ? 0 : -1}
              type="button"
            >
              受け渡し
            </button>
            <button
              aria-controls="output-panel"
              aria-selected={activeOutput === 'advanced'}
              className={activeOutput === 'advanced' ? 'is-active' : ''}
              id="output-tab-advanced"
              onClick={() => setActiveOutput('advanced')}
              role="tab"
              tabIndex={activeOutput === 'advanced' ? 0 : -1}
              type="button"
            >
              詳細
            </button>
          </div>
          <div
            aria-labelledby={`output-tab-${activeOutput}`}
            className="output-panel"
            id="output-panel"
            role="tabpanel"
          >
            {activeOutput === 'math' ? (
              <MathView
                model={modelIr}
                onSelectNode={(nodeId) => selectNodeForEditing(nodeId, { focusEditor: true })}
              />
            ) : (
              <>
              <div className="output-actions">
                <span>
                  {activeOutput === 'review'
                    ? '診断一覧'
                    : activeOutput === 'handoff'
                      ? '受け渡しサマリー'
                      : advancedOutput === 'ir'
                        ? 'JSON契約'
                        : advancedOutput === 'prompt'
                          ? '実装用メモ'
                          : advancedOutput === 'package'
                            ? 'portable package'
                            : 'semantic diff'}
                </span>
                <button type="button" onClick={() => copyText(outputText)}>
                  コピー
                </button>
                {activeOutput === 'advanced' && advancedOutput === 'package' ? (
                  <button type="button" onClick={() => copyText(portablePackage.files['model.json'])}>
                    model.json
                  </button>
                ) : null}
                {activeOutput === 'advanced' ? (
                  <div className="segmented-control" aria-label="詳細出力">
                    <button
                      type="button"
                      className={advancedOutput === 'ir' ? 'is-active' : ''}
                      onClick={() => setAdvancedOutput('ir')}
                    >
                      IR
                    </button>
                    <button
                      type="button"
                      className={advancedOutput === 'prompt' ? 'is-active' : ''}
                      onClick={() => setAdvancedOutput('prompt')}
                    >
                      AIメモ
                    </button>
                    <button
                      type="button"
                      className={advancedOutput === 'package' ? 'is-active' : ''}
                      onClick={() => setAdvancedOutput('package')}
                    >
                      Package
                    </button>
                    <button
                      type="button"
                      className={advancedOutput === 'diff' ? 'is-active' : ''}
                      onClick={() => setAdvancedOutput('diff')}
                    >
                      Diff
                    </button>
                  </div>
                ) : null}
                {activeOutput === 'handoff' ? (
                  <div className="segmented-control" aria-label="受け渡しプレビュー形式">
                    <button
                      type="button"
                      className={handoffPreviewFormat === 'markdown' ? 'is-active' : ''}
                      onClick={() => setHandoffPreviewFormat('markdown')}
                    >
                      Markdown
                    </button>
                    <button
                      type="button"
                      className={handoffPreviewFormat === 'json' ? 'is-active' : ''}
                      onClick={() => setHandoffPreviewFormat('json')}
                    >
                      JSON
                    </button>
                  </div>
                ) : null}
              </div>
              {activeOutput === 'handoff' || (activeOutput === 'advanced' && advancedOutput === 'prompt') ? (
                <label className="prompt-target">
                  出力先
                  <select
                    value={promptTarget}
                    onChange={(event) => setPromptTarget(event.target.value as PromptTarget)}
                  >
                    {PROMPT_TARGETS.map((target) => (
                      <option key={target} value={target}>
                        {getPromptTargetLabel(target)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <pre>{outputText}</pre>
              </>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

