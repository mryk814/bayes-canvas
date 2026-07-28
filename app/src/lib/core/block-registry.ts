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
  block(
    'gp_regression',
    'GP regression',
    'Gaussian-process latent function indexed by declared coordinates.',
    [
      input('coordinates', 'Coordinates', 'data'),
      input('kernel', 'Kernel', 'parameter'),
      output('latent_function', 'Latent function', 'latent_process'),
    ],
    ['approximation'],
  ),
  block(
    'gam_smooth',
    'GAM smooth',
    'Basis expansion and coefficient contract for a smooth additive term.',
    [
      input('predictor', 'Predictor', 'data'),
      input('basis', 'Basis and coefficients', 'parameter'),
      output('smooth_effect', 'Smooth effect', 'deterministic_value'),
    ],
    ['basis_family', 'basis_count'],
  ),
  block(
    'mixture',
    'Mixture model',
    'Finite-mixture contract that keeps weights and component distributions distinct.',
    [
      input('weights', 'Mixture weights', 'parameter'),
      input('components', 'Component distributions', 'parameter'),
      output('mixture_value', 'Mixture value', 'latent_process'),
    ],
    ['component_count', 'marginalize_assignments'],
  ),
  block(
    'state_space',
    'State-space model',
    'Initial-state, transition, innovation, and latent-state sequence contract.',
    [
      input('initial_state', 'Initial state', 'parameter'),
      input('transition', 'Transition function', 'parameter'),
      input('innovation', 'Innovation scale', 'parameter'),
      output('state', 'State sequence', 'latent_process'),
    ],
    ['transition_family', 'time_axis'],
  ),
  block(
    'hidden_markov',
    'Hidden Markov model',
    'Discrete latent-state sequence with initial, transition, and emission contracts.',
    [
      input('initial_probs', 'Initial probabilities', 'parameter'),
      input('transition_matrix', 'Transition matrix', 'parameter'),
      input('emission', 'Emission distribution', 'parameter'),
      output('state_sequence', 'State sequence', 'latent_process'),
    ],
    ['state_count', 'marginalize_states'],
  ),
]);

function block(
  typeId: string,
  label: string,
  description: string,
  ports: BlockDefinition['ports'],
  configKeys: string[],
): BlockDefinition {
  return {
    typeId,
    version: '1.0.0',
    label,
    description,
    ports,
    configSchema: {
      type: 'object',
      properties: Object.fromEntries(
        ['expression', 'validationLevel', ...configKeys].map((key) => [key, {}]),
      ),
    },
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

function input(
  id: string,
  label: string,
  semanticRole: BlockDefinition['ports'][number]['semanticRole'],
): BlockDefinition['ports'][number] {
  return { id, label, direction: 'input', required: true, multiplicity: 'one', semanticRole };
}

function output(
  id: string,
  label: string,
  semanticRole: BlockDefinition['ports'][number]['semanticRole'],
): BlockDefinition['ports'][number] {
  return { id, label, direction: 'output', required: true, multiplicity: 'one', semanticRole };
}

function key(typeId: string, version: string): string {
  return `${typeId}@${version}`;
}
