import type { Diagnostic, JsonPatchOperation } from './core/diagnostics.js';
import type { ModelDocument, ModelEntity } from './core/model.js';

export const EVIDENCE_VERSION = 'bayes-canvas-evidence@2' as const;
export type EvidenceVersion = 'bayes-canvas-evidence@1' | typeof EVIDENCE_VERSION;

export type EvidenceRunType =
  | 'prior_predictive'
  | 'simulation_recovery'
  | 'prior_sensitivity'
  | 'posterior_inference'
  | 'posterior_predictive'
  | 'calibration';

export interface EvidenceMetric {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  status: 'pass' | 'review' | 'fail';
  entityIds: string[];
  note?: string;
}

export interface EvidenceFinding {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  entityIds: string[];
  suggestedPatch?: JsonPatchOperation[];
}

/** Summary of one quantity's prior or posterior draws (@2). */
export interface EvidenceQuantity {
  entityId: string;
  distribution: 'prior' | 'posterior';
  q05: number;
  q50: number;
  q95: number;
  q25?: number;
  q75?: number;
  mean?: number;
  sd?: number;
  draws?: number;
}

/** Predictive performance and sampler health of a posterior fit (@2). */
export interface EvidenceAssessment {
  elpdLoo?: number;
  elpdLooSe?: number;
  stackingWeight?: number;
  divergences?: number;
  maxRhat?: number;
  minEssBulk?: number;
}

export interface ModelEvidenceBundle {
  evidenceVersion: EvidenceVersion;
  specificationFingerprint: string;
  runType: EvidenceRunType;
  createdAt: string;
  backend: string;
  status: 'passed' | 'review' | 'failed';
  metrics: EvidenceMetric[];
  findings: EvidenceFinding[];
  notes: string[];
  /** @2 only. */
  quantities?: EvidenceQuantity[];
  /** @2 only. */
  assessment?: EvidenceAssessment;
}

export interface SensitivityScenario {
  id: string;
  label: string;
  rationale: string;
  entityIds: string[];
  operations: JsonPatchOperation[];
}

export interface ModelScoreDimension {
  id: 'data' | 'priors' | 'identification' | 'estimands' | 'portability';
  label: string;
  score: number;
  status: 'ready' | 'review' | 'blocked';
  detail: string;
}

export interface ModelScorecard {
  overall: number;
  status: 'ready' | 'review' | 'blocked';
  dimensions: ModelScoreDimension[];
}

const STORAGE_KEY = 'bayes-canvas:model-evidence';
const STORAGE_BUDGET_BYTES = 2 * 1024 * 1024;
const RUN_TYPES_V1 = new Set<EvidenceRunType>([
  'prior_predictive',
  'simulation_recovery',
  'prior_sensitivity',
  'posterior_predictive',
  'calibration',
]);
const RUN_TYPES_V2 = new Set<EvidenceRunType>([...RUN_TYPES_V1, 'posterior_inference']);

export function validateModelEvidence(value: unknown): ModelEvidenceBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EvidenceはJSON objectで指定してください。');
  }
  const candidate = value as Partial<ModelEvidenceBundle>;
  const version = candidate.evidenceVersion;
  if (version !== 'bayes-canvas-evidence@1' && version !== EVIDENCE_VERSION) {
    throw new Error(`evidenceVersionは${EVIDENCE_VERSION}（または旧形式のbayes-canvas-evidence@1）を指定してください。`);
  }
  if (!candidate.specificationFingerprint) throw new Error('specificationFingerprintがありません。');
  const runTypes = version === EVIDENCE_VERSION ? RUN_TYPES_V2 : RUN_TYPES_V1;
  if (!candidate.runType || !runTypes.has(candidate.runType)) throw new Error('未対応のrunTypeです。');
  if (!candidate.createdAt || Number.isNaN(Date.parse(candidate.createdAt))) throw new Error('createdAtはISO日時で指定してください。');
  if (!candidate.backend) throw new Error('backendがありません。');
  if (!['passed', 'review', 'failed'].includes(String(candidate.status))) throw new Error('statusが不正です。');
  if (!Array.isArray(candidate.metrics) || !Array.isArray(candidate.findings)) {
    throw new Error('metricsとfindingsはarrayで指定してください。');
  }
  const metrics = candidate.metrics.map((metric, index) => validateMetric(metric, index));
  const findings = candidate.findings.map((finding, index) => validateFinding(finding, index));
  // @1 has no quantities or assessment; fields an @1 producer adds anyway are not read.
  const v2 = version === EVIDENCE_VERSION ? {
    quantities: candidate.quantities === undefined ? [] : validateQuantities(candidate.quantities),
    ...(candidate.assessment === undefined ? {} : { assessment: validateAssessment(candidate.assessment) }),
  } : {};
  return {
    evidenceVersion: version,
    specificationFingerprint: candidate.specificationFingerprint,
    runType: candidate.runType,
    createdAt: candidate.createdAt,
    backend: candidate.backend,
    status: candidate.status as ModelEvidenceBundle['status'],
    metrics,
    findings,
    notes: Array.isArray(candidate.notes) ? candidate.notes.filter((note): note is string => typeof note === 'string') : [],
    ...v2,
  };
}

