#!/usr/bin/env node
/**
 * tools/version.js — stamp a content hash onto every asset reference.
 *
 * GitHub Pages serves this repository's files directly, with a cache lifetime
 * it controls, so a returning visitor can keep running yesterday's JavaScript
 * against today's HTML. That is invisible to whoever deployed and confusing to
 * whoever is looking at it.
 *
 * This rewrites `./src/app.js` to `./src/app.js?v=<hash>` in index.html, and
 * the same for the internal `import ... from './x.js'` statements, so a byte
 * change anywhere in src/ produces new URLs and the browser has nothing stale
 * to serve. Idempotent: any existing stamp is stripped before the new one is
 * applied.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

/**
 * Every shipped module under src/, at any depth, as a POSIX-style path
 * relative to src/.
 *
 * This walks recursively on purpose. It previously read only the top level,
 * so once the engine grew subdirectories (src/core, src/rules) their contents
 * were absent from the hash — a byte could change in a tax rule and the stamp
 * would not move, which is precisely the stale-code bug the stamp exists to
 * prevent. Sorting keeps the hash stable across platforms and filesystems.
 */
function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else if (/\.(js|css)$/.test(entry.name)) out.push(rel);
  }
  return out;
}
const files = walk(srcDir).sort();

const strip = (text) => text.replace(/(\.(?:js|css))\?v=[a-f0-9]+/g, '$1');

// Hash the stripped contents so the stamp never feeds into its own input.
const hash = crypto.createHash('sha256');
for (const f of files) {
  hash.update(f).update(strip(fs.readFileSync(path.join(srcDir, f), 'utf8')));
}
const v = hash.digest('hex').slice(0, 10);

let changed = 0;

// index.html: the stylesheet link and the module entry point.
const indexPath = path.join(root, 'index.html');
const before = fs.readFileSync(indexPath, 'utf8');
const after = strip(before).replace(/\.\/src\/(app\.js|styles\.css)/g, `./src/$1?v=${v}`);
if (after !== before) { fs.writeFileSync(indexPath, after); changed++; }

/*
 * Inter-module imports are deliberately NOT stamped.
 *
 * A query string forks the module graph: to a browser (and to Node)
 * "./money.js" and "./money.js?v=abc" are two different modules, each with its
 * own copy of every class it exports. Anything reached by both specifiers then
 * has two distinct constructors, and `instanceof` between them is false. Once
 * the engine started exporting classes (Money, Decimal) that stopped being
 * theoretical: stamping the internal imports made `evaluateRule` reject its own
 * Money objects.
 *
 * What the stamp on index.html still buys is real, because the hash above
 * covers every module at every depth: change a tax rule and the entry-point URL
 * changes, so no returning browser pairs a new index.html with a cached app.js.
 *
 * The dependencies behind that entry point are covered by GitHub Pages' own
 * caching, which serves src/ with `Cache-Control: max-age=600` and an ETag —
 * bounded staleness of ten minutes, then revalidation. Content-hashed
 * FILENAMES would remove even that window, but they require publishing a built
 * artifact rather than serving the repository root, which is a deployment
 * change rather than a build one. See README § Deployment.
 */


console.log(`Stamped ${changed} file(s) with ?v=${v}`);
