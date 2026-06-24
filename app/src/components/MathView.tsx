import { useMemo } from 'react';
import { TexMath } from './TexMath';
import {
  generateModelTex,
  generateModelTexSections,
  generateModelMarkdown,
  type ModelIr,
} from '../lib/modelIr';

interface MathViewProps {
  model: ModelIr;
  onSelectNode?: (nodeId: string) => void;
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

const VISIBLE_SECTION_TITLES = new Set([
  'Indices / Plates',
  'Index Mappings',
  'Data',
  'Priors',
  'Deterministic',
  'Likelihood',
  'Observation Process',
]);

export function MathView({ model, onSelectNode }: MathViewProps) {
  const sections = useMemo(() => generateModelTexSections(model), [model]);
  const visibleSections = useMemo(
    () => sections.filter((section) => VISIBLE_SECTION_TITLES.has(section.title)),
    [sections],
  );
  const fullTex = useMemo(() => generateModelTex(model), [model]);
  const markdown = useMemo(() => generateModelMarkdown(model), [model]);

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
      {visibleSections.map((section) => (
        <div className="math-section" key={section.title}>
          <h3 className="math-section-title">{section.title}</h3>
          <div className="math-section-lines">
            {section.lines.map((line, index) => (
              <div
                className={`math-line ${line.nodeId && onSelectNode ? 'math-line-clickable' : ''}`}
                key={`${section.title}-${index}`}
                onClick={line.nodeId && onSelectNode ? () => onSelectNode(line.nodeId!) : undefined}
              >
                <TexMath tex={line.tex} block />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
