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
const files = fs.readdirSync(srcDir).filter((f) => /\.(js|css)$/.test(f)).sort();

const strip = (text) => text.replace(/(\.(?:js|css))\?v=[a-f0-9]+/g, '$1');

// Hash the stripped contents so the stamp never feeds into its own input.
const hash = crypto.createHash('sha256');
for (const f of files) hash.update(f).update(strip(fs.readFileSync(path.join(srcDir, f), 'utf8')));
const v = hash.digest('hex').slice(0, 10);

let changed = 0;

// index.html: the stylesheet link and the module entry point.
const indexPath = path.join(root, 'index.html');
const before = fs.readFileSync(indexPath, 'utf8');
const after = strip(before).replace(/\.\/src\/(app\.js|styles\.css)/g, `./src/$1?v=${v}`);
if (after !== before) { fs.writeFileSync(indexPath, after); changed++; }

// src/*.js: the relative imports between modules.
for (const f of files.filter((n) => n.endsWith('.js'))) {
  const p = path.join(srcDir, f);
  const src = fs.readFileSync(p, 'utf8');
  const out = strip(src).replace(/from '\.\/([\w.-]+\.js)'/g, `from './$1?v=${v}'`);
  if (out !== src) { fs.writeFileSync(p, out); changed++; }
}

console.log(`Stamped ${changed} file(s) with ?v=${v}`);
