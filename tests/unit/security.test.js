/**
 * security.test.js — properties of the shipped code, asserted rather than assumed.
 *
 * Each of these was verified by hand once. A hand check is true on the day it
 * is run; these make the same statements survive every later change, and each
 * one names the attack it prevents rather than the rule it enforces.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every shipped source file, at any depth. */
function shippedFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (/\.(js|css)$/.test(entry.name)) out.push(p);
    }
  };
  walk(path.join(root, 'src'));
  out.push(path.join(root, 'index.html'));
  return out;
}

/** Source with comments removed, so a comment mentioning a pattern is not a hit. */
function codeOnly(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/<!--[\s\S]*?-->/g, '');
}

describe('No script-injection sink exists in shipped code', () => {
  test('nothing assigns innerHTML or outerHTML', () => {
    // The element helper once offered an `html:` option for "static markup".
    // It had no call sites, so it was an injection sink kept open for nothing —
    // the one place a future change could introduce XSS by passing the wrong
    // variable. Containers are emptied by removing children instead.
    const offenders = [];
    for (const file of shippedFiles()) {
      if (/\.(innerHTML|outerHTML)\s*=/.test(codeOnly(file))) {
        offenders.push(path.relative(root, file));
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('nothing evaluates a string as code', () => {
    const offenders = [];
    for (const file of shippedFiles()) {
      const code = codeOnly(file);
      if (/\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(|insertAdjacentHTML/.test(code)) {
        offenders.push(path.relative(root, file));
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('no inline event handler attributes in the markup', () => {
    // onclick="..." would need 'unsafe-inline' in the script policy.
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const inline = html.match(/\son(click|load|error|submit|change|input|mouseover)\s*=/gi) || [];
    assert.deepEqual(inline, []);
  });
});

describe('The calculation engine reaches no network and holds no secret', () => {
  test('nothing in shipped code opens a connection', () => {
    // The product must compute offline with no service of any kind. The auth
    // verifier is exempt: it runs at the edge, not in the browser, and fetching
    // Cloudflare's signing keys is the entire point of it.
    const offenders = [];
    for (const file of shippedFiles()) {
      if (file.includes(path.join('src', 'auth'))) continue;
      const code = codeOnly(file);
      if (/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|sendBeacon|new\s+EventSource/.test(code)) {
        offenders.push(path.relative(root, file));
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('no secret-shaped string is committed', () => {
    const pattern = /(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
    const offenders = [];
    for (const file of shippedFiles()) {
      if (pattern.test(fs.readFileSync(file, 'utf8'))) offenders.push(path.relative(root, file));
    }
    assert.deepEqual(offenders, []);
  });

  test('the only external origins are documentation citations', () => {
    // A rule pack cites gov.uk and the IRS. Those are links a reader follows,
    // never anything the code requests.
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const origins = [...html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
    const disallowed = origins.filter((o) => !/(^|\.)(w3\.org|schema\.org|gov\.uk|irs\.gov|tax\.ny\.gov|nyc\.gov|nta\.go\.jp|tax\.metro\.tokyo\.lg\.jp|sitemaps\.org)$/.test(o));
    assert.deepEqual([...new Set(disallowed)], []);
  });
});

describe('The content security policy is strict', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const csp = (html.match(/content="(default-src[^"]*)"/) || [])[1] || '';

  test('a policy is present', () => {
    assert.ok(csp.length > 0, 'index.html carries a CSP');
  });

  test('scripts and styles are same-origin only, with no unsafe directives', () => {
    assert.match(csp, /script-src 'self'/);
    assert.ok(!/unsafe-inline/.test(csp), "no 'unsafe-inline'");
    assert.ok(!/unsafe-eval/.test(csp), "no 'unsafe-eval'");
  });

  test('the page cannot open a connection or be used as a form target', () => {
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
  });

  test('the edge adds frame-ancestors, which a meta tag cannot', () => {
    // Anything behind a login must also be unframeable, or the login is
    // defeated by clickjacking. A <meta> CSP cannot express frame-ancestors,
    // so it is set as a real header in the middleware.
    const mw = fs.readFileSync(path.join(root, 'functions', '_middleware.js'), 'utf8');
    assert.match(mw, /frame-ancestors 'none'/);
    assert.match(mw, /Strict-Transport-Security/);
    assert.match(mw, /X-Content-Type-Options/);
  });
});

describe('The access guard fails closed', () => {
  const mw = fs.readFileSync(path.join(root, 'functions', '_middleware.js'), 'utf8');

  test('a missing configuration denies rather than serves', () => {
    assert.match(mw, /if \(!teamDomain \|\| !audience \|\| !ownerEmail\)/);
    assert.match(mw, /return deny\(503/);
  });

  test('only the health probe is public', () => {
    assert.match(mw, /const PUBLIC_PATHS = new Set\(\['\/healthz'\]\)/);
  });

  test('the denial reason is logged, never returned to the client', () => {
    // Telling an attacker whether the signature or the email failed is free
    // reconnaissance.
    assert.match(mw, /return deny\(403, 'Not authorised\.'\)/);
    assert.ok(!/deny\(403, `[^`]*\$\{result\.reason\}/.test(mw), 'the reason is not in the response');
  });

  test('nothing identifying is written to the log', () => {
    // Comments are stripped first: the comment beside this code SAYS "no
    // email, no token", and matching on the prose would fail a file whose
    // documentation is correct.
    const code = mw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const start = code.indexOf('access_denied');
    const logBlock = code.slice(start, start + 400);
    assert.ok(!/email/.test(logBlock), 'no email in the denial log');
    assert.ok(!/token|assertion/i.test(logBlock), 'no token in the denial log');
  });
});

describe('There is no runtime dependency to compromise', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  test('the shipped application has zero runtime dependencies', () => {
    // Nothing from npm reaches the browser, so there is no supply chain to
    // attack and no transitive package to audit.
    assert.deepEqual(Object.keys(pkg.dependencies || {}), []);
  });

  test('development dependencies are the test runner only', () => {
    const dev = Object.keys(pkg.devDependencies || {});
    assert.ok(dev.every((d) => d.includes('playwright') || d.includes('axe-core')), dev.join(', '));
  });
});
