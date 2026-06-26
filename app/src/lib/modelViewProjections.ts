import type { SemanticModel } from './core/compiler.js';
import type { HandoffBundle } from './core/handoff.js';
import type {
  AxisUse,
  EntityId,
  ModelDocument,
  ModelEntity,
  PlateDefinition,
  SourceText,
} from './core/model.js';

export type ModelViewProjectionId = 'canvas' | 'story' | 'equations' | 'structure' | 'contract';

export interface ProjectionFieldUse {
  source: 'ModelDocument' | 'SemanticModel' | 'LayoutDocument' | 'HandoffBundle';
  fields: string[];
}

export interface ProjectionMetric {
  label: string;
  value: string;
}

export type ProjectionTone = 'default' | 'muted' | 'success' | 'warning' | 'danger';

export interface ProjectionLine {
  id: string;
  text: string;
  detail?: string;
  entityId?: EntityId;
  entityIds?: EntityId[];
  path?: string;
  tone?: ProjectionTone;
  monospace?: boolean;
}

export interface ProjectionSection {
  id: string;
  title: string;
  summary?: string;
  rows: ProjectionLine[];
}

export interface ProjectionDiagnosticLink {
  id: string;
  severity: SemanticModel['diagnostics'][number]['severity'];
  code: string;
  message: string;
  path: string;
  entityIds: EntityId[];
  blocksHandoff: boolean;
}

export interface ModelViewProjection {
  id: ModelViewProjectionId;
  title: string;
  purpose: string;
  source: {
    documentId: string;
    revision: number;
    compilerVersion: string;
  };
  consumes: ProjectionFieldUse[];
  metrics: ProjectionMetric[];
  entityIds: EntityId[];
  diagnosticLinks: ProjectionDiagnosticLink[];
  sections: ProjectionSection[];
  copyText: string;
}

export interface ModelViewProjectionInput {
  document: ModelDocument;
  semantic: SemanticModel;
  handoff?: HandoffBundle;
}

const VIEW_ORDER: ModelViewProjectionId[] = ['canvas', 'story', 'equations', 'structure', 'contract'];

export function buildModelViewProjections({
  document,
  semantic,
  handoff,
}: ModelViewProjectionInput): ModelViewProjection[] {
  const diagnostics = buildDiagnosticLinks(semantic);
  const baseSource = {
    documentId: document.documentId,
    revision: document.revision,
    compilerVersion: semantic.compilerVersion,
  };

  return VIEW_ORDER.map((viewId) =>
    attachSharedProjectionData({
      projection: buildProjection(viewId, document, semantic, handoff, baseSource),
      diagnostics,
    }),
  );
}

function buildProjection(
  viewId: ModelViewProjectionId,
  document: ModelDocument,
  semantic: SemanticModel,
  handoff: HandoffBundle | undefined,
  source: ModelViewProjection['source'],
): Omit<ModelViewProjection, 'diagnosticLinks' | 'copyText'> {
  if (viewId === 'canvas') return buildCanvasProjection(document, semantic, source);
  if (viewId === 'story') return buildStoryProjection(document, semantic, source);
  if (viewId === 'equations') return buildEquationProjection(document, semantic, source);
  if (viewId === 'structure') return buildStructureProjection(document, semantic, source);
  return buildContractProjection(document, semantic, handoff, source);
}

function attachSharedProjectionData({
  projection,
  diagnostics,
}: {
  projection: Omit<ModelViewProjection, 'diagnosticLinks' | 'copyText'>;
  diagnostics: ProjectionDiagnosticLink[];
}): ModelViewProjection {
  const diagnosticSection: ProjectionSection = {
    id: 'diagnostics',
    title: '診断',
    summary: diagnostics.length ? `${diagnostics.length}件のcompiler診断` : 'compiler診断はありません',
    rows: diagnostics.length
      ? diagnostics.map((diagnostic) => ({
          id: diagnostic.id,
          text: `${diagnostic.code}: ${diagnostic.message}`,
          detail: diagnostic.path,
          entityIds: diagnostic.entityIds,
          path: diagnostic.path,
          tone: diagnostic.severity === 'error' ? 'danger' : diagnostic.severity === 'warning' ? 'warning' : 'muted',
        }))
      : [{
          id: 'diagnostics-empty',
          text: 'compiler診断はありません。すべてのビューが同じSemanticModelを参照しています。',
          tone: 'success',
        }],
  };

  const completeProjection = {
    ...projection,
    diagnosticLinks: diagnostics,
    sections: [...projection.sections, diagnosticSection],
  };

  return {
    ...completeProjection,
    copyText: formatProjectionText(completeProjection),
  };
}

