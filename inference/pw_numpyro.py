"""NumPyro fitting for Possible Worlds.

Methods, all writing JSON the app reads back:
  approx   Laplace (mode + Hessian) for models without per-unit latents, mean-field ADVI
           for models with them. Checked with PSIS: the Pareto k of importance weights p/q.
  nuts     NUTS with several chains, R-hat / ESS / divergences.
  custom   an inference algorithm written for this model (see ALGORITHM CONTRACT below),
           with the same diagnostics as NUTS.
  sbc      simulation-based calibration: fit many datasets simulated from the prior and
           report where each true value falls among its posterior draws.

A generated model module provides: model(data, sizes), build(centered), KEEP, VERSION_ID.

ALGORITHM CONTRACT. An algorithm module defines
  NAME: str                       short name shown in the app
  make(mod, sizes, options) -> fit
      mod is the generated model module; sizes the plate sizes. make may compile once;
      fit is then called for several datasets with the same sizes (the real data,
      a training split, and every simulated dataset of the calibration).
  fit(key, data, *, chains, draws, warmup) -> {"samples": {name: array}, "divergences": int}
      samples has every name in mod.KEEP, shaped (chains, draws, ...) on the model's
      original scale: a collapsed algorithm must draw the variables it integrated out back.
The algorithm must target the same posterior as mod.model. The app checks that with
calibration (sbc), by comparing with NUTS, and by prediction on held-out data.
"""
import importlib.util
import json
import sys
import time

import numpy as np


def setup(chains=4):
    import numpyro

    numpyro.set_host_device_count(chains)
    numpyro.enable_x64()


def stage(name):
    print(f"STAGE {name}", flush=True)


def load(dataset_path):
    with open(dataset_path, encoding="utf-8") as f:
        ds = json.load(f)
    data = {k: np.asarray(v, dtype=float) for k, v in ds["columns"].items()}
    return ds, data, ds["plates"]


def psis_khat(log_weights):
    """Pareto k-hat of importance weights (generalized Pareto fit to the upper tail,
    Zhang & Stephens 2009 as used in PSIS). Above 0.7 the approximation is not trustworthy."""
    lw = np.asarray(log_weights, dtype=float)
    # a weight of zero (log -inf: q put mass where p has none) is harmless; NaN or +inf is not
    if np.any(np.isnan(lw)) or np.any(lw == np.inf):
        return float("inf")
    lw = lw[np.isfinite(lw)]
    n = lw.size
    m = int(min(0.2 * n, 3 * np.sqrt(n)))
    if m < 5:
        return float("inf")
    lw = np.sort(lw - lw.max())
    cutoff = np.exp(lw[-m - 1])
    x = np.exp(lw[-m:]) - cutoff
    x = np.sort(x)
    nx = x.size
    prior_bs, prior_k = 3, 10
    m_est = 30 + int(nx**0.5)
    b = 1 - np.sqrt(m_est / (np.arange(1, m_est + 1) - 0.5))
    b /= prior_bs * x[int(nx / 4 + 0.5) - 1]
    b += 1 / x[-1]
    k = np.log1p(-b[:, None] * x).mean(axis=1)
    length = nx * (np.log(-(b / k)) - k - 1)
    w = 1 / np.exp(length - length[:, None]).sum(axis=1)
    keep = w >= 10 * np.finfo(float).eps
    w, b = w[keep], b[keep]
    w /= w.sum()
    b_post = np.sum(b * w)
    k_post = np.log1p(-b_post * x).mean()
    # weakly informative prior towards 0.5, as in PSIS
    k_post = (nx * k_post + prior_k * 0.5) / (nx + prior_k)
    return float(k_post)


def _thin(flat, names, keep):
    total = next(iter(flat.values())).shape[0]
    pick = np.linspace(0, total - 1, min(keep, total)).round().astype(int)
    return {k: np.asarray(flat[k])[pick].reshape(len(pick), -1).tolist() for k in names}


def _mcmc_result(method, by_chain, names, divergences, chains, keep, seconds):
    from numpyro.diagnostics import summary

    by_chain = {k: np.asarray(by_chain[k]) for k in names}
    diag = summary(by_chain)
    flat = {k: v.reshape((-1,) + v.shape[2:]) for k, v in by_chain.items()}
    return {
        "method": method,
        "fidelity": "mcmc",
        "diagnostics": {
            "maxRhat": max(float(np.nanmax(v["r_hat"])) for v in diag.values()),
            "minEss": min(float(np.nanmin(v["n_eff"])) for v in diag.values()),
            "divergences": int(divergences),
            "chains": chains,
            "paretoK": None,
            "seconds": seconds,
        },
        "draws": _thin(flat, names, keep),
    }


