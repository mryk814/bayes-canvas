import type { SourceText } from './model.js';

export interface SourceSpan {
  start: number;
  end: number;
}

export type ExprNode =
  | { kind: 'number'; value: number; raw: string; span: SourceSpan }
  | { kind: 'reference'; symbol: string; span: SourceSpan }
  | { kind: 'unary'; operator: '+' | '-'; operand: ExprNode; span: SourceSpan }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/' | '^'; left: ExprNode; right: ExprNode; span: SourceSpan }
  | { kind: 'call'; functionName: string; args: ExprNode[]; span: SourceSpan }
  | { kind: 'index'; target: ExprNode; indices: ExprNode[]; span: SourceSpan };

export interface ExpressionParseError {
  code: 'unexpected_token' | 'unexpected_end' | 'invalid_number' | 'invalid_call_target';
  message: string;
  span: SourceSpan;
}

export type ParseExpressionResult =
  | { ok: true; ast: ExprNode }
  | { ok: false; error: ExpressionParseError };

type TokenKind =
  | 'number'
  | 'identifier'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'caret'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'eof';

interface Token {
  kind: TokenKind;
  text: string;
  span: SourceSpan;
}

class Tokenizer {
  private offset = 0;

  constructor(private readonly source: string) {}

  next(): Token {
    while (this.offset < this.source.length && /\s/u.test(this.source[this.offset]!)) {
      this.offset += 1;
    }

    const start = this.offset;
    const ch = this.source[this.offset];
    if (ch === undefined) return { kind: 'eof', text: '', span: { start, end: start } };

    const punctuation: Record<string, TokenKind> = {
      '+': 'plus',
      '-': 'minus',
      '*': 'star',
      '/': 'slash',
      '^': 'caret',
      '(': 'lparen',
      ')': 'rparen',
      '[': 'lbracket',
      ']': 'rbracket',
      ',': 'comma',
    };
    const punctuationKind = punctuation[ch];
    if (punctuationKind) {
      this.offset += 1;
      return { kind: punctuationKind, text: ch, span: { start, end: this.offset } };
    }

    if (/[0-9.]/u.test(ch)) {
      this.offset += 1;
      while (this.offset < this.source.length && /[0-9._eE+-]/u.test(this.source[this.offset]!)) {
        const candidate = this.source.slice(start, this.offset + 1).replaceAll('_', '');
        if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d*)?$/u.test(candidate)) break;
        this.offset += 1;
      }
      const text = this.source.slice(start, this.offset);
      return { kind: 'number', text, span: { start, end: this.offset } };
    }

    if (/[A-Za-z_]/u.test(ch)) {
      this.offset += 1;
      while (this.offset < this.source.length && /[A-Za-z0-9_]/u.test(this.source[this.offset]!)) {
        this.offset += 1;
      }
      return {
        kind: 'identifier',
        text: this.source.slice(start, this.offset),
        span: { start, end: this.offset },
      };
    }

    // Return unknown characters as a token the parser will reject.
    this.offset += 1;
    return { kind: 'identifier', text: ch, span: { start, end: this.offset } };
  }
}

class Parser {
  private current: Token;

  constructor(private readonly source: string) {
    this.tokenizer = new Tokenizer(source);
    this.current = this.tokenizer.next();
  }

  private readonly tokenizer: Tokenizer;

