# Deployment and operations

One user, one protected application, one public page. Nothing here needs a
database, a server you maintain, or a login system anyone has to write.

---

## The shape of it

| Surface | Host | Who can reach it | What it holds |
|---|---|---|---|
| **The application** | Cloudflare Pages, behind Cloudflare Access | the owner, after signing in | nothing — saved properties live in the owner's browser |
| **Public page** | GitHub Pages (the current URL) | anyone | a description of the product; no saved work |

The calculator is deterministic and offline: no Claude, no LLM, no API, no
tokens, no network call of any kind during a calculation. The build refuses to
ship a file containing an external origin or a secret-shaped string.

---

## 1. Set up access (about ten minutes, once)

You need a Cloudflare account. The free plan covers this; Access is free for up
to 50 users and this needs one.

### a. Create the Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**, and choose this repository.
2. Build settings:
   - **Build command:** `npm ci && npm run build`
   - **Build output directory:** `dist`
3. Deploy. You will get a `*.pages.dev` URL. **It is public at this point** —
   step (c) closes it.

### b. Add an Access application

1. Dashboard → **Zero Trust** → **Access** → **Applications** → **Add an
   application** → **Self-hosted**.
2. Application domain: the `*.pages.dev` hostname from step (a), or your own
   domain if you add one.
3. Session duration: 24 hours is a reasonable default for a single owner.
4. Add a policy:
   - **Action:** Allow
   - **Include:** *Emails* → your email address, and nothing else.
   - Do **not** use "Emails ending in" — that admits a whole domain.
5. Identity provider: One-time PIN works with no setup. Google, GitHub or an
   OIDC provider is better, because you can require MFA there.
   **Turn MFA on at the identity provider.** Access enforces what the provider
   asserts; it cannot add a second factor the provider does not require.
6. Save, then copy the application's **Audience (AUD) tag** from its Overview.

### c. Give the application its three variables

Pages project → **Settings** → **Environment variables** → Production:

| Name | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `your-team.cloudflareaccess.com` |
| `ACCESS_AUD` | the AUD tag from step (b6) |
| `OWNER_EMAIL` | the one address allowed in |

Set them for **Preview** as well. A preview deployment is a real, reachable URL;
leaving it unconfigured is the most common way a "protected" app stays open.

Redeploy so the variables take effect.

### d. Check it is actually closed

```bash
# In a private window, or signed in as anybody else: expect a login page,
# then "Not authorised."
curl -sI https://<your-app>.pages.dev/ | head -1

# The health probe is the one public path, and reveals nothing.
curl -s https://<your-app>.pages.dev/healthz     # -> ok
```

If you see the application without signing in, **stop** — one of the three
variables is missing and the guard is failing closed for a different reason, or
the Access policy is not bound to that hostname.

---

## How the protection works

Two independent layers, because either alone has a gap.

**Cloudflare Access** stops the request before it reaches the application.
There is no login page in this codebase, no password to store, no session to
forge, and no route to navigate directly to.

**`functions/_middleware.js`** verifies, on every request, that the identity
assertion is genuine: RSA signature against Cloudflare's published keys, then
audience, issuer, expiry, and that the email is the owner's. This matters
because Access protects a *hostname*, not the origin — a preview URL, a second
custom domain added later, or a policy widened by accident would otherwise let
a request through. It **fails closed**: unconfigured means 503, never "serve
the app anyway".

The email check is deliberately redundant with the Access policy. If the policy
is ever edited to admit a domain rather than an address, the application still
admits one person.

`tests/unit/auth/verifyAccessJwt.test.js` attacks this with a real RSA key pair:
`alg:none`, algorithm confusion with HS256, a token signed by another key, a
tampered payload, an unknown key id, expired and not-yet-valid tokens, a token
minted for a different Access application, a different team domain, and a valid
token belonging to somebody else. All refused.

---

## 2. Where saved properties live

**In the owner's browser, in IndexedDB, on that device.** They are never
uploaded, and there is no server that could read them.

That is the right trade for one person: nothing to breach, nothing to
subpoena, no third party holding a client's financial position. The cost is
that the browser is the only copy.

### Back up

**Properties → Export backup** writes a single JSON file containing every
analysis, archived ones included. Keep it wherever you keep client files.

Do this before clearing browser data, changing machine, or any browser reset.
Nothing else backs it up.

### Restore

**Properties → Import backup**, and choose the file. Import **merges**: an
analysis with the same id is updated, everything else is added, and nothing
already saved is destroyed. One damaged property in a file does not cost the
others — it is reported and skipped.

### What survives what

| Event | Saved properties |
|---|---|
| Closing the tab or browser | survive |
| Reboot | survive |
| Signing out of Cloudflare Access | survive — they are not tied to the session |
| Clearing site data / "reset browser" | **lost** unless exported |
| A different browser or machine | not there — import a backup |
| Private/incognito window | not saved at all; the app says so |

---

## 3. Day-to-day

| Task | How |
|---|---|
| Sign in | open the application URL; Access handles the rest |
| Sign out | `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/logout` |
| Revoke every session | Zero Trust → Access → **Sessions** → Revoke |
| Change who the owner is | update `OWNER_EMAIL` **and** the Access policy, then redeploy |
| Rotate credentials | done at the identity provider; nothing is stored here |
| Health check | `GET /healthz` → `ok` |

There is no admin dashboard because there is nothing for it to administer: no
other users, no roles, no seats, no tenants.

---

## 4. Releasing a change

```bash
npm ci
npm run check          # build, 316 unit tests, rule hygiene, coverage
npm run test:e2e       # 182 end-to-end, accessibility and responsive
```

Push to `main`. CI runs the same checks plus a dependency audit and a secret
scan; Cloudflare Pages builds and deploys on green.

**Rollback:** Pages project → **Deployments** → the last good build →
**Rollback**. It is immediate and needs no repository change.

### After a Budget or a new tax year

1. `npm run coverage` lists every rule with its effective dates and last review.
2. Update the affected rule in `src/rules/jurisdictions/`, with its citation and
   a fresh `lastReviewed`.
3. `npm run check` — a rule unreviewed for a year fails the build, and a rule
   with no test fails it too.
4. `npm run coverage:md` and commit `COVERAGE.md`.

---

## 5. What is deliberately not here

- **No cloud sync.** One person on one machine does not need it, and it would
  put a client's financial position on somebody else's server.
- **No accounts, roles, organisations, seats or billing.** There is one user.
- **No server-side storage of scenarios.** Nothing to breach.
- **No analytics or error reporting service.** The application makes no network
  request at all after loading, which is checked by the build.
- **No password reset flow in this codebase.** The identity provider owns
  credentials, which is the whole reason for using one.
