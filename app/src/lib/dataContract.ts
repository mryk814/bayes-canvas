import type { Node } from '@xyflow/react';
import type { BayesNodeData, ObservationProcess } from './modelIr.js';

export type DataFieldRole =
  | 'outcome'
  | 'predictor'
  | 'index'
  | 'coordinate'
  | 'known_error'
  | 'metadata';

export interface DataFieldContract {
  name: string;
  scalar: 'real' | 'integer' | 'boolean' | 'category' | 'positive';
  role: DataFieldRole;
  shape?: string;
  unit?: string;
  missing: 'none' | 'possible' | 'observed';
  levels?: string[];
}

export interface DataContract {
  contractVersion: 'bayes-canvas-data-contract@1';
  fields: DataFieldContract[];
}

const HEADER = ['name', 'type', 'role', 'shape', 'unit', 'missing', 'levels'];
const ROLES = new Set<DataFieldRole>(['outcome', 'predictor', 'index', 'coordinate', 'known_error', 'metadata']);
const SCALARS = new Set<DataFieldContract['scalar']>(['real', 'integer', 'boolean', 'category', 'positive']);
const MISSING = new Set<DataFieldContract['missing']>(['none', 'possible', 'observed']);

export function parseDataContractInput(input: string): DataContract {
  const rows = input
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvRow);
  if (!rows.length) throw new Error('列契約が空です。');

  const dataRows = isHeader(rows[0]) ? rows.slice(1) : rows;
  const fields = dataRows.map((row, index) => parseField(row, index));
  const names = new Set<string>();
  for (const field of fields) {
    if (names.has(field.name)) throw new Error(`列名 "${field.name}" が重複しています。`);
    names.add(field.name);
  }
  if (!fields.some((field) => field.role === 'outcome')) {
    throw new Error('role=outcome の列を1つ以上指定してください。');
  }
  return { contractVersion: 'bayes-canvas-data-contract@1', fields };
}

export function dataContractToNodes(
  contract: DataContract,
  existingIds: readonly string[] = [],
  timestamp = Date.now(),
): Node<BayesNodeData>[] {
  const usedIds = new Set(existingIds);
  return contract.fields.map((field, index) => {
    const baseId = `data_${stableId(field.name)}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    const shape = field.shape && field.shape !== 'scalar' ? field.shape : undefined;
    const plate = shape ? inferPlate(field) : undefined;
    return {
      id,
      type: 'bayesNode',
      position: { x: 80 + (index % 2) * 220, y: 120 + Math.floor(index / 2) * 150 },
      data: {
        kind: 'data',
        name: shape ? `${field.name}[${inferIndex(plate)}]` : field.name,
        scalarType: field.scalar === 'positive' ? 'real' : field.scalar,
        dataRole: toDataRole(field.role),
        unit: field.unit,
        missingValuePolicy: field.missing === 'none' ? undefined : `missing=${field.missing}`,
        shape: shape ? [shape] : undefined,
        plate,
        observed: true,
        constraints: field.scalar === 'positive' ? [{ kind: 'positive' }] : undefined,
        observationProcess: missingProcess(field.missing),
        notes: formatFieldNotes(field, timestamp),
      },
    };
  });
}

export function formatDataContract(contract: DataContract): string {
  return [
    HEADER.join(','),
    ...contract.fields.map((field) => [
      field.name,
      field.scalar,
      field.role,
      field.shape ?? '',
      field.unit ?? '',
      field.missing,
      field.levels?.join('|') ?? '',
    ].join(',')),
  ].join('\n');
}

function parseField(row: string[], index: number): DataFieldContract {
  const [name, scalarRaw = 'real', roleRaw = 'predictor', shape, unit, missingRaw = 'none', levelsRaw] = row;
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    throw new Error(`${index + 1}行目のnameは英数字と_で指定してください。`);
  }
  const scalar = scalarRaw.toLowerCase() as DataFieldContract['scalar'];
  if (!SCALARS.has(scalar)) throw new Error(`${name}: type "${scalarRaw}" は未対応です。`);
  const role = roleRaw.toLowerCase() as DataFieldRole;
  if (!ROLES.has(role)) throw new Error(`${name}: role "${roleRaw}" は未対応です。`);
  const missing = missingRaw.toLowerCase() as DataFieldContract['missing'];
  if (!MISSING.has(missing)) throw new Error(`${name}: missingはnone, possible, observedのいずれかです。`);
  return {
    name,
    scalar,
    role,
    shape: shape || undefined,
    unit: unit || undefined,
    missing,
    levels: levelsRaw ? levelsRaw.split('|').map((value) => value.trim()).filter(Boolean) : undefined,
  };
}

function parseCsvRow(line: string): string[] {
  return line.split(',').map((value) => value.trim());
}

function isHeader(row: string[]): boolean {
  return row.slice(0, HEADER.length).every((value, index) => value.toLowerCase() === HEADER[index]);
}

function inferPlate(field: DataFieldContract): string {
  if (field.role === 'coordinate' && field.shape?.toUpperCase() === 'T') return 'time';
  return 'obs';
}

function inferIndex(plate?: string): string {
  if (plate === 'time') return 't';
  return 'i';
}

function missingProcess(missing: DataFieldContract['missing']): ObservationProcess | undefined {
  if (missing === 'none') return undefined;
  return {
    kind: 'missing',
    mechanism: 'unspecified',
    strategy: missing === 'observed' ? 'latent_imputation' : 'note_only',
  };
}

function formatFieldNotes(field: DataFieldContract, timestamp: number): string {
  return [
    `Data contract: role=${field.role}; type=${field.scalar}; missing=${field.missing}.`,
    field.unit ? `Unit: ${field.unit}.` : undefined,
    field.levels?.length ? `Levels: ${field.levels.join(', ')}.` : undefined,
    `Imported at ${new Date(timestamp).toISOString()}.`,
  ].filter(Boolean).join(' ');
}

function stableId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '') || 'column';
}

function toDataRole(role: DataFieldRole): NonNullable<BayesNodeData['dataRole']> {
  if (role === 'outcome') return 'observed_value';
  if (role === 'known_error') return 'known_error';
  return role;
}