function validateQuantities(value: unknown): EvidenceQuantity[] {
  if (!Array.isArray(value)) throw new Error('quantitiesはarrayで指定してください。');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`quantity ${index}がobjectではありません。`);
    const quantity = item as Partial<EvidenceQuantity>;
    if (!quantity.entityId || typeof quantity.entityId !== 'string') throw new Error(`quantity ${index}にentityIdがありません。`);
    if (quantity.distribution !== 'prior' && quantity.distribution !== 'posterior') {
      throw new Error(`quantity ${index}のdistributionはpriorかposteriorを指定してください。`);
    }
    const { q05, q50, q95 } = quantity;
    if (!isFiniteNumber(q05) || !isFiniteNumber(q50) || !isFiniteNumber(q95) || q05 > q50 || q50 > q95) {
      throw new Error(`quantity ${index}のq05・q50・q95は q05 ≤ q50 ≤ q95 の数値で指定してください。`);
    }
    const optional = (key: 'q25' | 'q75' | 'mean' | 'sd' | 'draws') => {
      const field = quantity[key];
      if (field === undefined) return {};
      if (!isFiniteNumber(field)) throw new Error(`quantity ${index}の${key}が数値ではありません。`);
      return { [key]: field };
    };
    return {
      entityId: quantity.entityId,
      distribution: quantity.distribution,
      q05,
      q50,
      q95,
      ...optional('q25'),
      ...optional('q75'),
      ...optional('mean'),
      ...optional('sd'),
      ...optional('draws'),
    };
  });
}

function validateAssessment(value: unknown): EvidenceAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('assessmentはobjectで指定してください。');
  const assessment = value as Record<string, unknown>;
  const result: EvidenceAssessment = {};
  for (const key of ['elpdLoo', 'elpdLooSe', 'stackingWeight', 'divergences', 'maxRhat', 'minEssBulk'] as const) {
    const field = assessment[key];
    if (field === undefined) continue;
    if (!isFiniteNumber(field)) throw new Error(`assessment.${key}が数値ではありません。`);
    result[key] = field;
  }
  if (result.stackingWeight !== undefined && (result.stackingWeight < 0 || result.stackingWeight > 1)) {
    throw new Error('assessment.stackingWeightは0から1の値で指定してください。');
  }
  if (result.divergences !== undefined && (result.divergences < 0 || !Number.isInteger(result.divergences))) {
    throw new Error('assessment.divergencesは0以上の整数で指定してください。');
  }
  return result;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function loadModelEvidence(): ModelEvidenceBundle[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      try {
        return [validateModelEvidence(entry)];
      } catch {
        return [];
      }
    }).slice(0, 30);
  } catch {
    return [];
  }
}

export function persistModelEvidence(evidence: ModelEvidenceBundle[]): ModelEvidenceBundle[] {
  const bounded = evidence.slice(0, 30);
  while (bounded.length > 1 && encodedLength(JSON.stringify(bounded)) > STORAGE_BUDGET_BYTES) {
    bounded.pop();
  }
  while (bounded.length) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
      return bounded;
    } catch {
      if (bounded.length === 1) {
        throw new Error('Evidenceをブラウザへ保存できません。JSONをコピーしてから古いEvidenceを削除してください。');
      }
      bounded.pop();
    }
  }
  localStorage.removeItem(STORAGE_KEY);
  return [];
}