def _nuts_sampler(mod, sizes, centered, target_accept, chains, draws, warmup):
    from numpyro.infer import MCMC, NUTS

    # jit_model_args: the compiled sampler is reused for later datasets of the same shape.
    # Plate sizes stay outside the traced arguments.
    built = mod.build(centered)

    def model(data):
        return built(data, sizes)

    return MCMC(
        NUTS(model, target_accept_prob=target_accept),
        num_warmup=warmup, num_samples=draws, num_chains=chains, progress_bar=False, jit_model_args=True,
    )


def fit_nuts(mod, data, sizes, *, draws=1000, warmup=1000, chains=4, seed=0, keep=400, target_accept=0.9, centered=False):
    import jax

    stage("sample")
    start = time.perf_counter()
    mcmc = _nuts_sampler(mod, sizes, centered, target_accept, chains, draws, warmup)
    mcmc.run(jax.random.PRNGKey(seed), data, extra_fields=("diverging",))
    divergences = np.asarray(mcmc.get_extra_fields()["diverging"]).sum()
    return _mcmc_result(
        f"NumPyro NUTS {chains}x{draws} accept {target_accept}", mcmc.get_samples(group_by_chain=True),
        mod.KEEP, divergences, chains, keep, time.perf_counter() - start,
    )


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fit_custom(mod, data, sizes, *, algorithm, draws=1000, warmup=1000, chains=4, seed=0, keep=400, options=None):
    import jax

    alg = load_module(algorithm, f"pw_alg_{abs(hash(algorithm))}")
    stage("sample")
    start = time.perf_counter()
    fit_fn = alg.make(mod, sizes, options or {})
    out = fit_fn(jax.random.PRNGKey(seed), data, chains=chains, draws=draws, warmup=warmup)
    return _mcmc_result(alg.NAME, out["samples"], mod.KEEP, out.get("divergences", 0), chains, keep, time.perf_counter() - start)


