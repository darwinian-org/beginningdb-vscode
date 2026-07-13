import { readFile } from 'node:fs/promises';

const bundle = await readFile(new URL('../dist/extension.browser.js', import.meta.url), 'utf8');
const forbidden = [
  { name: 'child_process', pattern: /(?:node:)?child_process/ },
  { name: 'fs', pattern: /require\(["'](?:node:)?fs(?:\/promises)?["']\)|from ["'](?:node:)?fs(?:\/promises)?["']/ },
  { name: 'path', pattern: /require\(["'](?:node:)?path["']\)|from ["'](?:node:)?path["']/ },
  { name: 'util', pattern: /(?:node:)?util/ },
  { name: 'Buffer', pattern: /\bBuffer\.from\b/ }
];

const leaks = forbidden.filter(({ pattern }) => pattern.test(bundle));
if (leaks.length > 0) {
  throw new Error(`Browser bundle includes Node-only APIs: ${leaks.map(leak => leak.name).join(', ')}`);
}

console.log('Browser bundle contains no forbidden Node-only APIs.');