export function buildSensitivityScenarios(document: ModelDocument): SensitivityScenario[] {
  const scenarios: SensitivityScenario[] = [];
  for (const entity of Object.values(document.entities)) {
    if (entity.kind !== 'random_variable' || entity.role === 'observation') continue;
    const scaleArgument = ['sigma', 'scale', 'b']
      .find((argument) => isPositiveNumberSource(entity.distribution.args[argument]?.source));
    if (!scaleArgument) continue;
    const value = Number(entity.distribution.args[scaleArgument]!.source);
    for (const factor of [0.5, 2]) {
      scenarios.push({
        id: `${entity.id}-${scaleArgument}-${factor}`,
        label: `${entity.symbol}: ${scaleArgument} × ${factor}`,
        rationale: factor < 1 ? 'より強い収縮への感度' : 'より弱い収縮・広いtailへの感度',
        entityIds: [entity.id],
        operations: [{
          op: 'replace',
          path: `/entities/${escapePointer(entity.id)}/distribution/args/${escapePointer(scaleArgument)}/source`,
          value: String(value * factor),
        }],
      });
    }
  }
  for (const entity of Object.values(document.entities)) {
    if (
      entity.kind !== 'random_variable'
      || entity.role !== 'observation'
      || entity.distribution.distributionId !== 'normal'
    ) continue;
    scenarios.push({
      id: `${entity.id}-student-t`,
      label: `${entity.symbol}: Student-t観測`,
      rationale: '外れ値と厚いtailに対する尤度感度',
      entityIds: [entity.id],
      operations: [
        {
          op: 'replace',
          path: `/entities/${escapePointer(entity.id)}/distribution/distributionId`,
          value: 'student_t',
        },
        {
          op: 'add',
          path: `/entities/${escapePointer(entity.id)}/distribution/args/nu`,
          value: { language: 'bayes-expr@1', source: '4' },
        },
      ],
    });
  }
  return scenarios.slice(0, 16);
}

export function buildModelScorecard(
  document: ModelDocument,
  diagnostics: readonly Diagnostic[],
): ModelScorecard {
  const entities = Object.values(document.entities);
  const observations = entities.filter(isObservation);
  const parameters = entities.filter(isParameter);
  const queries = entities.filter(isQuery);
  const causalBlocks = entities.filter(isCausalBlock);
  const blocking = diagnostics.filter((item) => item.blocksHandoff);
  const dimensions: ModelScoreDimension[] = [
    dimension(
      'data',
      'Data binding',
      ratioScore(observations.filter((entity) => entity.observedDataId).length, Math.max(observations.length, 1)),
      observations.length
        ? `${observations.filter((entity) => entity.observedDataId).length}/${observations.length} likelihoods bound`
        : '観測尤度がありません。',
      observations.length === 0,
    ),
    dimension(
      'priors',
      'Prior intent',
      ratioScore(parameters.filter((entity) => entity.priorRationale).length, Math.max(parameters.length, 1)),
      `${parameters.filter((entity) => entity.priorRationale).length}/${parameters.length} priors have rationale`,
      parameters.length === 0,
    ),
    dimension(
      'identification',
      'Identification',
      blocking.some((item) => ['statistical', 'shape', 'support', 'graph'].includes(item.stage)) ? 20 : 100,
      blocking.length ? `${blocking.length} blocking diagnostics` : 'blocking diagnosticなし',
      blocking.some((item) => ['statistical', 'shape', 'support', 'graph'].includes(item.stage)),
    ),
    dimension(
      'estimands',
      'Estimand / QoI',
      queries.length || causalBlocks.length ? 100 : 0,
      `${queries.length} QoI / ${causalBlocks.length} causal estimand`,
      false,
    ),
    dimension(
      'portability',
      'Handoff',
      blocking.length ? Math.max(0, 100 - blocking.length * 20) : 100,
      blocking.length ? `${blocking.length}件がhandoffを停止` : 'handoff可能',
      blocking.length > 0,
    ),
  ];
  const overall = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length);
  return {
    overall,
    status: dimensions.some((item) => item.status === 'blocked')
      ? 'blocked'
      : dimensions.some((item) => item.status === 'review')
        ? 'review'
        : 'ready',
    dimensions,
  };
}

