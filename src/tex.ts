import katex from "katex";
import { parseExpr, type Expr } from "../shared/expr.ts";
import { describeDist } from "../shared/sim.ts";
import type { Dist } from "../shared/contracts.ts";

const PREC = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 } as const;

function name(n: string) {
  if (n === "pi") return "\\pi";
  if (n === "sigma") return "\\sigma";
  if (n === "mu") return "\\mu";
  return n.length === 1 ? n : `\\mathit{${n.replace(/_/g, "\\_")}}`;
}

function toTex(e: Expr, parent = 0): string {
  switch (e.type) {
    case "num":
      return String(e.value);
    case "var":
      return name(e.name);
    case "neg":
      return `-${toTex(e.arg, 3)}`;
    case "call":
      if (e.fn === "sqrt") return `\\sqrt{${toTex(e.args[0])}}`;
      if (e.fn === "abs") return `\\left|${toTex(e.args[0])}\\right|`;
      if (e.fn === "exp") return `e^{${toTex(e.args[0])}}`;
      return `\\operatorname{${e.fn}}\\left(${e.args.map((a) => toTex(a)).join(", ")}\\right)`;
    case "bin": {
      const p = PREC[e.op];
      let s: string;
      if (e.op === "/") return `\\frac{${toTex(e.left)}}{${toTex(e.right)}}`;
      if (e.op === "^") s = `${toTex(e.left, 4)}^{${toTex(e.right)}}`;
      else if (e.op === "*") s = `${toTex(e.left, p)} \\, ${toTex(e.right, p + 1)}`;
      else s = `${toTex(e.left, p)} ${e.op} ${toTex(e.right, p + 1)}`;
      return p < parent ? `\\left(${s}\\right)` : s;
    }
  }
}

export function exprHtml(source: string): string {
  try {
    return katex.renderToString(toTex(parseExpr(source)), { throwOnError: false });
  } catch {
    return source;
  }
}

export function texHtml(tex: string): string {
  return katex.renderToString(tex, { throwOnError: false });
}

export function distTex(d: Dist) {
  return describeDist(d).replace(/^(\w+)/, "\\operatorname{$1}");
}

export { name as texName };