def sbc(mod, datasets_path, *, algorithm=None, draws=500, warmup=500, thin=5, seed=0, centered=False, target_accept=0.9):
    """Calibration: for each simulated dataset with known truth, the rank of the truth among
    the thinned posterior draws. With a correct algorithm the ranks are uniform on 0..L."""
    import jax

    with open(datasets_path, encoding="utf-8") as f:
        sims = json.load(f)
    sizes = sims["plates"]
    if algorithm:
        alg = load_module(algorithm, f"pw_alg_sbc_{abs(hash(algorithm))}")
        fit_fn = alg.make(mod, sizes, {})

        def run(key, data):
            out = fit_fn(key, data, chains=1, draws=draws, warmup=warmup)
            return out["samples"], int(out.get("divergences", 0))
    else:
        mcmc = _nuts_sampler(mod, sizes, centered, target_accept, 1, draws, warmup)

        def run(key, data):
            mcmc.run(key, data, extra_fields=("diverging",))
            return mcmc.get_samples(group_by_chain=True), int(np.asarray(mcmc.get_extra_fields()["diverging"]).sum())

    ranks = {}
    divergences = []
    start = time.perf_counter()
    total = len(sims["datasets"])
    for r, sim in enumerate(sims["datasets"]):
        stage(f"calibrate {r + 1}/{total}")
        data = {k: np.asarray(v, dtype=float) for k, v in sim["columns"].items()}
        samples, div = run(jax.random.PRNGKey(seed + r), data)
        divergences.append(div)
        # truth: {"node": v, "node[i]": v, "a[0]+b[0]": v}; sums test the joint draws, not only
        # each margin. Draws are thinned against autocorrelation.
        for name, truth in sim["truth"].items():
            col = 0
            for term in name.split("+"):
                base, _, idx = term.partition("[")
                arr = np.asarray(samples[base])
                arr = arr.reshape((-1,) + arr.shape[2:])[::thin]
                col = col + arr.reshape(arr.shape[0], -1)[:, int(idx[:-1]) if idx else 0]
            ranks.setdefault(name, []).append(int(np.sum(col < truth)))
    return {"ranks": ranks, "draws": int(-(-draws // thin)), "divergences": divergences, "seconds": time.perf_counter() - start}


def fit_approx(mod, data, sizes, *, seed=0, keep=400, centered=False, check_draws=1000, steps=4000):
    """Fast approximation, chosen by structure.

    Without per-unit latent variables: Laplace (a normal approximation at the mode).
    With them: the joint mode collapses (each latent fits its own record and the
    measurement error goes to zero), so Laplace is ill-posed; use mean-field ADVI instead.
    Either way the result is checked with PSIS (Pareto k)."""
    import jax
    import numpyro
    from numpyro.infer import SVI, Predictive, Trace_ELBO, init_to_median
    from numpyro.infer.autoguide import AutoDiagonalNormal, AutoLaplaceApproximation
    from numpyro.infer.util import potential_energy

    start = time.perf_counter()
    model = mod.build(centered)
    latent = bool(getattr(mod, "PLATED_LATENT", []))
    init = init_to_median(num_samples=31)
    guide = AutoDiagonalNormal(model, init_loc_fn=init) if latent else AutoLaplaceApproximation(model, init_loc_fn=init)
    stage("optimize")
    if latent:
        svi = SVI(model, guide, numpyro.optim.Adam(0.02), Trace_ELBO(num_particles=4))
        params = svi.run(jax.random.PRNGKey(seed), steps, data, sizes, progress_bar=False).params
    else:
        # one Minimize step runs BFGS to the mode; further steps only perturb it
        svi = SVI(model, guide, numpyro.optim.Minimize(method="BFGS"), Trace_ELBO())
        state = svi.init(jax.random.PRNGKey(seed), data, sizes)
        state, _ = svi.update(state, data, sizes)
        params = svi.get_params(state)

    stage("check")
    # PSIS check: weights p(z, data) / q(z) on the unconstrained latent vector
    posterior = guide.get_posterior(params)
    z = posterior.sample(jax.random.PRNGKey(seed + 1), (check_draws,))
    log_q = posterior.log_prob(z)
    if log_q.ndim > 1:  # the diagonal guide returns one density per dimension
        log_q = log_q.sum(-1)
    pe = jax.vmap(lambda zi: potential_energy(model, (data, sizes), {}, guide._unpack_latent(zi)))(z)
    k = psis_khat(np.asarray(-pe - log_q))

    # draw from the fitted approximation (calling a Laplace guide directly gives only its mode),
    # then run the model on those draws to recover deterministic sites such as non-centred latents
    latent_draws = guide.sample_posterior(jax.random.PRNGKey(seed + 2), params, sample_shape=(keep,))
    samples = Predictive(model, posterior_samples=latent_draws, return_sites=list(mod.KEEP))(jax.random.PRNGKey(seed + 3), data, sizes)
    return {
        "method": "NumPyro ADVI（平均場）" if latent else "NumPyro Laplace",
        "fidelity": "approximate",
        "diagnostics": {"maxRhat": None, "minEss": None, "divergences": None, "chains": None, "paretoK": k if np.isfinite(k) else 99.0, "seconds": time.perf_counter() - start},
        "draws": {name: np.asarray(samples[name]).reshape(keep, -1).tolist() for name in mod.KEEP},
    }


def fit(mod, dataset_path, out_path, method, **options):
    if method == "sbc":
        result = sbc(mod, dataset_path, **options)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f)
        return result
    ds, data, sizes = load(dataset_path)
    if method == "approx":
        result = fit_approx(mod, data, sizes, **options)
    elif method == "custom":
        result = fit_custom(mod, data, sizes, **options)
    else:
        result = fit_nuts(mod, data, sizes, **options)
    run ={"versionId": mod.VERSION_ID, "datasetId": ds["id"], "note": "", **result}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(run, f)
    return run


def cli(mod):
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("out")
    ap.add_argument("--method", choices=["nuts", "approx", "custom"], default="nuts", help="approx: Laplace, or ADVI when the model has per-unit latents; custom: --algorithm")
    ap.add_argument("--algorithm", help="an algorithm module following the ALGORITHM CONTRACT (with --method custom)")
    ap.add_argument("--draws", type=int, default=1000)
    ap.add_argument("--warmup", type=int, default=1000)
    ap.add_argument("--chains", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--keep", type=int, default=400, help="draws written back to the app")
    ap.add_argument("--target-accept", type=float, default=0.9)
    ap.add_argument("--centered", action="store_true", help="sample plated latents in the centred form")
    a = ap.parse_args()
    setup(a.chains)
    if a.method == "approx":
        opts = {"seed": a.seed, "keep": a.keep, "centered": a.centered}
    elif a.method == "custom":
        if not a.algorithm:
            ap.error("--method custom needs --algorithm")
        opts = {"algorithm": a.algorithm, "draws": a.draws, "warmup": a.warmup, "chains": a.chains, "seed": a.seed, "keep": a.keep}
    else:
        opts = {"draws": a.draws, "warmup": a.warmup, "chains": a.chains, "seed": a.seed, "keep": a.keep, "target_accept": a.target_accept, "centered": a.centered}
    run = fit(mod, a.dataset, a.out, a.method, **opts)
    print(json.dumps(run["diagnostics"]))


if __name__ == "__main__":
    sys.exit("import this module from a generated model.py")
