import { useMemo } from 'react';
import katex from 'katex';

interface TexMathProps {
  tex: string;
  block?: boolean;
  className?: string;
  onClick?: () => void;
}

export function TexMath({ tex, block = false, className, onClick }: TexMathProps) {
  const rendered = useMemo(() => {
    try {
      return {
        html: katex.renderToString(tex, {
        displayMode: block,
        throwOnError: false,
          strict: 'warn',
          // User-authored TeX is untrusted. Keep URL/HTML-like KaTeX extensions disabled.
          trust: false,
        }),
        error: null,
      };
    } catch (error) {
      return {
        html: null,
        error: error instanceof Error ? error.message : 'TeXの表示に失敗しました。',
      };
    }
  }, [tex, block]);

  const Tag = block ? 'div' : 'span';

  return (
    <Tag
      className={`tex-math ${block ? 'tex-block' : 'tex-inline'} ${rendered.error ? 'tex-error' : ''} ${className ?? ''}`}
      dangerouslySetInnerHTML={rendered.html ? { __html: rendered.html } : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={rendered.error ? `${rendered.error} 入力したTeX: ${tex}` : undefined}
    >
      {rendered.html ? null : tex}
    </Tag>
  );
}
