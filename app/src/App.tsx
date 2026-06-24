import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  addEdge,
  Background,
  type Connection,
  Controls,
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
import { exportModelIr, generateAiPrompt, generateModelTex, getPromptTargetLabel, type PromptTarget } from './lib/modelIr';
import { initialEdges, initialNodes } from './samples/hierarchicalRegression';
import type { BayesNodeData } from './lib/modelIr';
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


const nodeTypes = {
  bayesNode: memo(function BayesNode({ data }: NodeProps<Node<BayesNodeData>>) {
    const distributionText = data.distribution ? formatDistributionText(data.distribution) : data.expression;
    const distributionTex = data.distribution ? formatDistributionTex(data.distribution) : undefined;

    return (
      <div className={`bayes-node bayes-node-${data.kind}`}>
        <Handle className="node-handle" type="target" position={Position.Top} />
        <div className="node-heading">
          <span className="node-kind">{NODE_KIND_LABELS[data.kind]}</span>
          {data.observed ? <span className="node-chip">Observed</span> : null}
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
              <button type="button" onClick={() => copyText(JSON.stringify(modelIr, null, 2))}>
                Copy IR
              </button>
              <button disabled={!selectedNode && !selectedEdge} type="button" onClick={deleteSelectedItem}>
                Delete selected
              </button>
              <button type="button" onClick={resetSample}>
                Reset sample
              </button>
            </div>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
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

