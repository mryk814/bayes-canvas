import type { Diagnostic, JsonPatchOperation } from '../lib/core/diagnostics.js';
import type { SemanticModel } from '../lib/core/compiler.js';
import { parseExpression, type ExprNode } from '../lib/core/expression.js';
import type {
  DistributionCall,
  ModelDocument,
  ModelEntity,
  RandomVariableEntity,
} from '../lib/core/model.js';
import { diffModelDocuments } from '../lib/core/semantic-diff.js';
import type { ImplementationReceipt } from '../lib/core/receipt.js';
import { findDistribution } from '../lib/distributionRegistry.js';
import type { ModelEvidenceBundle } from '../lib/modelEvidence.js';

/* ------------------------------------------------------------------ */
/* Rows and stages: the generative order of the document              */
/* ------------------------------------------------------------------ */

export type RowRole = 'belief' | 'hierarchy' | 'given' | 'index' | 'derived' | 'observation' | 'query' | 'other';

export interface ScoreRow {
  id: string;
  entity: ModelEntity;
  role: RowRole;
  stageId: string;
  parents: string[];
  children: string[];
  depth: number;
  /** Index symbols that this statement repeats over, outer to inner. */
  indices: string[];
  /** Data entity folded into this observation row (observedDataId). */
  observedData?: ModelEntity;
}

export interface ScoreStage {
  id: string;
  title: string;
  plateIds: string[];
  /** "j = 1..J" per plate, for the bracket label. */
  range: string;
  rows: ScoreRow[];
}

export interface ScoreProjection {
  stages: ScoreStage[];
  rows: ScoreRow[];
  byId: Record<string, ScoreRow>;
  queries: ScoreRow[];
}

export function projectScore(document: ModelDocument, semantic: SemanticModel): ScoreProjection {
  const entities = document.entities;
  const folded = new Set<string>();
  for (const entity of Object.values(entities)) {
    if (entity.kind === 'random_variable' && entity.observedDataId && entities[entity.observedDataId]?.authorship === 'generated') {
      folded.add(entity.observedDataId);
    }
  }

  const parents: Record<string, string[]> = {};
  const children: Record<string, string[]> = {};
  for (const id of Object.keys(entities)) {
    parents[id] = [];
    children[id] = [];
  }
  for (const edge of semantic.dependencyEdges) {
    if (!parents[edge.to] || !children[edge.from]) continue;
    if (!parents[edge.to]!.includes(edge.from)) parents[edge.to]!.push(edge.from);
    if (!children[edge.from]!.includes(edge.to)) children[edge.from]!.push(edge.to);
  }

  const depth: Record<string, number> = {};
  const visit = (id: string, trail: Set<string>): number => {
    if (depth[id] !== undefined) return depth[id]!;
    if (trail.has(id)) return 0;
    trail.add(id);
    const value = parents[id]!.length ? Math.max(...parents[id]!.map((parent) => visit(parent, trail) + 1)) : 0;
    trail.delete(id);
    depth[id] = value;
    return value;
  };
  Object.keys(entities).forEach((id) => visit(id, new Set()));

  const order = new Map(document.entityOrder.map((id, index) => [id, index]));
  const rows: ScoreRow[] = Object.values(entities)
    .filter((entity) => !folded.has(entity.id))
    .map((entity) => ({
      id: entity.id,
      entity,
      role: roleOf(entity, document, children[entity.id] ?? []),
      stageId: entity.kind === 'query' ? 'question' : entity.plateIds.length ? `plate:${[...entity.plateIds].sort().join('+')}` : 'global',
      parents: parents[entity.id] ?? [],
      children: children[entity.id] ?? [],
      depth: depth[entity.id] ?? 0,
      indices: entity.plateIds.map((plateId) => document.plates[plateId]?.indexSymbol ?? plateId),
      observedData: entity.kind === 'random_variable' && entity.observedDataId ? entities[entity.observedDataId] : undefined,
    }));

  const stageMap = new Map<string, ScoreRow[]>();
  for (const row of rows) {
    if (!stageMap.has(row.stageId)) stageMap.set(row.stageId, []);
    stageMap.get(row.stageId)!.push(row);
  }
  const stageKey = (stageRows: ScoreRow[], id: string) => {
    if (id === 'global') return -1;
    const stochastic = stageRows.filter((row) => row.entity.kind !== 'data');
    return stochastic.length ? Math.min(...stochastic.map((row) => row.depth)) : 0;
  };
  const stages: ScoreStage[] = [...stageMap.entries()]
    .filter(([id]) => id !== 'question')
    .sort(([a, aRows], [b, bRows]) => stageKey(aRows, a) - stageKey(bRows, b))
    .map(([id, stageRows], index) => {
      const plateIds = stageRows[0]!.entity.plateIds;
      stageRows.sort((a, b) =>
        Number(a.entity.kind !== 'data') - Number(b.entity.kind !== 'data')
        || a.depth - b.depth
        || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      return {
        id,
        title: stageTitle(index, plateIds, stageRows, document),
        plateIds,
        range: plateIds.map((plateId) => {
          const plate = document.plates[plateId];
          if (!plate) return plateId;
          const axis = document.axes[plate.axisId];
          return `${plate.indexSymbol} = 1..${axis?.size.source ?? axis?.symbol ?? '?'}`;
        }).join(', '),
        rows: stageRows,
      };
    });

  const ordered = stages.flatMap((stage) => stage.rows);
  const queries = stageMap.get('question') ?? [];
  return {
    stages,
    rows: ordered,
    byId: Object.fromEntries([...ordered, ...queries].map((row) => [row.id, row])),
    queries,
  };
}

function stageTitle(index: number, plateIds: string[], rows: ScoreRow[], document: ModelDocument): string {
  const numeral = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][index] ?? String(index + 1);
  if (!plateIds.length) return `${numeral}. 全体に共通する信念`;
  const hasObservation = rows.some((row) => row.role === 'observation');
  const labels = plateIds.map((plateId) => document.plates[plateId]?.label ?? plateId).join(' × ');
  return hasObservation ? `${numeral}. 観測ごとに（${labels}）` : `${numeral}. ${labels} ごとに`;
}

