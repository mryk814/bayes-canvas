export type EntityId = string;
export type AxisId = string;
export type PlateId = string;
export type BlockTypeId = string;

export interface SourceText {
  language: 'bayes-expr@1';
  source: string;
}

export type ScalarKind = 'real' | 'integer' | 'boolean' | 'category';

export type Domain =
  | { kind: 'real' }
  | { kind: 'positive' }
  | { kind: 'nonnegative' }
  | { kind: 'unit_interval' }
  | { kind: 'simplex'; axisId: AxisId }
  | { kind: 'ordered'; axisId: AxisId }
  | { kind: 'correlation_matrix'; axisId: AxisId }
  | { kind: 'cholesky_factor_corr'; axisId: AxisId }
  | { kind: 'positive_definite_matrix'; axisId: AxisId }
  | { kind: 'custom'; description: string };

/**
 * A tensor axis and a plate are deliberately different concepts.
 * - axis: shape / coordinate information
 * - plate: a declared repeated conditional-independence context
 * - role=batch: independent repetitions for a distribution
 * - role=event: jointly modelled dimensions of a distribution event
 */
export interface AxisUse {
  axisId: AxisId;
  role: 'batch' | 'event';
}

export interface ValueType {
  scalar: ScalarKind;
  axes: AxisUse[];
  domain?: Domain;
}

export interface AxisDefinition {
  id: AxisId;
  symbol: string;
  label: string;
  size: SourceText;
  coordinateDataId?: EntityId;
  notes?: string;
}

export interface PlateDefinition {
  id: PlateId;
  label: string;
  axisId: AxisId;
  indexSymbol: string;
  parentPlateIds: PlateId[];
  assumption: 'conditionally_independent' | 'exchangeable' | 'declared_only';
  notes?: string;
}

export interface DistributionCall {
  distributionId: string;
  parameterizationId?: string;
  args: Record<string, SourceText>;
  truncation?: {
    lower?: SourceText;
    upper?: SourceText;
  };
}

export type ModelConstraint =
  | { kind: 'sum_to_zero'; axisId: AxisId }
  | { kind: 'monotonic'; axisId: AxisId; direction: 'increasing' | 'decreasing' }
  | { kind: 'custom'; description: string };

export type ImplementationHint =
  | { kind: 'parameterization'; value: 'centered' | 'non_centered' }
  | { kind: 'marginalization'; value: 'prefer' | 'required' }
  | { kind: 'backend'; backend: string; note: string }
  | { kind: 'custom'; note: string };

export type ObservationProcess =
  | { kind: 'exact' }
  | { kind: 'missing'; mechanism?: 'MCAR' | 'MAR' | 'MNAR' | 'unspecified'; strategy?: string }
  | { kind: 'measurement_error'; latentTrueEntityId: EntityId; errorScale?: SourceText }
  | { kind: 'censored'; direction: 'left' | 'right' | 'interval'; lower?: SourceText; upper?: SourceText }
  | { kind: 'truncated'; lower?: SourceText; upper?: SourceText }
  | { kind: 'rounded'; unit: SourceText }
  | { kind: 'custom'; description: string };

export interface BaseEntity {
  id: EntityId;
  symbol: string;
  label?: string;
  valueType: ValueType;
  plateIds: PlateId[];
  notes?: string;
  tags?: string[];
  authorship?: 'user' | 'generated' | 'imported';
}

export interface DataEntity extends BaseEntity {
  kind: 'data';
  dataRole: 'observed_value' | 'predictor' | 'index' | 'constant' | 'coordinate' | 'metadata';
  unit?: string;
  missingValuePolicy?: string;
}

export interface RandomVariableEntity extends BaseEntity {
  kind: 'random_variable';
  role: 'parameter' | 'latent' | 'observation';
  distribution: DistributionCall;
  observedDataId?: EntityId;
  observationProcess?: ObservationProcess;
  constraints?: ModelConstraint[];
  hints?: ImplementationHint[];
  priorRationale?: string;
}

export interface DeterministicEntity extends BaseEntity {
  kind: 'deterministic';
  expression: SourceText;
}

/** A custom log-density or potential contribution. */
export interface FactorEntity extends BaseEntity {
  kind: 'factor';
  logDensity: SourceText;
  normalization: 'known' | 'unknown' | 'not_required';
}

export interface BlockPortBinding {
  portId: string;
  entityId?: EntityId;
  expression?: SourceText;
}

export interface BlockInstanceEntity extends BaseEntity {
  kind: 'block_instance';
  blockTypeId: BlockTypeId;
  blockVersion: string;
  inputs: Record<string, BlockPortBinding>;
  outputs: Record<string, EntityId>;
  config: Record<string, unknown>;
}

export interface QueryEntity extends BaseEntity {
  kind: 'query';
  queryRole: 'quantity_of_interest' | 'prediction_target' | 'contrast' | 'generated_quantity';
  expression: SourceText;
  scale?: 'linear' | 'log' | 'logit' | 'probability' | 'custom';
}

export interface MacroInstance {
  id: string;
  macroTypeId: string;
  macroVersion: string;
  bindings: Record<string, EntityId | SourceText>;
  config: Record<string, unknown>;
  status?: 'collapsed' | 'expanded' | 'partially_expanded';
}

export interface LoweringSourceMap {
  generatedEntityId: EntityId;
  macroInstanceId: string;
  macroFieldPath: string;
}

export type ModelEntity =
  | DataEntity
  | RandomVariableEntity
  | DeterministicEntity
  | FactorEntity
  | BlockInstanceEntity
  | QueryEntity;

export interface ModelNote {
  id: string;
  kind: 'assumption' | 'decision' | 'warning' | 'review_question' | 'implementation_note';
  text: string;
  status: 'open' | 'accepted' | 'rejected' | 'resolved';
  relatedEntityIds: EntityId[];
  createdAt?: string;
  author?: 'user' | 'ai' | 'import';
  blocking?: boolean;
}

/**
 * The persisted semantic source document. Maps are keyed by stable IDs so
 * patches and merges are not coupled to array positions. Ordering is separate.
 */
export interface ModelDocument {
  schemaVersion: '1.0.0';
  documentId: string;
  revision: number;
  model: {
    id: string;
    name: string;
    description?: string;
    intent?: string;
  };
  axes: Record<AxisId, AxisDefinition>;
  plates: Record<PlateId, PlateDefinition>;
  entities: Record<EntityId, ModelEntity>;
  entityOrder: EntityId[];
  macros?: Record<string, MacroInstance>;
  loweringSourceMap?: LoweringSourceMap[];
  notes: Record<string, ModelNote>;
  noteOrder: string[];
  extensions?: Record<string, unknown>;
}

/** Canvas state is not part of probabilistic semantics. */
export interface LayoutDocument {
  schemaVersion: '1.0.0';
  modelDocumentId: string;
  revision: number;
  nodes: Record<EntityId, {
    x: number;
    y: number;
    width?: number;
    height?: number;
    collapsed?: boolean;
    groupId?: string;
  }>;
  view: {
    x: number;
    y: number;
    zoom: number;
  };
  hiddenEntityIds?: EntityId[];
}

export interface DistributionDefinition {
  id: string;
  label: string;
  requiredArgs: string[];
  optionalArgs?: string[];
  support: Domain;
  eventRank?: number;
  aliases?: string[];
  deprecated?: boolean;
}

export interface DistributionRegistry {
  get(id: string): DistributionDefinition | undefined;
}
