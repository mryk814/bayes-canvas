import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
  type Edge,
  type Node,
  type NodeProps,
  type OnSelectionChangeParams,
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
  type BayesNodeData,
  type Constraint,
  type ModelHint,
  type ObservationProcess,
  type PromptTarget,
} from './lib/modelIr';
import { initialEdges, initialNodes } from './samples/hierarchicalRegression';
import { TexMath } from './components/TexMath';
import { DistributionEditor } from './components/DistributionEditor';
import { MathView } from './components/MathView';

const NODE_KIND_LABELS: Record<BayesNodeData['kind'], string> = {
  data: 'Data',
  deterministic: 'Deterministic',
  derived_quantity: 'Derived quantity',
  hyperparameter: 'Hyperparameter',
  latent: 'Latent',
  likelihood: 'Likelihood',
  model_block: 'Model block',
  parameter: 'Parameter',
  prior_recipe: 'Prior recipe',
  regression_term: 'Regression term',
};

const PALETTE_GROUPS: Array<{
  title: string;
  items: Array<{ kind: BayesNodeData['kind']; label: string; note: string }>;
}> = [
  {
    title: 'Variables',
    items: [
      { kind: 'data', label: 'Data', note: 'Observed values' },
      { kind: 'parameter', label: 'Parameter', note: 'Unknown quantity' },
      { kind: 'latent', label: 'Latent', note: 'Unobserved value' },
      { kind: 'deterministic', label: 'Deterministic', note: 'Derived expression' },
      { kind: 'likelihood', label: 'Likelihood', note: 'Observed outcome' },
      { kind: 'hyperparameter', label: 'Hyperparameter', note: 'Prior control' },
    ],
  },
  {
    title: 'Patterns',
    items: [
      { kind: 'prior_recipe', label: 'Prior recipe', note: 'Prior template' },
      { kind: 'regression_term', label: 'Regression term', note: 'Additive term' },
      { kind: 'model_block', label: 'Model block', note: 'Opaque structure' },
    ],
  },
  {
    title: 'Outputs',
    items: [
      { kind: 'derived_quantity', label: 'Derived quantity', note: 'Target value' },
    ],
  },
];

const STORAGE_KEY = 'bayes-canvas:model';
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

const edgeTypes = {
  paramEdge: memo(function ParamEdge({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    markerEnd, style, data,
  }: EdgeProps) {
    const [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX, sourceY, targetX, targetY,
      sourcePosition, targetPosition,
    });

    const paramLabel = data?.paramLabel as string | undefined;

    return (
      <>
        <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
        {paramLabel ? (
          <EdgeLabelRenderer>
            <div
              className="edge-param-label"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              }}
            >
              {paramLabel}
            </div>
          </EdgeLabelRenderer>
        ) : null}
      </>
    );
  }),
};

type BayesCanvasNode = Node<BayesNodeData>;

interface CanvasState {
  nodes: BayesCanvasNode[];
  edges: Edge[];
}

const initialCanvasNodes: BayesCanvasNode[] = initialNodes.map((node) => ({
  ...node,
  type: 'bayesNode',
}));

const initialCanvasEdges = initialEdges.map((edge) => ({
  ...edge,
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed },
}));

