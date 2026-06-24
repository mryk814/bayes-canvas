import { TexMath } from './TexMath';
import {
  createDefaultDistribution,
  DISTRIBUTIONS,
  findDistribution,
  formatDistributionTex,
  formatDistributionText,
  getDistributionSupport,
  normalizeDistribution,
  type DistributionSpec,
} from '../lib/distributionRegistry';

interface DistributionEditorProps {
  distribution?: DistributionSpec;
  onChange: (distribution: DistributionSpec | undefined) => void;
}

const SUPPORT_LABELS: Record<string, string> = {
  real: 'Real (-inf, +inf)',
  positive: 'Positive (0, +inf)',
  unit_interval: 'Unit interval [0, 1]',
  simplex: 'Simplex',
  integer: 'Integer',
  nonnegative_integer: 'Non-negative integer',
  correlation_matrix: 'Correlation matrix',
  cholesky_factor_corr: 'Cholesky correlation factor',
  ordered: 'Ordered vector',
  ordered_category: 'Ordered category',
  positive_definite_matrix: 'Positive definite matrix',
  custom: 'Custom',
};

const FAMILY_LABELS: Record<string, string> = {
  continuous: 'Continuous',
  discrete: 'Discrete',
  multivariate: 'Multivariate',
  count: 'Count',
  categorical: 'Categorical',
};

function mergeDistributionSelection(id: string, currentArgs?: Record<string, string>): DistributionSpec {
  const next = createDefaultDistribution(id);

  return {
    ...next,
    args: {
      ...next.args,
      ...Object.fromEntries(
        Object.entries(currentArgs ?? {}).filter(([key]) =>
          Boolean(findDistribution(id)?.params.some((param) => param.name === key)),
        ),
      ),
    },
  };
}

export function DistributionEditor({ distribution, onChange }: DistributionEditorProps) {
  const normalized = distribution ? normalizeDistribution(distribution) : undefined;
  const definition = normalized ? findDistribution(normalized.id ?? normalized.name) : undefined;
  const support = normalized ? getDistributionSupport(normalized) : undefined;

  return (
    <div className="distribution-editor">
      <label>
        Distribution
        <select
          value={normalized?.id ?? ''}
          onChange={(event) =>
            onChange(
              event.target.value
                ? mergeDistributionSelection(event.target.value, distribution?.args)
                : undefined,
            )
          }
        >
          <option value="">None</option>
          {DISTRIBUTIONS.map((dist) => (
            <option key={dist.id} value={dist.id}>
              {dist.name}
            </option>
          ))}
        </select>
      </label>

      {definition ? (
        <>
          <div className="dist-meta">
            {definition.family ? (
              <span className="dist-chip">{FAMILY_LABELS[definition.family] ?? definition.family}</span>
            ) : null}
            {support ? (
              <span className="dist-chip dist-chip-support">{SUPPORT_LABELS[support] ?? support}</span>
            ) : null}
            {definition.deprecated ? <span className="dist-chip dist-chip-warning">Use carefully</span> : null}
          </div>
          {definition.notes ? <small className="dist-preview-note">{definition.notes}</small> : null}

          <fieldset className="dist-params">
            <legend>Parameters</legend>
            {definition.params.map((param) => (
              <label key={param.name} className="dist-param-field">
                <span className="dist-param-name">
                  {param.name}
                  {param.role ? <small className="dist-param-role">{param.role}</small> : null}
                </span>
                <input
                  value={distribution?.args[param.name] ?? ''}
                  placeholder={param.defaultExpression ?? param.name}
                  onChange={(event) => {
                    const nextArgs = { ...(distribution?.args ?? {}), [param.name]: event.target.value };
                    onChange({ ...normalized!, args: nextArgs });
                  }}
                />
                {param.support ? (
                  <small className="dist-param-support">{SUPPORT_LABELS[param.support] ?? param.support}</small>
                ) : null}
              </label>
            ))}
          </fieldset>

          <div className="dist-preview">
            <div className="dist-preview-text">{formatDistributionText(normalized!)}</div>
            <TexMath tex={formatDistributionTex(normalized!)} block />
          </div>
        </>
      ) : normalized ? (
        <div className="dist-preview">
          <div className="dist-preview-text">{formatDistributionText(normalized)}</div>
          <small className="dist-preview-note">Custom distribution</small>
        </div>
      ) : null}
    </div>
  );
}
