import { DISTRIBUTIONS } from '../distributionRegistry.js';

export type TargetSupport = 'native' | 'lowered' | 'approximate' | 'unsupported' | 'unknown';

export interface TargetProfile {
  id: 'generic' | 'pymc' | 'numpyro' | 'stan' | 'review';
  version: string;
  label: string;
  distributionNames: Record<string, string>;
  defaultSupport: TargetSupport;
  notes: string[];
}

function backendDistributionNames(target: 'pymc' | 'numpyro' | 'stan'): Record<string, string> {
  return Object.fromEntries(
    DISTRIBUTIONS.flatMap((distribution) => {
      const backendName = distribution.backendNames?.[target];
      return backendName ? [[distribution.id, backendName]] : [];
    }),
  );
}

export const TARGET_PROFILES: Record<TargetProfile['id'], TargetProfile> = {
  generic: {
    id: 'generic',
    version: '1.0.0',
    label: 'Generic PPL',
    distributionNames: {},
    defaultSupport: 'unknown',
    notes: ['Preserve ModelDocument entity IDs and ask before adding assumptions.'],
  },
  pymc: {
    id: 'pymc',
    version: '1.0.0',
    label: 'PyMC',
    distributionNames: backendDistributionNames('pymc'),
    defaultSupport: 'native',
    notes: ['Use named coords and dims when axes are declared.'],
  },
  numpyro: {
    id: 'numpyro',
    version: '1.0.0',
    label: 'NumPyro',
    distributionNames: backendDistributionNames('numpyro'),
    defaultSupport: 'native',
    notes: ['Use numpyro.plate for batch axes.'],
  },
  stan: {
    id: 'stan',
    version: '1.0.0',
    label: 'Stan',
    distributionNames: backendDistributionNames('stan'),
    defaultSupport: 'lowered',
    notes: ['Separate data, parameters, transformed parameters, and generated quantities.'],
  },
  review: {
    id: 'review',
    version: '1.0.0',
    label: 'Review only',
    distributionNames: {},
    defaultSupport: 'unknown',
    notes: ['Do not generate backend code; identify ambiguities and unsupported assumptions.'],
  },
};
