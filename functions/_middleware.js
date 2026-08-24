/**
 * _middleware.js — Cloudflare Pages Functions edge guard.
 *
 * Runs before ANY asset is served. A request without a valid Cloudflare Access
 * identity for the owner never reaches the application, so there is no route to
 * navigate directly to and no client-side gate to disable in devtools.
 *
 * WHY THIS EXISTS WHEN ACCESS ALREADY BLOCKS THE HOSTNAME. Access protects the
 * hostname it is bound to. It does not protect the origin from a request that
 * arrives another way — a *.pages.dev preview URL, a second custom hostname
 * added later, or a policy edited to admit a whole email domain. This checks
 * the assertion cryptographically on every request, so protection travels with
 * the deployment rather than with a dashboard setting.
 *
 * REQUIRED ENVIRONMENT (Pages project → Settings → Environment variables):
 *   ACCESS_TEAM_DOMAIN   your-team.cloudflareaccess.com
 *   ACCESS_AUD           the Access application's Audience (AUD) tag
 *   OWNER_EMAIL          the one address permitted to use the application
 *
 * These are server-side variables. None of them is a secret that grants
 * access — they are identifiers the guard compares against — and none is ever
 * sent to the browser.
 */

import { verifyAccessJwt, cachedJwksFetcher } from '../src/auth/verifyAccessJwt.js';

/** One cache per isolate; Cloudflare reuses isolates across requests. */
let jwks = null;

/** Paths served without an identity: the health probe only. */
const PUBLIC_PATHS = new Set(['/healthz']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) {
    return new Response('ok', {
      status: 200,
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
    });
  }

  // A misconfigured deployment must FAIL CLOSED. Serving the application
  // because a variable is missing is the worst possible default.
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  const ownerEmail = env.OWNER_EMAIL;
  if (!teamDomain || !audience || !ownerEmail) {
    return deny(503, 'This deployment is not configured for access control.');
  }

  if (!jwks) jwks = cachedJwksFetcher((u) => fetch(u), 3600);

  const result = await verifyAccessJwt(
    request.headers.get('Cf-Access-Jwt-Assertion'),
    { teamDomain, audience, ownerEmail, fetchJwks: jwks },
  );

  if (!result.ok) {
    // The reason goes to the log, never to the client: telling an attacker
    // whether the signature or the email failed is free reconnaissance.
    console.log(JSON.stringify({
      event: 'access_denied',
      reason: result.reason,
      path: url.pathname,
      // No email, no token, no headers — nothing identifying in the log.
    }));
    return deny(403, 'Not authorised.');
  }

  const response = await next();
  return withSecurityHeaders(response);
}

function deny(status, message) {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

/**
 * Headers the static host cannot set.
 *
 * The CSP in index.html is the same policy; this repeats it as a real header,
 * which a meta tag cannot do for frame-ancestors. Anything protected by a
 * login must also be unframeable, or the login is defeated by clickjacking.
 */
function withSecurityHeaders(response) {
  const h = new Headers(response.headers);
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
  h.set(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    + "font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; "
    + "object-src 'none'; manifest-src 'self'; frame-ancestors 'none'",
  );
  // A financial workspace should not be held in a shared cache.
  h.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}
