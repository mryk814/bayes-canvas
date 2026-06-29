import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const files = await collect(root);
const checked = files.filter((file) => /\.(tsx?|jsx?|mjs|json|css|md|yml)$/u.test(file))
  .filter((file) => !file.includes('/dist') && !file.includes('/node_modules/'));
const failures = [];

for (const file of checked) {
  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (/[ \t]$/u.test(line)) failures.push(`${file}:${index + 1}: trailing whitespace`);
    if (line.includes('\t')) failures.push(`${file}:${index + 1}: tab indentation`);
    if (line.length > 800) failures.push(`${file}:${index + 1}: line exceeds 800 characters`);
  });
}

if (failures.length) {
  console.error(failures.slice(0, 80).join('\n'));
  process.exit(1);
}

async function collect(url) {
  const entries = await readdir(url, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('dist')) continue;
    if (entry.isDirectory()) output.push(...await collect(new URL(`${entry.name}/`, url)));
    if (entry.isFile()) output.push(new URL(entry.name, url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'));
  }
  return output;
}
