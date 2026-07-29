import type { Diagnostic, JsonPatchOperation } from './core/diagnostics.js';
import type { ModelDocument, ModelEntity } from './core/model.js';

export type EvidenceRunType =
  | 'prior_predictive'
  | 'simulation_recovery'
  | 'prior_sensitivity'
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

export interface ModelEvidenceBundle {
  evidenceVersion: 'bayes-canvas-evidence@1';
  specificationFingerprint: string;
  runType: EvidenceRunType;
  createdAt: string;
  backend: string;
  status: 'passed' | 'review' | 'failed';
  metrics: EvidenceMetric[];
  findings: EvidenceFinding[];
  notes: string[];
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
const RUN_TYPES = new Set<EvidenceRunType>([
  'prior_predictive',
  'simulation_recovery',
  'prior_sensitivity',
  'posterior_predictive',
  'calibration',
]);

export function validateModelEvidence(value: unknown): ModelEvidenceBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EvidenceはJSON objectで指定してください。');
  }
  const candidate = value as Partial<ModelEvidenceBundle>;
  if (candidate.evidenceVersion !== 'bayes-canvas-evidence@1') {
    throw new Error('evidenceVersionはbayes-canvas-evidence@1を指定してください。');
  }
  if (!candidate.specificationFingerprint) throw new Error('specificationFingerprintがありません。');
  if (!candidate.runType || !RUN_TYPES.has(candidate.runType)) throw new Error('未対応のrunTypeです。');
  if (!candidate.createdAt || Number.isNaN(Date.parse(candidate.createdAt))) throw new Error('createdAtはISO日時で指定してください。');
  if (!candidate.backend) throw new Error('backendがありません。');
  if (!['passed', 'review', 'failed'].includes(String(candidate.status))) throw new Error('statusが不正です。');
  if (!Array.isArray(candidate.metrics) || !Array.isArray(candidate.findings)) {
    throw new Error('metricsとfindingsはarrayで指定してください。');
  }
  const metrics = candidate.metrics.map((metric, index) => validateMetric(metric, index));
  const findings = candidate.findings.map((finding, index) => validateFinding(finding, index));
  return {
    evidenceVersion: 'bayes-canvas-evidence@1',
    specificationFingerprint: candidate.specificationFingerprint,
    runType: candidate.runType,
    createdAt: candidate.createdAt,
    backend: candidate.backend,
    status: candidate.status as ModelEvidenceBundle['status'],
    metrics,
    findings,
    notes: Array.isArray(candidate.notes) ? candidate.notes.filter((note): note is string => typeof note === 'string') : [],
  };
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
    'Preserve entity IDs. Return exactly one JSON object matching bayes-canvas-evidence@1.',
    'Use suggestedPatch only for RFC 6902 operations against this exact ModelDocument.',
    '',
    'Required JSON shape:',
    '```json',
    JSON.stringify({
      evidenceVersion: 'bayes-canvas-evidence@1',
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