function buildCanvasProjection(
  document: ModelDocument,
  semantic: SemanticModel,
  source: ModelViewProjection['source'],
): Omit<ModelViewProjection, 'diagnosticLinks' | 'copyText'> {
  const visibleEntities = orderedEntities(document).filter((entity) => entity.authorship !== 'generated');
  return {
    id: 'canvas',
    title: 'キャンバス',
    purpose: '正本モデルの依存関係を、図として編集・確認するビュー。',
    source,
    consumes: [
      { source: 'ModelDocument', fields: ['entities', 'entityOrder', 'plates', 'axes'] },
      { source: 'LayoutDocument', fields: ['nodes', 'view', 'hiddenEntityIds'] },
      { source: 'SemanticModel', fields: ['dependencyEdges', 'diagnostics'] },
    ],
    metrics: [
      { label: '要素', value: String(visibleEntities.length) },
      { label: '依存', value: String(semantic.dependencyEdges.length) },
      { label: '反復範囲', value: String(Object.keys(document.plates).length) },
    ],
    entityIds: visibleEntities.map((entity) => entity.id),
    sections: [
      {
        id: 'canvas-entities',
        title: '表示中の要素',
        summary: 'キャンバスのノードは、同じModelDocument要素を図として配置したものです。',
        rows: visibleEntities.map((entity) => ({
          id: `canvas-${entity.id}`,
          text: `${entity.symbol} (${formatEntityKind(entity)})`,
          detail: entity.plateIds.length ? `反復範囲: ${entity.plateIds.join(', ')}` : '全体',
          entityId: entity.id,
          monospace: true,
        })),
      },
    ],
  };
}

function buildStoryProjection(
  document: ModelDocument,
  semantic: SemanticModel,
  source: ModelViewProjection['source'],
): Omit<ModelViewProjection, 'diagnosticLinks' | 'copyText'> {
  const userEntities = orderedEntities(document).filter((entity) => entity.authorship !== 'generated');
  const sections = groupEntitiesForStory(document, userEntities);

  return {
    id: 'story',
    title: '説明',
    purpose: 'ModelDocumentとSemanticModelから生成した、読みやすい生成過程の説明。',
    source,
    consumes: [
      { source: 'ModelDocument', fields: ['entities', 'entityOrder', 'plates', 'axes'] },
      { source: 'SemanticModel', fields: ['symbols', 'dependencyEdges', 'diagnostics'] },
    ],
    metrics: [
      { label: '手順', value: String(sections.reduce((total, section) => total + section.rows.length, 0)) },
      { label: '記号', value: String(Object.keys(semantic.symbols).length) },
      { label: '範囲', value: String(sections.length) },
    ],
    entityIds: userEntities.map((entity) => entity.id),
    sections,
  };
}