export function generateCriticismPrompt(
  document: ModelDocument,
  specificationFingerprint: string,
  scenarios: readonly SensitivityScenario[],
): string {
  const now = new Date().toISOString();
  return [
    'Evaluate this Bayes Canvas specification in an executable Bayesian environment.',
    'Run the checks that are feasible. Do not claim a check was run when it was only inspected.',
    `Preserve entity IDs. Return exactly one JSON object matching ${EVIDENCE_VERSION}.`,
    'Use suggestedPatch only for RFC 6902 operations against this exact ModelDocument.',
    'quantities: for each quantity of interest (query entities, or the parameters if there are none), summarize the draws you actually computed.',
    'Use distribution "posterior" only when posterior inference was run; prior draws are "prior".',
    'assessment: include only after posterior inference (PSIS-LOO elpd and SE, stacking weight among compared models, divergences, max R-hat, min bulk ESS). Omit fields you did not compute.',
    '',
    'Required JSON shape:',
    '```json',
    JSON.stringify({
      evidenceVersion: EVIDENCE_VERSION,
      specificationFingerprint,
      runType: 'prior_predictive',
      createdAt: now,
      backend: 'numpyro',
      status: 'review',
      metrics: [{
        id: 'prior-range-y',
        label: 'Prior predictive y range',
        value: 'p01=-2.1, p99=2.4',
        unit: '',
        status: 'pass',
        entityIds: ['replace-with-entity-id'],
        note: 'What was actually computed.',
      }],
      findings: [{
        id: 'finding-1',
        severity: 'warning',
        title: 'Concise finding',
        detail: 'Evidence and consequence.',
        entityIds: ['replace-with-entity-id'],
        suggestedPatch: [],
      }],
      notes: [],
      quantities: [{
        entityId: 'replace-with-entity-id',
        distribution: 'prior',
        q05: -1.6,
        q50: 0,
        q95: 1.6,
        draws: 4000,
      }],
      assessment: {
        elpdLoo: -123.4,
        elpdLooSe: 5.6,
        divergences: 0,
        maxRhat: 1.003,
        minEssBulk: 812,
      },
    }, null, 2),
    '```',
    '',
    'Minimum protocol:',
    '- prior predictive: units, impossible values, central range, tails, and group-level spread',
    '- simulation recovery: parameter bias/coverage when a simulator can be run',
    '- sensitivity: compare the listed scenarios with the baseline on QoIs',
    '- posterior predictive or calibration only if posterior inference was actually run',
    '',
    'Sensitivity scenarios:',
    ...scenarios.map((scenario) => `- ${scenario.id}: ${scenario.label}; ${scenario.rationale}; patch=${JSON.stringify(scenario.operations)}`),
    '',
    'ModelDocument:',
    '```json',
    JSON.stringify(document, null, 2),
    '```',
  ].join('\n');
}

export function generateModelCardMarkdown(
  document: ModelDocument,
  diagnostics: readonly Diagnostic[],
  scorecard: ModelScorecard,
  evidence: readonly ModelEvidenceBundle[],
): string {
  const entities = Object.values(document.entities);
  const data = entities.filter((entity): entity is Extract<ModelEntity, { kind: 'data' }> => entity.kind === 'data');
  const parameters = entities.filter(isParameter);
  const observations = entities.filter(isObservation);
  const queries = entities.filter(isQuery);
  return [
    `# ${document.model.name}`,
    '',
    document.model.intent ? `**Intent:** ${document.model.intent}` : '',
    document.model.description ?? '',
    '',
    `**Model readiness:** ${scorecard.overall}/100 (${scorecard.status})`,
    '',
    '## Scorecard',
    '',
    ...scorecard.dimensions.map((item) => `- **${item.label}: ${item.score}/100** — ${item.detail}`),
    '',
    '## Data contract',
    '',
    ...data.map((entity) => `- \`${entity.symbol}\`: ${entity.dataRole}; ${formatValueType(entity.valueType)}${entity.unit ? `; unit=${entity.unit}` : ''}`),
    '',
    '## Priors',
    '',
    ...parameters.map((entity) => `- \`${entity.symbol}\` ~ ${entity.distribution.distributionId}(${formatArgs(entity.distribution.args)})${entity.priorRationale ? ` — ${entity.priorRationale}` : ' — rationale未記入'}`),
    '',
    '## Observation model',
    '',
    ...observations.map((entity) => `- \`${entity.symbol}\` ~ ${entity.distribution.distributionId}; data=${entity.observedDataId ?? 'unbound'}; process=${entity.observationProcess?.kind ?? 'exact'}`),
    '',
    '## Estimands / QoI',
    '',
    ...(queries.length ? queries.map((entity) => `- \`${entity.symbol}\` = ${entity.expression.source} (${entity.queryRole})`) : ['- 未定義']),
    '',
    '## Open diagnostics',
    '',
    ...(diagnostics.length ? diagnostics.map((item) => `- ${item.severity.toUpperCase()} ${item.code}: ${item.message}`) : ['- なし']),
    '',
    '## Validation evidence',
    '',
    ...(evidence.length
      ? evidence.map((item) => `- ${item.createdAt} / ${item.runType} / ${item.backend}: ${item.status}; ${item.metrics.length} metrics, ${item.findings.length} findings`)
      : ['- 未Import']),
  ].join('\n');
}

