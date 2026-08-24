/**
 * verifyAccessJwt.test.js — the access check, attacked.
 *
 * These are the tests that decide whether the application is actually
 * protected. Each one forges a token the way a real attacker would and asserts
 * it is refused. A real RSA key pair is generated here and used to sign, so
 * "valid signature" means genuinely valid rather than stubbed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { verifyAccessJwt, REJECT, cachedJwksFetcher } from '../../../src/auth/verifyAccessJwt.js';

// Node exposes Web Crypto as webcrypto; the module expects a global `crypto`.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const TEAM = 'example.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const OWNER = 'owner@example.com';

const b64url = (bytes) => Buffer.from(bytes).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encodeJson = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

let keyPair;
let jwks;
let otherKeyPair;

async function setup() {
  if (keyPair) return;
  keyPair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  otherKeyPair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const pub = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
  jwks = { keys: [{ kid: 'test-key-1', kty: pub.kty, n: pub.n, e: pub.e, alg: 'RS256', use: 'sig' }] };
}

const fetchJwks = async () => jwks;

/** Build a signed token. `signWith` lets a test sign with the wrong key. */
async function makeToken(claimOverrides = {}, headerOverrides = {}, signWith = null) {
  await setup();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: 'test-key-1', typ: 'JWT', ...headerOverrides };
  const claims = {
    aud: [AUD],
    iss: `https://${TEAM}`,
    email: OWNER,
    exp: now + 3600,
    iat: now,
    ...claimOverrides,
  };
  const body = `${encodeJson(header)}.${encodeJson(claims)}`;
  const sig = await webcrypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    (signWith || keyPair).privateKey,
    new TextEncoder().encode(body),
  );
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

const opts = () => ({ teamDomain: TEAM, audience: AUD, ownerEmail: OWNER, fetchJwks });

describe('A genuine assertion from the owner is accepted', () => {
  test('a correctly signed token for the owner passes', async () => {
    const r = await verifyAccessJwt(await makeToken(), opts());
    assert.equal(r.ok, true);
    assert.equal(r.email, OWNER);
  });

  test('the owner email match is case-insensitive', async () => {
    const r = await verifyAccessJwt(await makeToken({ email: 'Owner@Example.COM' }), opts());
    assert.equal(r.ok, true);
  });

  test('a token inside the clock-skew window is still accepted', async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await verifyAccessJwt(await makeToken({ exp: now - 30 }), opts());
    assert.equal(r.ok, true, '30 seconds past expiry is inside the 60s tolerance');
  });
});

describe('Forged and absent assertions are refused', () => {
  test('no header at all', async () => {
    for (const v of [null, undefined, '', 0]) {
      const r = await verifyAccessJwt(v, opts());
      assert.equal(r.ok, false);
      assert.equal(r.reason, REJECT.MISSING);
    }
  });

  test('a token that is not three segments', async () => {
    for (const v of ['abc', 'a.b', 'a.b.c.d']) {
      const r = await verifyAccessJwt(v, opts());
      assert.equal(r.ok, false);
      assert.ok([REJECT.MALFORMED, REJECT.UNSUPPORTED_ALG].includes(r.reason));
    }
  });

  test('THE alg:none ATTACK — an unsigned token is refused', async () => {
    // The classic JWT bypass: strip the signature and declare no algorithm.
    const now = Math.floor(Date.now() / 1000);
    const header = encodeJson({ alg: 'none', kid: 'test-key-1', typ: 'JWT' });
    const claims = encodeJson({ aud: [AUD], iss: `https://${TEAM}`, email: OWNER, exp: now + 3600 });
    const r = await verifyAccessJwt(`${header}.${claims}.`, opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.UNSUPPORTED_ALG);
  });

  test('THE algorithm-confusion ATTACK — HS256 signed with the public key', async () => {
    // If the verifier accepted HMAC, an attacker who has the (public) signing
    // key could forge tokens with it. Only RS256 is accepted.
    const now = Math.floor(Date.now() / 1000);
    const header = encodeJson({ alg: 'HS256', kid: 'test-key-1', typ: 'JWT' });
    const claims = encodeJson({ aud: [AUD], iss: `https://${TEAM}`, email: OWNER, exp: now + 3600 });
    const r = await verifyAccessJwt(`${header}.${claims}.ZmFrZXNpZw`, opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.UNSUPPORTED_ALG);
  });

  test('a token signed by a DIFFERENT key is refused', async () => {
    const token = await makeToken({}, {}, otherKeyPair);
    const r = await verifyAccessJwt(token, opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.BAD_SIGNATURE);
  });

  test('a tampered payload invalidates the signature', async () => {
    // Take a genuine token and swap the email for the attacker's.
    const token = await makeToken();
    const [h, , s] = token.split('.');
    const now = Math.floor(Date.now() / 1000);
    const forged = encodeJson({ aud: [AUD], iss: `https://${TEAM}`, email: 'attacker@evil.test', exp: now + 3600 });
    const r = await verifyAccessJwt(`${h}.${forged}.${s}`, opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.BAD_SIGNATURE);
  });

  test('an unknown signing key id is refused', async () => {
    const r = await verifyAccessJwt(await makeToken({}, { kid: 'not-a-real-key' }), opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.UNKNOWN_KEY);
  });

  test('a header with no kid is refused', async () => {
    const r = await verifyAccessJwt(await makeToken({}, { kid: undefined }), opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.UNKNOWN_KEY);
  });
});

