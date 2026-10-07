// A small, safe arithmetic language for model formulas. Never uses eval.
// Grammar: numbers, identifiers, + - * / ^, unary -, parentheses, f(a, b).

export type Expr =
  | { type: "num"; value: number }
  | { type: "var"; name: string; index?: string }
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
  "step(z) is 1 when z > 0, else 0. " +
  "name[idx] reads element idx of a value on another plate, where idx is an index data column.";

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
    } else if ("+-*/^(),[]".includes(ch)) {
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
      if (peek()?.text === "[") {
        take("[");
        const idx = take();
        if (idx.kind !== "id") throw new ExprError("[ ] の中には添字の列の名前を書いてください", idx.pos);
        take("]");
        return { type: "var", name: t.text, index: idx.text };
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

export type Ref = { name: string; index: string | null };

// Every name an expression reads, with the index column used to read it (if any).
export function refs(expr: Expr, out: Ref[] = []): Ref[] {
  switch (expr.type) {
    case "var":
      if (!(expr.name in CONSTANTS) || expr.index) out.push({ name: expr.name, index: expr.index ?? null });
      break;
    case "neg":
      refs(expr.arg, out);
      break;
    case "bin":
      refs(expr.left, out);
      refs(expr.right, out);
      break;
    case "call":
      expr.args.forEach((a) => refs(a, out));
      break;
  }
  return out;
}

export function isConstant(name: string) {
  return name in CONSTANTS;
}

// resolve(name, index) returns the value a name has at the current element.
export type Resolve = (name: string, index: string | null) => number;

export function evaluate(expr: Expr, env: Record<string, number> | Resolve): number {
  switch (expr.type) {
    case "num":
      return expr.value;
    case "var": {
      if (!expr.index && expr.name in CONSTANTS && (typeof env === "function" || !(expr.name in env))) return CONSTANTS[expr.name];
      const v = typeof env === "function" ? env(expr.name, expr.index ?? null) : env[expr.name];
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
    case "call":
      return FUNCTIONS[expr.fn].fn(...expr.args.map((a) => evaluate(a, env)));
  }
}