function validateMetric(value: unknown, index: number): EvidenceMetric {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`metric ${index}がobjectではありません。`);
  const metric = value as Partial<EvidenceMetric>;
  if (!metric.id || !metric.label || !['string', 'number'].includes(typeof metric.value)) {
    throw new Error(`metric ${index}にid, label, valueが必要です。`);
  }
  if (!['pass', 'review', 'fail'].includes(String(metric.status))) throw new Error(`metric ${index}のstatusが不正です。`);
  return {
    id: metric.id,
    label: metric.label,
    value: metric.value!,
    unit: metric.unit,
    status: metric.status as EvidenceMetric['status'],
    entityIds: stringArray(metric.entityIds),
    note: metric.note,
  };
}

function validateFinding(value: unknown, index: number): EvidenceFinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`finding ${index}がobjectではありません。`);
  const finding = value as Partial<EvidenceFinding>;
  if (!finding.id || !finding.title || !finding.detail) throw new Error(`finding ${index}にid, title, detailが必要です。`);
  if (!['info', 'warning', 'critical'].includes(String(finding.severity))) throw new Error(`finding ${index}のseverityが不正です。`);
  return {
    id: finding.id,
    severity: finding.severity as EvidenceFinding['severity'],
    title: finding.title,
    detail: finding.detail,
    entityIds: stringArray(finding.entityIds),
    suggestedPatch: Array.isArray(finding.suggestedPatch) ? finding.suggestedPatch : undefined,
  };
}

function dimension(
  id: ModelScoreDimension['id'],
  label: string,
  score: number,
  detail: string,
  blocked: boolean,
): ModelScoreDimension {
  return {
    id,
    label,
    score,
    detail,
    status: blocked ? 'blocked' : score < 100 ? 'review' : 'ready',
  };
}

function ratioScore(value: number, total: number): number {
  return Math.round((value / total) * 100);
}

function isPositiveNumberSource(value?: string): boolean {
  return value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0;
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function encodedLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function formatValueType(valueType: ModelDocument['entities'][string]['valueType']): string {
  const axes = valueType.axes.map((axis) => `${axis.axisId}:${axis.role}`).join(', ');
  return `${valueType.scalar}${axes ? ` [${axes}]` : ''}`;
}

function formatArgs(args: Record<string, { source: string }>): string {
  return Object.entries(args).map(([key, value]) => `${key}=${value.source}`).join(', ');
}

function isParameter(entity: ModelEntity): entity is Extract<ModelEntity, { kind: 'random_variable' }> {
  return entity.kind === 'random_variable' && entity.role === 'parameter';
}

function isObservation(entity: ModelEntity): entity is Extract<ModelEntity, { kind: 'random_variable' }> {
  return entity.kind === 'random_variable' && entity.role === 'observation';
}

function isQuery(entity: ModelEntity): entity is Extract<ModelEntity, { kind: 'query' }> {
  return entity.kind === 'query';
}

function isCausalBlock(entity: ModelEntity): entity is Extract<ModelEntity, { kind: 'block_instance' }> {
  return entity.kind === 'block_instance' && entity.blockTypeId === 'causal_estimand';
}
