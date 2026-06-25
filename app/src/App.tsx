import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { modelTemplates, type ModelTemplate } from './samples/modelTemplates';
import { TexMath } from './components/TexMath';
import { DistributionEditor } from './components/DistributionEditor';
import { MathView } from './components/MathView';
import {
  buildCanvasHandoff,
  buildCanvasPortablePackage,
  compileCanvas,
  projectToReactFlow,
  previewCanvasPatch,
} from './lib/documentAdapter';
import { assertJsonComplexity } from './lib/core/migrations.js';
import type { HandoffBundle, HandoffTarget } from './lib/core/handoff.js';
import type { PatchPreview } from './lib/core/patch-proposal.js';
import { diffModelDocuments } from './lib/core/semantic-diff.js';
import { compareReceiptFingerprint, validateImplementationReceipt, type ImplementationReceipt } from './lib/core/receipt.js';
import { saveAutosave } from './lib/storage';

const NODE_KIND_LABELS: Record<BayesNodeData['kind'], string> = {
  data: 'Data',
  deterministic: 'Deterministic',
  derived_quantity: 'Derived quantity',
  hyperparameter: 'Hyperparameter',
  latent: 'Latent',
  likelihood: 'Likelihood',
  model_block: 'Model block',
  parameter: 'Parameter',
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
  { id: 'add', label: 'Add' },
  { id: 'structure', label: 'Structure' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'library', label: 'Library' },
];

const PALETTE_GROUPS: Array<{
  title: string;
  items: PaletteItem[];
}> = [
  {
    title: 'Variables',
    items: [
      { type: 'node', kind: 'data', label: 'Data', note: 'Observed values' },
      { type: 'node', kind: 'parameter', label: 'Parameter', note: 'Unknown quantity' },
      { type: 'node', kind: 'latent', label: 'Latent', note: 'Unobserved value' },
      { type: 'node', kind: 'deterministic', label: 'Deterministic', note: 'Derived expression' },
      { type: 'node', kind: 'likelihood', label: 'Likelihood', note: 'Observed outcome' },
      { type: 'node', kind: 'hyperparameter', label: 'Hyperparameter', note: 'Prior control' },
    ],
  },
  {
    title: 'Patterns',
    items: [
      { type: 'preset', preset: 'horseshoe_prior', label: 'Horseshoe prior', note: 'Apply to parameter' },
      { type: 'preset', preset: 'linear_term', label: 'Linear term', note: 'Insert into predictor' },
      { type: 'preset', preset: 'group_effect', label: 'Group effect', note: 'Insert varying effect' },
      { type: 'preset', preset: 'interaction_term', label: 'Interaction', note: 'Insert product term' },
      { type: 'node', kind: 'model_block', label: 'Model block', note: 'Opaque structure' },
    ],
  },
  {
    title: 'Outputs',
    items: [
      { type: 'node', kind: 'derived_quantity', label: 'Derived quantity', note: 'Target value' },
    ],
  },
];

const STORAGE_KEY = 'bayes-canvas:model';
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

