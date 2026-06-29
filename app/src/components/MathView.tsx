import { useMemo } from 'react';
import { TexMath } from './TexMath';
import {
  generateModelTex,
  generateModelTexSections,
  generateModelMarkdown,
  type ModelIr,
} from '../lib/modelIr';
import { generateTexFromDocument } from '../lib/documentOutputs';
import type { ModelDocument } from '../lib/core/model';

interface MathViewProps {
  model: ModelIr;
  document?: ModelDocument;
  onSelectNode?: (nodeId: string) => void;
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

const VISIBLE_SECTION_TITLES = new Set([
  'Index Ranges',
  'Index Mappings',
  'Data',
  'Priors',
  'Deterministic',
  'Likelihood',
  'Observation Process',
]);

const SECTION_KIND_CLASS: Record<string, string> = {
  Data: 'math-line-data',
  Priors: 'math-line-prior',
  Deterministic: 'math-line-deterministic',
  Likelihood: 'math-line-likelihood',
  'Observation Process': 'math-line-observation',
  'Derived Quantities': 'math-line-query',
};

export function MathView({ model, document, onSelectNode }: MathViewProps) {
  const sections = useMemo(() => generateModelTexSections(model), [model]);
  const visibleSections = useMemo(
    () => sections.filter((section) => VISIBLE_SECTION_TITLES.has(section.title)),
    [sections],
  );
  const fullTex = useMemo(() => document ? generateTexFromDocument(document) : generateModelTex(model), [document, model]);
  const markdown = useMemo(() => document ? `$$\n${generateTexFromDocument(document)}\n$$` : generateModelMarkdown(model), [document, model]);

  const hasContent = visibleSections.some((section) => section.lines.length > 0);

  if (!hasContent) {
    return <p className="empty-note">ノードを追加すると数式が表示されます。</p>;
  }

  return (
    <div className="math-view">
      <div className="math-view-actions">
        <button type="button" onClick={() => copyText(fullTex)}>
          TeXをコピー
        </button>
        <button type="button" onClick={() => copyText(markdown)}>
          Markdownをコピー
        </button>
      </div>
      {document ? (
        <div className="math-section">
          <h3 className="math-section-title">
            <span>ModelDocument</span>
            <span className="math-section-count">{document.entityOrder.length}</span>
          </h3>
          <div className="math-section-lines">
            <div className="math-line">
              <TexMath tex={fullTex} block />
            </div>
          </div>
        </div>
      ) : null}
      {document ? null : visibleSections.map((section) => {
        const kindClass = SECTION_KIND_CLASS[section.title] ?? '';
        return (
          <div className="math-section" key={section.title}>
            <h3 className="math-section-title">
              <span>{section.title}</span>
              <span className="math-section-count">{section.lines.length}</span>
            </h3>
            <div className="math-section-lines">
              {section.lines.map((line, index) => {
                const key = `${section.title}-${index}`;
                if (line.nodeId && onSelectNode) {
                  return (
                    <button
                      aria-label={`${line.tex} のノードを選択`}
                      className={`math-line math-line-clickable ${kindClass}`}
                      key={key}
                      type="button"
                      onClick={() => onSelectNode(line.nodeId!)}
                    >
                      <TexMath tex={line.tex} />
                    </button>
                  );
                }
                return (
                  <div className="math-line" key={key}>
                    <TexMath tex={line.tex} block />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
