import { useState } from 'react';
import type { LayoutDocument, ModelDocument } from '../lib/core/model';
import { validateImplementationReceipt, type ImplementationReceipt } from '../lib/core/receipt';
import { semanticFingerprint } from '../lib/core/semantic-fingerprint';
import { previewPortablePackageImport } from '../lib/canvasProjector';
import { parseImportJsonText } from '../lib/importText';
import { validateModelEvidence, type ModelEvidenceBundle } from '../lib/modelEvidence';
import { groupKinds, isVariantsEnvelope, validateVariantsEnvelope } from './modelSpace';
import { MEANING_LABEL, meaningDiff, type MeaningChange } from './scoreModel';

const IMPORT_LIMITS = { maxBytes: 4 * 1024 * 1024, maxDepth: 64 };
export const VARIANT_CAPACITY = 20;

export interface ImportedVariant {
  label: string;
  document: ModelDocument;
  layout: LayoutDocument;
}

interface VariantPreview {
  label: string;
  rationale?: string;
  document?: ModelDocument;
  layout?: LayoutDocument;
  changes: MeaningChange[];
  /** Label of an existing model with the same semantic fingerprint. */
  duplicateOf?: string;
  error?: string;
}

type ImportResult =
  | { kind: 'model'; document: ModelDocument; layout: LayoutDocument; summary: string; changes: MeaningChange[]; warnings: string[] }
  | { kind: 'variants'; items: VariantPreview[] }
  | { kind: 'evidence'; bundle: ModelEvidenceBundle }
  | { kind: 'receipt'; receipt: ImplementationReceipt };