function buildEquationProjection(
  document: ModelDocument,
  semantic: SemanticModel,
  source: ModelViewProjection['source'],
): Omit<ModelViewProjection, 'diagnosticLinks' | 'copyText'> {
  const entities = orderedEntities(document).filter((entity) => entity.authorship !== 'generated');
  const randomVariables = entities.filter((entity): entity is Extract<ModelEntity, { kind: 'random_variable' }> => entity.kind === 'random_variable');
  const deterministic = entities.filter((entity): entity is Extract<ModelEntity, { kind: 'deterministic' }> => entity.kind === 'deterministic');
  const queries = entities.filter((entity): entity is Extract<ModelEntity, { kind: 'query' }> => entity.kind === 'query');
  const factors = entities.filter((entity): entity is Extract<ModelEntity, { kind: 'factor' }> => entity.kind === 'factor');
  const compilerExpressions = Object.values(semantic.expressions).sort((a, b) => a.path.localeCompare(b.path));
  const sections = compactSections([
    {
      id: 'equation-random',
      title: '事前分布と尤度',
      summary: `${randomVariables.length}個の確率変数`,
      rows: randomVariables.map((entity) => ({
        id: `equation-rv-${entity.id}`,
        text: `${entity.symbol} ~ ${formatDistributionCall(entity.distribution.distributionId, entity.distribution.args)}`,
        detail: entity.observedDataId ? `observed binding: ${entity.observedDataId}` : entity.role,
        entityId: entity.id,
        monospace: true,
      })),
    },
    {
      id: 'equation-deterministic',
      title: '決定式',
      summary: `${deterministic.length}個の式`,
      rows: deterministic.map((entity) => ({
        id: `equation-det-${entity.id}`,
        text: `${entity.symbol} = ${entity.expression.source}`,
        detail: `/entities/${escapePointer(entity.id)}/expression`,
        entityId: entity.id,
        monospace: true,
      })),
    },
    {
      id: 'equation-query',
      title: '確認量',
      summary: `${queries.length}個のquery`,
      rows: queries.map((entity) => ({
        id: `equation-query-${entity.id}`,
        text: `${entity.symbol} = ${entity.expression.source}`,
        detail: entity.queryRole,
        entityId: entity.id,
        monospace: true,
      })),
    },
    {
      id: 'equation-factor',
      title: 'Factor寄与',
      summary: `${factors.length}個のfactor`,
      rows: factors.map((entity) => ({
        id: `equation-factor-${entity.id}`,
        text: `${entity.symbol}: ${entity.logDensity.source}`,
        detail: `normalization: ${entity.normalization}`,
        entityId: entity.id,
        monospace: true,
      })),
    },
    {
      id: 'equation-compiler',
      title: 'compiler式ソース',
      summary: 'SemanticModelが使うExpression AST入力。',
      rows: compilerExpressions.map((expression) => ({
        id: `compiler-${expression.path}`,
        text: expression.source.source,
        detail: expression.path,
        entityId: expression.ownerEntityId,
        path: expression.path,
        monospace: true,
      })),
    },
  ]);

  return {
    id: 'equations',
    title: '数式',
    purpose: 'compilerの式ソースと揃えて確認する、数式中心のビュー。',
    source,
    consumes: [
      { source: 'ModelDocument', fields: ['entities.*.distribution', 'entities.*.expression', 'entities.*.valueType'] },
      { source: 'SemanticModel', fields: ['expressions', 'symbols', 'diagnostics'] },
    ],
    metrics: [
      { label: '確率変数', value: String(randomVariables.length) },
      { label: '式', value: String(compilerExpressions.length) },
      { label: 'query', value: String(queries.length) },
    ],
    entityIds: entities.map((entity) => entity.id),
    sections,
  };
}

