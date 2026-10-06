import { memo, useMemo } from 'react';
import katex from 'katex';

/** KaTeX with addressable symbols: \htmlData{sym=...}{...} becomes data-sym. */
export const Tex = memo(function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: false,
        trust: (context) => context.command === '\\htmlData',
      });
    } catch {
      return tex;
    }
  }, [tex, display]);
  return <span className="tex" dangerouslySetInnerHTML={{ __html: html }} />;
});
