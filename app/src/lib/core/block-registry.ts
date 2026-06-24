import { diagnostic } from './diagnostics.js';
import type { BlockDefinition, BlockRegistry } from './block-sdk.js';

export class InMemoryBlockRegistry implements BlockRegistry {
  private readonly definitions = new Map<string, BlockDefinition>();

  constructor(definitions: readonly BlockDefinition[]) {
    for (const definition of definitions) {
      this.definitions.set(key(definition.typeId, definition.version), definition);
    }
  }

  get(typeId: string, version: string): BlockDefinition | undefined {
    return this.definitions.get(key(typeId, version));
  }

  all(): BlockDefinition[] {
    return [...this.definitions.values()];
  }
}

export const builtInBlockRegistry = new InMemoryBlockRegistry([
  block('gp_regression', 'GP regression', 'Boundary-checked Gaussian process latent function.'),
  block('gam_smooth', 'GAM smooth', 'Boundary-checked generalized additive smooth term.'),
  block('mixture', 'Mixture model', 'Component and weight contract for finite mixtures.'),
  block('state_space', 'State-space model', 'Transition and observation boundary contract.'),
]);

function block(typeId: string, label: string, description: string): BlockDefinition {
  return {
    typeId,
    version: '1.0.0',
    label,
    description,
    ports: [
      { id: 'input', label: 'Input', direction: 'input', required: true, multiplicity: 'many', semanticRole: 'data' },
      { id: 'output', label: 'Output', direction: 'output', required: true, multiplicity: 'one', semanticRole: 'deterministic_value' },
    ],
    configSchema: { type: 'object' },
    coverage: {
      config: 'declared',
      symbols: 'boundary_checked',
      shapes: 'boundary_checked',
      probabilitySemantics: 'declared',
      backendPortability: 'declared',
    },
    validateBoundary: () => [
      diagnostic({
        code: 'BC-BLOCK-001',
        stage: 'portability',
        severity: 'info',
        message: `${label} is validated at the declared boundary, not fully lowered.`,
        path: '/blocks',
        blocksHandoff: false,
      }),
    ],
    handoffInstructions: () => [
      `Preserve the ${label} inputs, outputs, config, and validation coverage.`,
    ],
    backendCapabilities: {
      pymc: 'approximate',
      numpyro: 'approximate',
      stan: 'approximate',
      review: 'native',
    },
  };
}

function key(typeId: string, version: string): string {
  return `${typeId}@${version}`;
}