function buildStructureProjection(
  document: ModelDocument,
  semantic: SemanticModel,
  source: ModelViewProjection['source'],
): Omit<ModelViewProjection, 'diagnosticLinks' | 'copyText'> {
  const entities = orderedEntities(document);
  const indexMappings = inferIndexMappings(document);
  const sections: ProjectionSection[] = [
    {
      id: 'structure-axes',
      title: '軸',
      summary: `${Object.keys(document.axes).length}個の軸`,
      rows: Object.values(document.axes).map((axis) => ({
        id: `axis-${axis.id}`,
        text: `${axis.id}: ${axis.symbol} = ${axis.size.source}`,
        detail: axis.notes,
        monospace: true,
      })),
    },
    {
      id: 'structure-plates',
      title: '反復範囲（plate）',
      summary: `${Object.keys(document.plates).length}件の反復範囲`,
      rows: Object.values(document.plates).map((plate) => ({
        id: `plate-${plate.id}`,
        text: formatPlateLine(document, plate),
        detail: `軸: ${plate.axisId}; 上位: ${plate.parentPlateIds.join(', ') || 'なし'}; 仮定: ${formatPlateAssumption(plate.assumption)}`,
        monospace: true,
      })),
    },
    {
      id: 'structure-dimensions',
      title: 'Batch / event次元',
      summary: `${entities.length}個の要素`,
      rows: entities.map((entity) => ({
        id: `dims-${entity.id}`,
        text: `${entity.symbol}: ${formatAxisUses(entity.valueType.axes)}`,
        detail: entity.plateIds.length ? `反復範囲: ${entity.plateIds.join(', ')}` : '全体',
        entityId: entity.id,
        monospace: true,
      })),
    },
    {
      id: 'structure-index-mapping',
      title: 'Index対応',
      summary: indexMappings.length ? `${indexMappings.length}件の対応` : 'index対応データはありません',
      rows: indexMappings.length
        ? indexMappings
        : [{
            id: 'index-mapping-empty',
            text: 'index対応用のデータ変数は見つかりませんでした。',
            tone: 'muted',
          }],
    },
    {
      id: 'structure-dependencies',
      title: '意味的な依存関係',
      summary: `${semantic.dependencyEdges.length}本のcompiler edge`,
      rows: semantic.dependencyEdges.map((edge, index) => ({
        id: `semantic-edge-${index}-${edge.from}-${edge.to}`,
        text: `${entitySymbol(document, edge.from)} -> ${entitySymbol(document, edge.to)}`,
        detail: edge.role,
        entityIds: [edge.from, edge.to],
        monospace: true,
      })),
    },
  ];

  return {
    id: 'structure',
    title: '構造',
    purpose: '軸、反復範囲、shape、入れ子、index対応、意味的な依存関係を確認するビュー。',
    source,
    consumes: [
      { source: 'ModelDocument', fields: ['axes', 'plates', 'entities.*.valueType', 'entities.*.plateIds'] },
      { source: 'SemanticModel', fields: ['dependencyEdges', 'diagnostics'] },
    ],
    metrics: [
      { label: '軸', value: String(Object.keys(document.axes).length) },
      { label: '反復範囲', value: String(Object.keys(document.plates).length) },
      { label: '対応', value: String(indexMappings.length) },
    ],
    entityIds: entities.map((entity) => entity.id),
    sections,
  };
}

