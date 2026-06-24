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
  type ValidationLevel,
} from './lib/modelIr';
import { initialEdges, initialNodes } from './samples/hierarchicalRegression';
import { TexMath } from './components/TexMath';
import { DistributionEditor } from './components/DistributionEditor';
import { MathView } from './components/MathView';

const NODE_KIND_LABELS: Record<BayesNodeData['kind'], string> = {
  data: 'Data',
  deterministic: 'Deterministic',
  hyperparameter: 'Hyperparameter',
  latent: 'Latent',
  likelihood: 'Likelihood',
  parameter: 'Parameter',
};

const PALETTE_ITEMS = [
  { kind: 'data', label: 'Data', note: 'Observed values' },
  { kind: 'parameter', label: 'Parameter', note: 'Unknown quantity' },
  { kind: 'latent', label: 'Latent', note: 'Unobserved value' },
  { kind: 'deterministic', label: 'Deterministic', note: 'Derived expression' },
  { kind: 'likelihood', label: 'Likelihood', note: 'Observed outcome' },
  { kind: 'hyperparameter', label: 'Hyperparameter', note: 'Prior control' },
] as const;

const STORAGE_KEY = 'bayes-canvas:model';
const PROMPT_TARGETS: PromptTarget[] = ['generic', 'pymc', 'numpyro', 'stan', 'review'];
const VALIDATION_LEVELS: ValidationLevel[] = ['linted', 'expanded', 'structured', 'opaque'];

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

  return { kind, name: baseName, distribution: createDefaultDistribution('normal') };
}

function parseList(value: string): string[] | undefined {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length ? items : undefined;
}

function parseConstraints(value: string): Constraint[] | undefined {
  const constraints = parseList(value)?.map((item) => {
    if (item === 'positive') return { kind: 'positive' } satisfies Constraint;
    if (item === 'unit_interval') return { kind: 'unit_interval' } satisfies Constraint;
    if (item === 'simplex') return { kind: 'simplex' } satisfies Constraint;
    if (item === 'ordered') return { kind: 'ordered' } satisfies Constraint;
    if (item === 'correlation_matrix') return { kind: 'correlation_matrix' } satisfies Constraint;
    if (item.startsWith('sum_to_zero:')) {
      return { kind: 'sum_to_zero', overPlateId: item.slice('sum_to_zero:'.length) } satisfies Constraint;
    }
    return { kind: 'custom', description: item } satisfies Constraint;
  });

  return constraints?.length ? constraints : undefined;
}