function loadInitialCanvas(): CanvasState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { nodes: initialCanvasNodes, edges: initialCanvasEdges };
    }

    const parsed = JSON.parse(stored) as Partial<CanvasState>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return { nodes: initialCanvasNodes, edges: initialCanvasEdges };
    }

    return {
      nodes: (parsed.nodes as BayesCanvasNode[]).map((node) => ({ ...node, type: 'bayesNode' })),
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
      nodes: (parsed.nodes as BayesCanvasNode[]).map((node) => ({ ...node, type: 'bayesNode' })),
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

function parseCanvasFile(file: File): Promise<CanvasState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          reject(new Error('Invalid model file'));
          return;
        }
        resolve({
          nodes: (parsed.nodes as BayesCanvasNode[]).map((node) => ({ ...node, type: 'bayesNode' })),
          edges: parsed.edges.map((edge: Edge) => ({
            ...edge,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
          })),
        });
      } catch {
        reject(new Error('Invalid JSON'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

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

  if (kind === 'prior_recipe') {
    return {
      kind,
      name: 'beta_horseshoe',
      expression: 'beta[k] ~ Horseshoe(scale = tau0)',
      notes: [
        'beta[k] ~ Normal(0, tau * lambda[k])',
        'lambda[k] ~ HalfCauchy(1)',
        'tau ~ HalfCauchy(tau0)',
      ].join('\n'),
      validationLevel: 'expanded',
    };
  }

  if (kind === 'regression_term') {
    return {
      kind,
      name: `${baseName}[i]`,
      shape: ['N'],
      plate: 'obs',
      expression: 'beta * x[i]',
      notes: 'Add this term into a deterministic predictor.',
    };
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
  bayesNode: memo(function BayesNode({ data }: NodeProps<Node<BayesNodeData>>) {
    const distributionText = data.distribution ? formatDistributionText(data.distribution) : data.expression;
    const distributionTex = data.distribution ? formatDistributionTex(data.distribution) : undefined;
    const diagnosticCount = Number(data.diagnosticCount ?? 0);

    return (
      <div className={`bayes-node bayes-node-${data.kind}`}>
        <Handle className="node-handle" type="target" position={Position.Top} />
        <div className="node-heading">
          <span className="node-kind">{NODE_KIND_LABELS[data.kind]}</span>
          {data.observed ? <span className="node-chip">観測</span> : null}
          {diagnosticCount ? <span className="node-chip node-chip-warning">{diagnosticCount}件</span> : null}
        </div>
        <div className="node-name">{data.name}</div>
        {distributionText ? <div className="node-formula">{distributionText}</div> : null}
        {distributionTex ? (
          <div className="node-tex">
            <TexMath tex={distributionTex} />
          </div>
        ) : null}
        <div className="node-meta">
          {data.shape?.length ? <span>{data.shape.join(' x ')}</span> : <span>スカラー</span>}
          {data.plate ? <span>繰り返し: {data.plate}</span> : null}
        </div>
        <Handle className="node-handle" type="source" position={Position.Bottom} />
      </div>
    );
  }),
};

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

export function App() {
  const initialCanvas = useMemo(() => loadInitialCanvas(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<BayesCanvasNode>(initialCanvas.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialCanvas.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [promptTarget, setPromptTarget] = useState<PromptTarget>('generic');
  const modelIr = useMemo(() => exportModelIr(nodes, edges), [nodes, edges]);
  const prompt = useMemo(() => generateAiPrompt(modelIr, promptTarget), [modelIr, promptTarget]);
  const [activeOutput, setActiveOutput] = useState<'ir' | 'prompt' | 'math'>('math');
  const fullTex = useMemo(() => generateModelTex(modelIr), [modelIr]);
  const outputText = activeOutput === 'ir' ? JSON.stringify(modelIr, null, 2) : activeOutput === 'prompt' ? prompt : fullTex;
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
      'prior_recipe',
      'regression_term',
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
  const [savedModels, setSavedModels] = useState<SavedModelEntry[]>(loadSavedModelsList);
  const diagnosticCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const diagnostic of modelIr.diagnostics) {
      const nodeId = diagnostic.target.nodeId;
      if (!nodeId) continue;
      counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
    }
    return counts;
  }, [modelIr.diagnostics]);
  const flowNodes = useMemo(
    () => nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        diagnosticCount: diagnosticCounts.get(node.id) ?? 0,
      },
    })),
    [diagnosticCounts, nodes],
  );
  const selectedDiagnostics = useMemo(
    () => modelIr.diagnostics.filter((diagnostic) => diagnostic.target.nodeId === selectedNodeId || diagnostic.target.expressionId === selectedNodeId),
    [modelIr.diagnostics, selectedNodeId],
  );

  const labeledEdges = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n.data]));
    return edges.map((edge) => {
      const targetData = nodeMap.get(edge.target);
      if (!targetData) return { ...edge, type: 'paramEdge' as const };
      const paramLabel = resolveEdgeParam(edge.source, targetData);
      return { ...edge, type: 'paramEdge' as const, data: { ...edge.data, paramLabel } };
    });
  }, [nodes, edges]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
  }, [nodes, edges]);

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
  }, []);

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
      setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId));
      setEdges((currentEdges) =>
        currentEdges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
      );
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      return;
    }

    if (selectedEdgeId) {
      setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    }
  }, [selectedEdgeId, selectedNodeId, setEdges, setNodes]);

  const resetSample = useCallback(() => {
    setNodes(initialCanvasNodes);
    setEdges(initialCanvasEdges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [setEdges, setNodes]);

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
        setNodes(state.nodes);
        setEdges(state.edges);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      } catch {
        window.alert('モデルJSONを読み込めませんでした。ファイル形式を確認してください。');
      }
    };
    input.click();
  }, [setNodes, setEdges]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <h1>Bayes Canvas</h1>
          <p>ベイズモデルを図で組み、実装へ渡すためのキャンバス。</p>
        </div>
        <div className="model-summary" aria-label="モデル概要">
          <div>
            <span className="summary-value">{nodes.length}</span>
            <span className="summary-label">ノード</span>
          </div>
          <div>
            <span className="summary-value">{edges.length}</span>
            <span className="summary-label">リンク</span>
          </div>
          <div>
            <span className="summary-value">{plateCount}</span>
            <span className="summary-label">プレート</span>
          </div>
          <div>
            <span className="summary-value">{modelIr.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length}</span>
            <span className="summary-label">確認</span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel left-panel">
          <div className="panel-title">
            <h2>追加</h2>
            <span>モデル要素</span>
          </div>
          <div className="palette-groups">
            {PALETTE_GROUPS.map((group) => (
              <div className="palette-group" key={group.title}>
                <h3>{group.title}</h3>
                <div className="palette-list">
                  {group.items.map((item) => (
                    <button
                      className={`palette-item palette-${item.kind}`}
                      key={item.kind}
                      onClick={() => addNodeFromPalette(item.kind)}
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
          {savedModels.length > 0 ? (
            <div className="snapshots-panel">
              <div className="panel-title compact">
                <h2>保存済み</h2>
                <span>{savedModels.length}</span>
              </div>
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
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="editor-panel">
            <div className="panel-title compact">
              <h2>編集</h2>
              <span>{selectedKindLabel}</span>
            </div>
            {selectedData ? (
              <div className="node-editor">
                <button className="danger-button compact-danger" onClick={deleteSelectedItem} type="button">
                  選択中を削除
                </button>
                <label>
                  名前
                  <input
                    value={selectedData.name}
                    onChange={(event) => updateSelectedNodeData({ name: event.target.value })}
                  />
                </label>
                <label>
                  形
                  <input
                    placeholder="N, J"
                    value={selectedData.shape?.join(', ') ?? ''}
                    onChange={(event) => updateSelectedNodeData({ shape: parseList(event.target.value) })}
                  />
                </label>
                <label>
                  繰り返し
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
                      和を0にする単位
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
                <label>
                  実装メモ
                  <input
                    placeholder="non_centered, sparse GP, warning:識別性を確認"
                    value={formatHintsForInput(selectedData.hints)}
                    onChange={(event) => updateSelectedNodeData({ hints: parseHints(event.target.value) })}
                  />
                </label>
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
                <label>
                  ノート
                  <textarea
                    placeholder="仮定、実装へ渡す注意、あとで確認すること"
                    value={selectedData.notes ?? ''}
                    onChange={(event) => updateSelectedNodeData({ notes: event.target.value || undefined })}
                  />
                </label>
                {selectedDiagnostics.length ? (
                  <div className="diagnostic-list">
                    {selectedDiagnostics.map((diagnostic) => (
                      <div className={`diagnostic-item diagnostic-${diagnostic.severity}`} key={diagnostic.id}>
                        <strong>{diagnostic.severity}</strong>
                        <span>{diagnostic.message}</span>
                        {diagnostic.suggestion ? <small>{diagnostic.suggestion}</small> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : selectedEdge ? (
              <div className="node-editor">
                <button className="danger-button compact-danger" onClick={deleteSelectedItem} type="button">
                  選択中を削除
                </button>
                <label>
                  関係
                  <input
                    placeholder="dependency"
                    value={String(selectedEdge.data?.role ?? 'dependency')}
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
        </aside>

        <section className="canvas">
          <div className="canvas-toolbar">
            <div>
              <strong>階層回帰</strong>
              <span>編集キャンバス</span>
            </div>
            <div className="toolbar-actions">
              <button type="button" onClick={handleSave}>
                保存
              </button>
              <button type="button" onClick={handleExport}>
                書き出し
              </button>
              <button type="button" onClick={handleImport}>
                読み込み
              </button>
              <button type="button" onClick={() => copyText(JSON.stringify(modelIr, null, 2))}>
                IRコピー
              </button>
              <button disabled={!selectedNode && !selectedEdge} type="button" onClick={deleteSelectedItem}>
                削除
              </button>
              <button type="button" onClick={resetSample}>
                初期化
              </button>
            </div>
          </div>
          <ReactFlow
            nodes={flowNodes}
            edges={labeledEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onConnect={onConnect}
            onEdgesChange={onEdgesChange}
            onNodesChange={onNodesChange}
            onSelectionChange={onSelectionChange}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.18 }}
          >
            <Background color="var(--color-border)" gap={24} />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </section>

        <aside className="panel right-panel">
          <div className="panel-title">
            <h2>受け渡し</h2>
            <span>生成される内容</span>
          </div>
          <div className="output-tabs" role="tablist" aria-label="出力">
            <button
              aria-selected={activeOutput === 'ir'}
              className={activeOutput === 'ir' ? 'is-active' : ''}
              onClick={() => setActiveOutput('ir')}
              role="tab"
              type="button"
            >
              IR
            </button>
            <button
              aria-selected={activeOutput === 'prompt'}
              className={activeOutput === 'prompt' ? 'is-active' : ''}
              onClick={() => setActiveOutput('prompt')}
              role="tab"
              type="button"
            >
              AIメモ
            </button>
            <button
              aria-selected={activeOutput === 'math'}
              className={activeOutput === 'math' ? 'is-active' : ''}
              onClick={() => setActiveOutput('math')}
              role="tab"
              type="button"
            >
              数式
            </button>
          </div>
          {activeOutput === 'math' ? (
            <MathView
              model={modelIr}
              onSelectNode={(nodeId) => {
                setNodes((currentNodes) =>
                  currentNodes.map((node) => ({ ...node, selected: node.id === nodeId })),
                );
                setEdges((currentEdges) =>
                  currentEdges.map((edge) => ({ ...edge, selected: false })),
                );
                setSelectedNodeId(nodeId);
                setSelectedEdgeId(null);
              }}
            />
          ) : (
            <>
              <div className="output-actions">
                <span>{activeOutput === 'ir' ? 'JSON契約' : '実装用メモ'}</span>
                <button type="button" onClick={() => copyText(outputText)}>
                  コピー
                </button>
              </div>
              {activeOutput === 'prompt' ? (
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
        </aside>
      </section>
    </main>
  );
}