function buildContractProjection(
  document: ModelDocument,
  semantic: SemanticModel,
  handoff: HandoffBundle | undefined,
  source: ModelViewProjection['source'],
): Omit<ModelViewProjection, 'diagnosticLinks' | 'copyText'> {
  const randomVariables = orderedEntities(document)
    .filter((entity): entity is Extract<ModelEntity, { kind: 'random_variable' }> => entity.kind === 'random_variable');
  const observedBindings = randomVariables.filter((entity) => entity.observedDataId);
  const queries = orderedEntities(document).filter((entity): entity is Extract<ModelEntity, { kind: 'query' }> => entity.kind === 'query');
  const notes = orderedNotes(document);
  const capabilityRows: ProjectionLine[] = handoff?.capabilityReport.map((item, index) => ({
    id: `capability-${index}-${item.feature}`,
    text: `${item.feature}: ${item.support}`,
    detail: item.note,
    entityIds: item.relatedEntityIds,
    tone: item.support === 'unsupported' ? 'danger' : item.support === 'unknown' ? 'warning' : 'default',
  })) ?? [];

  const sections: ProjectionSection[] = [
    {
      id: 'contract-observed',
      title: '観測データの対応',
      summary: observedBindings.length ? `${observedBindings.length}件の対応` : '観測データ対応はありません',
      rows: observedBindings.length
        ? observedBindings.map((entity) => ({
            id: `binding-${entity.id}`,
            text: `${entity.symbol} -> ${entity.observedDataId}`,
            detail: entity.observationProcess ? formatObservationProcess(entity.observationProcess.kind) : 'そのまま観測',
            entityIds: [entity.id, entity.observedDataId!],
            monospace: true,
          }))
        : [{
            id: 'binding-empty',
            text: '観測データに対応する確率変数が宣言されていません。',
            tone: 'warning',
          }],
    },
    {
      id: 'contract-qoi',
      title: '確認量',
      summary: queries.length ? `${queries.length}個のquery要素` : '確認量はありません',
      rows: queries.length
        ? queries.map((entity) => ({
            id: `qoi-${entity.id}`,
            text: `${entity.symbol} = ${entity.expression.source}`,
            detail: entity.queryRole,
            entityId: entity.id,
            monospace: true,
          }))
        : [{
            id: 'qoi-empty',
            text: '確認量が宣言されていません。',
            tone: 'warning',
          }],
    },
    {
      id: 'contract-notes',
      title: '仮定と判断',
      summary: notes.length ? `${notes.length}件のメモ` : 'メモはありません',
      rows: notes.length
        ? notes.map((note) => ({
            id: `note-${note.id}`,
            text: note.text,
            detail: `${note.kind}; ${note.status}${note.blocking ? '; blocking' : ''}`,
            entityIds: note.relatedEntityIds,
            tone: note.kind === 'review_question' ? 'warning' : 'default',
          }))
        : [{
            id: 'notes-empty',
            text: '仮定、判断、確認質問はまだ記録されていません。',
            tone: 'muted',
          }],
    },
    {
      id: 'contract-capability',
      title: '出力先の対応状況',
      summary: handoff ? `${handoff.manifest.target} target` : '受け渡し先が未選択です',
      rows: capabilityRows.length
        ? capabilityRows
        : [{
            id: 'capability-empty',
            text: 'このビューでは対応状況レポートを利用できません。',
            tone: 'muted',
          }],
    },
    {
      id: 'contract-implementation',
      title: '実装契約',
      summary: handoff ? handoff.manifest.specificationFingerprint.slice(0, 12) : undefined,
      rows: handoff
        ? [
            {
              id: 'contract-preserve-ids',
              text: `entity IDを維持: ${handoff.implementationContract.preserveEntityIds ? 'yes' : 'no'}`,
              tone: 'success',
            },
            {
              id: 'contract-assumptions',
              text: `仮定を勝手に増やさない: ${handoff.implementationContract.doNotInventAssumptions ? 'yes' : 'no'}`,
              tone: 'success',
            },
            {
              id: 'contract-deviations',
              text: `差分を報告: ${handoff.implementationContract.reportDeviations ? 'yes' : 'no'}`,
              tone: 'success',
            },
            {
              id: 'contract-mapping',
              text: `Return mapping: ${handoff.implementationContract.returnMapping.join(', ')}`,
              monospace: true,
            },
          ]
        : [{
            id: 'contract-empty',
            text: '受け渡しbundleはまだ利用できません。',
            tone: 'muted',
          }],
    },
  ];

  return {
    id: 'contract',
    title: '契約',
    purpose: '同じ正本ドキュメントから生成される、実装・レビュー用の受け渡し情報。',
    source,
    consumes: [
      { source: 'ModelDocument', fields: ['entities', 'notes', 'noteOrder'] },
      { source: 'SemanticModel', fields: ['diagnostics', 'readiness'] },
      { source: 'HandoffBundle', fields: ['manifest', 'capabilityReport', 'implementationContract'] },
    ],
    metrics: [
      { label: '対応', value: String(observedBindings.length) },
      { label: '質問', value: String(handoff?.unresolvedQuestions.length ?? 0) },
      { label: '対応状況', value: String(handoff?.capabilityReport.length ?? 0) },
    ],
    entityIds: unique([
      ...observedBindings.flatMap((entity) => [entity.id, entity.observedDataId!]),
      ...queries.map((entity) => entity.id),
      ...notes.flatMap((note) => note.relatedEntityIds),
      ...(handoff?.capabilityReport.flatMap((item) => item.relatedEntityIds) ?? []),
      ...Object.keys(semantic.entities),
    ]),
    sections,
  };
}

