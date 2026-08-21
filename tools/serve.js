#!/usr/bin/env node
/**
 * Minimal static file server for local development and for the end-to-end
 * tests. Optionally serves the site under a base path, so the GitHub Pages
 * project subpath (/property-investment-tax-model/) can be tested locally.
 *
 *   node tools/serve.js 4173
 *   node tools/serve.js 4174 /property-investment-tax-model
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 4173);
const base = (process.argv[3] || '').replace(/\/$/, '');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (base) {
    if (urlPath === base) { res.writeHead(302, { Location: base + '/' }); res.end(); return; }
    if (!urlPath.startsWith(base + '/')) { res.writeHead(404).end('Not found'); return; }
    urlPath = urlPath.slice(base.length);
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const filePath = path.join(root, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`serving ${root} at http://localhost:${port}${base}/`);
});