describe('Valid signature, wrong claims — still refused', () => {
  test('an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await verifyAccessJwt(await makeToken({ exp: now - 3600 }), opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.EXPIRED);
  });

  test('a token with no expiry at all', async () => {
    const r = await verifyAccessJwt(await makeToken({ exp: undefined }), opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.EXPIRED);
  });

  test('a not-yet-valid token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await verifyAccessJwt(await makeToken({ nbf: now + 3600 }), opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.NOT_YET_VALID);
  });

  test('a token minted for a DIFFERENT Access application', async () => {
    // Same Cloudflare team, different app. Without an audience check, any app
    // in the account could mint a token that opens this one.
    const r = await verifyAccessJwt(await makeToken({ aud: ['b'.repeat(64)] }), opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.WRONG_AUDIENCE);
  });

  test('a token from a different team domain', async () => {
    const r = await verifyAccessJwt(await makeToken({ iss: 'https://attacker.cloudflareaccess.com' }), opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.WRONG_ISSUER);
  });

  test('a valid token for SOMEBODY ELSE is refused', async () => {
    // The Access policy is the primary control. This is the second one, so a
    // policy widened by accident does not open the app to a whole domain.
    for (const email of ['someone@example.com', 'attacker@evil.test', '']) {
      const r = await verifyAccessJwt(await makeToken({ email }), opts());
      assert.equal(r.ok, false, `${email} must be refused`);
      assert.equal(r.reason, REJECT.NOT_OWNER);
    }
  });

  test('an email that differs only in length is refused', async () => {
    const r = await verifyAccessJwt(await makeToken({ email: `${OWNER}.evil.test` }), opts());
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.NOT_OWNER);
  });
});

describe('The JWKS cache', () => {
  test('fetches once and reuses within the TTL', async () => {
    let calls = 0;
    const fetcher = cachedJwksFetcher(async () => {
      calls++;
      return { ok: true, json: async () => ({ keys: [] }) };
    }, 3600);

    await fetcher('https://x/certs');
    await fetcher('https://x/certs');
    await fetcher('https://x/certs');
    assert.equal(calls, 1, 'the key document is fetched once');
  });

  test('a failed fetch throws rather than returning an empty key set', async () => {
    // Returning {} on failure would make every token fail with "unknown key",
    // which looks like a bad token rather than a broken dependency.
    const fetcher = cachedJwksFetcher(async () => ({ ok: false, status: 503 }));
    await assert.rejects(() => fetcher('https://x/certs'), /JWKS fetch failed: 503/);
  });
});
