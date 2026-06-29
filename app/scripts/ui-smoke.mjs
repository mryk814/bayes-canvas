import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
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
]) {
  assert.ok(appSource.includes(marker), `UI smoke marker missing: ${marker}`);
}

const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.ok(css.includes(':focus-visible'), 'focus-visible styles must remain reachable');