function formatConstraintsForInput(constraints?: Constraint[]): string {
  return (constraints ?? []).map((constraint) => {
    if (constraint.kind === 'sum_to_zero') return constraint.overPlateId ? `sum_to_zero:${constraint.overPlateId}` : 'sum_to_zero';
    if (constraint.kind === 'custom') return constraint.description;
    return constraint.kind;
  }).join(', ');
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
          {data.observed ? <span className="node-chip">Observed</span> : null}
          {diagnosticCount ? <span className="node-chip node-chip-warning">{diagnosticCount} issue</span> : null}
        </div>
        <div className="node-name">{data.name}</div>
        {distributionText ? <div className="node-formula">{distributionText}</div> : null}
        {distributionTex ? (
          <div className="node-tex">
            <TexMath tex={distributionTex} />
          </div>
        ) : null}
        <div className="node-meta">
          {data.shape?.length ? <span>{data.shape.join(' x ')}</span> : <span>scalar</span>}
          {data.plate ? <span>plate: {data.plate}</span> : null}
          {data.validationLevel ? <span>{data.validationLevel}</span> : null}
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
  const selectedLabel = selectedNode?.id ?? selectedEdge?.id ?? 'none';
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
    const name = window.prompt('Snapshot name:', `Model ${new Date().toLocaleString()}`);
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
        // invalid file
      }
    };
    input.click();
  }, [setNodes, setEdges]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <h1>Bayes Canvas</h1>
          <p>Visual model sketch, strict IR, AI-ready implementation handoff.</p>
        </div>
        <div className="model-summary" aria-label="Model summary">
          <div>
            <span className="summary-value">{nodes.length}</span>
            <span className="summary-label">nodes</span>
          </div>
          <div>
            <span className="summary-value">{edges.length}</span>
            <span className="summary-label">links</span>
          </div>
          <div>
            <span className="summary-value">{plateCount}</span>
            <span className="summary-label">plates</span>
          </div>
          <div>
            <span className="summary-value">{modelIr.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length}</span>
            <span className="summary-label">checks</span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel left-panel">
          <div className="panel-title">
            <h2>Palette</h2>
            <span>Model blocks</span>
          </div>
          <div className="palette-list">
            {PALETTE_ITEMS.map((item) => (
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
          {savedModels.length > 0 ? (
            <div className="snapshots-panel">
              <div className="panel-title compact">
                <h2>Snapshots</h2>
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
                        Load
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
              <h2>Selection</h2>
              <span>{selectedLabel}</span>
            </div>
            {selectedData ? (
              <div className="node-editor">
                <button className="danger-button compact-danger" onClick={deleteSelectedItem} type="button">
                  Delete selected
                </button>
                <label>
                  Name
                  <input
                    value={selectedData.name}
                    onChange={(event) => updateSelectedNodeData({ name: event.target.value })}
                  />
                </label>
                <label>
                  Shape
                  <input
                    placeholder="N, J"
                    value={selectedData.shape?.join(', ') ?? ''}
                    onChange={(event) => updateSelectedNodeData({ shape: parseList(event.target.value) })}
                  />
                </label>
                <label>
                  Plate
                  <input
                    placeholder="obs"
                    value={selectedData.plate ?? ''}
                    onChange={(event) => updateSelectedNodeData({ plate: event.target.value || undefined })}
                  />
                </label>
                <label>
                  Constraints
                  <input
                    placeholder="positive, ordered, sum_to_zero:group"
                    value={formatConstraintsForInput(selectedData.constraints)}
                    onChange={(event) => updateSelectedNodeData({ constraints: parseConstraints(event.target.value) })}
                  />
                </label>
                <label>
                  Hints
                  <input
                    placeholder="non_centered, sparse GP, warning:check identifiability"
                    value={formatHintsForInput(selectedData.hints)}
                    onChange={(event) => updateSelectedNodeData({ hints: parseHints(event.target.value) })}
                  />
                </label>
                <label>
                  Observation
                  <select
                    value={selectedData.observationProcess?.kind ?? ''}
                    onChange={(event) => updateSelectedNodeData({ observationProcess: createObservationProcess(event.target.value) })}
                  >
                    <option value="">Default</option>
                    <option value="exact">Exact</option>
                    <option value="missing">Missing / latent imputation</option>
                    <option value="measurement_error">Measurement error</option>
                    <option value="censored">Censored</option>
                    <option value="truncated">Truncated</option>
                    <option value="rounded">Rounded</option>
                  </select>
                </label>
                <label>
                  Validation
                  <select
                    value={selectedData.validationLevel ?? 'linted'}
                    onChange={(event) => updateSelectedNodeData({ validationLevel: event.target.value as ValidationLevel })}
                  >
                    {VALIDATION_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-row">
                  <input
                    checked={Boolean(selectedData.observed)}
                    onChange={(event) => updateSelectedNodeData({ observed: event.target.checked || undefined })}
                    type="checkbox"
                  />
                  Observed
                </label>
                <DistributionEditor
                  distribution={selectedData.distribution}
                  onChange={(distribution) => updateSelectedNodeData({ distribution })}
                />
                <label>
                  Expression
                  <textarea
                    placeholder="alpha + beta * x"
                    value={selectedData.expression ?? ''}
                    onChange={(event) => updateSelectedNodeData({ expression: event.target.value || undefined })}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    placeholder="Modeling assumption, opaque block contract, or handoff note"
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
                  Delete selected
                </button>
                <label>
                  Role
                  <input
                    placeholder="dependency"
                    value={String(selectedEdge.data?.role ?? 'dependency')}
                    onChange={(event) => updateSelectedEdgeRole(event.target.value)}
                  />
                </label>
                <p className="empty-note">
                  {selectedEdge.source} to {selectedEdge.target}
                </p>
              </div>
            ) : (
              <p className="empty-note">Select a node or link to edit or delete it.</p>
            )}
          </div>
        </aside>

        <section className="canvas">
          <div className="canvas-toolbar">
            <div>
              <strong>Hierarchical regression</strong>
              <span>editable canvas</span>
            </div>
            <div className="toolbar-actions">
              <button type="button" onClick={handleSave}>
                Save
              </button>
              <button type="button" onClick={handleExport}>
                Export
              </button>
              <button type="button" onClick={handleImport}>
                Import
              </button>
              <button type="button" onClick={() => copyText(JSON.stringify(modelIr, null, 2))}>
                Copy IR
              </button>
              <button disabled={!selectedNode && !selectedEdge} type="button" onClick={deleteSelectedItem}>
                Delete
              </button>
              <button type="button" onClick={resetSample}>
                Reset
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
            <h2>Handoff</h2>
            <span>Generated artifacts</span>
          </div>
          <div className="output-tabs" role="tablist" aria-label="Output">
            <button
              aria-selected={activeOutput === 'ir'}
              className={activeOutput === 'ir' ? 'is-active' : ''}
              onClick={() => setActiveOutput('ir')}
              role="tab"
              type="button"
            >
              Model IR
            </button>
            <button
              aria-selected={activeOutput === 'prompt'}
              className={activeOutput === 'prompt' ? 'is-active' : ''}
              onClick={() => setActiveOutput('prompt')}
              role="tab"
              type="button"
            >
              AI Prompt
            </button>
            <button
              aria-selected={activeOutput === 'math'}
              className={activeOutput === 'math' ? 'is-active' : ''}
              onClick={() => setActiveOutput('math')}
              role="tab"
              type="button"
            >
              Math
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
                <span>{activeOutput === 'ir' ? 'JSON contract' : 'Implementation brief'}</span>
                <button type="button" onClick={() => copyText(outputText)}>
                  Copy
                </button>
              </div>
              {activeOutput === 'prompt' ? (
                <label className="prompt-target">
                  Prompt target
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

