import type { Edge, Node } from '@xyflow/react';
import type { Diagnostic, DiagnosticFix } from './core/diagnostics.js';
import type { LayoutDocument, ModelDocument } from './core/model.js';
import type { SemanticDiffItem } from './core/semantic-diff.js';
import { diffModelDocuments } from './core/semantic-diff.js';
import type { BayesNodeData } from './modelIr.js';

export interface ModelVariant {
  id: string;
  label: string;
  createdAt: string;
  document: ModelDocument;
  layout: LayoutDocument;
}

export interface VariantComparison {
  baseline: ModelVariant;
  currentDocumentId: string;
  changes: SemanticDiffItem[];
  critical: number;
  warnings: number;
}

export interface PriorPredictiveCheck {
  id: string;
  label: string;
  detail: string;
  status: 'ready' | 'review' | 'blocked';
  entityId?: string;
}

export interface ModelingRecipe {
  id: 'robust_likelihood' | 'non_centered_hierarchy' | 'explicit_scale_notes';
  label: string;
  note: string;
}

export const MODELING_RECIPES: ModelingRecipe[] = [
  { id: 'robust_likelihood', label: 'ロバスト尤度', note: '最初のNormal尤度をStudent-tへ置換' },
  { id: 'non_centered_hierarchy', label: 'Non-centered', note: 'plateを持つ階層パラメータへ実装hintを追加' },
  { id: 'explicit_scale_notes', label: 'Scale確認', note: 'priorと観測の単位確認をノートへ追加' },
];

const VARIANT_STORAGE_KEY = 'bayes-canvas:model-variants';

export function loadModelVariants(): ModelVariant[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(VARIANT_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isVariantLike).slice(0, 20);
  } catch {
    return [];
  }
}

export function persistModelVariants(variants: ModelVariant[]): ModelVariant[] {
  const bounded = variants.slice(0, 20);
  localStorage.setItem(VARIANT_STORAGE_KEY, JSON.stringify(bounded));
  return bounded;
}

export function createModelVariant(
  label: string,
  document: ModelDocument,
  layout: LayoutDocument,
  timestamp = Date.now(),
): ModelVariant {
  return {
    id: `variant_${timestamp}_${Math.random().toString(36).slice(2, 7)}`,
    label,
    createdAt: new Date(timestamp).toISOString(),
    document: structuredClone(document),
    layout: structuredClone(layout),
  };
}

export function compareModelVariant(variant: ModelVariant, current: ModelDocument): VariantComparison {
  const changes = diffModelDocuments(variant.document, current);
  return {
    baseline: variant,
    currentDocumentId: current.documentId,
    changes,
    critical: changes.filter((item) => item.severity === 'critical').length,
    warnings: changes.filter((item) => item.severity === 'warning').length,
  };
}

export function buildPriorPredictivePlan(document: ModelDocument): PriorPredictiveCheck[] {
  const entities = Object.values(document.entities);
  const randomVariables = entities.filter((entity) => entity.kind === 'random_variable');
  const parameters = randomVariables.filter((entity) => entity.role !== 'observation');
  const observations = randomVariables.filter((entity) => entity.role === 'observation');
  const checks: PriorPredictiveCheck[] = parameters.map((entity) => ({
    id: `prior-${entity.id}`,
    label: `${entity.symbol} ~ ${entity.distribution.distributionId}`,
    detail: entity.priorRationale
      ? `意図: ${entity.priorRationale}`
      : `生成値の単位・妥当範囲を確認してください。${entity.valueType.domain ? ` domain=${entity.valueType.domain.kind}` : ''}`,
    status: entity.priorRationale ? 'ready' : 'review',
    entityId: entity.id,
  }));

  for (const entity of observations) {
    checks.push({
      id: `likelihood-${entity.id}`,
      label: `${entity.symbol} の観測生成`,
      detail: entity.observedDataId
        ? `${entity.distribution.distributionId} → ${entity.observedDataId}`
        : '観測データとのbindingがありません。',
      status: entity.observedDataId ? 'ready' : 'blocked',
      entityId: entity.id,
    });
  }

  if (!observations.length) {
    checks.push({
      id: 'likelihood-missing',
      label: '観測生成',
      detail: '尤度となるobservation変数がありません。',
      status: 'blocked',
    });
  }
  return checks;
}