export function ImportSheet({ current, knownModels, savedCount, onClose, onModel, onVariants, onEvidence, onReceipt }: {
  current: ModelDocument;
  /** Semantic fingerprint → label, for the current model and saved variants. */
  knownModels: ReadonlyMap<string, string>;
  savedCount: number;
  onClose: () => void;
  onModel: (document: ModelDocument, layout: LayoutDocument, label: string) => void;
  onVariants: (variants: ImportedVariant[]) => void;
  onEvidence: (bundle: ModelEvidenceBundle) => void;
  onReceipt: (receipt: ImplementationReceipt) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());

  const inspect = (input: string) => {
    setError(null);
    setResult(null);
    if (!input.trim()) return;
    try {
      const value = parseImportJsonText(input, IMPORT_LIMITS) as Record<string, unknown>;
      if (value && typeof value === 'object' && 'evidenceVersion' in value) {
        setResult({ kind: 'evidence', bundle: validateModelEvidence(value) });
      } else if (value && typeof value === 'object' && 'receiptVersion' in value) {
        setResult({ kind: 'receipt', receipt: validateImplementationReceipt(value) });
      } else if (isVariantsEnvelope(value)) {
        const items = previewVariants(value, current, knownModels);
        setSkipped(new Set(items.flatMap((item, index) => (item.error || item.duplicateOf ? [index] : []))));
        setResult({ kind: 'variants', items });
      } else {
        const preview = previewPortablePackageImport(value);
        setResult({ kind: 'model', document: preview.document, layout: preview.layout, summary: preview.summary, warnings: preview.importWarnings, changes: meaningDiff(current, preview.document) });
      }
    } catch (caught) {
      setError(`読み込めません: ${(caught as Error).message}。JSON全体（portable package / ModelDocument / 案の一覧 / Evidence / Receipt）を貼り付けてください。`);
    }
  };

  const chosen = result?.kind === 'variants'
    ? result.items.filter((item, index) => !skipped.has(index) && item.document && item.layout)
    : [];
  const overflow = Math.max(0, savedCount + chosen.length - VARIANT_CAPACITY);

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="読み込み" onClick={onClose}>
      <div className="import" onClick={(event) => event.stopPropagation()}>
        <h2>読み込む</h2>
        <textarea
          value={text}
          autoFocus
          placeholder="portable package・ModelDocument・案の一覧・Evidence・Implementation Receipt の JSON（AIの返答そのままでも可）"
          onChange={(event) => { setText(event.target.value); inspect(event.target.value); }}
        />
        <label className="file">
          ファイルを選ぶ
          <input type="file" accept=".json,application/json" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const content = await file.text();
            setText(content);
            inspect(content);
          }} />
        </label>
        {error && <p className="error">{error}</p>}
        {result?.kind === 'model' && (
          <div className="import-preview">
            <p>{result.summary}</p>
            {result.warnings.map((warning) => <p key={warning} className="note">{warning}</p>)}
            <ol className="meaning">
              {result.changes.slice(0, 12).map((change, index) => (
                <li key={index} className="meaning-item"><span className="meaning-kind">{MEANING_LABEL[change.kind]}</span><span className="meaning-text">{change.sentence}</span></li>
              ))}
            </ol>
            {result.changes.length > 12 && <p className="note">ほか {result.changes.length - 12} 件</p>}
          </div>
        )}
        {result?.kind === 'variants' && (
          <div className="import-preview">
            <p>{result.items.length} 案。現在のモデルは変えず、モデル案として追加します。</p>
            <ul className="import-variants">
              {result.items.map((item, index) => {
                const usable = Boolean(item.document && !item.error);
                const kinds = groupKinds(item.changes);
                return (
                  <li key={index} className={`import-variant${usable ? '' : ' is-error'}`}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={!usable}
                        checked={usable && !skipped.has(index)}
                        onChange={(event) => setSkipped((set) => {
                          const next = new Set(set);
                          if (event.target.checked) next.delete(index);
                          else next.add(index);
                          return next;
                        })}
                      />
                      <span className="import-variant-label">{item.label}</span>
                    </label>
                    <span className="import-variant-kinds">
                      {kinds.map((kind) => <span key={kind} className="meaning-kind">{MEANING_LABEL[kind]}</span>)}
                    </span>
                    {item.rationale && <span className="import-variant-why">{item.rationale}</span>}
                    {item.duplicateOf && <span className="note">「{item.duplicateOf}」と同じモデル（書き方違い）。既定では取り込みません。</span>}
                    {item.error && <span className="error">{item.error}</span>}
                  </li>
                );
              })}
            </ul>
            {overflow > 0 && <p className="note">モデル案は {VARIANT_CAPACITY} 件まで保存します。追加すると古い案 {overflow} 件が外れます（取り消せます）。</p>}
          </div>
        )}
        {result?.kind === 'evidence' && (
          <p>
            {result.bundle.runType} · {result.bundle.backend} · metric {result.bundle.metrics.length} / finding {result.bundle.findings.length}
            {result.bundle.quantities?.length ? ` / 結論 ${result.bundle.quantities.length}` : ''}
            {result.bundle.assessment ? ' / 予測性能・診断あり' : ''}
          </p>
        )}
        {result?.kind === 'receipt' && <p>{result.receipt.backend} · 対応 {result.receipt.mappings.length} 件</p>}
        <div className="import-acts">
          <button type="button" className="quiet" onClick={onClose}>閉じる</button>
          <button
            type="button"
            className="primary"
            disabled={!result || (result.kind === 'variants' && !chosen.length)}
            onClick={() => {
              if (result?.kind === 'model') onModel(result.document, result.layout, 'モデルを読み込む');
              else if (result?.kind === 'variants') onVariants(chosen.map((item) => ({ label: item.label, document: item.document!, layout: item.layout! })));
              else if (result?.kind === 'evidence') onEvidence(result.bundle);
              else if (result?.kind === 'receipt') onReceipt(result.receipt);
            }}
          >
            {result?.kind === 'model'
              ? 'このモデルに置き換える'
              : result?.kind === 'variants'
                ? `${chosen.length} 案を追加する`
                : result?.kind === 'evidence' ? 'Evidence を取り込む' : result?.kind === 'receipt' ? 'receipt を照合する' : '取り込む'}
          </button>
        </div>
      </div>
    </div>
  );
}

function previewVariants(value: unknown, current: ModelDocument, knownModels: ReadonlyMap<string, string>): VariantPreview[] {
  const envelope = validateVariantsEnvelope(value);
  const seen = new Map(knownModels);
  return envelope.variants.map((proposal) => {
    try {
      const preview = previewPortablePackageImport(proposal.model);
      const key = semanticFingerprint(preview.document).value;
      const duplicateOf = seen.get(key);
      if (!duplicateOf) seen.set(key, proposal.label);
      return {
        label: proposal.label,
        rationale: proposal.rationale,
        document: preview.document,
        layout: preview.layout,
        changes: meaningDiff(current, preview.document),
        duplicateOf,
      };
    } catch (caught) {
      return { label: proposal.label, rationale: proposal.rationale, changes: [], error: `読み込めません: ${(caught as Error).message}` };
    }
  });
}
