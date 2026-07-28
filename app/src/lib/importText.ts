import { assertJsonComplexity } from './core/migrations.js';

export interface ImportTextLimits {
  maxBytes: number;
  maxDepth: number;
}

export function parseImportJsonText(input: string, limits: ImportTextLimits): unknown {
  const trimmed = input.trim();
  try {
    return assertJsonComplexity(trimmed, limits);
  } catch (directError) {
    if (isComplexityError(directError)) throw directError;
    for (const candidate of extractJsonCandidates(trimmed)) {
      try {
        return assertJsonComplexity(candidate, limits);
      } catch (candidateError) {
        if (isComplexityError(candidateError)) throw candidateError;
      }
    }
    throw directError;
  }
}

export function extractJsonCandidates(input: string): string[] {
  const candidates: string[] = [];
  for (const match of input.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)) {
    const candidate = match[1]?.trim();
    if (candidate) candidates.push(candidate);
  }

  let start = -1;
  let depth = 0;
  let opener = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (start < 0 && (character === '{' || character === '[')) {
      start = index;
      opener = character;
      depth = 1;
      continue;
    }
    if (start < 0) continue;
    if (character === opener) depth += 1;
    if (character === (opener === '{' ? '}' : ']')) depth -= 1;
    if (depth === 0) {
      candidates.push(input.slice(start, index + 1).trim());
      start = -1;
      opener = '';
    }
  }
  return [...new Set(candidates)];
}

function isComplexityError(error: unknown): boolean {
  return error instanceof Error && (error.message.includes('too large') || error.message.includes('nesting'));
}
