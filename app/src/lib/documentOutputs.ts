import { formatDistributionTex, formatTexExpression } from './distributionRegistry';
import type { SemanticModel } from './core/compiler';
import type { HandoffTarget } from './core/handoff';
import type { ModelDocument, ModelEntity, RandomVariableEntity } from './core/model';

const TARGET_LABELS: Record<HandoffTarget, string> = {
  generic: 'Generic PPL implementation',
  pymc: 'PyMC implementation',
  numpyro: 'NumPyro implementation',
  stan: 'Stan implementation',
  review: 'Model review only',
};

export function generateAiPromptFromDocument(
  document: ModelDocument,
  semantic: SemanticModel,
  target: HandoffTarget = 'generic',
): string {
  const entities = orderedEntities(document);
  const diagnostics = semantic.diagnostics;
  return [
    target === 'review'
      ? 'Review the following Bayesian model specification for clarity, shape consistency, and implementation risks.'
      : `Implement the following Bayesian model specification for ${TARGET_LABELS[target]}.`,
    '',
    'Non-goals and boundaries:',
    '- Bayes Canvas authors model specifications; it does not run inference.',
    '- Do not add assumptions that are not present in the ModelDocument.',
    '- Preserve stable entity IDs and report deviations.',
    '- Unknown or unsupported external blocks are diagnostic-only unless the handoff explicitly marks them supported.',
    '',
    'Model:',
    `- Name: ${document.model.name}`,
    `- Document ID: ${document.documentId}`,
    `- Revision: ${document.revision}`,
    `- Target: ${TARGET_LABELS[target]}`,
    '',
    'Entities:',
    ...entities.map((entity) => `- ${entity.id}: ${entity.symbol} (${entity.kind})${entitySummary(entity)}`),
    '',
    'Plates:',
    ...Object.values(document.plates).map((plate) => `- ${plate.id}: ${plate.indexSymbol}=1..${plate.axisId}; ${plate.assumption}`),
    '',
    'Semantic dependencies:',
    ...(semantic.dependencyEdges.length
      ? semantic.dependencyEdges.map((edge) => `- ${edge.from} -> ${edge.to} (${edge.role})`)
      : ['- None detected']),
    '',
    'Diagnostics:',
    ...(diagnostics.length
      ? diagnostics.map((diagnostic) => `- ${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.displayPath ?? diagnostic.path}: ${diagnostic.message}`)
      : ['- No diagnostics']),
    '',
    'TeX math block:',
    '```tex',
    generateTexFromDocument(document),
    '```',
    '',
    'ModelDocument JSON:',
    '```json',
    JSON.stringify(document, null, 2),
    '```',
  ].join('\n');
}

export function generateTexFromDocument(document: ModelDocument): string {
  const lines = [
    ...Object.values(document.plates).map((plate) =>
      `${formatTexExpression(plate.indexSymbol)} &\\in \\{1, \\dots, ${formatTexExpression(document.axes[plate.axisId]?.size.source ?? plate.axisId)}\\}`,
    ),
    ...orderedEntities(document).flatMap((entity) => texLinesForEntity(entity)),
  ];
  return ['\\begin{aligned}', ...lines.map((line, index) => `  ${line}${index === lines.length - 1 ? '' : ' \\\\'}`), '\\end{aligned}'].join('\n');
}

function texLinesForEntity(entity: ModelEntity): string[] {
  if (entity.kind === 'random_variable') {
    const lines = [`${formatTexExpression(entity.symbol)} &\\sim ${formatDistributionTex(toDistributionSpec(entity))}`];
    if (entity.transform) {
      const forward = entity.transform.forward?.source ?? entity.transform.kind;
      lines.push(`${formatTexExpression(`T_${entity.symbol}`)} &= ${formatTexExpression(forward)} \\quad \\text{Jacobian: ${texText(entity.transform.jacobianOwner)}}`);
    }
    if (
      entity.observationProcess?.kind === 'missing'
      && entity.observationProcess.mechanism === 'MNAR'
      && entity.observationProcess.selectionModel
    ) {
      lines.push(`${formatTexExpression(`missing_${entity.symbol}`)} &: ${formatTexExpression(entity.observationProcess.selectionModel.source)}`);
    }
    return lines;
  }
  if (entity.kind === 'deterministic') {
    return [`${formatTexExpression(entity.symbol)} &= ${formatTexExpression(entity.expression.source)}`];
  }
  if (entity.kind === 'factor') {
    return [`\\log p_{${formatTexExpression(entity.symbol)}} &+= ${formatTexExpression(entity.logDensity.source)}`];
  }
  if (entity.kind === 'query') {
    return [`${formatTexExpression(entity.symbol)} &= ${formatTexExpression(entity.expression.source)}`];
  }
  if (entity.kind === 'block_instance') {
    const expression = typeof entity.config.expression === 'string'
      ? entity.config.expression
      : entity.blockTypeId;
    return [`${formatTexExpression(entity.symbol)} &:= ${formatTexExpression(expression)} \\quad \\text{${texText(entity.blockTypeId)}}`];
  }
  return [];
}

function texText(value: string): string {
  return value.replaceAll('\\', '\\textbackslash{}').replaceAll('_', '\\_').replaceAll('{', '\\{').replaceAll('}', '\\}');
}

function toDistributionSpec(entity: RandomVariableEntity) {
  return {
    id: entity.distribution.distributionId,
    name: entity.distribution.distributionId,
    args: Object.fromEntries(
      Object.entries(entity.distribution.args).map(([key, value]) => [key, value.source]),
    ),
  };
}

function orderedEntities(document: ModelDocument): ModelEntity[] {
  return document.entityOrder
    .map((entityId) => document.entities[entityId])
    .filter((entity): entity is ModelEntity => Boolean(entity));
}

function entitySummary(entity: ModelEntity): string {
  if (entity.kind === 'random_variable') {
    const transform = entity.transform ? `; transform ${entity.transform.kind}; Jacobian ${entity.transform.jacobianOwner}` : '';
    const observation = entity.observationProcess?.kind === 'missing'
      ? `; missing ${entity.observationProcess.mechanism ?? 'unspecified'}; strategy ${entity.observationProcess.strategy ?? 'unspecified'}${entity.observationProcess.selectionModel ? `; selection ${entity.observationProcess.selectionModel.source}` : ''}`
      : '';
    return `; ${entity.role}; ${entity.distribution.distributionId}${transform}${observation}`;
  }
  if (entity.kind === 'deterministic') return `; ${entity.expression.source}`;
  if (entity.kind === 'factor') return `; ${entity.logDensity.source}`;
  if (entity.kind === 'block_instance') {
    return `; ${entity.blockTypeId}@${entity.blockVersion}; config ${JSON.stringify(entity.config)}`;
  }
  if (entity.kind === 'query') return `; ${entity.expression.source}`;
  return '';
}
