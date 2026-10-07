// A small, safe arithmetic language for model formulas. Never uses eval.
// Grammar: numbers, identifiers, + - * / ^, unary -, parentheses, f(a, b).

export type Expr =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "neg"; arg: Expr }
  | { type: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Expr; right: Expr }
  | { type: "call"; fn: string; args: Expr[] };

const FUNCTIONS: Record<string, { arity: number; fn: (...a: number[]) => number }> = {
  exp: { arity: 1, fn: Math.exp },
  log: { arity: 1, fn: Math.log },
  sqrt: { arity: 1, fn: Math.sqrt },
  abs: { arity: 1, fn: Math.abs },
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tanh: { arity: 1, fn: Math.tanh },
  logistic: { arity: 1, fn: (z) => 1 / (1 + Math.exp(-z)) },
  step: { arity: 1, fn: (z) => (z > 0 ? 1 : 0) },
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
  pow: { arity: 2, fn: Math.pow },
};

const CONSTANTS: Record<string, number> = { pi: Math.PI };

export const EXPRESSION_HELP =
  "Arithmetic on numbers and names: + - * / ^, parentheses, unary minus. " +
  `Functions: ${Object.keys(FUNCTIONS).join(", ")}. Constant: pi. ` +
  "step(z) is 1 when z > 0, else 0.";

type Token = { kind: "num" | "id" | "op"; text: string; pos: number };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(source.slice(i));
      if (!m) throw new ExprError(`数値を読めません: "${source.slice(i, i + 8)}"`, i);
      tokens.push({ kind: "num", text: m[0], pos: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      tokens.push({ kind: "id", text: m[0], pos: i });
      i += m[0].length;
    } else if ("+-*/^(),".includes(ch)) {
      tokens.push({ kind: "op", text: ch, pos: i });
      i++;
    } else {
      throw new ExprError(`使えない文字 "${ch}" があります`, i);
    }
  }
  return tokens;
}

export class ExprError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

export function parseExpr(source: string): Expr {
  const tokens = tokenize(source);
  let k = 0;
  const peek = () => tokens[k];
  const take = (text?: string) => {
    const t = tokens[k];
    if (!t || (text !== undefined && t.text !== text)) {
      throw new ExprError(text ? `"${text}" が必要です` : "式が途中で終わっています", t?.pos ?? source.length);
    }
    k++;
    return t;
  };

  // precedence climbing: + - < * / < unary - < ^ (right assoc)
  const parseSum = (): Expr => {
    let left = parseProduct();
    while (peek()?.text === "+" || peek()?.text === "-") {
      const op = take().text as "+" | "-";
      left = { type: "bin", op, left, right: parseProduct() };
    }
    return left;
  };
  const parseProduct = (): Expr => {
    let left = parseUnary();
    while (peek()?.text === "*" || peek()?.text === "/") {
      const op = take().text as "*" | "/";
      left = { type: "bin", op, left, right: parseUnary() };
    }
    return left;
  };
  const parseUnary = (): Expr => {
    if (peek()?.text === "-") {
      take();
      return { type: "neg", arg: parseUnary() };
    }
    if (peek()?.text === "+") {
      take();
      return parseUnary();
    }
    return parsePower();
  };
  const parsePower = (): Expr => {
    const base = parseAtom();
    if (peek()?.text === "^") {
      take();
      return { type: "bin", op: "^", left: base, right: parseUnary() };
    }
    return base;
  };
  const parseAtom = (): Expr => {
    const t = take();
    if (t.kind === "num") return { type: "num", value: Number(t.text) };
    if (t.kind === "id") {
      if (peek()?.text === "(") {
        const spec = FUNCTIONS[t.text];
        if (!spec) throw new ExprError(`関数 ${t.text} は使えません`, t.pos);
        take("(");
        const args: Expr[] = [];
        if (peek()?.text !== ")") {
          args.push(parseSum());
          while (peek()?.text === ",") {
            take();
            args.push(parseSum());
          }
        }
        take(")");
        if (args.length !== spec.arity) {
          throw new ExprError(`${t.text} の引数は ${spec.arity} 個です`, t.pos);
        }
        return { type: "call", fn: t.text, args };
      }
      return { type: "var", name: t.text };
    }
    if (t.text === "(") {
      const inner = parseSum();
      take(")");
      return inner;
    }
    throw new ExprError(`"${t.text}" はここに置けません`, t.pos);
  };

  if (tokens.length === 0) throw new ExprError("式が空です", 0);
  const expr = parseSum();
  if (k < tokens.length) throw new ExprError(`"${tokens[k].text}" 以降を読めません`, tokens[k].pos);
  return expr;
}

export function freeNames(expr: Expr, out = new Set<string>()): Set<string> {
  switch (expr.type) {
    case "var":
      if (!(expr.name in CONSTANTS)) out.add(expr.name);
      break;
    case "neg":
      freeNames(expr.arg, out);
      break;
    case "bin":
      freeNames(expr.left, out);
      freeNames(expr.right, out);
      break;
    case "call":
      expr.args.forEach((a) => freeNames(a, out));
      break;
  }
  return out;
}

export function evaluate(expr: Expr, env: Record<string, number>): number {
  switch (expr.type) {
    case "num":
      return expr.value;
    case "var": {
      const v = env[expr.name] ?? CONSTANTS[expr.name];
      if (v === undefined) throw new ExprError(`名前 ${expr.name} が定義されていません`, 0);
      return v;
    }
    case "neg":
      return -evaluate(expr.arg, env);
    case "bin": {
      const a = evaluate(expr.left, env);
      const b = evaluate(expr.right, env);
      switch (expr.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "^":
          return Math.pow(a, b);
      }
    }
    // falls through only on impossible op
    case "call":
      return FUNCTIONS[expr.fn].fn(...expr.args.map((a) => evaluate(a, env)));
  }
}
