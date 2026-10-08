import katex from "katex";
import { parseExpr, type Expr } from "../shared/expr.ts";
import type { ModelNode } from "../shared/contracts.ts";

const PREC = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 } as const;
const GREEK = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "nu", "sigma", "tau", "phi", "psi", "omega", "rho", "kappa", "eta"]);

export function texName(n: string) {
  if (n === "pi") return "\\pi";
  if (GREEK.has(n)) return `\\${n}`;
  const m = /^([a-z]+)_([A-Za-z0-9]+)$/.exec(n);
  if (m && GREEK.has(m[1])) return `\\${m[1]}_{\\mathrm{${m[2]}}}`;
  return n.length === 1 ? n : `\\mathit{${n.replace(/_/g, "\\_")}}`;
}

function toTex(e: Expr, parent = 0): string {
  switch (e.type) {
    case "num":
      return String(e.value);
    case "var":
      return e.index ? `${texName(e.name)}[${texName(e.index)}]` : texName(e.name);
    case "neg":
      return `-${toTex(e.arg, 3)}`;
    case "call":
      if (e.fn === "sqrt") return `\\sqrt{${toTex(e.args[0])}}`;
      if (e.fn === "abs") return `\\left|${toTex(e.args[0])}\\right|`;
      if (e.fn === "exp") return `e^{${toTex(e.args[0])}}`;
      return `\\operatorname{${e.fn}}\\left(${e.args.map((a) => toTex(a)).join(", ")}\\right)`;
    case "bin": {
      const p = PREC[e.op];
      if (e.op === "/") return `\\frac{${toTex(e.left)}}{${toTex(e.right)}}`;
      let s: string;
      if (e.op === "^") s = `${toTex(e.left, 4)}^{${toTex(e.right)}}`;
      else if (e.op === "*") s = `${toTex(e.left, p)} \\, ${toTex(e.right, p + 1)}`;
      else s = `${toTex(e.left, p)} ${e.op} ${toTex(e.right, p + 1)}`;
      return p < parent ? `\\left(${s}\\right)` : s;
    }
  }
}

function exprTex(source: string) {
  try {
    return toTex(parseExpr(source));
  } catch {
    return `\\text{${source}}`;
  }
}

const FAMILY: Record<string, string> = {
  normal: "Normal",
  lognormal: "LogNormal",
  halfnormal: "HalfNormal",
  exponential: "Exponential",
  uniform: "Uniform",
  studentt: "StudentT",
  gamma: "Gamma",
  beta: "Beta",
  poisson: "Poisson",
  bernoulli: "Bernoulli",
  binomial: "Binomial",
};

export function nodeHtml(n: ModelNode): string {
  const lhs = texName(n.name);
  const rhs =
    n.role === "deterministic"
      ? `= ${exprTex(n.expr!)}`
      : `\\sim \\operatorname{${FAMILY[n.dist!.family]}}\\left(${Object.values(n.dist!.args).map(exprTex).join(",\\ ")}\\right)`;
  const cap = n.censorAbove ? `\\quad \\text{上限 } ${exprTex(n.censorAbove)}` : "";
  return katex.renderToString(`${lhs} ${rhs}${cap}`, { throwOnError: false, strict: "ignore" });
}