function groupEntitiesForStory(document: ModelDocument, entities: ModelEntity[]): ProjectionSection[] {
  const groups = new Map<string, ModelEntity[]>();
  for (const entity of entities) {
    const scope = entity.plateIds[0] ?? 'global';
    groups.set(scope, [...(groups.get(scope) ?? []), entity]);
  }

  const sectionIds = [
    'global',
    ...Object.keys(document.plates).filter((plateId) => groups.has(plateId)),
    ...[...groups.keys()].filter((scope) => scope !== 'global' && !document.plates[scope]),
  ];

  return sectionIds
    .filter((sectionId) => groups.has(sectionId))
    .map((sectionId) => {
      const plate = document.plates[sectionId];
      return {
        id: `story-${sectionId}`,
        title: plate ? `${plate.label}ごと` : '全体の流れ',
        summary: plate ? formatPlateLine(document, plate) : 'モデル全体の宣言',
        rows: (groups.get(sectionId) ?? []).map((entity) => ({
          id: `story-${entity.id}`,
          text: formatStoryLine(document, entity),
          detail: entity.notes,
          entityId: entity.id,
          monospace: entity.kind !== 'data',
        })),
      };
    });
}

function formatStoryLine(document: ModelDocument, entity: ModelEntity): string {
  if (entity.kind === 'data') {
    return `${entity.symbol} is ${entity.dataRole} data (${formatValueType(entity.valueType)}).`;
  }
  if (entity.kind === 'random_variable') {
    const binding = entity.observedDataId ? ` observed as ${entitySymbol(document, entity.observedDataId)}` : '';
    return `${entity.symbol} ~ ${formatDistributionCall(entity.distribution.distributionId, entity.distribution.args)}${binding}.`;
  }
  if (entity.kind === 'deterministic') {
    return `${entity.symbol} = ${entity.expression.source}.`;
  }
  if (entity.kind === 'query') {
    return `Track ${entity.symbol} = ${entity.expression.source}.`;
  }
  if (entity.kind === 'factor') {
    return `Add factor ${entity.symbol}: ${entity.logDensity.source}.`;
  }
  return `Apply ${entity.blockTypeId} block with inputs ${Object.keys(entity.inputs).join(', ') || 'none'}.`;
}

function inferIndexMappings(document: ModelDocument): ProjectionLine[] {
  const mappings: ProjectionLine[] = [];
  for (const entity of orderedEntities(document)) {
    if (entity.kind !== 'data' || entity.dataRole !== 'index') continue;
    const fromPlateId = entity.plateIds[0];
    const targetPlateId = entity.symbol.replace(/_id$/u, '');
    const fromPlate = fromPlateId ? document.plates[fromPlateId] : undefined;
    const targetPlate = document.plates[targetPlateId];
    if (!fromPlateId || !fromPlate || !targetPlate) {
    mappings.push({
      id: `index-${entity.id}`,
      text: `${entity.symbol}: index data`,
      detail: '対応先の反復範囲がまだ宣言されていません。',
        entityId: entity.id,
        tone: 'warning',
        monospace: true,
      });
      continue;
    }

    mappings.push({
      id: `index-${entity.id}`,
      text: `${entity.symbol}[${fromPlate.indexSymbol}]: ${fromPlateId} -> ${targetPlateId}`,
      detail: `${fromPlate.label}の添字を${targetPlate.label}へ対応付け`,
      entityId: entity.id,
      monospace: true,
    });
  }
  return mappings;
}

function buildDiagnosticLinks(semantic: SemanticModel): ProjectionDiagnosticLink[] {
  return semantic.diagnostics.map((diagnostic) => ({
    id: `${diagnostic.code}-${diagnostic.path}-${diagnostic.message}`,
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.path,
    entityIds: unique([
      ...entityIdsFromPath(diagnostic.path),
      ...(diagnostic.related ?? []).flatMap((related) => entityIdsFromPath(related.path)),
    ]),
    blocksHandoff: diagnostic.blocksHandoff,
  }));
}

