export type TargetSupport = 'native' | 'lowered' | 'approximate' | 'unsupported' | 'unknown';

export interface TargetProfile {
  id: 'generic' | 'pymc' | 'numpyro' | 'stan' | 'review';
  version: string;
  label: string;
  distributionNames: Record<string, string>;
  defaultSupport: TargetSupport;
  notes: string[];
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
    distributionNames: { normal: 'pm.Normal', halfnormal: 'pm.HalfNormal', student_t: 'pm.StudentT' },
    defaultSupport: 'native',
    notes: ['Use named coords and dims when axes are declared.'],
  },
  numpyro: {
    id: 'numpyro',
    version: '1.0.0',
    label: 'NumPyro',
    distributionNames: { normal: 'dist.Normal', halfnormal: 'dist.HalfNormal', student_t: 'dist.StudentT' },
    defaultSupport: 'native',
    notes: ['Use numpyro.plate for batch axes.'],
  },
  stan: {
    id: 'stan',
    version: '1.0.0',
    label: 'Stan',
    distributionNames: { normal: 'normal', halfnormal: 'normal<lower=0>', student_t: 'student_t' },
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
