import type { ImplementationReceipt } from '../lib/core/receipt.js';
import type {
  DiagnosticFixCandidate,
  ModelVariant,
  ModelingRecipe,
  PriorPredictiveCheck,
  VariantComparison,
} from '../lib/modelWorkbench.js';

interface WorkbenchPanelProps {
  diagnosticFixes: DiagnosticFixCandidate[];
  pendingPatchSummary: string | null;
  variants: ModelVariant[];
  selectedVariantId: string;
  comparison?: VariantComparison;
  priorChecks: PriorPredictiveCheck[];
  recipes: ModelingRecipe[];
  receipt: ImplementationReceipt | null;
  receiptStatus: { matches: boolean; message: string } | null;
  onApplyRecipe: (recipeId: ModelingRecipe['id']) => void;
  onCopyPriorPrompt: () => void;
  onDeleteVariant: (variantId: string) => void;
  onDismissPatch: () => void;
  onImportReceipt: () => void;
  onPreviewDiagnosticFix: (candidate: DiagnosticFixCandidate) => void;
  onApplyPendingPatch: () => void;
  onRestoreVariant: (variantId: string) => void;
  onSaveVariant: () => void;
  onSelectVariant: (variantId: string) => void;
}

export function WorkbenchPanel({
  diagnosticFixes,
  pendingPatchSummary,
  variants,
  selectedVariantId,
  comparison,
  priorChecks,
  recipes,
  receipt,
  receiptStatus,
  onApplyRecipe,
  onCopyPriorPrompt,
  onDeleteVariant,
  onDismissPatch,
  onImportReceipt,
  onPreviewDiagnosticFix,
  onApplyPendingPatch,
  onRestoreVariant,
  onSaveVariant,
  onSelectVariant,
}: WorkbenchPanelProps) {
  const reviewed = priorChecks.filter((item) => item.status === 'ready').length;
  return (
    <div className="workbench-panel">
      <section className="workbench-card">
        <div className="panel-title compact">
          <h2>診断から修正</h2>
          <span>{diagnosticFixes.length}</span>
        </div>
        {pendingPatchSummary ? (
          <div className="patch-review">
            <span>{pendingPatchSummary}</span>
            <div className="row-actions">
              <button type="button" onClick={onApplyPendingPatch}>修正を適用</button>
              <button type="button" onClick={onDismissPatch}>閉じる</button>
            </div>
          </div>
        ) : diagnosticFixes.length ? (
          <div className="diagnostic-fix-list">
            {diagnosticFixes.slice(0, 5).map((candidate) => (
              <button
                key={`${candidate.diagnostic.code}-${candidate.fix.id}`}
                type="button"
                onClick={() => onPreviewDiagnosticFix(candidate)}
              >
                <strong>{candidate.fix.title}</strong>
                <span>{candidate.diagnostic.code} · 差分を確認して適用</span>
              </button>
            ))}
          </div>
        ) : <p className="empty-note">自動修正できる診断はありません。</p>}
      </section>

      <section className="workbench-card">
        <div className="panel-title compact">
          <h2>モデル案</h2>
          <button type="button" onClick={onSaveVariant}>現在を保存</button>
        </div>
        {variants.length ? (
          <>
            <label>
              比較元
              <select value={selectedVariantId} onChange={(event) => onSelectVariant(event.target.value)}>
                <option value="">選択してください</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>{variant.label}</option>
                ))}
              </select>
            </label>
            {comparison ? (
              <div className="variant-summary">
                <strong>{comparison.changes.length}差分</strong>
                <span>重要 {comparison.critical} / 確認 {comparison.warnings}</span>
                <div className="variant-diff-list">
                  {comparison.changes.slice(0, 5).map((change) => (
                    <span key={`${change.kind}-${change.path}`}>{change.label}</span>
                  ))}
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => onRestoreVariant(comparison.baseline.id)}>この案を開く</button>
                  <button type="button" onClick={() => onDeleteVariant(comparison.baseline.id)}>削除</button>
                </div>
              </div>
            ) : null}
          </>
        ) : <p className="empty-note">現在のモデルを保存すると、以後の変更と比較できます。</p>}
      </section>

      <section className="workbench-card">
        <div className="panel-title compact">
          <h2>Prior predictive</h2>
          <span>{reviewed}/{priorChecks.length}</span>
        </div>
        <div className="prior-check-list">
          {priorChecks.slice(0, 6).map((item) => (
            <div className={`prior-check prior-${item.status}`} key={item.id}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
        <button type="button" onClick={onCopyPriorPrompt}>検証promptをコピー</button>
      </section>

      <section className="workbench-card">
        <div className="panel-title compact">
          <h2>モデルレシピ</h2>
          <span>{recipes.length}</span>
        </div>
        <div className="recipe-list">
          {recipes.map((recipe) => (
            <button key={recipe.id} type="button" onClick={() => onApplyRecipe(recipe.id)}>
              <strong>{recipe.label}</strong>
              <span>{recipe.note}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="workbench-card">
        <div className="panel-title compact">
          <h2>実装receipt</h2>
          <button type="button" onClick={onImportReceipt}>読み込む</button>
        </div>
        {receipt && receiptStatus ? (
          <div className={receiptStatus.matches ? 'receipt-status is-match' : 'receipt-status is-mismatch'}>
            <strong>{receipt.backend}</strong>
            <span>{receiptStatus.message}</span>
            <small>
              対応 {receipt.mappings.length} / 差分 {receipt.deviations.length} / 追加仮定 {receipt.addedAssumptions.length}
            </small>
          </div>
        ) : <p className="empty-note">実装側の対応表を戻すと、現在の仕様との一致を確認できます。</p>}
      </section>
    </div>
  );
}
