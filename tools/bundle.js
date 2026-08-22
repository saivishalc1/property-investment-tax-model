#!/usr/bin/env node
/**
 * tools/bundle.js — build a single self-contained HTML file.
 *
 * GitHub Pages serves the ES modules directly, which is the honest way to ship
 * this app. Some hosts (and the Claude Artifact runtime) want one file instead,
 * so this concatenates the modules in dependency order, strips the import and
 * export keywords, and inlines the stylesheet.
 *
 * The calculation code is copied verbatim — nothing is rewritten or minified —
 * so the bundle computes exactly what the tested modules compute.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Dependency order. app.js comes last because the `store` namespace shim has
// to be initialised before app.js's bottom-of-file init() call runs.
const ORDER = [
  'src/calculations.js',
  'src/presets.js',
  'src/storage.js',
  'src/validation.js',
];
const APP = 'src/app.js';

function strip(src) {
  return src
    // drop local import statements entirely
    .replace(/^import\s+[^;]*?from\s+['"]\.\/[^'"]+['"];\s*$/gm, '')
    // `export const` / `export function` / `export class` -> plain declaration
    .replace(/^export\s+(const|let|var|function|class|async)\b/gm, '$1')
    // `export { a, b };` -> removed (names are already in scope)
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');
}

const modules = ORDER.map((f) => `/* ===== ${f} ===== */\n${strip(read(f))}`).join('\n\n');
const app = `/* ===== ${APP} ===== */\n${strip(read(APP))}`;

// app.js uses `store.*` for the storage module namespace.
const storeShim = `
/* namespace shim: app.js refers to the storage module as \`store\` */
const store = {
  SCHEMA_VERSION, defaultState, nycExampleState, newId, sanitize, migrate,
  normaliseTable, saveAutosave, loadAutosave, clearAutosave, listScenarios,
  saveScenario, deleteScenario, duplicateScenario, loadPrefs, savePrefs,
};
`;

const html = read('index.html');
const bodyStart = html.indexOf('<body>') + '<body>'.length;
const bodyEnd = html.indexOf('<script type="module"');
let body = html.slice(bodyStart, bodyEnd);

// The bundle is served from a single file, so the module <script> and the
// stylesheet <link> are replaced by inline blocks.
const css = read('src/styles.css');
const title = 'Property Investment Tax Model';

const out = `<title>${title}</title>
<style>
${css}
</style>
${body}
<script type="module">
${modules}
${storeShim}
${app}
</script>
`;

fs.writeFileSync(path.join(root, 'artifact.html'), out);
console.log(`bundle written: artifact.html (${(out.length / 1024).toFixed(1)} kB)`);
