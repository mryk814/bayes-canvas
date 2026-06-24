import { useMemo } from 'react';
import katex from 'katex';

interface TexMathProps {
  tex: string;
  block?: boolean;
  className?: string;
  onClick?: () => void;
}

export function TexMath({ tex, block = false, className, onClick }: TexMathProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: block,
        throwOnError: false,
        trust: true,
      });
    } catch {
      return tex;
    }
  }, [tex, block]);

  const Tag = block ? 'div' : 'span';

  return (
    <Tag
      className={`tex-math ${block ? 'tex-block' : 'tex-inline'} ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    />
  );
}
