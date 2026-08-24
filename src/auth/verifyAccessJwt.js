/**
 * verifyAccessJwt.js — verify a Cloudflare Access identity assertion.
 *
 * WHY THIS ARCHITECTURE. The product has one user. Building a login system for
 * one person means writing password hashing, session storage, reset flows,
 * rate limiting and MFA — every one of which is a chance to get security wrong,
 * for no benefit that an identity provider does not already give for free.
 *
 * So there is no login code in this application. Cloudflare Access sits in
 * front of it: a request without a valid identity never reaches the origin at
 * all. Access handles the login page, the identity provider, MFA, session
 * lifetime, revocation and brute-force protection. What remains here is the
 * one thing that must not be delegated — CHECKING that the request really came
 * through Access, and really belongs to the owner.
 *
 * THE ATTACK THIS DEFENDS AGAINST. Access injects a signed JWT into the
 * `Cf-Access-Jwt-Assertion` header. If the origin trusts that header without
 * verifying the signature, anyone who can reach the origin directly — a
 * misconfigured DNS record, a preview deployment, a stale hostname — can set
 * the header themselves and walk straight in. Decoding the token is not
 * verifying it. This module verifies the RSA signature against Cloudflare's
 * published keys, then checks the audience, the issuer, the expiry and the
 * email.
 *
 * No dependencies: Web Crypto is available in both Workers and Node.
 */

/** Reasons a token can be rejected. Returned rather than thrown so the caller
 *  can log the reason without leaking it to the client. */
export const REJECT = Object.freeze({
  MISSING: 'no_assertion',
  MALFORMED: 'malformed_token',
  UNSUPPORTED_ALG: 'unsupported_algorithm',
  UNKNOWN_KEY: 'unknown_signing_key',
  BAD_SIGNATURE: 'bad_signature',
  EXPIRED: 'expired',
  NOT_YET_VALID: 'not_yet_valid',
  WRONG_AUDIENCE: 'wrong_audience',
  WRONG_ISSUER: 'wrong_issuer',
  NOT_OWNER: 'not_the_owner',
});

function base64UrlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

/**
 * Constant-time-ish string comparison.
 *
 * The email check is not a secret comparison, but comparing identity strings
 * with early exit is a habit worth not forming.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify an Access JWT.
 *
 * @param {string|null} token   the Cf-Access-Jwt-Assertion header value
 * @param {object} opts
 * @param {string} opts.teamDomain   e.g. "example.cloudflareaccess.com"
 * @param {string} opts.audience     the Access application AUD tag
 * @param {string} opts.ownerEmail   the single authorised identity
 * @param {(url:string)=>Promise<object>} opts.fetchJwks  returns the JWKS document
 * @param {number} [opts.now]        epoch seconds, for testing
 * @param {number} [opts.clockSkew]  seconds of tolerance, default 60
 * @returns {Promise<{ok:true, email:string, claims:object}|{ok:false, reason:string}>}
 */
export async function verifyAccessJwt(token, opts) {
  const {
    teamDomain, audience, ownerEmail, fetchJwks,
    now = Math.floor(Date.now() / 1000), clockSkew = 60,
  } = opts;

  if (!token || typeof token !== 'string') return { ok: false, reason: REJECT.MISSING };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: REJECT.MALFORMED };

  let header;
  let claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    return { ok: false, reason: REJECT.MALFORMED };
  }

  // Only RS256. "none" and HMAC algorithms are the classic JWT bypass: an
  // attacker re-signs the token with an algorithm the verifier accepts but the
  // issuer never uses.
  if (header.alg !== 'RS256') return { ok: false, reason: REJECT.UNSUPPORTED_ALG };
  if (!header.kid) return { ok: false, reason: REJECT.UNKNOWN_KEY };

  const jwks = await fetchJwks(`https://${teamDomain}/cdn-cgi/access/certs`);
  const jwk = (jwks?.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: REJECT.UNKNOWN_KEY };

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, base64UrlToBytes(parts[2]), signed,
  );
  if (!valid) return { ok: false, reason: REJECT.BAD_SIGNATURE };

  // Signature is good. Now the claims, in the order that fails cheapest.
  if (typeof claims.exp !== 'number' || claims.exp + clockSkew < now) {
    return { ok: false, reason: REJECT.EXPIRED };
  }
  if (typeof claims.nbf === 'number' && claims.nbf - clockSkew > now) {
    return { ok: false, reason: REJECT.NOT_YET_VALID };
  }

  // aud may be a string or an array; Access issues an array.
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.some((a) => safeEqual(String(a), audience))) {
    return { ok: false, reason: REJECT.WRONG_AUDIENCE };
  }

  if (!safeEqual(String(claims.iss || ''), `https://${teamDomain}`)) {
    return { ok: false, reason: REJECT.WRONG_ISSUER };
  }

  // The application has exactly one authorised identity. An Access policy is
  // the primary control; this is the second, so a policy edited by accident
  // does not silently open the application to a whole email domain.
  const email = String(claims.email || '').toLowerCase();
  if (!safeEqual(email, String(ownerEmail || '').toLowerCase())) {
    return { ok: false, reason: REJECT.NOT_OWNER };
  }

  return { ok: true, email, claims };
}

/**
 * A JWKS fetcher that caches by key id for `ttlSeconds`.
 *
 * Cloudflare rotates signing keys, so the document cannot be pinned; but
 * fetching it on every request adds a round trip to every page load and makes
 * the origin dependent on that endpoint being fast.
 */
export function cachedJwksFetcher(fetchImpl, ttlSeconds = 3600) {
  let cache = null;
  let fetchedAt = 0;
  return async (url) => {
    const now = Math.floor(Date.now() / 1000);
    if (cache && now - fetchedAt < ttlSeconds) return cache;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    cache = await res.json();
    fetchedAt = now;
    return cache;
  };
}