function orderedEntities(document: ModelDocument): ModelEntity[] {
  const ordered = document.entityOrder
    .map((entityId) => document.entities[entityId])
    .filter((entity): entity is ModelEntity => Boolean(entity));
  const orderedIds = new Set(ordered.map((entity) => entity.id));
  return [
    ...ordered,
    ...Object.values(document.entities).filter((entity) => !orderedIds.has(entity.id)),
  ];
}

function orderedNotes(document: ModelDocument) {
  const ordered = document.noteOrder
    .map((noteId) => document.notes[noteId])
    .filter((note): note is NonNullable<typeof note> => Boolean(note));
  const orderedIds = new Set(ordered.map((note) => note.id));
  return [
    ...ordered,
    ...Object.values(document.notes).filter((note) => !orderedIds.has(note.id)),
  ];
}

function compactSections(sections: ProjectionSection[]): ProjectionSection[] {
  return sections.filter((section) => section.rows.length > 0);
}

function formatProjectionText(projection: Omit<ModelViewProjection, 'copyText'>): string {
  return [
    `# ${projection.title}`,
    projection.purpose,
    '',
    `Source: ${projection.source.documentId} rev ${projection.source.revision} / compiler ${projection.source.compilerVersion}`,
    '',
    '参照している正本:',
    ...projection.consumes.map((use) => `- ${use.source}: ${use.fields.join(', ')}`),
    '',
    ...projection.sections.flatMap((section) => [
      `## ${section.title}`,
      section.summary ?? '',
      ...section.rows.map((row) => [
        `- ${row.text}`,
        row.detail ? `  ${row.detail}` : undefined,
        (row.entityId || row.entityIds?.length) ? `  entities: ${[row.entityId, ...(row.entityIds ?? [])].filter(Boolean).join(', ')}` : undefined,
      ].filter(Boolean).join('\n')),
      '',
    ]),
  ].join('\n').trim();
}

function formatDistributionCall(distributionId: string, args: Record<string, SourceText>): string {
  const formattedArgs = Object.entries(args)
    .map(([key, value]) => `${key}=${value.source}`)
    .join(', ');
  return `${distributionId}(${formattedArgs})`;
}

function formatPlateLine(document: ModelDocument, plate: PlateDefinition): string {
  const axis = document.axes[plate.axisId];
  return `${plate.label}: ${plate.indexSymbol} = 1..${axis?.size.source ?? plate.axisId}`;
}

function formatPlateAssumption(assumption: PlateDefinition['assumption']): string {
  if (assumption === 'conditionally_independent') return '条件付き独立';
  if (assumption === 'exchangeable') return '交換可能';
  return '宣言のみ';
}

function formatValueType(entityValueType: ModelEntity['valueType']): string {
  const axes = formatAxisUses(entityValueType.axes);
  return entityValueType.domain ? `${axes}; ${entityValueType.domain.kind}` : axes;
}

function formatAxisUses(axes: AxisUse[]): string {
  if (!axes.length) return 'scalar';
  const batch = axes.filter((axis) => axis.role === 'batch').map((axis) => axis.axisId);
  const event = axes.filter((axis) => axis.role === 'event').map((axis) => axis.axisId);
  return [
    batch.length ? `batch: ${batch.join(', ')}` : undefined,
    event.length ? `event: ${event.join(', ')}` : undefined,
  ].filter(Boolean).join('; ');
}

function formatEntityKind(entity: ModelEntity): string {
  if (entity.kind === 'random_variable') return `${entity.kind}:${entity.role}`;
  if (entity.kind === 'data') return `${entity.kind}:${entity.dataRole}`;
  if (entity.kind === 'query') return `${entity.kind}:${entity.queryRole}`;
  return entity.kind;
}

function formatObservationProcess(kind: string): string {
  return kind.replaceAll('_', ' ');
}

function entitySymbol(document: ModelDocument, entityId: EntityId): string {
  return document.entities[entityId]?.symbol ?? entityId;
}

function entityIdsFromPath(path: string): EntityId[] {
  const match = /^\/entities\/([^/]+)/u.exec(path);
  return match ? [unescapePointer(match[1])] : [];
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescapePointer(value: string): string {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}