export function generatePriorPredictivePrompt(document: ModelDocument): string {
  const checks = buildPriorPredictivePlan(document);
  return [
    'Run a prior predictive design review for this Bayes Canvas ModelDocument.',
    'Do not fit posterior inference. Simulate from priors and the observation model only.',
    'Report units, central ranges, tail behavior, impossible values, and the entity IDs responsible.',
    'Return proposed model changes as a bayes-canvas AI patch proposal; do not rewrite stable entity IDs.',
    '',
    'Review checklist:',
    ...checks.map((item) => `- [${item.status === 'ready' ? 'x' : ' '}] ${item.label}: ${item.detail}`),
    '',
    'ModelDocument:',
    '```json',
    JSON.stringify(document, null, 2),
    '```',
  ].join('\n');
}

export interface DiagnosticFixCandidate {
  diagnostic: Diagnostic;
  fix: DiagnosticFix;
}

export function availableDiagnosticFixes(diagnostics: readonly Diagnostic[]): DiagnosticFixCandidate[] {
  return diagnostics.flatMap((diagnostic) =>
    (diagnostic.fixes ?? [])
      .filter((fix) => fix.patch.length > 0)
      .map((fix) => ({ diagnostic, fix })),
  );
}

export function applyModelingRecipe(
  recipeId: ModelingRecipe['id'],
  nodes: Node<BayesNodeData>[],
  edges: Edge[],
): { nodes: Node<BayesNodeData>[]; edges: Edge[]; message: string } {
  if (recipeId === 'robust_likelihood') {
    let changed = false;
    const next = nodes.map((node) => {
      if (changed || node.data.kind !== 'likelihood' || node.data.distribution?.id !== 'normal') return node;
      changed = true;
      const args = node.data.distribution.args;
      return {
        ...node,
        data: {
          ...node.data,
          distribution: {
            id: 'student_t',
            name: 'StudentT',
            args: { nu: '4', mu: args.mu ?? '0', sigma: args.sigma ?? '1' },
          },
        },
      };
    });
    if (!changed) throw new Error('Normal尤度が見つかりません。');
    return { nodes: next, edges, message: 'Normal尤度をStudent-t(ν=4)へ置換しました。' };
  }

  if (recipeId === 'non_centered_hierarchy') {
    let changed = 0;
    const next = nodes.map((node) => {
      if (!['parameter', 'latent'].includes(node.data.kind) || !node.data.plate) return node;
      if (node.data.hints?.some((hint) => hint.kind === 'parameterization' && hint.value === 'non_centered')) return node;
      changed += 1;
      return {
        ...node,
        data: {
          ...node.data,
          hints: [
            ...(node.data.hints ?? []).filter((hint) => hint.kind !== 'parameterization'),
            { kind: 'parameterization' as const, value: 'non_centered' as const },
          ],
        },
      };
    });
    if (!changed) throw new Error('対象となる階層パラメータが見つかりません。');
    return { nodes: next, edges, message: `${changed}件をnon-centered指定にしました。` };
  }

  let changed = 0;
  const next = nodes.map((node) => {
    if (!node.data.distribution) return node;
    if (node.data.notes?.includes('Prior predictive scale review required.')) return node;
    changed += 1;
    return {
      ...node,
      data: {
        ...node.data,
        notes: [node.data.notes, 'Prior predictive scale review required.'].filter(Boolean).join('\n'),
      },
    };
  });
  if (!changed) throw new Error('分布を持つ変数がありません。');
  return { nodes: next, edges, message: `${changed}件へscale確認ノートを追加しました。` };
}

function isVariantLike(value: unknown): value is ModelVariant {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelVariant>;
  return typeof candidate.id === 'string'
    && typeof candidate.label === 'string'
    && typeof candidate.createdAt === 'string'
    && Boolean(candidate.document)
    && Boolean(candidate.layout);
}
