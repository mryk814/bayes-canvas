import type { DataContract, DataFieldContract, DataFieldRole } from './dataContract.js';
import { formatDataContract } from './dataContract.js';

export interface DataColumnProfile {
  sourceName: string;
  field: DataFieldContract;
  nonMissing: number;
  missing: number;
  unique: number;
  exampleValues: string[];
  range?: { min: number; max: number };
}

export interface DataProfile {
  delimiter: ',' | '\t' | ';';
  rowCount: number;
  sampledRows: number;
  columns: DataColumnProfile[];
  contract: DataContract;
  warnings: string[];
}

const MISSING_VALUES = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '.']);

export function profileDelimitedData(input: string, maxRows = 500): DataProfile {
  const lines = input.split(/\r?\n/gu).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error('headerと1行以上のデータが必要です。');
  const delimiter = detectDelimiter(lines[0]!);
  const header = parseDelimitedRow(lines[0]!, delimiter);
  if (!header.length || header.some((value) => !value.trim())) {
    throw new Error('空の列名があります。headerを確認してください。');
  }
  const rows = lines.slice(1, maxRows + 1).map((line, index) => {
    const row = parseDelimitedRow(line, delimiter);
    if (row.length !== header.length) {
      throw new Error(`${index + 2}行目は${row.length}列です。headerの${header.length}列と一致しません。`);
    }
    return row;
  });
  const names = uniqueIdentifiers(header);
  const columns = header.map((sourceName, columnIndex) => {
    const values = rows.map((row) => row[columnIndex]?.trim() ?? '');
    return profileColumn(sourceName.trim(), names[columnIndex]!, values, rows.length);
  });
  const contract: DataContract = {
    contractVersion: 'bayes-canvas-data-contract@1',
    fields: columns.map((column) => column.field),
  };
  const warnings: string[] = [];
  if (!contract.fields.some((field) => field.role === 'outcome')) {
    warnings.push('outcome候補を特定できませんでした。Dataノード追加前にrole=outcomeを指定してください。');
  }
  if (lines.length - 1 > maxRows) warnings.push(`先頭${maxRows}行で型と欠測を推定しました。`);
  for (const column of columns) {
    if (column.missing > 0) warnings.push(`${column.field.name}: ${column.missing}/${rows.length}件が欠測候補です。`);
  }
  return {
    delimiter,
    rowCount: lines.length - 1,
    sampledRows: rows.length,
    columns,
    contract,
    warnings,
  };
}

export function formatProfileContract(profile: DataProfile): string {
  return formatDataContract(profile.contract);
}

function profileColumn(
  sourceName: string,
  name: string,
  rawValues: string[],
  rowCount: number,
): DataColumnProfile {
  const values = rawValues.filter((value) => !MISSING_VALUES.has(value.toLowerCase()));
  const uniqueValues = [...new Set(values)];
  const scalar = inferScalar(values, uniqueValues.length, rowCount);
  const numbers = values.map(Number).filter(Number.isFinite);
  return {
    sourceName,
    field: {
      name,
      scalar,
      role: inferRole(name),
      shape: 'N',
      missing: values.length === rawValues.length ? 'none' : 'possible',
      levels: scalar === 'category' && uniqueValues.length <= 20 ? uniqueValues : undefined,
    },
    nonMissing: values.length,
    missing: rawValues.length - values.length,
    unique: uniqueValues.length,
    exampleValues: uniqueValues.slice(0, 4),
    range: numbers.length === values.length && numbers.length
      ? { min: Math.min(...numbers), max: Math.max(...numbers) }
      : undefined,
  };
}

function inferScalar(
  values: string[],
  uniqueCount: number,
  rowCount: number,
): DataFieldContract['scalar'] {
  if (!values.length) return 'real';
  if (values.every((value) => /^[-+]?\d+$/u.test(value))) return 'integer';
  if (values.every((value) => Number.isFinite(Number(value)))) {
    return values.every((value) => Number(value) > 0) ? 'positive' : 'real';
  }
  const normalized = values.map((value) => value.toLowerCase());
  if (normalized.every((value) => ['true', 'false', 'yes', 'no'].includes(value))) return 'boolean';
  if (uniqueCount <= Math.min(20, Math.max(3, Math.floor(rowCount * 0.2)))) return 'category';
  return 'category';
}

function inferRole(name: string): DataFieldRole {
  const normalized = name.toLowerCase();
  if (/^(y|outcome|response|target|label)$/u.test(normalized)) return 'outcome';
  if (/(^|_)(se|stderr|std_error|known_error)$/u.test(normalized)) return 'known_error';
  if (/(^|_)(time|date|timestamp|coordinate|coord)$/u.test(normalized)) return 'coordinate';
  if (/(^|_)(id|group|batch|site|subject)(_id)?$/u.test(normalized) || normalized.endsWith('_id')) return 'index';
  return 'predictor';
}

function detectDelimiter(header: string): DataProfile['delimiter'] {
  const candidates: DataProfile['delimiter'][] = [',', '\t', ';'];
  return candidates
    .map((delimiter) => ({ delimiter, columns: parseDelimitedRow(header, delimiter).length }))
    .sort((left, right) => right.columns - left.columns)[0]!.delimiter;
}

function parseDelimitedRow(line: string, delimiter: DataProfile['delimiter']): string[] {
  const output: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === delimiter && !quoted) {
      output.push(value);
      value = '';
      continue;
    }
    value += character;
  }
  if (quoted) throw new Error('閉じていない引用符があります。');
  output.push(value);
  return output;
}

function uniqueIdentifiers(sourceNames: string[]): string[] {
  const used = new Set<string>();
  return sourceNames.map((sourceName, index) => {
    const normalized = sourceName
      .normalize('NFKC')
      .replace(/[^A-Za-z0-9_]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .replace(/^(\d)/u, '_$1') || `column_${index + 1}`;
    let candidate = normalized;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${normalized}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}