interface PlateRow {
  id: string;
  index: string;
  size: string;
  nodeCount: number;
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

function parseCanvasFile(file: File): Promise<CanvasState> {
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
          const projected = projectToReactFlow({
            document: JSON.parse(portableFile.files['model.json']),
            layout: JSON.parse(portableFile.files['layout.json']),
          });
          resolve({
            nodes: projected.nodes.map(prepareCanvasNode),
            edges: projected.edges.map((edge: Edge) => ({
              ...edge,
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed },
            })),
          });
          return;
        }
        if (!Array.isArray(modelFile.nodes) || !Array.isArray(modelFile.edges)) {
          reject(new Error('必須field `nodes` / `edges` または portable package の `files.model.json` / `files.layout.json` がありません。'));
          return;
        }
        resolve({
          nodes: modelFile.nodes.map(prepareCanvasNode),
          edges: modelFile.edges.map((edge: Edge) => ({
            ...edge,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
          })),
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('JSON形式が正しくありません。'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読み込めませんでした。'));
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

function inferPlateIndexForUi(plateId: string): string {
  if (plateId === 'obs' || plateId === 'observation') return 'i';
  if (plateId === 'group') return 'j';
  if (plateId === 'time') return 't';
  return plateId.slice(0, 1).toLowerCase() || 'i';
}

function renameIndexedSymbol(name: string, nextIndex: string): string {
  const trimmed = name.trim();
  if (!nextIndex.trim()) return trimmed;
  if (/\[[^\]]+\]/.test(trimmed)) return trimmed.replace(/\[[^\]]+\]/, `[${nextIndex.trim()}]`);
  return `${trimmed}[${nextIndex.trim()}]`;
}

function formatReviewPanel(diagnostics: ReturnType<typeof compileCanvas>['semantic']['diagnostics']): string {
  if (!diagnostics.length) {
    return 'No compiler diagnostics. Handoff is ready.';
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
    `# Handoff Review: ${bundle.manifest.target}`,
    '',
    `- Model: ${bundle.manifest.modelDocumentId}`,
    `- Revision: ${bundle.manifest.sourceRevision}`,
    `- Fingerprint: \`${bundle.manifest.fingerprintAlgorithm}:${bundle.manifest.specificationFingerprint}\``,
    `- Diagnostics: ${bundle.diagnostics.length}`,
    `- Blocking diagnostics: ${blockingDiagnostics.length}`,
    `- Blocking questions: ${unresolvedQuestions.length}`,
    '',
    '## Capability Report',
    '',
    '| Feature | Support | Entities | Note |',
    '| --- | --- | --- | --- |',
    ...capabilityRows,
    '',
    '## Blocking Diagnostics',
    '',
    '| Severity | Code | Path | Message |',
    '| --- | --- | --- | --- |',
    ...diagnosticRows,
    '',
    '## Unresolved Questions',
    '',
    '| Question | Entities | Text |',
    '| --- | --- | --- |',
    ...questionRows,
  ].join('\n');
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatSemanticDiff(items: ReturnType<typeof diffModelDocuments>): string {
  if (!items.length) return 'No semantic changes from the initial sample.';
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
  const prompt = useMemo(() => generateAiPrompt(modelIr, promptTarget), [modelIr, promptTarget]);
  const [activeOutput, setActiveOutput] = useState<'math' | 'review' | 'handoff' | 'advanced'>('math');
  const [advancedOutput, setAdvancedOutput] = useState<'ir' | 'prompt' | 'package' | 'diff'>('ir');
  const [handoffPreviewFormat, setHandoffPreviewFormat] = useState<'markdown' | 'json'>('markdown');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [importError, setImportError] = useState<ImportErrorState | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [patchInput, setPatchInput] = useState('');
  const [pendingPatch, setPendingPatch] = useState<PendingPatchState | null>(null);
  const [patchInbox, setPatchInbox] = useState<Array<{ id: string; label: string; value: string }>>([]);
  const [schemaInput, setSchemaInput] = useState('x, real, N\ny, real, N');
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ImplementationReceipt | null>(null);
  const receiptFingerprintStatus = useMemo(
    () => receipt ? compareReceiptFingerprint(receipt, handoffBundle.manifest.specificationFingerprint) : null,
    [handoffBundle.manifest.specificationFingerprint, receipt],
  );
  const fullTex = useMemo(() => generateModelTex(modelIr), [modelIr]);
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
        label: 'Blocked',
        message: 'Handoff前に止めている項目があります。',
      }
    : compiledCanvas.semantic.readiness.summary.warnings || handoffBundle.unresolvedQuestions.length
      ? {
          state: 'review',
          label: 'Needs review',
          message: 'Handoff前に確認したい項目があります。',
        }
      : {
          state: 'ready',
          label: 'Ready',
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
    return [...byPlate.entries()].map(([id, plateNodes]) => ({
      id,
      index: inferPlateIndexForUi(id),
      size: plateNodes.find((node) => node.data.shape?.length)?.data.shape?.[0] ?? id.toUpperCase(),
      nodeCount: plateNodes.length,
    }));
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
      label: 'Blocking diagnostics cleared',
      done: blockingDiagnostics.length === 0,
      detail: `${blockingDiagnostics.length} blocking`,
    },
    {
      label: 'Observed likelihood is bound',
      done: nodes.some((node) => node.data.kind === 'likelihood' && node.data.observed),
      detail: 'observed likelihood',
    },
    {
      label: 'QoI is defined',
      done: queryNodes.length > 0,
      detail: `${queryNodes.length} QoI`,
    },
    {
      label: 'Decision notes exist',
      done: decisionNotes.length > 0,
      detail: `${decisionNotes.length} notes`,
    },
    {
      label: 'Target support reviewed',
      done: handoffBundle.capabilityReport.every((item) => item.support !== 'unsupported'),
      detail: `${handoffBundle.capabilityReport.filter((item) => item.support === 'unsupported').length} unsupported`,
    },
  ], [blockingDiagnostics.length, decisionNotes.length, handoffBundle.capabilityReport, nodes, queryNodes.length]);
  const focusedNodeIds = useMemo(() => {
    if (!focusNodeId) return null;
    const related = new Set([focusNodeId]);
    for (const edge of edges) {
      if (edge.source === focusNodeId) related.add(edge.target);
      if (edge.target === focusNodeId) related.add(edge.source);
    }
    return related;
  }, [edges, focusNodeId]);
  const flowNodes = useMemo(
    () => nodes
      .filter((node) => !focusedNodeIds || focusedNodeIds.has(node.id))
      .map((node) => ({
        ...node,
        data: {
          ...node.data,
          diagnosticCount: diagnosticCounts.get(node.id) ?? 0,
        },
      })),
    [diagnosticCounts, focusedNodeIds, nodes],
  );
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
        label: 'Blocking',
        diagnostics: diagnostics.filter((diagnostic) => diagnostic.blocksHandoff),
      },
      {
        id: 'error',
        label: 'Errors',
        diagnostics: diagnostics.filter((diagnostic) => diagnostic.severity === 'error' && !diagnostic.blocksHandoff),
      },
      {
        id: 'warning',
        label: 'Warnings',
        diagnostics: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning' && !diagnostic.blocksHandoff),
      },
      {
        id: 'info',
        label: 'Info',
        diagnostics: diagnostics.filter((diagnostic) => diagnostic.severity === 'info' && !diagnostic.blocksHandoff),
      },
    ];
  }, [compiledCanvas.semantic.diagnostics]);

  const labeledEdges = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n.data]));
    return edges.filter((edge) => !focusedNodeIds || (focusedNodeIds.has(edge.source) && focusedNodeIds.has(edge.target))).map((edge) => {
      const targetData = nodeMap.get(edge.target);
      if (!targetData) return { ...edge, type: 'paramEdge' as const };
      const paramLabel = resolveEdgeParam(edge.source, targetData);
      return { ...edge, type: 'paramEdge' as const, data: { ...edge.data, paramLabel } };
    });
  }, [nodes, edges, focusedNodeIds]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
  }, [nodes, edges]);

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
        setNodes(state.nodes);
        setEdges(state.edges);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setImportError(null);
      } catch (error) {
        setImportError({
          title: '読み込みに失敗しました',
          detail: error instanceof Error ? error.message : 'JSON形式とBayes Canvas形式を確認してください。',
        });
      }
    };
    input.click();
  }, [setNodes, setEdges]);

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

  const commands = useMemo<CommandAction[]>(() => [
    {
      id: 'add-data',
      label: 'Add data',
      group: 'Add',
      run: () => addNodeFromPalette('data'),
    },
    {
      id: 'add-parameter',
      label: 'Add parameter',
      group: 'Add',
      run: () => addNodeFromPalette('parameter'),
    },
    {
      id: 'add-likelihood',
      label: 'Add likelihood',
      group: 'Add',
      run: () => addNodeFromPalette('likelihood'),
    },
    {
      id: 'add-deterministic',
      label: 'Add deterministic',
      group: 'Add',
      run: () => addNodeFromPalette('deterministic'),
    },
    {
      id: 'open-add',
      label: 'Open Add panel',
      group: 'Navigate',
      run: () => setActiveLeftPanel('add'),
    },
    ...modelTemplates.map((template) => ({
      id: `template-${template.id}`,
      label: `Start ${template.name}`,
      group: 'Template',
      run: () => applyModelTemplate(template),
    })),
    {
      id: 'open-structure',
      label: 'Open Structure panel',
      group: 'Navigate',
      run: () => setActiveLeftPanel('structure'),
    },
    {
      id: 'go-review',
      label: 'Go to Review',
      group: 'Navigate',
      run: () => setActiveOutput('review'),
    },
    {
      id: 'add-qoi',
      label: 'Add QoI',
      group: 'Builder',
      run: addQoIFromSelection,
    },
    {
      id: 'add-model-block',
      label: 'Add model block',
      group: 'Builder',
      run: addModelBlock,
    },
    {
      id: 'prepare-handoff',
      label: 'Prepare Handoff',
      group: 'Navigate',
      run: () => setActiveOutput('handoff'),
    },
    {
      id: 'export-package',
      label: 'Export package',
      group: 'File',
      run: () => exportPortablePackageToFile(portablePackage),
    },
    {
      id: 'import-canvas',
      label: 'Import canvas',
      group: 'File',
      run: handleImport,
    },
  ], [addModelBlock, addNodeFromPalette, addQoIFromSelection, applyModelTemplate, handleImport, portablePackage]);

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
            <span className="summary-value">{compiledCanvas.semantic.readiness.summary.errors}</span>
            <span className="summary-label">エラー</span>
          </div>
          <div>
            <span className="summary-value">{modelIr.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length + compiledCanvas.semantic.readiness.summary.warnings}</span>
            <span className="summary-label">確認</span>
          </div>
        </div>
      </header>

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

      {commandPaletteOpen ? (
        <div className="command-backdrop" role="presentation" onMouseDown={() => setCommandPaletteOpen(false)}>
          <div
            aria-label="Command Palette"
            aria-modal="true"
            className="command-palette"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <input
              autoFocus
              placeholder="Commandを検索"
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
                <p className="empty-note">一致するcommandはありません。</p>
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
                  ? `${plateRows.length} plates`
                  : activeLeftPanel === 'library'
                    ? `${savedModels.length} snapshots`
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
              <div className="template-panel">
                <div className="panel-title compact">
                  <h2>Templates</h2>
                  <span>{modelTemplates.length}</span>
                </div>
                <div className="template-list">
                  {modelTemplates.map((template) => (
                    <button key={template.id} type="button" onClick={() => applyModelTemplate(template)}>
                      <strong>{template.name}</strong>
                      <span>{template.family}</span>
                      <small>{template.description}</small>
                    </button>
                  ))}
                </div>
              </div>
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
                <h2>Plates</h2>
                <span>{plateRows.length}</span>
              </div>
              <div className="plate-list">
                {plateRows.map((plate) => (
                  <div className="plate-row" key={plate.id}>
                    <label>
                      id
                      <input
                        defaultValue={plate.id}
                        onBlur={(event) => renamePlate(plate.id, event.target.value)}
                      />
                    </label>
                    <label>
                      index
                      <input
                        defaultValue={plate.index}
                        onBlur={(event) => updatePlateIndex(plate.id, event.target.value)}
                      />
                    </label>
                    <label>
                      size
                      <input
                        defaultValue={plate.size}
                        onBlur={(event) => updatePlateSize(plate.id, event.target.value)}
                      />
                    </label>
                    <span>{plate.nodeCount} nodes</span>
                  </div>
                ))}
                {!plateRows.length ? <p className="empty-note">plateを持つノードはまだありません。</p> : null}
              </div>
              <button disabled={!selectedNodeId} type="button" onClick={addPlateToSelection}>
                選択ノードにtime plate
              </button>
              {modelIr.indexMappings.length ? (
                <div className="mapping-list">
                  {modelIr.indexMappings.map((mapping) => (
                    <div className="mapping-row" key={mapping.id}>
                      <span>{mapping.symbol}[{mapping.inputIndex}]</span>
                      <small>{mapping.fromPlateId} → {mapping.toPlateId}</small>
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
                  <h2>Templates</h2>
                  <span>{modelTemplates.length}</span>
                </div>
                <div className="template-list">
                  {modelTemplates.map((template) => (
                    <button key={template.id} type="button" onClick={() => applyModelTemplate(template)}>
                      <strong>{template.name}</strong>
                      <span>{template.family}</span>
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
                <h2 ref={editorHeadingRef} tabIndex={-1}>Inspector</h2>
                <span>{selectedKindLabel}</span>
              </div>
            {selectedData ? (
              <div className="node-editor">
                <button className="danger-button compact-danger" onClick={deleteSelectedItem} type="button">
                  選択中を削除
                </button>
                <div className="inspector-section">
                  <div className="inspector-section-title">Definition</div>
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
                  <div className="inspector-section-title">Shape / Plate</div>
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
                </div>
                <div className="inspector-section">
                  <div className="inspector-section-title">Model</div>
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
                  <div className="inspector-section-title">Notes</div>
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
                  <div className="inspector-section-title">Diagnostics</div>
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
          ) : null}
        </aside>

        <section className="canvas">
          <div className="canvas-toolbar">
            <div className="toolbar-title">
              <strong>階層回帰</strong>
              <span>編集キャンバス</span>
            </div>
            <div className="toolbar-actions">
              <div className="toolbar-group toolbar-primary" aria-label="Primary actions">
                <button type="button" onClick={() => setCommandPaletteOpen(true)}>
                  Command
                </button>
                <button type="button" onClick={() => setActiveOutput('review')}>
                  Review
                </button>
                <button type="button" onClick={() => setActiveOutput('handoff')}>
                  Handoff
                </button>
              </div>
              <div className="toolbar-group" aria-label="File actions">
                <button type="button" onClick={handleSave}>
                  保存
                </button>
                <button type="button" onClick={handleImport}>
                  読み込み
                </button>
                <button type="button" onClick={handleExport}>
                  書き出し
                </button>
              </div>
              <div className="toolbar-group" aria-label="Edit actions">
                <button disabled={!selectedNode && !selectedEdge} type="button" onClick={deleteSelectedItem}>
                  削除
                </button>
              </div>
              <div className="toolbar-group" aria-label="Advanced actions">
                <button type="button" onClick={() => exportPortablePackageToFile(portablePackage)}>
                  Package
                </button>
                <button type="button" onClick={() => copyText(JSON.stringify(modelIr, null, 2))}>
                  IRコピー
                </button>
              </div>
              <div className="toolbar-group toolbar-danger" aria-label="Danger actions">
                <button type="button" onClick={resetSample}>
                  初期化
                </button>
              </div>
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
          <section className={`readiness-card readiness-${handoffReadiness.state}`} aria-label="Handoff readiness">
            <div className="readiness-heading">
              <span>{handoffReadiness.label}</span>
              <strong>{getPromptTargetLabel(promptTarget)}</strong>
            </div>
            <p>{handoffReadiness.message}</p>
            <div className="readiness-metrics">
              <span>{compiledCanvas.semantic.readiness.summary.errors} errors</span>
              <span>{compiledCanvas.semantic.readiness.summary.warnings} warnings</span>
              <span>{blockingQuestions.length} questions</span>
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
                Review issues
              </button>
              <button type="button" onClick={() => setActiveOutput('handoff')}>
                Prepare handoff
              </button>
            </div>
          </section>
          <div className="outline-panel">
            <div className="panel-title compact">
              <h2>Outline</h2>
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
                      <small>{references.length} refs</small>
                    </button>
                  );
                })}
            </div>
          </div>
          <div className="issues-panel">
            <div className="panel-title compact">
              <h2>Review</h2>
              <span>{compiledCanvas.semantic.readiness.handoff === 'ready' ? 'ready' : 'blocked'}</span>
            </div>
            <div className="issue-summary">
              <span>{compiledCanvas.semantic.readiness.summary.errors} errors</span>
              <span>{compiledCanvas.semantic.readiness.summary.warnings} warnings</span>
              <span>{compiledCanvas.semantic.readiness.summary.infos} info</span>
              <span>{blockingDiagnostics.length} blocking</span>
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
                              <small>{diagnostic.stage}{diagnostic.blocksHandoff ? ' / blocks handoff' : ''}</small>
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
          <div className="assistant-panel">
            <div className="panel-title compact">
              <h2>Design Assistants</h2>
              <span>{reviewChecklist.filter((item) => item.done).length}/{reviewChecklist.length}</span>
            </div>
            <div className="assistant-grid">
              <button type="button" onClick={() => setActiveLeftPanel('library')}>
                <strong>Interview / Templates</strong>
                <span>{modelTemplates.length} starting points</span>
              </button>
              <button type="button" onClick={addQoIFromSelection}>
                <strong>QoI Builder</strong>
                <span>{queryNodes.length} quantities</span>
              </button>
              <button type="button" onClick={addModelBlock}>
                <strong>Block Inspector</strong>
                <span>{blockNodes.length} blocks</span>
              </button>
              <button type="button" onClick={applyHorseshoePrior}>
                <strong>Prior Assistant</strong>
                <span>{selectedData ? selectedData.name : 'select or create'}</span>
              </button>
            </div>
            <div className="schema-assistant">
              <label>
                Schema Importer
                <textarea value={schemaInput} onChange={(event) => setSchemaInput(event.target.value)} />
              </label>
              <button type="button" onClick={importSchemaColumns}>列をDataノード化</button>
            </div>
            <div className="checklist-list">
              {reviewChecklist.map((item) => (
                <div className={item.done ? 'checklist-item is-done' : 'checklist-item'} key={item.label}>
                  <strong>{item.done ? 'done' : 'todo'}</strong>
                  <span>{item.label}</span>
                  <small>{item.detail}</small>
                </div>
              ))}
            </div>
            <div className="decision-list">
              <div className="assistant-subtitle">
                <span>Decision Log</span>
                <strong>{decisionNotes.length}</strong>
              </div>
              {decisionNotes.slice(0, 4).map((note) => (
                <button key={note.id} type="button" onClick={() => selectNodeForEditing(note.id, { focusEditor: true })}>
                  <span>{note.name}</span>
                  <small>{note.text}</small>
                </button>
              ))}
              {!decisionNotes.length ? <p className="empty-note">ノートやprior rationaleはまだありません。</p> : null}
            </div>
            <div className="assistant-grid">
              <button disabled={!selectedNodeId} type="button" onClick={() => setFocusNodeId(selectedNodeId)}>
                <strong>Dependency Slice</strong>
                <span>{focusNodeId ? 'focused' : 'selected node'}</span>
              </button>
              <button disabled={!focusNodeId} type="button" onClick={() => setFocusNodeId(null)}>
                <strong>Clear Focus</strong>
                <span>{focusedNodeIds ? `${focusedNodeIds.size} visible` : 'all visible'}</span>
              </button>
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
              Review
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
              Handoff
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
              Advanced
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
                      ? '受け渡しsummary'
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
                  <div className="segmented-control" aria-label="advanced output">
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
                  <div className="segmented-control" aria-label="handoff preview format">
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
          <div className="receipt-panel">
            <div className="panel-title compact">
              <h2>Receipt</h2>
              <button type="button" onClick={handleReceiptImport}>読込</button>
            </div>
            {receipt ? (
              <div className="receipt-summary">
                <strong>{receipt.backend}</strong>
                <span>{receipt.mappings.length} mappings</span>
                <span>{receipt.deviations.length + receipt.addedAssumptions.length + receipt.approximations.length} review items</span>
                {receiptFingerprintStatus ? (
                  <span className={receiptFingerprintStatus.matches ? 'receipt-match' : 'receipt-mismatch'}>
                    {receiptFingerprintStatus.message}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="empty-note">外部実装の対応表を読み込めます。</p>
            )}
          </div>
          <div className="patch-panel">
            <div className="panel-title compact">
              <h2>Patch</h2>
              <div className="mini-actions">
                <button type="button" onClick={insertPatchTemplate}>雛形</button>
                <button disabled={!patchInput.trim()} type="button" onClick={savePatchToInbox}>保存</button>
              </div>
            </div>
            {patchInbox.length ? (
              <div className="patch-inbox">
                {patchInbox.map((item) => (
                  <button key={item.id} type="button" onClick={() => setPatchInput(item.value)}>
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            <textarea
              aria-label="JSON Patch proposal"
              placeholder="AI patch proposal JSON"
              value={patchInput}
              onChange={(event) => setPatchInput(event.target.value)}
            />
            <div className="patch-actions">
              <button disabled={!patchInput.trim()} type="button" onClick={previewPatch}>
                プレビュー
              </button>
              <button disabled={!pendingPatch} type="button" onClick={applyPendingPatch}>
                適用
              </button>
            </div>
            {pendingPatch ? (
              <div className="patch-summary">
                <strong>{pendingPatch.summary}</strong>
                <span>{pendingPatch.preview.semanticDiff.map((item) => item.label).join(' / ') || 'semantic diffなし'}</span>
              </div>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}