function roleOf(entity: ModelEntity, document: ModelDocument, children: string[]): RowRole {
  if (entity.kind === 'query') return 'query';
  if (entity.kind === 'deterministic') return 'derived';
  if (entity.kind === 'data') return entity.dataRole === 'index' ? 'index' : 'given';
  if (entity.kind !== 'random_variable') return 'other';
  if (entity.role === 'observation') return 'observation';
  const feedsPlated = children.some((child) => {
    const target = document.entities[child];
    return target?.kind === 'random_variable' && target.role !== 'observation' && target.plateIds.length > entity.plateIds.length;
  });
  return feedsPlated ? 'hierarchy' : 'belief';
}

/* ------------------------------------------------------------------ */
/* Typesetting: TeX with addressable symbols                           */
/* ------------------------------------------------------------------ */

const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'eta', 'theta', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'phi', 'psi', 'omega', 'zeta', 'chi']);
const ACCENTS: Record<string, string> = { bar: '\\bar', hat: '\\hat', tilde: '\\tilde' };

export function symbolTex(symbol: string): string {
  const parts = symbol.split('_');
  const base = parts[0]!;
  const baseTex = GREEK.has(base) ? `\\${base}` : base.length === 1 ? base : `\\mathrm{${base}}`;
  if (parts.length === 1) return baseTex;
  const rest = parts.slice(1);
  if (rest.length === 1 && ACCENTS[rest[0]!]) return `${ACCENTS[rest[0]!]}{${baseTex}}`;
  if (!GREEK.has(base) && base.length > 1) return `\\mathrm{${symbol.replaceAll('_', '\\_')}}`;
  const sub = rest.map((part) => (GREEK.has(part) ? `\\${part}` : `\\mathrm{${part}}`)).join(',');
  return `${baseTex}_{${sub}}`;
}

function wrap(symbol: string, tex: string, known: Set<string>): string {
  return known.has(symbol) ? `\\htmlData{sym=${symbol}}{${tex}}` : tex;
}

export function exprTex(node: ExprNode, known: Set<string>): string {
  switch (node.kind) {
    case 'number':
      return node.raw;
    case 'reference':
      return wrap(node.symbol, symbolTex(node.symbol), known);
    case 'unary':
      return `${node.operator}${exprTex(node.operand, known)}`;
    case 'binary': {
      const left = exprTex(node.left, known);
      const right = exprTex(node.right, known);
      if (node.operator === '*') return `${left} \\cdot ${right}`;
      if (node.operator === '/') return `\\frac{${left}}{${right}}`;
      if (node.operator === '^') return `{${left}}^{${right}}`;
      if (node.operator === '@') return `${left}\\,${right}`;
      return `${left} ${node.operator === '==' ? '=' : node.operator} ${right}`;
    }
    case 'call':
      return `\\operatorname{${node.functionName.replaceAll('_', '\\_')}}\\left(${node.args.map((arg) => exprTex(arg, known)).join(', ')}\\right)`;
    case 'index': {
      const target = exprTex(node.target, known);
      const indices = node.indices.map((index) => exprTex(index, known)).join(',');
      return `{${target}}_{${indices}}`;
    }
    case 'slice':
      return ':';
  }
}

export function sourceTex(source: string, known: Set<string>): string {
  const parsed = parseExpression(source);
  return parsed.ok ? exprTex(parsed.ast, known) : `\\text{${source.replace(/[{}\\]/g, '')}}`;
}

