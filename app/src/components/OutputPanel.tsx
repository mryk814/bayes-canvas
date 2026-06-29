import { MathView } from './MathView';
import type { HandoffTarget } from '../lib/core/handoff';
import type { ModelDocument } from '../lib/core/model';
import { getPromptTargetLabel, type ModelIr, type PromptTarget } from '../lib/modelIr';

export type OutputMode = 'math' | 'review' | 'handoff' | 'advanced';
export type AdvancedOutputMode = 'ir' | 'prompt' | 'package' | 'diff';
export type HandoffPreviewFormat = 'markdown' | 'json';

interface OutputPanelProps {
  activeOutput: OutputMode;
  advancedOutput: AdvancedOutputMode;
  handoffPreviewFormat: HandoffPreviewFormat;
  outputText: string;
  modelIr: ModelIr;
  document: ModelDocument;
  promptTarget: HandoffTarget;
  promptTargets: PromptTarget[];
  onCopyOutput: () => void;
  onCopyPackageModel: () => void;
  onSelectNode: (nodeId: string) => void;
  onSetActiveOutput: (output: OutputMode) => void;
  onSetAdvancedOutput: (output: AdvancedOutputMode) => void;
  onSetHandoffPreviewFormat: (format: HandoffPreviewFormat) => void;
  onSetPromptTarget: (target: PromptTarget) => void;
}

export function OutputPanel({
  activeOutput,
  advancedOutput,
  handoffPreviewFormat,
  outputText,
  modelIr,
  document,
  promptTarget,
  promptTargets,
  onCopyOutput,
  onCopyPackageModel,
  onSelectNode,
  onSetActiveOutput,
  onSetAdvancedOutput,
  onSetHandoffPreviewFormat,
  onSetPromptTarget,
}: OutputPanelProps) {
  return (
    <>
      <div className="output-tabs" aria-label="出力の種類" role="tablist">
        <OutputTab activeOutput={activeOutput} id="math" label="数式" onSelect={onSetActiveOutput} />
        <OutputTab activeOutput={activeOutput} id="review" label="診断" onSelect={onSetActiveOutput} />
        <OutputTab activeOutput={activeOutput} id="handoff" label="受け渡し" onSelect={onSetActiveOutput} />
        <OutputTab activeOutput={activeOutput} id="advanced" label="詳細" onSelect={onSetActiveOutput} />
      </div>
      <div
        aria-labelledby={`output-tab-${activeOutput}`}
        className="output-panel"
        id="output-panel"
        role="tabpanel"
      >
        {activeOutput === 'math' ? (
          <MathView
            model={modelIr}
            document={document}
            onSelectNode={onSelectNode}
          />
        ) : (
          <>
            <div className="output-actions">
              <span>{getOutputLabel(activeOutput, advancedOutput)}</span>
              <button type="button" onClick={onCopyOutput}>
                コピー
              </button>
              {activeOutput === 'advanced' && advancedOutput === 'package' ? (
                <button type="button" onClick={onCopyPackageModel}>
                  model.json
                </button>
              ) : null}
              {activeOutput === 'advanced' ? (
                <div className="segmented-control" aria-label="詳細出力">
                  <button
                    type="button"
                    className={advancedOutput === 'ir' ? 'is-active' : ''}
                    onClick={() => onSetAdvancedOutput('ir')}
                  >
                    IR
                  </button>
                  <button
                    type="button"
                    className={advancedOutput === 'prompt' ? 'is-active' : ''}
                    onClick={() => onSetAdvancedOutput('prompt')}
                  >
                    AIメモ
                  </button>
                  <button
                    type="button"
                    className={advancedOutput === 'package' ? 'is-active' : ''}
                    onClick={() => onSetAdvancedOutput('package')}
                  >
                    Package
                  </button>
                  <button
                    type="button"
                    className={advancedOutput === 'diff' ? 'is-active' : ''}
                    onClick={() => onSetAdvancedOutput('diff')}
                  >
                    Diff
                  </button>
                </div>
              ) : null}
              {activeOutput === 'handoff' ? (
                <div className="segmented-control" aria-label="受け渡しプレビュー形式">
                  <button
                    type="button"
                    className={handoffPreviewFormat === 'markdown' ? 'is-active' : ''}
                    onClick={() => onSetHandoffPreviewFormat('markdown')}
                  >
                    Markdown
                  </button>
                  <button
                    type="button"
                    className={handoffPreviewFormat === 'json' ? 'is-active' : ''}
                    onClick={() => onSetHandoffPreviewFormat('json')}
                  >
                    JSON
                  </button>
                </div>
              ) : null}
            </div>
            {activeOutput === 'handoff' || (activeOutput === 'advanced' && advancedOutput === 'prompt') ? (
              <label className="prompt-target">
                出力先
                <select
                  value={promptTarget}
                  onChange={(event) => onSetPromptTarget(event.target.value as PromptTarget)}
                >
                  {promptTargets.map((target) => (
                    <option key={target} value={target}>
                      {getPromptTargetLabel(target)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <pre>{outputText}</pre>
          </>
        )}
      </div>
    </>
  );
}

function OutputTab({
  activeOutput,
  id,
  label,
  onSelect,
}: {
  activeOutput: OutputMode;
  id: OutputMode;
  label: string;
  onSelect: (output: OutputMode) => void;
}) {
  return (
    <button
      aria-controls="output-panel"
      aria-selected={activeOutput === id}
      className={activeOutput === id ? 'is-active' : ''}
      id={`output-tab-${id}`}
      onClick={() => onSelect(id)}
      role="tab"
      tabIndex={activeOutput === id ? 0 : -1}
      type="button"
    >
      {label}
    </button>
  );
}

function getOutputLabel(activeOutput: OutputMode, advancedOutput: AdvancedOutputMode): string {
  if (activeOutput === 'review') return '診断一覧';
  if (activeOutput === 'handoff') return '受け渡しサマリー';
  if (advancedOutput === 'ir') return 'JSON契約';
  if (advancedOutput === 'prompt') return '実装用メモ';
  if (advancedOutput === 'package') return 'portable package';
  return 'semantic diff';
}