  parse(): ParseExpressionResult {
    try {
      const ast = this.parseAdditive();
      if (this.current.kind !== 'eof') {
        return {
          ok: false,
          error: {
            code: 'unexpected_token',
            message: `Unexpected token "${this.current.text}".`,
            span: this.current.span,
          },
        };
      }
      return { ok: true, ast };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof ParseFailure
          ? error.detail
          : {
              code: 'unexpected_token',
              message: error instanceof Error ? error.message : 'Expression parse failed.',
              span: this.current.span,
            },
      };
    }
  }

  private advance(): Token {
    const previous = this.current;
    this.current = this.tokenizer.next();
    return previous;
  }

  private isCurrent(kind: TokenKind): boolean {
    return this.current.kind === kind;
  }

  private accept(kind: TokenKind): Token | undefined {
    if (this.current.kind !== kind) return undefined;
    return this.advance();
  }

  private expect(kind: TokenKind, message: string): Token {
    const token = this.accept(kind);
    if (token) return token;
    throw new ParseFailure({
      code: this.current.kind === 'eof' ? 'unexpected_end' : 'unexpected_token',
      message,
      span: this.current.span,
    });
  }

  private parseAdditive(): ExprNode {
    let node = this.parseMultiplicative();
    while (this.current.kind === 'plus' || this.current.kind === 'minus') {
      const operator = this.advance();
      const right = this.parseMultiplicative();
      node = {
        kind: 'binary',
        operator: operator.text as '+' | '-',
        left: node,
        right,
        span: { start: node.span.start, end: right.span.end },
      };
    }
    return node;
  }

  private parseMultiplicative(): ExprNode {
    let node = this.parsePower();
    while (this.current.kind === 'star' || this.current.kind === 'slash') {
      const operator = this.advance();
      const right = this.parsePower();
      node = {
        kind: 'binary',
        operator: operator.text as '*' | '/',
        left: node,
        right,
        span: { start: node.span.start, end: right.span.end },
      };
    }
    return node;
  }

  private parsePower(): ExprNode {
    let node = this.parseUnary();
    if (this.current.kind === 'caret') {
      this.advance();
      const right = this.parsePower();
      node = {
        kind: 'binary',
        operator: '^',
        left: node,
        right,
        span: { start: node.span.start, end: right.span.end },
      };
    }
    return node;
  }

  private parseUnary(): ExprNode {
    if (this.current.kind === 'plus' || this.current.kind === 'minus') {
      const operator = this.advance();
      const operand = this.parseUnary();
      return {
        kind: 'unary',
        operator: operator.text as '+' | '-',
        operand,
        span: { start: operator.span.start, end: operand.span.end },
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ExprNode {
    let node = this.parsePrimary();

    while (this.current.kind === 'lparen' || this.current.kind === 'lbracket') {
      if (this.accept('lparen')) {
        if (node.kind !== 'reference') {
          throw new ParseFailure({
            code: 'invalid_call_target',
            message: 'Only a named function can be called.',
            span: node.span,
          });
        }
        const args: ExprNode[] = [];
        if (!this.isCurrent('rparen')) {
          do {
            args.push(this.parseAdditive());
          } while (this.accept('comma'));
        }
        const end = this.expect('rparen', 'Expected ")" after function arguments.');
        node = {
          kind: 'call',
          functionName: node.symbol,
          args,
          span: { start: node.span.start, end: end.span.end },
        };
        continue;
      }

      this.expect('lbracket', 'Expected "[".');
      const indices: ExprNode[] = [];
      if (!this.isCurrent('rbracket')) {
        do {
          indices.push(this.parseAdditive());
        } while (this.accept('comma'));
      }
      const end = this.expect('rbracket', 'Expected "]" after index expression.');
      node = {
        kind: 'index',
        target: node,
        indices,
        span: { start: node.span.start, end: end.span.end },
      };
    }

    return node;
  }

  private parsePrimary(): ExprNode {
    if (this.current.kind === 'number') {
      const token = this.advance();
      const value = Number(token.text.replaceAll('_', ''));
      if (!Number.isFinite(value)) {
        throw new ParseFailure({
          code: 'invalid_number',
          message: `Invalid number "${token.text}".`,
          span: token.span,
        });
      }
      return { kind: 'number', value, raw: token.text, span: token.span };
    }

    if (this.current.kind === 'identifier') {
      const token = this.advance();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(token.text)) {
        throw new ParseFailure({
          code: 'unexpected_token',
          message: `Unexpected character "${token.text}".`,
          span: token.span,
        });
      }
      return { kind: 'reference', symbol: token.text, span: token.span };
    }

    if (this.accept('lparen')) {
      const node = this.parseAdditive();
      this.expect('rparen', 'Expected ")".');
      return node;
    }

    throw new ParseFailure({
      code: this.current.kind === 'eof' ? 'unexpected_end' : 'unexpected_token',
      message: this.current.kind === 'eof'
        ? 'Expected an expression.'
        : `Unexpected token "${this.current.text}".`,
      span: this.current.span,
    });
  }
}

class ParseFailure extends Error {
  constructor(readonly detail: ExpressionParseError) {
    super(detail.message);
  }
}

export function parseExpression(expression: SourceText | string): ParseExpressionResult {
  const source = typeof expression === 'string' ? expression : expression.source;
  return new Parser(source).parse();
}

export interface ReferenceOccurrence {
  symbol: string;
  span: SourceSpan;
}

export function collectReferenceOccurrences(ast: ExprNode): ReferenceOccurrence[] {
  const output: ReferenceOccurrence[] = [];

  const visit = (node: ExprNode): void => {
    switch (node.kind) {
      case 'reference':
        output.push({ symbol: node.symbol, span: node.span });
        break;
      case 'unary':
        visit(node.operand);
        break;
      case 'binary':
        visit(node.left);
        visit(node.right);
        break;
      case 'call':
        node.args.forEach(visit);
        break;
      case 'index':
        visit(node.target);
        node.indices.forEach(visit);
        break;
      case 'number':
        break;
    }
  };

  visit(ast);
  return output;
}

export function rewriteReference(source: SourceText, oldSymbol: string, newSymbol: string): SourceText {
  const parsed = parseExpression(source);
  if (!parsed.ok) return source;

  const replacements = collectReferenceOccurrences(parsed.ast)
    .filter((reference) => reference.symbol === oldSymbol)
    .sort((a, b) => b.span.start - a.span.start);

  let next = source.source;
  for (const replacement of replacements) {
    next = `${next.slice(0, replacement.span.start)}${newSymbol}${next.slice(replacement.span.end)}`;
  }

  return { ...source, source: next };
}
