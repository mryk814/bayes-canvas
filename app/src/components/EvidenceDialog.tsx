interface EvidenceDialogProps {
  input: string;
  onChangeInput: (value: string) => void;
  onClose: () => void;
  onCopyProtocol: () => void;
  onImport: () => void;
  onOpenFile: () => void;
}

export function EvidenceDialog({
  input,
  onChangeInput,
  onClose,
  onCopyProtocol,
  onImport,
  onOpenFile,
}: EvidenceDialogProps) {
  return (
    <div className="start-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="検証Evidenceを読み込む"
        aria-modal="true"
        className="import-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="start-dialog-heading">
          <div>
            <span>EVIDENCE</span>
            <h2>検証結果を戻す</h2>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </div>
        <button className="evidence-protocol-button" type="button" onClick={onCopyProtocol}>
          <strong>検証protocolをコピー</strong>
          <span>外部AI・notebookへ仕様とEvidence形式を渡す</span>
        </button>
        <button className="evidence-file-button" type="button" onClick={onOpenFile}>
          Evidence JSONファイルを選ぶ
        </button>
        <label className="import-paste-field">
          bayes-canvas-evidence@1を貼り付け
          <textarea
            autoFocus
            placeholder={'```json\n{ "evidenceVersion": "bayes-canvas-evidence@1", ... }\n```'}
            value={input}
            onChange={(event) => onChangeInput(event.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button disabled={!input.trim()} type="button" onClick={onImport}>Evidenceを取り込む</button>
          <button type="button" onClick={onClose}>キャンセル</button>
        </div>
      </section>
    </div>
  );
}
