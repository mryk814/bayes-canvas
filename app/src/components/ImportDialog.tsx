import { useState } from 'react';

interface ImportDialogProps {
  input: string;
  dataInput: string;
  onChangeInput: (value: string) => void;
  onChangeDataInput: (value: string) => void;
  onClose: () => void;
  onCopyPrompt: () => void;
  onOpenFile: () => void;
  onOpenDataFile: () => void;
  onProfileData: () => void;
  onPreviewText: () => void;
}

export function ImportDialog({
  input,
  dataInput,
  onChangeInput,
  onChangeDataInput,
  onClose,
  onCopyPrompt,
  onOpenFile,
  onOpenDataFile,
  onProfileData,
  onPreviewText,
}: ImportDialogProps) {
  const [mode, setMode] = useState<'model' | 'data'>('model');
  return (
    <div className="start-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={mode === 'model' ? '外部モデルを読み込む' : 'データから契約を作る'}
        aria-modal="true"
        className="import-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="start-dialog-heading">
          <div>
            <span>IMPORT</span>
            <h2>{mode === 'model' ? '外部モデルを取り込む' : 'データから契約を作る'}</h2>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </div>
        <div aria-label="読み込み対象" className="dialog-mode-tabs" role="tablist">
          <button
            aria-selected={mode === 'model'}
            role="tab"
            type="button"
            onClick={() => setMode('model')}
          >
            モデル
          </button>
          <button
            aria-selected={mode === 'data'}
            role="tab"
            type="button"
            onClick={() => setMode('data')}
          >
            データ
          </button>
        </div>
        {mode === 'model' ? (
          <>
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
          </>
        ) : (
          <>
            <label className="import-paste-field">
              CSV / TSVのheaderと代表行を貼り付け
              <textarea
                autoFocus
                placeholder={'outcome,x,group_id\n12.4,1.8,A\n10.9,2.1,B'}
                value={dataInput}
                onChange={(event) => onChangeDataInput(event.target.value)}
              />
            </label>
            <button className="evidence-file-button" type="button" onClick={onOpenDataFile}>
              CSV / TSVファイルを選ぶ
            </button>
            <div className="dialog-actions">
              <button disabled={!dataInput.trim()} type="button" onClick={onProfileData}>
                データ契約を作成
              </button>
              <button type="button" onClick={onClose}>キャンセル</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
