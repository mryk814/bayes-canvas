"""Known-variance Gaussian experiment; no application or real-data access."""
import argparse
import json
import platform
import time
from pathlib import Path
import numpy as np


def inputs(groups, m0, s0, tau, sigma):
    if not np.isfinite([m0, s0, tau, sigma]).all() or min(s0, tau, sigma) <= 0:
        raise ValueError('finite mean and strictly positive finite scales required')
    clean = [np.asarray([x for x in g if x is not None], dtype=float) for g in groups]
    if any(x.ndim != 1 or not np.isfinite(x).all() for x in clean):
        raise ValueError('observations must be finite scalars or None')
    return clean


def joint(groups, *, m0=0., s0=2., tau=1., sigma=1.):
    """Independent reference: solve the full arrowhead posterior precision."""
    groups = inputs(groups, m0, s0, tau, sigma)
    g = len(groups)
    q = np.zeros((g + 1, g + 1))
    h = np.zeros(g + 1)
    q[0, 0], h[0] = 1 / s0**2 + g / tau**2, m0 / s0**2
    for i, y in enumerate(groups, 1):
        q[i, i] = 1 / tau**2 + len(y) / sigma**2
        q[0, i] = q[i, 0] = -1 / tau**2
        h[i] = y.sum() / sigma**2
    mean, cov = np.linalg.solve(q, h), np.linalg.solve(q, np.eye(g + 1))
    y = np.concatenate(groups) if g else np.array([])
    if not len(y):
        evidence = 0.
    else:
        ids = np.repeat(np.arange(g), [len(v) for v in groups])
        cy = s0**2 + tau**2 * (ids[:, None] == ids[None, :]) + sigma**2 * np.eye(len(y))
        sign, logdet = np.linalg.slogdet(cy)
        if sign <= 0:
            raise ArithmeticError('observation covariance is not positive definite')
        residual = y - m0
        evidence = -.5 * (len(y) * np.log(2 * np.pi) + logdet + residual @ np.linalg.solve(cy, residual))
    return dict(mean=mean, cov=cov, log_evidence=float(evidence))


def collapsed(groups, *, m0=0., s0=2., tau=1., sigma=1.):
    """Integrate theta; recover analytic joint moments via conditional expectation."""
    groups = inputs(groups, m0, s0, tau, sigma)
    n = np.array([len(y) for y in groups], dtype=float)
    sums = np.array([y.sum() for y in groups])
    bars = np.divide(sums, n, out=np.zeros_like(sums), where=n > 0)
    w = n / (sigma**2 + n * tau**2)
    v = 1 / (1 / s0**2 + w.sum())
    m = v * (m0 / s0**2 + np.dot(w, bars))
    conditional_var = 1 / (1 / tau**2 + n / sigma**2)
    a = conditional_var / tau**2
    b = conditional_var * sums / sigma**2
    factors = np.concatenate(([1.], a))
    mean = np.concatenate(([m], a * m + b))
    cov = v * np.outer(factors, factors) + np.diag(np.concatenate(([0.], conditional_var)))
    present = n > 0
    logdet = np.sum((n[present] - 1) * np.log(sigma**2) + np.log(sigma**2 + n[present] * tau**2))
    within = sum(np.sum((y - y.mean())**2) for y in groups if len(y)) / sigma**2
    delta = bars - m0
    quadratic = within + np.dot(w, delta**2) - v * np.dot(w, delta)**2
    evidence = -.5 * (n.sum() * np.log(2 * np.pi) + logdet + np.log1p(s0**2 * w.sum()) + quadratic)
    return dict(mean=mean, cov=cov, log_evidence=float(evidence),
                mu_var=v, conditional_var=conditional_var, a=a, b=b)


def recover(result, draws, seed):
    rng = np.random.default_rng(seed)
    mu = rng.normal(result['mean'][0], np.sqrt(result['mu_var']), size=draws)
    theta = mu[:, None] * result['a'] + result['b']
    theta += rng.normal(size=theta.shape) * np.sqrt(result['conditional_var'])
    return np.column_stack((mu, theta))


def independent_recovery(result, draws, seed):
    """Intentionally wrong negative control: marginals right, dependence destroyed."""
    rng = np.random.default_rng(seed)
    return result['mean'] + rng.normal(size=(draws, len(result['mean']))) * np.sqrt(np.diag(result['cov']))


def report():
    groups = [[], [None, 2.1], [1.2, None, 1.5], [2 + j / 10 for j in range(7)], [3 + j / 100 for j in range(50)], [None, None]]
    opts = dict(m0=.4, s0=2., tau=1.3, sigma=.7)
    timings = {}
    results = {}
    # Tiny run timing is descriptive only; report the median of repeated solves.
    for name, fn in [('joint', joint), ('collapsed', collapsed)]:
        elapsed = []
        for _ in range(30):
            start = time.perf_counter()
            results[name] = fn(groups, **opts)
            elapsed.append(time.perf_counter() - start)
        timings[name + '_solve_and_evidence_median_seconds'] = float(np.median(elapsed))
    a, b = results['joint'], results['collapsed']
    sample_reports = []
    for seed in [17, 913]:
        start = time.perf_counter()
        draws = recover(b, 160000, seed)
        elapsed = time.perf_counter() - start
        sample_reports.append(dict(seed=seed, draws=len(draws), recovery_seconds=elapsed,
            mean_max_abs_error=float(np.max(abs(draws.mean(axis=0) - b['mean']))),
            covariance_max_abs_error=float(np.max(abs(np.cov(draws, rowvar=False) - b['cov'])))))
    negative = collapsed([[], [1., None], []], m0=0., s0=2., tau=1., sigma=1.)
    bad = independent_recovery(negative, 160000, 17)
    bad_cov = np.cov(bad, rowvar=False)
    return dict(python=platform.python_version(), numpy=np.__version__, platform=platform.platform(),
        contract='Known variances; observation missingness ignored; exact Gaussian target; no MNAR claim',
        timing_scope='Import/startup excluded; 30 repeated solve+log-evidence calls; includes dense observation covariance in joint reference; not an algorithm speed benchmark',
        groups=groups, parameters=opts, timings=timings,
        agreement=dict(mean_max_abs_error=float(np.max(abs(a['mean'] - b['mean']))),
            covariance_max_abs_error=float(np.max(abs(a['cov'] - b['cov']))),
            log_evidence_abs_error=abs(a['log_evidence'] - b['log_evidence'])),
        posterior=dict(order=['mu'] + [f'theta_{g}' for g in range(len(groups))],
            mean=b['mean'].tolist(), covariance=b['cov'].tolist(), log_evidence=b['log_evidence']),
        recovery=sample_reports,
        negative_control=dict(seed=17, draws=160000, pair=['theta_0', 'theta_2'],
            true_covariance=float(negative['cov'][1, 3]), wrong_covariance=float(bad_cov[1, 3]),
            detected=bool(abs(bad_cov[1, 3] - negative['cov'][1, 3]) > .5)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    result = report()
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps(dict(agreement=result['agreement'], negative_control=result['negative_control'], timings=result['timings']), indent=2))