export function distributionTex(call: DistributionCall, known: Set<string>): string {
  const definition = findDistribution(call.distributionId);
  const name = definition?.name ?? call.distributionId;
  const order = definition?.params.map((param) => param.name) ?? Object.keys(call.args);
  const args = [...order, ...Object.keys(call.args).filter((key) => !order.includes(key))]
    .filter((key) => call.args[key])
    .map((key) => sourceTex(call.args[key]!.source, known));
  const head = name === 'Normal' ? '\\mathcal{N}' : `\\operatorname{${name}}`;
  return `${head}\\left(${args.join(',\\ ')}\\right)`;
}

export function lhsTex(entity: ModelEntity, indices: string[], known: Set<string>): string {
  const base = wrap(entity.symbol, symbolTex(entity.symbol), known);
  return indices.length ? `{${base}}_{${indices.join(',')}}` : base;
}

export function statementTex(row: ScoreRow, known: Set<string>): string {
  const { entity } = row;
  const lhs = lhsTex(entity, row.indices, known);
  switch (entity.kind) {
    case 'random_variable':
      return `${lhs} \\sim ${distributionTex(entity.distribution, known)}`;
    case 'deterministic':
      return `${lhs} = ${sourceTex(entity.expression.source, known)}`;
    case 'query':
      return `${lhs} := ${sourceTex(entity.expression.source, known)}`;
    case 'factor':
      return `\\log p \\mathrel{+}= ${sourceTex(entity.logDensity.source, known)}`;
    case 'data':
      return `${lhs} \\in \\mathbb{${entity.valueType.scalar === 'integer' || entity.valueType.scalar === 'category' ? 'Z' : 'R'}}`;
    case 'block_instance':
      return `${lhs} \\leftarrow \\operatorname{${entity.blockTypeId.replaceAll('_', '\\_')}}(\\dots)`;
  }
}

/* ------------------------------------------------------------------ */
/* Story: the same statement read as a sentence                       */
/* ------------------------------------------------------------------ */

export interface StoryPart {
  text: string;
  sym?: string;
}

function isNumeric(source?: string): boolean {
  return source !== undefined && /^-?\d+(\.\d+)?$/.test(source.trim());
}

