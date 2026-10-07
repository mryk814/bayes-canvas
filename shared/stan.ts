// Turns a model spec into a Stan program plus a CmdStanPy runner. Stan names are
// prefixed (n_ node, d_ data, o_ observed) so user names never clash with Stan
// keywords; the runner strips the prefix, so draws map back to the same nodes.
import { parseExpr, type Expr } from "./expr.ts";
import type { ModelNode, ModelSpec } from "./contracts.ts";
import { isDiscrete } from "./sim.ts";

type Code = { code: string; vec: boolean };

const FN: Record<string, string> = {
  exp: "exp",
  log: "log",
  sqrt: "sqrt",
  abs: "abs",
  sin: "sin",
  cos: "cos",
  tanh: "tanh",
  logistic: "inv_logit",
};

const POSITIVE = new Set(["halfnormal", "exponential", "gamma", "lognormal"]);

export function stanProgram(spec: ModelSpec, versionId: string): { files: Record<string, string>; warnings: string[] } {
  const warnings: string[] = [];
  const plateOf = new Map<string, string | null>();
  const isData = new Set(spec.data.map((d) => d.name));
  const observed = new Set(spec.nodes.filter((n) => n.role === "observed").map((n) => n.name));
  for (const d of spec.data) plateOf.set(d.name, d.plate);
  for (const n of spec.nodes) plateOf.set(n.name, n.plate);
  const ident = (name: string) => (isData.has(name) ? `d_${name}` : observed.has(name) ? `o_${name}` : `n_${name}`);

  const emit = (e: Expr, ctx: string | null): Code => {
    switch (e.type) {
      case "num":
        return { code: String(e.value), vec: false };
      case "var": {
        if (e.name === "pi" && !e.index) return { code: "pi()", vec: false };
        if (e.index) return { code: `${ident(e.name)}[${ident(e.index)}]`, vec: true };
        return { code: ident(e.name), vec: plateOf.get(e.name) !== null && ctx !== null };
      }
      case "neg": {
        const a = emit(e.arg, ctx);
        return { code: `(-${a.code})`, vec: a.vec };
      }
      case "bin": {
        const a = emit(e.left, ctx);
        const b = emit(e.right, ctx);
        const vec = a.vec || b.vec;
        const both = a.vec && b.vec;
        const op = e.op === "^" ? (vec ? ".^" : "^") : e.op === "*" ? (both ? ".*" : "*") : e.op === "/" ? (both ? "./" : a.vec || !b.vec ? "/" : "./") : e.op;
        // scalar / vector needs the elementwise form
        return { code: `(${a.code} ${op} ${b.code})`, vec };
      }
      case "call": {
        const args = e.args.map((x) => emit(x, ctx));
        const vec = args.some((x) => x.vec);
        if (e.fn === "step") return { code: `pw_step(${args[0].code})`, vec };
        if (e.fn === "min" || e.fn === "max") return { code: `pw_${e.fn}(${args.map((x) => x.code).join(", ")})`, vec };
        if (e.fn === "pow") return { code: `(${args[0].code} .^ ${args[1].code})`, vec };
        return { code: `${FN[e.fn]}(${args.map((x) => x.code).join(", ")})`, vec };
      }
    }
  };
  const ex = (src: string, ctx: string | null) => emit(parseExpr(src), ctx);
  const size = (plate: string) => `N_${plate}`;
  const asType = (c: Code, plate: string | null) => (plate && !c.vec ? `rep_vector(${c.code}, ${size(plate)})` : c.code);
  const decl = (plate: string | null) => (plate ? `vector[${size(plate)}]` : "real");

  const dataLines: string[] = spec.plates.map((p) => `  int<lower=1> ${size(p.name)};`);
  for (const d of spec.data) {
    dataLines.push(
      d.indexOf
        ? `  array[${size(d.plate)}] int<lower=1, upper=${size(d.indexOf)}> ${ident(d.name)};`
        : `  vector[${size(d.plate)}] ${ident(d.name)};`,
    );
  }
  for (const n of spec.nodes.filter((x) => x.role === "observed")) {
    if (isDiscrete(n)) dataLines.push(n.plate ? `  array[${size(n.plate)}] int ${ident(n.name)};` : `  int ${ident(n.name)};`);
    else dataLines.push(`  ${decl(n.plate)} ${ident(n.name)};`);
  }

  const params: string[] = [];
  const tparams: string[] = [];
  const model: string[] = [];
  const nonCentred = (n: ModelNode) => n.role === "latent" && n.plate !== null && (n.dist?.family === "normal" || n.dist?.family === "studentt");

  for (const n of spec.nodes) {
    const name = ident(n.name);
    if (n.role === "deterministic") {
      tparams.push(`  ${decl(n.plate)} ${name} = ${asType(ex(n.expr!, n.plate), n.plate)};`);
      continue;
    }
    const d = n.dist!;
    const a = (k: string) => ex(d.args[k], n.plate).code;
    if (n.role === "observed") {
      if (d.family === "binomial") warnings.push(`${n.name}: binomial の観測は Stan 書き出しでは未対応です`);
      model.push(...observe(n, a, (src) => asType(ex(src, n.plate), n.plate), ident));
      continue;
    }
    if (isDiscrete(n)) {
      warnings.push(`${n.name} は離散の潜在変数なので Stan では扱えません。周辺化が必要です`);
      continue;
    }
    if (nonCentred(n)) {
      params.push(`  ${decl(n.plate)} ${name}_raw;`);
      if (d.family === "normal") {
        tparams.push(`  ${decl(n.plate)} ${name} = ${asType(ex(d.args.mu, n.plate), n.plate)} + ${a("sigma")} * ${name}_raw;`);
        model.push(`  ${name}_raw ~ std_normal();`);
      } else {
        tparams.push(`  ${decl(n.plate)} ${name} = ${asType(ex(d.args.mu, n.plate), n.plate)} + ${a("sigma")} * ${name}_raw;`);
        model.push(`  ${name}_raw ~ student_t(${a("nu")}, 0, 1);`);
      }
      continue;
    }
    const bound =
      d.family === "beta" ? "<lower=0, upper=1>" : POSITIVE.has(d.family) ? "<lower=0>" : d.family === "uniform" ? `<lower=${a("lower")}, upper=${a("upper")}>` : "";
    const t = n.plate ? `vector${bound}[${size(n.plate)}]` : `real${bound}`;
    // A parameter whose bounds or prior read transformed parameters must also live after them.
    params.push(`  ${t} ${name};`);
    model.push(`  ${name} ~ ${dist(n, a)};`);
  }

  // Kept ASCII-only: CmdStanPy reads the file with the system code page on Windows.
  const program = `// Generated by Possible Worlds (version ${versionId}). See run_stan.py for the model title and warnings.
// Names: n_<node>, d_<data>, o_<observed>. Index data is 1-based here; the runner converts.
functions {
  real pw_step(real z) { return z > 0 ? 1.0 : 0.0; }
  vector pw_step(vector z) { vector[rows(z)] r; for (i in 1:rows(z)) r[i] = z[i] > 0 ? 1.0 : 0.0; return r; }
  real pw_min(real a, real b) { return fmin(a, b); }
  vector pw_min(vector a, real b) { vector[rows(a)] r; for (i in 1:rows(a)) r[i] = fmin(a[i], b); return r; }
  vector pw_min(real a, vector b) { return pw_min(b, a); }
  vector pw_min(vector a, vector b) { vector[rows(a)] r; for (i in 1:rows(a)) r[i] = fmin(a[i], b[i]); return r; }
  real pw_max(real a, real b) { return fmax(a, b); }
  vector pw_max(vector a, real b) { vector[rows(a)] r; for (i in 1:rows(a)) r[i] = fmax(a[i], b); return r; }
  vector pw_max(real a, vector b) { return pw_max(b, a); }
  vector pw_max(vector a, vector b) { vector[rows(a)] r; for (i in 1:rows(a)) r[i] = fmax(a[i], b[i]); return r; }
}
data {
${dataLines.join("\n")}
}
parameters {
${params.join("\n")}
}
transformed parameters {
${tparams.join("\n")}
}
model {
${model.join("\n")}
}
`;

  const keep = spec.nodes.filter((n) => (n.role === "param" || n.role === "latent") && !isDiscrete(n)).map((n) => n.name);
  const runner = `#!/usr/bin/env python3
# Runs model.stan with CmdStanPy and writes draws back for Possible Worlds.
# Model: ${spec.title} (version ${versionId})
${warnings.map((w) => `# WARNING: ${w}`).join("\n")}
#
#   uv run --with cmdstanpy python run_stan.py dataset.json run.json [--draws 1000 --warmup 1000 --chains 4]
import argparse
import json
import os

import numpy as np
from cmdstanpy import CmdStanModel

VERSION_ID = "${versionId}"
KEEP = ${JSON.stringify(keep)}
DATA = json.loads(${JSON.stringify(JSON.stringify(spec.data.map((d) => ({ name: d.name, index: !!d.indexOf }))))})
OBSERVED = json.loads(${JSON.stringify(JSON.stringify(spec.nodes.filter((n) => n.role === "observed").map((n) => ({ name: n.name, discrete: isDiscrete(n), scalar: n.plate === null }))))})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("out")
    ap.add_argument("--draws", type=int, default=1000)
    ap.add_argument("--warmup", type=int, default=1000)
    ap.add_argument("--chains", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--keep", type=int, default=400)
    ap.add_argument("--target-accept", type=float, default=0.8, help="adapt_delta; raise (e.g. 0.95) when there are divergences")
    args = ap.parse_args()

    with open(args.dataset, encoding="utf-8") as f:
        ds = json.load(f)
    data = {f"N_{p}": int(n) for p, n in ds["plates"].items()}
    for d in DATA:
        v = ds["columns"][d["name"]]
        data[f"d_{d['name']}"] = [int(x) + 1 for x in v] if d["index"] else v
    for o in OBSERVED:
        v = ds["columns"][o["name"]]
        v = [int(round(x)) for x in v] if o["discrete"] else v
        data[f"o_{o['name']}"] = v[0] if o["scalar"] else v

    if os.name == "nt":
        # RTools installed by cmdstanpy lives under %USERPROFILE%\\.cmdstan; put its make and g++ on PATH.
        rt = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), ".cmdstan", "RTools40")
        if os.path.isdir(rt):
            os.environ["PATH"] = os.pathsep.join([os.path.join(rt, "mingw64", "bin"), os.path.join(rt, "usr", "bin"), os.environ["PATH"]])

    here = os.path.dirname(os.path.abspath(__file__))
    model = CmdStanModel(stan_file=os.path.join(here, "model.stan"))
    fit = model.sample(data=data, chains=args.chains, iter_warmup=args.warmup, iter_sampling=args.draws, seed=args.seed, adapt_delta=args.target_accept, show_progress=False)

    summ = fit.summary()
    rows = [r for r in summ.index if any(r == f"n_{k}" or r.startswith(f"n_{k}[") for k in KEEP)]
    rhat_col = next(c for c in summ.columns if c.lower().startswith("r_hat"))
    ess_col = next(c for c in summ.columns if "ess_bulk" in c.lower() or c.lower() == "n_eff")
    divergences = int(np.asarray(fit.method_variables()["divergent__"]).sum())

    total = fit.num_draws_sampling * args.chains
    pick = np.linspace(0, total - 1, min(args.keep, total)).round().astype(int)
    draws = {}
    for k in KEEP:
        v = np.asarray(fit.stan_variable(f"n_{k}"))
        draws[k] = v[pick].reshape(len(pick), -1).tolist()

    run = {
        "versionId": VERSION_ID,
        "datasetId": ds["id"],
        "method": f"Stan NUTS {args.chains}x{args.draws} accept {args.target_accept}",
        "note": "",
        "diagnostics": {
            "maxRhat": float(np.nanmax(summ.loc[rows, rhat_col])),
            "minEss": float(np.nanmin(summ.loc[rows, ess_col])),
            "divergences": divergences,
            "chains": args.chains,
        },
        "draws": draws,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(run, f)
    print(json.dumps(run["diagnostics"]))


if __name__ == "__main__":
    main()
`;
  return { files: { "model.stan": program, "run_stan.py": runner }, warnings };
}

const STAN_FAMILY: Record<string, string> = {
  normal: "normal",
  lognormal: "lognormal",
  exponential: "exponential",
  uniform: "uniform",
  studentt: "student_t",
  gamma: "gamma",
  beta: "beta",
  poisson: "poisson",
  bernoulli: "bernoulli",
};

function argList(n: ModelNode, a: (k: string) => string) {
  const d = n.dist!;
  if (d.family === "halfnormal") return ["0", a("sigma")];
  return Object.keys(d.args).map(a);
}

function dist(n: ModelNode, a: (k: string) => string) {
  const fam = n.dist!.family === "halfnormal" ? "normal" : STAN_FAMILY[n.dist!.family];
  return `${fam}(${argList(n, a).join(", ")})`;
}

function observe(n: ModelNode, a: (k: string) => string, asVec: (src: string) => string, ident: (s: string) => string): string[] {
  const y = ident(n.name);
  if (!n.censorAbove) return [`  ${y} ~ ${dist(n, a)};`];
  const fam = n.dist!.family === "halfnormal" ? "normal" : STAN_FAMILY[n.dist!.family];
  const keys = n.dist!.family === "halfnormal" ? [] : Object.keys(n.dist!.args);
  const N = `N_${n.plate}`;
  const lines = [`  {`];
  const at: string[] = [];
  if (n.dist!.family === "halfnormal") {
    lines.push(`    vector[${N}] a_sigma = ${asVec(n.dist!.args.sigma)};`);
    at.push("0", "a_sigma[i]");
  }
  for (const k of keys) {
    lines.push(`    vector[${N}] a_${k} = ${asVec(n.dist!.args[k])};`);
    at.push(`a_${k}[i]`);
  }
  lines.push(
    `    vector[${N}] cap = ${asVec(n.censorAbove)};`,
    `    for (i in 1:${N}) {`,
    // right-censored at the recording limit: a capped record says only "at least this much"
    `      if (${y}[i] >= cap[i] - 1e-9) target += ${fam}_lccdf(cap[i] | ${at.join(", ")});`,
    `      else target += ${fam}_lpdf(${y}[i] | ${at.join(", ")});`,
    `    }`,
    `  }`,
  );
  return lines;
}
