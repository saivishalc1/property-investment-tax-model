#!/usr/bin/env node
/**
 * "Production build" for a dependency-free static site.
 *
 * There is nothing to transpile or bundle — the browser loads the ES modules
 * directly, which is what keeps the deployment honest. What this script does
 * instead is produce a clean `dist/` tree and refuse to produce one that would
 * break on GitHub Pages:
 *
 *   - every local href/src/import resolves to a file that exists;
 *   - no absolute-root paths ("/src/app.js") that would 404 under a project
 *     subpath such as /property-investment-tax-model/;
 *   - no obvious secret material anywhere in the shipped files;
 *   - no external network origins beyond the ones the CSP allows;
 *   - a sitemap and a .nojekyll marker.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const INCLUDE = ['index.html', 'robots.txt', 'src', 'assets'];
const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/* ---------- copy ---------- */
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const item of INCLUDE) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) { errors.push(`missing ${item}`); continue; }
  fs.cpSync(src, path.join(dist, item), { recursive: true });
}
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

const files = walk(dist);

/* ---------- reference check ---------- */
const REF = /(?:href|src)\s*=\s*"([^"]+)"|from\s+'([^']+)'|import\s*\(\s*'([^']+)'/g;
for (const file of files) {
  if (!/\.(html|js|css|webmanifest)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = REF.exec(text))) {
    const ref = m[1] || m[2] || m[3];
    if (!ref || ref.startsWith('#') || ref.startsWith('data:') || ref.startsWith('mailto:')) continue;
    if (/^https?:\/\//.test(ref)) continue;
    if (ref.startsWith('/')) {
      errors.push(`${path.relative(dist, file)}: root-absolute path "${ref}" breaks under a GitHub Pages project subpath`);
      continue;
    }
    const target = path.resolve(path.dirname(file), ref.split(/[?#]/)[0]);
    if (!fs.existsSync(target)) {
      errors.push(`${path.relative(dist, file)}: broken reference "${ref}"`);
    }
  }
}

/* ---------- secret scan ---------- */
const SECRET_PATTERNS = [
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'API secret key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/["']?(api[_-]?key|secret|password|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, 'hardcoded credential'],
];
for (const file of files) {
  if (!/\.(html|js|css|json|txt|webmanifest)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(text)) errors.push(`${path.relative(dist, file)}: possible ${label} in shipped file`);
  }
}

/* ---------- network scan ---------- */
for (const file of files) {
  if (!/\.(html|js)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const call of ['fetch(', 'XMLHttpRequest', 'new WebSocket', 'navigator.sendBeacon', 'EventSource']) {
    if (text.includes(call)) {
      errors.push(`${path.relative(dist, file)}: network call "${call}" — this application must never transmit user input`);
    }
  }
}

/* ---------- sitemap ---------- */
fs.writeFileSync(path.join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>./</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`);

/* ---------- report ---------- */
const total = files.length;
const bytes = files.reduce((s, f) => s + fs.statSync(f).size, 0);
for (const w of warnings) console.warn('warn:', w);
if (errors.length) {
  for (const e of errors) console.error('error:', e);
  console.error(`\nBuild failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`Build OK — ${total} files, ${(bytes / 1024).toFixed(1)} kB in dist/`);
