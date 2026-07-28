interface ImportDialogProps {
  input: string;
  onChangeInput: (value: string) => void;
  onClose: () => void;
  onCopyPrompt: () => void;
  onOpenFile: () => void;
  onPreviewText: () => void;
}

export function ImportDialog({
  input,
  onChangeInput,
  onClose,
  onCopyPrompt,
  onOpenFile,
  onPreviewText,
}: ImportDialogProps) {
  return (
    <div className="start-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="外部モデルを読み込む"
        aria-modal="true"
        className="import-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="start-dialog-heading">
          <div>
            <span>IMPORT</span>
            <h2>外部モデルを取り込む</h2>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </div>
        <div className="import-route-grid">
          <button type="button" onClick={onCopyPrompt}>
            <strong>1. AI変換promptをコピー</strong>
            <span>外部AIへ渡し、Bayes Canvas JSONを作らせる</span>
          </button>
          <button type="button" onClick={onOpenFile}>
            <strong>JSONファイルを選ぶ</strong>
            <span>.json / .bayescanvas.json</span>
          </button>
        </div>
        <label className="import-paste-field">
          AIのJSON出力を貼り付け
          <textarea
            autoFocus
            placeholder={'```json\n{ "packageVersion": "bayes-canvas-ai-import@1", ... }\n```'}
            value={input}
            onChange={(event) => onChangeInput(event.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button disabled={!input.trim()} type="button" onClick={onPreviewText}>
            貼り付け内容をプレビュー
          </button>
          <button type="button" onClick={onClose}>キャンセル</button>
        </div>
      </section>
    </div>
  );
}
