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

export function MathView({ model, onSelectNode }: MathViewProps) {
  const sections = useMemo(() => generateModelTexSections(model), [model]);
  const fullTex = useMemo(() => generateModelTex(model), [model]);
  const markdown = useMemo(() => generateModelMarkdown(model), [model]);

  const hasContent = sections.some((section) => section.lines.length > 0);

  if (!hasContent) {
    return <p className="empty-note">Add nodes to see the model specification.</p>;
  }

  return (
    <div className="math-view">
      <div className="math-view-actions">
        <button type="button" onClick={() => copyText(fullTex)}>
          Copy TeX
        </button>
        <button type="button" onClick={() => copyText(markdown)}>
          Copy Markdown
        </button>
      </div>
      {sections.map((section) => (
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