function argStory(source: string, known: Set<string>): StoryPart[] {
  const trimmed = source.trim();
  const base = trimmed.replace(/\[.*$/, '');
  if (known.has(base)) return [{ text: trimmed, sym: base }];
  return [{ text: trimmed }];
}

export function storyFor(row: ScoreRow, document: ModelDocument, known: Set<string>): StoryPart[] {
  const { entity } = row;
  const plateWords = entity.plateIds.map((plateId) => document.plates[plateId]?.label ?? plateId);
  const scope: StoryPart[] = plateWords.length ? [{ text: `各${plateWords.join('・')} ${row.indices.join(',')} ごとに、` }] : [];
  const self: StoryPart = { text: entity.label ?? entity.symbol, sym: entity.symbol };

  if (entity.kind === 'data') {
    if (entity.dataRole === 'index') {
      const targets = Object.values(document.entities).filter((other) =>
        'expression' in other && other.kind === 'deterministic' && other.expression.source.includes(`[${entity.symbol}[`));
      return [...scope, self, { text: ' はどのグループに属するかを示す index。' }, ...(targets.length ? [{ text: '一段上の値を観測へ配る。' }] : [])];
    }
    return [...scope, self, { text: ` は与えられるデータ（${entity.dataRole}${entity.unit ? `, ${entity.unit}` : ''}）。モデルはこれを生成しない。` }];
  }
  if (entity.kind === 'deterministic') {
    return [...scope, self, { text: ' は ' }, ...argStory(entity.expression.source, known), { text: ' として決まる。新しい不確かさは加わらない。' }];
  }
  if (entity.kind === 'query') {
    return [{ text: '知りたいのは ' }, self, { text: ' = ' }, ...argStory(entity.expression.source, known), { text: '。' }];
  }
  if (entity.kind !== 'random_variable') return [...scope, self];

  const args = entity.distribution.args;
  const family = findDistribution(entity.distribution.distributionId)?.name ?? entity.distribution.distributionId;
  const location = args.mu?.source ?? args.alpha?.source;
  const scale = args.sigma?.source ?? args.beta?.source ?? args.scale?.source ?? args.b?.source;

  const shapeWords: StoryPart[] = [];
  if (family === 'HalfNormal' && scale) {
    shapeWords.push({ text: '0 以上で、' });
    if (isNumeric(scale)) shapeWords.push({ text: `たいてい ${round(2 * Number(scale))} 以下` });
    else shapeWords.push({ text: '大きさはおよそ ' }, ...argStory(scale, known), { text: ' 程度' });
  } else if ((family === 'Normal' || family === 'StudentT') && location && scale) {
    shapeWords.push(...argStory(location, known), { text: ' のまわりに、幅 ' }, ...argStory(scale, known), { text: ' でばらつく' });
    if (family === 'StudentT') shapeWords.push({ text: `（裾は自由度 ${args.nu?.source ?? '?'} の Student-t で厚い）` });
  } else {
    shapeWords.push({ text: `${family} に従う` });
  }

  if (entity.role === 'observation') {
    const observed = row.observedData;
    return [
      ...scope, { text: '観測 ' }, self, { text: ' は ' }, ...shapeWords, { text: '。' },
      ...(observed ? [{ text: ` 実際の値は ${observed.symbol} として与えられる。` }] : [{ text: ' 観測データとの結び付けがない。' }]),
    ];
  }
  if (row.role === 'hierarchy') {
    const slots = new Set<string>();
    for (const child of row.children) {
      const target = document.entities[child];
      if (target?.kind !== 'random_variable') continue;
      for (const [key, arg] of Object.entries(target.distribution.args)) {
        if (arg.source.trim().replace(/\[.*$/, '') !== entity.symbol) continue;
        slots.add(findDistribution(target.distribution.distributionId)?.params.find((param) => param.name === key)?.role ?? key);
      }
    }
    const effect = slots.has('scale') ? '下の段がどれだけばらつくかを決める' : slots.has('location') ? '下の段の中心を決める' : '下の段の形を決める';
    return [...scope, self, { text: ' は ' }, ...shapeWords, { text: `。${effect}。` }];
  }
  const hyper = row.parents.length > 0;
  return [
    ...scope, self, { text: hyper ? ' は ' : ' について、事前には ' }, ...shapeWords,
    { text: hyper ? '。互いに情報を借りあう（部分プーリング）。' : 'と信じている。' },
  ];
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toPrecision(3).replace(/\.?0+$/, '');
}

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

export interface ShapeView {
  axes: Array<{ axisId: string; symbol: string; size: string; role: 'batch' | 'event'; plate?: string }>;
  text: string;
  /** Nested indexing like alpha[group_id[i]]: i ↦ group_id[i] ↦ j. */
  gathers: Array<{ target: string; via: string; from: string }>;
}

export function shapeFor(entity: ModelEntity, document: ModelDocument): ShapeView {
  const plateByAxis = new Map(Object.values(document.plates).map((plate) => [plate.axisId, plate.id]));
  const axes = entity.valueType.axes.map((use) => {
    const axis = document.axes[use.axisId];
    return {
      axisId: use.axisId,
      symbol: axis?.symbol ?? use.axisId,
      size: axis?.size.source ?? '?',
      role: use.role,
      plate: plateByAxis.get(use.axisId),
    };
  });
  const gathers: ShapeView['gathers'] = [];
  const source = entity.kind === 'deterministic' ? entity.expression.source
    : entity.kind === 'random_variable' ? Object.values(entity.distribution.args).map((arg) => arg.source).join(' ')
      : '';
  for (const match of source.matchAll(/([A-Za-z_]\w*)\[([A-Za-z_]\w*)\[([A-Za-z_]\w*)\]\]/g)) {
    gathers.push({ target: match[1]!, via: match[2]!, from: match[3]! });
  }
  const text = axes.length ? axes.map((axis) => axis.size).join(' × ') : 'scalar';
  return { axes, text: `${entity.valueType.scalar}${axes.length ? `[${text}]` : ''}`, gathers };
}

/* ------------------------------------------------------------------ */
/* Support grade: how well-founded is this statement?                 */
/* ------------------------------------------------------------------ */

export type SupportGrade = 'given' | 'derived' | 'stated' | 'reasoned' | 'checked' | 'contested';

export const SUPPORT_LABEL: Record<SupportGrade, string> = {
  given: 'データ',
  derived: '導出',
  stated: '仮定のみ',
  reasoned: '根拠あり',
  checked: '検証済み',
  contested: '疑義あり',
};

/**
 * How an Evidence bundle relates to the current specification:
 * - implementation: run against exactly this document
 * - semantic: run against a document with the same probabilistic model, written differently
 * - stale: run against a different model
 */
export type EvidenceMatch = 'implementation' | 'semantic' | 'stale';

export interface SpecificationKeys {
  implementation: string;
  semantic: string;
  /** Implementation fingerprint → semantic fingerprint, for documents seen in this browser. */
  semanticOf: Readonly<Record<string, string>>;
}

export function evidenceMatch(bundle: ModelEvidenceBundle, keys: SpecificationKeys): EvidenceMatch {
  if (bundle.specificationFingerprint === keys.implementation) return 'implementation';
  return keys.semanticOf[bundle.specificationFingerprint] === keys.semantic ? 'semantic' : 'stale';
}

/** Bundle items that share a semantic fingerprint, keeping first-appearance order. */
export function groupBySemantics<T>(items: readonly T[], semanticOf: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = semanticOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

export interface RowSupport {
  grade: SupportGrade;
  diagnostics: Diagnostic[];
  evidence: Array<{ bundle: ModelEvidenceBundle; match: Exclude<EvidenceMatch, 'stale'>; label: string; status: 'pass' | 'review' | 'fail'; detail?: string }>;
  staleEvidence: number;
  implementation?: ImplementationReceipt['mappings'][number];
}

export function entityPathMatches(path: string, entityId: string): boolean {
  return path === `/entities/${entityId}` || path.startsWith(`/entities/${entityId}/`);
}

export function supportFor(
  row: ScoreRow,
  diagnostics: readonly Diagnostic[],
  evidence: readonly ModelEvidenceBundle[],
  keys: SpecificationKeys,
  receipt: ImplementationReceipt | null,
  receiptMatches: boolean,
  extraFindings: readonly Finding[],
): RowSupport {
  const ids = [row.id, ...(row.observedData ? [row.observedData.id] : [])];
  const ownDiagnostics = diagnostics.filter((item) => ids.some((id) => entityPathMatches(item.path, id)));
  const linked: RowSupport['evidence'] = [];
  let stale = 0;
  for (const bundle of evidence) {
    const metrics = bundle.metrics.filter((metric) => metric.entityIds.some((id) => ids.includes(id)));
    const findings = bundle.findings.filter((finding) => finding.entityIds.some((id) => ids.includes(id)));
    if (!metrics.length && !findings.length) continue;
    const match = evidenceMatch(bundle, keys);
    if (match === 'stale') {
      stale += 1;
      continue;
    }
    for (const metric of metrics) linked.push({ bundle, match, label: `${metric.label}: ${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`, status: metric.status, detail: metric.note });
    for (const finding of findings) linked.push({ bundle, match, label: finding.title, status: finding.severity === 'info' ? 'pass' : finding.severity === 'warning' ? 'review' : 'fail', detail: finding.detail });
  }
  const implementation = receipt && receiptMatches ? receipt.mappings.find((mapping) => ids.includes(mapping.entityId)) : undefined;

  const { entity } = row;
  let grade: SupportGrade;
  const contested = ownDiagnostics.some((item) => item.severity !== 'info')
    || linked.some((item) => item.status !== 'pass')
    || extraFindings.some((finding) => finding.entityIds.includes(row.id));
  if (entity.kind === 'data') grade = contested ? 'contested' : 'given';
  else if (contested) grade = 'contested';
  else if (linked.length) grade = 'checked';
  else if (entity.kind === 'deterministic' || entity.kind === 'query') grade = 'derived';
  else if (entity.kind === 'random_variable' && entity.priorRationale) grade = 'reasoned';
  else grade = 'stated';
  return { grade, diagnostics: ownDiagnostics, evidence: linked, staleEvidence: stale, implementation };
}

/* ------------------------------------------------------------------ */
/* Findings the score itself raises (beyond compiler diagnostics)     */
/* ------------------------------------------------------------------ */

export interface Finding {
  id: string;
  title: string;
  detail: string;
  entityIds: string[];
  fix?: { label: string; operations: JsonPatchOperation[] };
}

/**
 * A plate's own axis and a separately declared shape axis can end up both
 * attached to one entity (e.g. alpha: [j, group]), which describes a J × GROUP
 * tensor rather than a vector over groups.
 */
export function findDuplicateAxes(document: ModelDocument): Finding[] {
  const findings: Finding[] = [];
  for (const plate of Object.values(document.plates)) {
    const members = Object.values(document.entities).filter((entity) => entity.plateIds.includes(plate.id));
    const partners = new Set<string>();
    let consistent = true;
    for (const entity of members) {
      const batch = entity.valueType.axes.filter((use) => use.role === 'batch').map((use) => use.axisId);
      if (!batch.includes(plate.axisId)) continue;
      const others = batch.filter((axisId) => axisId !== plate.axisId && !Object.values(document.plates).some((other) => other.axisId === axisId));
      if (others.length > 1) consistent = false;
      others.forEach((axisId) => partners.add(axisId));
    }
    if (!consistent || partners.size !== 1) continue;
    const keep = [...partners][0]!;
    const affected = members.filter((entity) => entity.valueType.axes.some((use) => use.axisId === plate.axisId));
    const operations: JsonPatchOperation[] = [
      { op: 'replace', path: `/plates/${plate.id}/axisId`, value: keep },
    ];
    for (const entity of affected) {
      const axes = entity.valueType.axes
        .map((use) => (use.axisId === plate.axisId ? { ...use, axisId: keep } : use))
        .filter((use, index, list) => list.findIndex((other) => other.axisId === use.axisId) === index);
      operations.push({ op: 'replace', path: `/entities/${entity.id}/valueType/axes`, value: axes });
    }
    const stillUsed = Object.values(document.entities).some((entity) => !affected.includes(entity) && entity.valueType.axes.some((use) => use.axisId === plate.axisId));
    if (!stillUsed) operations.push({ op: 'remove', path: `/axes/${plate.axisId}` });
    const keepAxis = document.axes[keep];
    const plateAxis = document.axes[plate.axisId];
    findings.push({
      id: `dup-axis-${plate.id}`,
      title: `plate「${plate.label}」の軸が二重になっている`,
      detail: `${affected.filter((entity) => entity.valueType.axes.length > 1).map((entity) => entity.symbol).join(', ')} は軸 ${keepAxis?.symbol ?? keep} と ${plateAxis?.symbol ?? plate.axisId} を両方持つため、shape が ${keepAxis?.symbol ?? keep} × ${plateAxis?.symbol ?? plate.axisId} の行列として解釈される。同じ反復なら軸を ${keepAxis?.symbol ?? keep} に統合する。`,
      entityIds: affected.filter((entity) => entity.valueType.axes.length > 1).map((entity) => entity.id),
      fix: { label: `軸を ${keepAxis?.symbol ?? keep} に統合`, operations },
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Criticism: questions a statement should provoke                    */
/* ------------------------------------------------------------------ */

export interface Question {
  id: string;
  ask: string;
  why: string;
  /** Alternatives are forks: the current model is kept as the baseline. */
  alternative?: { label: string; operations: JsonPatchOperation[]; variantLabel: string };
  /** Edits refine the current model in place (undoable). */
  edit?: { label: string; operations: JsonPatchOperation[] };
  needsText?: { label: string; placeholder: string; build: (text: string) => JsonPatchOperation[] };
}

function scaleArgOf(call: DistributionCall): string | undefined {
  return ['sigma', 'scale', 'b', 'beta'].find((key) => isNumeric(call.args[key]?.source) && key in call.args);
}

export function questionsFor(row: ScoreRow, document: ModelDocument): Question[] {
  const { entity } = row;
  const out: Question[] = [];
  const base = `/entities/${entity.id}`;
  if (entity.kind === 'random_variable') {
    const rv = entity as RandomVariableEntity;
    if (row.role === 'hierarchy' && rv.valueType.domain?.kind === 'positive') {
      const childSymbols = row.children.map((child) => document.entities[child]?.symbol).filter(Boolean).join(', ');
      out.push({
        id: 'pooling',
        ask: `${entity.symbol} が 0 付近なら ${childSymbols} は完全にプールされる。グループ数が少ないとき、このばらつきは識別できるか？`,
        why: '階層の scale は funnel を作りやすく、centered 実装ではサンプリングが壊れる。',
        edit: rv.hints?.some((hint) => hint.kind === 'parameterization') ? undefined : {
          label: `${childSymbols} を non-centered で実装すると明示`,
          operations: row.children.filter((child) => document.entities[child]?.kind === 'random_variable').map((child) => {
            const target = document.entities[child] as RandomVariableEntity;
            return { op: 'add' as const, path: `/entities/${child}/hints`, value: [...(target.hints ?? []), { kind: 'parameterization', value: 'non_centered' }] };
          }),
        },
      });
    }
    if (rv.role === 'parameter' && row.parents.some((parent) => document.entities[parent]?.kind === 'random_variable') && rv.distribution.distributionId === 'normal') {
      out.push({
        id: 'need-hierarchy',
        ask: '階層は本当に必要か？ グループ間で情報を借りない場合と結論は変わるか？',
        why: '部分プーリングは小さいグループを全体平均へ引き寄せる。その引き寄せが推論を決めていないか確認する。',
        alternative: {
          label: 'プールなし案を作る',
          variantLabel: 'プールなし',
          operations: [
            { op: 'replace', path: `${base}/distribution/args/mu/source`, value: '0' },
            { op: 'replace', path: `${base}/distribution/args/sigma/source`, value: '2' },
          ],
        },
      });
    }
    if (rv.role === 'observation' && rv.distribution.distributionId === 'normal') {
      out.push({
        id: 'tails',
        ask: '尤度の裾は十分か？ 外れ値1つで結論が動かないか？',
        why: 'Normal 観測は外れ値を平均へ強く引き込む。Student-t にして結論が変わるなら、仮定に依存している。',
        alternative: {
          label: 'Student-t 観測の案を作る',
          variantLabel: 'Student-t 観測',
          operations: [
            { op: 'replace', path: `${base}/distribution/distributionId`, value: 'student_t' },
            { op: 'add', path: `${base}/distribution/args/nu`, value: { language: 'bayes-expr@1', source: '4' } },
          ],
        },
      });
    }
    if (rv.role === 'observation' && !rv.observationProcess) {
      out.push({
        id: 'missingness',
        ask: `${entity.symbol} に欠測・打ち切り・丸めはないか？`,
        why: '観測過程が未宣言だと、実装側は「完全に観測された」と暗黙に仮定する。',
        edit: { label: '欠測なし（exact）と明示', operations: [{ op: 'add', path: `${base}/observationProcess`, value: { kind: 'exact' } }] },
      });
    }
    const scaleArg = scaleArgOf(rv.distribution);
    if (rv.role !== 'observation' && scaleArg) {
      const value = Number(rv.distribution.args[scaleArg]!.source);
      out.push({
        id: 'scale',
        ask: `scale ${value} は、データの単位で見て妥当か？`,
        why: '数値の prior scale はデータの単位（標準化の有無）に依存する。2倍・半分で結論が変わるなら、prior が推論を支配している。',
        alternative: {
          label: `scale × 2 の案を作る`,
          variantLabel: `${entity.symbol} scale ×2`,
          operations: [{ op: 'replace', path: `${base}/distribution/args/${scaleArg}/source`, value: String(value * 2) }],
        },
      });
    }
    if (rv.role !== 'observation' && !rv.priorRationale) {
      out.push({
        id: 'intent',
        ask: 'この prior は何を表しているつもりか？',
        why: '意図が書かれていない prior は、後から「なぜこの値か」を検証できない。',
        needsText: {
          label: 'prior の意図を記録',
          placeholder: '例: 標準化した y で、グループ差はおよそ ±2 以内と考える',
          build: (text) => [{ op: 'add', path: `${base}/priorRationale`, value: text }],
        },
      });
    }
    if (rv.role === 'parameter' && !hasQuery(document, entity.symbol)) {
      out.push({
        id: 'estimand',
        ask: `${entity.symbol} は知りたい量そのものか、それとも途中の量か？`,
        why: '推定目標（QoI）が宣言されていないと、どの事後分布を報告すべきか実装側が推測することになる。',
        edit: { label: `${entity.symbol} を推定目標にする`, operations: queryOperations(document, entity.symbol) },
      });
    }
  }
  return out;
}

function hasQuery(document: ModelDocument, symbol: string): boolean {
  return Object.values(document.entities).some((entity) => entity.kind === 'query' && entity.expression.source.trim() === symbol);
}

export function queryOperations(document: ModelDocument, symbol: string): JsonPatchOperation[] {
  let id = `qoi_${symbol}`;
  while (document.entities[id]) id = `${id}_`;
  return [
    {
      op: 'add',
      path: `/entities/${id}`,
      value: {
        id,
        kind: 'query',
        symbol: id,
        label: `${symbol} の事後分布`,
        queryRole: 'quantity_of_interest',
        expression: { language: 'bayes-expr@1', source: symbol },
        valueType: { scalar: 'real', axes: [] },
        plateIds: [],
        authorship: 'user',
      },
    },
    { op: 'add', path: '/entityOrder/-', value: id },
  ];
}

/* ------------------------------------------------------------------ */
/* Meaning diff: what changed in what the model *says*               */
/* ------------------------------------------------------------------ */

export type MeaningKind = 'prior' | 'observation' | 'hierarchy' | 'index' | 'estimand' | 'assumption' | 'implementation' | 'structure';

export const MEANING_LABEL: Record<MeaningKind, string> = {
  prior: 'priorの信念',
  observation: '観測モデル',
  hierarchy: '階層',
  index: 'index・shape',
  estimand: '推定目標',
  assumption: '仮定・根拠',
  implementation: '実装方針',
  structure: '構造',
};

export interface MeaningChange {
  kind: MeaningKind;
  entityId?: string;
  sentence: string;
}

export function meaningDiff(before: ModelDocument, after: ModelDocument): MeaningChange[] {
  const out: MeaningChange[] = [];
  const symbols = (document: ModelDocument) => new Set(Object.values(document.entities).map((entity) => entity.symbol));
  const beforeSymbols = symbols(before);
  const afterSymbols = symbols(after);
  const refsRandom = (call: DistributionCall, document: ModelDocument, known: Set<string>) =>
    Object.values(call.args).some((arg) => {
      const base = arg.source.trim().replace(/\[.*$/, '');
      return known.has(base) && Object.values(document.entities).some((entity) => entity.symbol === base && entity.kind === 'random_variable');
    });

  for (const item of diffModelDocuments(before, after)) {
    const left = item.entityId ? before.entities[item.entityId] : undefined;
    const right = item.entityId ? after.entities[item.entityId] : undefined;
    switch (item.kind) {
      case 'entity_distribution_changed': {
        if (left?.kind !== 'random_variable' || right?.kind !== 'random_variable') break;
        const observation = right.role === 'observation';
        const a = left.distribution;
        const b = right.distribution;
        if (a.distributionId !== b.distributionId) {
          const from = findDistribution(a.distributionId)?.name ?? a.distributionId;
          const to = findDistribution(b.distributionId)?.name ?? b.distributionId;
          const tail = b.distributionId === 'student_t' ? `。裾が厚くなり、外れ値の影響が弱まる（ν = ${b.args.nu?.source ?? '?'}）` : '';
          out.push({ kind: observation ? 'observation' : 'prior', entityId: right.id, sentence: `${right.symbol} の分布を ${from} から ${to} へ${tail}。` });
          break;
        }
        const hierBefore = refsRandom(a, before, beforeSymbols);
        const hierAfter = refsRandom(b, after, afterSymbols);
        if (hierBefore && !hierAfter) {
          out.push({ kind: 'hierarchy', entityId: right.id, sentence: `${right.symbol} が上位パラメータを参照しなくなった。グループは互いに情報を借りない（プールなし）。` });
          break;
        }
        if (!hierBefore && hierAfter) {
          out.push({ kind: 'hierarchy', entityId: right.id, sentence: `${right.symbol} が上位パラメータから生成されるようになった（部分プーリング）。` });
          break;
        }
        for (const key of new Set([...Object.keys(a.args), ...Object.keys(b.args)])) {
          const x = a.args[key]?.source;
          const y = b.args[key]?.source;
          if (x === y) continue;
          const ratio = isNumeric(x) && isNumeric(y) && Number(x) !== 0 ? Number(y) / Number(x) : undefined;
          const role = findDistribution(b.distributionId)?.params.find((param) => param.name === key)?.role;
          const direction = ratio === undefined ? '' : role === 'scale' ? (ratio > 1 ? `（×${round(ratio)}、より広い）` : `（×${round(ratio)}、より強く縮める）`) : '';
          out.push({ kind: observation ? 'observation' : 'prior', entityId: right.id, sentence: `${right.symbol} の ${key}: ${x ?? '—'} → ${y ?? '—'}${direction}。` });
        }
        break;
      }
      case 'observation_process_changed':
        out.push({ kind: 'assumption', entityId: item.entityId, sentence: `${right?.symbol ?? item.entityId} の観測過程を ${describeProcess(item.after)} と宣言。` });
        break;
      case 'observation_binding_changed':
        out.push({ kind: 'observation', entityId: item.entityId, sentence: `${right?.symbol ?? item.entityId} が結び付く観測データが変わった。` });
        break;
      case 'hint_changed':
        out.push({ kind: 'implementation', entityId: item.entityId, sentence: `${right?.symbol ?? item.entityId} の実装方針: ${describeHints(item.after)}。確率モデル自体は変わらない。` });
        break;
      case 'entity_added':
        if (right?.kind === 'query') out.push({ kind: 'estimand', entityId: right.id, sentence: `推定目標に ${right.expression.source} を追加。` });
        else out.push({ kind: 'structure', entityId: item.entityId, sentence: `${right?.symbol ?? item.entityId} を追加。` });
        break;
      case 'entity_removed':
        out.push({ kind: left?.kind === 'query' ? 'estimand' : 'structure', entityId: item.entityId, sentence: `${left?.symbol ?? item.entityId} を削除。` });
        break;
      case 'query_contract_changed':
        out.push({ kind: 'estimand', entityId: item.entityId, sentence: `${right?.symbol ?? item.entityId} の推定目標の契約が変わった。` });
        break;
      case 'entity_value_type_changed':
      case 'entity_plate_scope_changed':
        out.push({ kind: 'index', entityId: item.entityId, sentence: `${right?.symbol ?? item.entityId} の shape・反復範囲が変わった（${axisText(left, before)} → ${axisText(right, after)}）。` });
        break;
      case 'axis_changed':
      case 'plate_changed':
        out.push({ kind: 'index', sentence: `${item.kind === 'axis_changed' ? '軸' : 'plate'} ${item.path.split('/').pop()} を${item.before === undefined ? '追加' : item.after === undefined ? '削除' : '変更'}。` });
        break;
      case 'entity_expression_changed':
        out.push({ kind: 'structure', entityId: item.entityId, sentence: `${right?.symbol ?? item.entityId} の式が変わった。` });
        break;
      case 'note_changed':
        out.push({ kind: 'assumption', sentence: 'モデルノート（仮定・判断）が変わった。' });
        break;
      default:
        out.push({ kind: 'structure', entityId: item.entityId, sentence: item.label });
    }
  }
  // priorRationale is not part of the semantic diff, but it changes what the model claims to mean.
  for (const [id, right] of Object.entries(after.entities)) {
    const left = before.entities[id];
    if (left?.kind === 'random_variable' && right.kind === 'random_variable' && left.priorRationale !== right.priorRationale) {
      out.push({ kind: 'assumption', entityId: id, sentence: `${right.symbol} の prior の意図${left.priorRationale ? 'を書き換え' : 'を記録'}: 「${right.priorRationale ?? '（削除）'}」` });
    }
  }
  return out;
}

function axisText(entity: ModelEntity | undefined, document: ModelDocument): string {
  if (!entity) return '—';
  return entity.valueType.axes.length ? entity.valueType.axes.map((use) => document.axes[use.axisId]?.symbol ?? use.axisId).join(' × ') : 'scalar';
}

function describeProcess(value: unknown): string {
  if (value && typeof value === 'object' && 'kind' in value) {
    const kind = (value as { kind: string }).kind;
    return kind === 'exact' ? '欠測なし（exact）' : kind;
  }
  return '未宣言';
}

function describeHints(value: unknown): string {
  if (!Array.isArray(value)) return 'なし';
  return value.map((hint) => (hint.kind === 'parameterization' ? `${hint.value === 'non_centered' ? 'non-centered' : 'centered'} parameterization` : hint.kind)).join(', ');
}
