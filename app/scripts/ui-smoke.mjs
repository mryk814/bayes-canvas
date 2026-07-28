import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const projectionSource = await readFile(new URL('../src/lib/modelViewProjections.ts', import.meta.url), 'utf8');
const builtIndex = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

assert.match(builtIndex, /<div id="root"><\/div>/u);
for (const marker of [
  '自動保存があります',
  '読み込みプレビュー',
  'パッチをプレビューできません',
  'applyPendingPatch',
  'setPendingPatch(null)',
  'updateSelectedNodeData',
  '操作検索',
  '変換プロンプト',
  'モデルの出発点を選ぶ',
  '空のモデルから始める',
  'workspace-${workStage}',
  'undoDeleteSnapshot',
  'restoreRedo',
  'Control+Shift+Z',
  '図で組む',
]) {
  assert.ok(appSource.includes(marker), `UI smoke marker missing: ${marker}`);
}
for (const marker of ['数式で読む', '生成過程', '軸・plate', '実装契約']) {
  assert.ok(projectionSource.includes(marker), `Projection marker missing: ${marker}`);
}

const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.ok(css.includes(':focus-visible'), 'focus-visible styles must remain reachable');
assert.ok(css.includes('.workspace-build'), 'build workspace must keep the canvas-first layout');
assert.ok(css.includes('.work-stage-nav'), 'workflow stage navigation must remain visible');
assert.ok(css.includes('.command-shortcuts'), 'command palette must expose shortcut guidance');
assert.match(css, /\.status-stack\s*\{[^}]*position:\s*relative;/su, 'recovery status must not cover the canvas');
