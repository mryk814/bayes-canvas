import type { AxisUse, BlockTypeId, Domain, ValueType } from './model.js';
import type { Diagnostic } from './diagnostics.js';

export type CoverageLevel = 'none' | 'declared' | 'boundary_checked' | 'fully_checked';

/** Coverage is multi-dimensional; a single opaque/structured/linted ladder loses information. */
export interface ValidationCoverage {
  config: CoverageLevel;
  symbols: CoverageLevel;
  shapes: CoverageLevel;
  probabilitySemantics: CoverageLevel;
  backendPortability: CoverageLevel;
}

export interface BlockPortDefinition {
  id: string;
  label: string;
  direction: 'input' | 'output';
  required: boolean;
  multiplicity: 'one' | 'many';
  valueType?: Partial<ValueType> & { axes?: AxisUse[] };
  domain?: Domain;
  semanticRole:
    | 'data'
    | 'parameter'
    | 'latent_process'
    | 'deterministic_value'
    | 'log_density'
    | 'prediction'
    | 'custom';
}

export interface BlockDefinition<Config = Record<string, unknown>> {
  typeId: BlockTypeId;
  version: string;
  label: string;
  description: string;
  ports: BlockPortDefinition[];
  configSchema: Record<string, unknown>;
  coverage: ValidationCoverage;
  validateBoundary?: (config: Config) => Diagnostic[];
  handoffInstructions: (config: Config) => string[];
  backendCapabilities?: Record<string, 'native' | 'lowered' | 'approximate' | 'unsupported' | 'unknown'>;
}

export interface BlockRegistry {
  get(typeId: BlockTypeId, version: string): BlockDefinition | undefined;
}
