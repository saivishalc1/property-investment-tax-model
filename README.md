# Property Investment Tax Model

A deterministic planning model for New York investment property. It takes a
purchase, a mortgage, a rent roll, a tax profile and a sale assumption, and
returns cash required, net operating income, after-tax cash flow, the tax due
on the sale broken into its separate components, net proceeds, ROI and
after-tax IRR — with a "How calculated" panel behind every figure.

It is a static site. There is no build step, no framework, no analytics and no
network call of any kind. Every number is computed in your browser from
arithmetic in `src/calculations.js`, and nothing you type ever leaves your
device.

> **This is planning software, not tax-preparation software.** It has not been
> reviewed or validated by a certified public accountant, an attorney, an
> enrolled agent or any other tax professional, and no such review is claimed.
> Nothing it produces is tax, legal or investment advice.

---

## Contents

- [Quick start](#quick-start)
- [Scripts](#scripts)
- [Features](#features)
- [Supported scope](#supported-scope)
- [Methodology](#methodology)
- [Known omissions](#known-omissions)
- [Privacy](#privacy)
- [Security](#security)
- [Architecture](#architecture)
- [Testing](#testing)
- [Deployment](#deployment)
- [Future secure AI integration](#future-secure-ai-integration)
- [Licence](#licence)

---

## Quick start

The application is plain ES modules, so it needs to be served over HTTP rather
than opened from the filesystem (module imports are blocked on `file://`).

```bash
git clone https://github.com/<owner>/property-investment-tax-model.git
cd property-investment-tax-model
npm install          # only needed for the test tooling
npm run serve        # http://localhost:4173
```

Node 20 or newer is required for the tooling. The application itself needs only
a current browser — Chrome, Edge, Firefox or Safari from 2023 onward, for
`structuredClone`, `<dialog>` and CSS `:has()`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run serve` | Serves the site at `http://localhost:4173`. |
| `npm run serve:subpath` | Serves it at `http://localhost:4174/property-investment-tax-model/`, reproducing the GitHub Pages project subpath. |
| `npm run build` | Stamps a content hash onto every asset reference, then produces `dist/` and fails the build on a broken reference, a root-absolute path, a possible secret or any network call in the shipped code. |
| `npm run bundle` | Produces `artifact.html`, a single self-contained file with the modules concatenated and the typefaces embedded, for hosts that want one file rather than ES modules. |
| `npm test` | Unit tests for the calculation engine, validation and storage (Node's built-in test runner — no test framework dependency). |
| `npm run test:e2e` | Playwright: user flow, scenario persistence, accessibility (axe-core), responsive layout and deployment shape. |
| `npm run check` | Build followed by the unit tests. |

## Features

**Guided workflow.** Eight steps — Property, Financing, Rental operations, Your
tax profile, Sale assumptions, Results, Comparisons, Report — with plain-English
labels, inline help and tooltips written for someone who has never heard the
phrase "unrecaptured section 1250 gain".

**Two levels of detail.** *Quick estimate* shows the inputs that move the
answer. *Professional* adds the placed-in-service month, the ownership
structure, the NIIT treatment of rental income, the full editable rate engine
and the bracket-table editors. Advanced settings are behind progressive
disclosure in both modes.

**Results that separate what is separate.** Transaction taxes, operating income
tax, depreciation, passive losses, gain, §1250 recapture, NIIT, New York State
tax and New York City tax are all shown as distinct lines with their own base
and their own rate — because they have distinct bases and distinct rates.

**"How calculated" everywhere.** Every results card expands to show the formula
with your actual inputs substituted in, including the IRR polynomial.

**Comparisons.** Side-by-side re-runs for 5-, 10-, 15-year and custom holds,
appreciation and rent-growth bands, financing variations (down payment,
interest rate, interest-only), sale-price sensitivity, and taxable sale versus
a §1031 exchange. Each column is a complete independent run of the model; your
scenario is never mutated to produce one.

**Report.** A US Letter print/PDF report with scenario and jurisdiction,
generation date and tax year, all assumptions, operating results, the sale and
tax breakdown, final returns, comparisons, sources, limitations and the
disclaimer. Navigation and editing controls are excluded from print.

**Nothing is lost, nothing to manage.** A versioned autosave restores your last
session from the welcome screen, and older saved files are migrated forward
rather than rejected. There is deliberately no scenario manager: saving, naming,
duplicating and importing named scenarios was the most confusing part of the
tool for someone running a single property, and this is a calculator rather than
a document manager. The only scenario action in the interface is **Start over**.
`storage.js` still exposes the full save/load/duplicate/delete API, and it is
still tested, so the feature can be reinstated behind a control if a future
audience needs it.

**Themes and layout.** Light and dark, with the choice remembered, and the
system preference honoured on first load. Layouts hold from 320px to large
desktops with no horizontal page overflow; a persistent results rail on desktop
and a compact results dock on mobile keep the headline numbers visible while
you edit.

**Reads as real estate, not as a tax form.** A deal header sits above every
step with what a broker, lender or appraiser looks at first: the address, asset
type, unit count and area, then price, price per square foot and per unit,
going-in cap, exit cap, LTV and the minimum debt service coverage over the hold
— flagged when it falls below 1.00, because that is the point at which the rent
stops covering the debt. Results are titled the way the industry titles them:
net operating income, going-in and exit cap rates, sources and uses, levered
IRR. The exit can be underwritten off a **cap rate** — capitalising the final
year's NOI, which is how the market actually prices a rental asset — as well as
by growing today's price or naming a figure, and the implied exit cap is always
shown so a tightening assumption cannot hide.

**Design.** One accent — a deep navy ink, chosen to read as institutional
rather than as interface blue — over warm limestone neutrals, the material the
business actually sells. Semantic gain/loss/caution colours are deliberately unrelated to the accent,
so "this is a link" and "this number is negative" can never be confused.
Headings are set in Source Serif 4 because this is a tax document more than it
is an app; every control, label and figure is IBM Plex Sans, whose numerals line
up honestly in a column. **Both typefaces are self-hosted** (variable, latin
subset, ~96 kB together, licences in `assets/fonts/`) rather than loaded from a
font CDN — the page's promise that it makes no external request of any kind is
worth more than the bytes saved. Results lead with a four-figure headline band
(cash to close, after-tax cash flow, total profit, after-tax IRR); everything
else is sized to read as supporting evidence. The step rail marks steps you have
completed, and announces that state in words rather than by colour alone.

**Accessibility.** Targets WCAG 2.2 AA — semantic landmarks, a skip link, full
keyboard operation, visible focus, explicit labels, an error summary that links
to the offending field, live status messages, adequate contrast in both themes,
no colour-only meaning, reduced-motion support, native `<dialog>`s, captioned
tables with scoped headers, a data-table alternative to the chart, and 24px
minimum touch targets. Native HTML is used before ARIA throughout.

## Supported scope

**Checked — New York.** Every rate compared against the published government
sources on 2026-08-22. That is a documentary check, not professional review;
nothing here has been seen by a CPA, an attorney or an enrolled agent.

- New York City, and New York State outside the city.
- Residential, co-op and commercial property.
- Purchase price, closing costs and cost basis.
- NYS and NYC transfer tax, the mansion tax, mortgage recording tax,
  co-op exemptions and the co-op flip tax.
- Financing, amortisation, interest-only periods, zero-interest loans and
  loan-cost amortisation.
- Rental income, vacancy, operating expenses, growth and inflation.
- Straight-line depreciation with the IRS mid-month convention, and separately
  depreciated capital improvements.
- Holding-period cash flow, year by year.
- Passive activity losses under §469: suspension, carry-forward and release on
  a fully taxable disposition.
- Taxable sale: amount realised, adjusted basis, gain composition, unrecaptured
  §1250 gain, long-term capital gain, NIIT, New York State and New York City
  tax, and after-tax proceeds.
- §1031 like-kind exchange comparison.
- ROI, annualised return, cap rate, cash-on-cash, equity multiple, pre-tax and
  after-tax IRR.
- Every rate and bracket table is adjustable.

**Experimental — everywhere else.** The engine is jurisdiction-neutral, and
presets for the UAE, Saudi Arabia, India, the UK, Spain, Portugal, France,
Germany, the Netherlands, Singapore, Australia, Japan, Hong Kong, New Zealand,
Canada, Mexico and Brazil are included, plus a blank template. They are
labelled **experimental** in the interface and carry a permanent warning.
They are researched from public sources but **not** independently verified, and
in several cases the engine cannot express the local rule at all — the UK's
20% basic-rate interest credit, the Dutch Box 3 notional-return regime, and
India's flat 30% standard deduction are all called out in each preset's notes.
Treat them as a starting point for your own figures.

## Methodology

Every calculation lives in `src/calculations.js` as ordinary arithmetic. No
language model, heuristic or approximation formula is involved anywhere in the
numeric path. Given the same inputs the model returns bit-identical output on
every run and on every machine.

Points worth stating explicitly, because they are the ones most often got
wrong:

**Whole-price versus marginal brackets.** New York's mansion tax and the NYC
Real Property Transfer Tax are *cliff* taxes: crossing a threshold re-rates the
entire price, not just the excess. A $2,000,000 purchase pays 1.25% of
$2,000,000; a $1,999,999 purchase pays 1% of $1,999,999 — a $5,000 jump for one
dollar of price. Marginal brackets, where each slice is taxed at its own rate,
are also supported and are what most non-US stamp duties use. The mode is a
per-preset setting and is editable.

**Who pays the transfer tax.** In New York the seller normally pays the state
and city transfer tax, but sponsor sales and new construction routinely shift
it to the buyer. Purchase and sale each carry an explicit payer setting, so the
two can never silently contradict each other. When the buyer pays, the tax
capitalises into cost basis.

**Cost basis and adjusted basis.** Acquisition costs — mansion tax, title
insurance, legal, inspection, and any transfer tax the buyer pays — capitalise
into cost basis. Loan costs (points and mortgage recording tax) do not: they
amortise over the loan term, and the unamortised remainder is deducted in the
year of sale. Adjusted basis is cost basis plus capital improvements less all
depreciation taken.

**Depreciation.** Straight line over 27.5 years for residential and 39 for
commercial, on the building portion only — land is never depreciable. The IRS
mid-month convention applies in both the first year, `(12 − month + 0.5) / 12`,
and the year of disposition, `(month − 0.5) / 12`. Capital improvements are
depreciated separately on their own recovery period beginning when they are
placed in service, and the whole amount is depreciable: an improvement contains
no land.

**Interest-only transition.** During the interest-only months the payment is
interest alone and the balance does not fall. The amortising payment is then
sized to retire the *original* balance over the remaining months, so the
payment steps up at the transition — which is what an actual interest-only loan
does. Zero-interest loans take a separate code path, because the annuity
formula divides by zero at r = 0.

**Passive losses.** Under §469 a rental loss is passive: it is suspended and
carried forward, offsetting passive income in later years. On a fully taxable
disposition to an unrelated party, §469(g) releases whatever remains, deductible
against income of any kind at your ordinary rate. The release is kept strictly
apart from the property gain: it never nets against the gain or the recapture
before the capital-gain and §1250 rates are applied. Deducting losses as they
arise is available as a switch for investors who qualify, and is off by default.

**Gain composition.** Depreciation is recovered first. Unrecaptured §1250 gain
is `min(accumulated depreciation, total gain)` and is taxed at the §1250 rate;
only what remains above it is long-term capital gain. New York has no
preferential capital gains rate, so state and city tax apply to the whole gain
at the ordinary rate. A loss on sale is treated as an ordinary §1231 loss.

**NIIT.** 3.8% of the lesser of net investment income and the excess of MAGI
over the filing-status threshold ($200,000 single, $250,000 married filing
jointly, $125,000 married filing separately — not indexed). It is applied to
the gain on sale, and, optionally, to net rental income during the hold.

**New York City residency.** The NYC resident toggle removes the city rate from
both rental income and gain. New York State tax is unaffected, because the gain
remains New York-source.

**Returns.** Cap rate is year-one NOI over purchase price (a cap rate on total
cost is shown alongside). Cash-on-cash is year-one pre-tax cash flow over cash
invested. ROI is total profit over cash invested, with the compound annual
equivalent beside it. IRR is found by bisection on the net present value —
200 halvings of `[-0.9999, 10]`, verified before it is returned — not by an
approximation, and it returns `null` rather than a misleading number when the
cash-flow stream has no sign change.

**Income tax is marginal, not a single top rate.** The model computes what this
property *adds* to your bill: your other income is the base, and the property's
income and gain stack on top of it and run through the real 2026 schedules —
federal, New York State and New York City. This matters more than it sounds. A
$150,000 single earner faces a 24% federal marginal rate, not 37%; charging the
top rate overstated the tax on rental income and, because suspended losses are
released at that same rate, overstated the benefit of the release by about
$22,000 on the default scenario. Long-term gain stacks above ordinary income to
find its 0/15/20 band rather than being charged at 20% throughout, and
unrecaptured §1250 gain is taxed at ordinary rates *capped* at 25% — the 25% is
a ceiling, not a flat rate. Professional mode can switch back to a single flat
rate for anyone who wants to drive the rates by hand.

**§469(i) special allowance.** An actively participating individual may deduct
up to $25,000 of rental losses immediately rather than suspending them, reduced
by 50 cents per dollar of income above $100,000 and gone at $150,000. This
applies to exactly the audience the tool is built for.

**Sources and how far they were checked.** Each preset lists its sources, its
tax year and — under *Your tax profile → Where these numbers come from* — the
provenance of each group of rates: whether the figure was read from the
government source itself, or taken from corroborating secondary sources. Transfer,
mansion, RPTT and mortgage recording taxes, and all federal rates and thresholds,
came from primary sources. New York State and City bracket thresholds came from
corroborating secondary sources, because the State publishes its 2026 schedule
only inside withholding formulas. Verify anything you intend to rely on.

## Known omissions

The application lists these per preset; for New York they are:

- IT-2663 nonresident estimated income tax on the sale of NY real property.
- Bracket thresholds are applied to your stated income directly: the standard
  deduction and any itemised deductions are not subtracted first, so the marginal
  rate can read slightly high near a bracket edge.
- The §121 principal-residence exclusion (this is an investment-property model).
- Grossing-up of consideration when the buyer pays the seller's transfer tax.
- Real estate professional status under §469(c)(7).
- The §199A qualified business income deduction.
- The SALT deduction, AMT, and entity-level tax for corporate owners.
- FIRPTA withholding and treaty relief for non-resident sellers.
- For §1031: the 45-day identification and 180-day closing deadlines,
  intermediary fees, boot, debt-relief boot and state clawback rules.

## Privacy

Everything runs locally.

- No analytics, no telemetry, no cookies, no third-party requests.
- Scenarios, autosave and the theme preference are stored in your browser's
  `localStorage` and nowhere else.
- Export writes a file with a `blob:` URL created in the page; import reads a
  file you choose. Neither touches a server.
- The Content Security Policy sets `connect-src 'none'`, which makes it
  impossible for the page to transmit anything even if code were injected into
  it, and `npm run build` fails if `fetch`, `XMLHttpRequest`, `WebSocket`,
  `EventSource` or `sendBeacon` appears anywhere in the shipped files.

Clearing your browser's site data for this origin removes every trace of your
scenarios.

## Security

This is a public static site with no backend, so the attack surface is a
scenario file someone might hand you and the page's own DOM.

- **Imported JSON is sanitised before use.** `sanitize()` in `src/storage.js`
  rebuilds the value from plain primitives only, dropping `__proto__`,
  `constructor` and `prototype` keys (blocking prototype pollution), dropping
  functions and exotic objects, truncating strings and bounding depth and array
  length. `migrate()` then merges only keys that exist in the current schema, so
  an unknown key can never reach the engine.
- **Schema and version are validated.** Files carry `schemaVersion`; anything
  older is migrated forward. An unknown preset falls back to New York City
  rather than producing an undefined rate table.
- **No user-controlled string is ever written as HTML.** Every value the user
  typed or imported reaches the page through `textContent`. `innerHTML` is used
  only to empty a container.
- **External links** carry `rel="noopener noreferrer external"`.
- **CSP** is `default-src 'none'` with `'self'` for scripts, styles, images and
  the manifest, plus `connect-src 'none'`, `object-src 'none'`, `base-uri
  'none'` and `form-action 'none'`. There is no `unsafe-inline` and no
  `unsafe-eval`: the stylesheet is external, and there are no inline `style`
  attributes anywhere.
- **`frame-ancestors` is deliberately absent** from the meta CSP: browsers
  ignore that directive in a `<meta>` tag and log an error for it. Clickjacking
  protection needs a real response header (`Content-Security-Policy:
  frame-ancestors 'none'` or `X-Frame-Options: DENY`), which GitHub Pages
  cannot send. If that matters for your deployment, front the site with a host
  that can set headers (Cloudflare Pages, Netlify, an S3/CloudFront
  distribution) — see the boundary note below.
- **No secrets, ever.** There is no API key, token or credential in this
  repository, and `npm run build` scans every shipped file for token-shaped
  strings and private-key headers and fails the build if it finds one. A public
  static site cannot hold a secret: anything shipped to the browser is public.

### Future secure backend boundary

The one feature that would require a server is optional AI-written explanations
of a result. That must not be bolted onto this page, because it would mean
either shipping an API key to the browser or sending the user's financial
inputs somewhere. If it is ever added, the boundary is:

1. **The browser never holds a provider key.** The page calls a first-party
   endpoint (`POST /api/explain`) on the same origin; the provider key lives
   only in server-side secret storage.
2. **The request carries derived figures, not the scenario.** Rounded,
   non-identifying outputs — an effective tax rate, a bracket name, a ratio —
   assembled by an explicit allow-list. Never the raw scenario, never a price,
   never MAGI, never anything that identifies a property or a person.
3. **It is opt-in per request** and clearly labelled, with the local-only
   behaviour unchanged when it is off. Nothing is sent without a deliberate
   click.
4. **Arithmetic stays here.** The model computes; the endpoint only phrases.
   No number in the interface may ever originate from a language model.
5. **The server is hardened**: rate limiting per IP and per session, strict
   request-schema validation, a bounded token budget, no logging of request
   bodies, and a short retention window on anything that must be logged.
6. **The CSP is widened by exactly one directive**, `connect-src 'self'`, and
   by nothing else.

Until all six hold, the correct value for `connect-src` is `'none'`.

## Architecture

```
index.html              markup, metadata, CSP
src/
  app.js                UI: binding, rendering, navigation, scenarios, charts
  calculations.js       pure engine — no DOM, no storage, no side effects
  presets.js            jurisdiction rate tables, status, sources, omissions
  storage.js            schema, defaults, sanitisation, migration, persistence
  validation.js         field errors and scenario warnings
  styles.css            design tokens, layout, print stylesheet
assets/                 favicon, icons, web manifest
  fonts/                self-hosted variable typefaces and their licences
tools/
  build.js              dist/ build plus reference, secret and subpath checks
  version.js            stamps ?v=<content hash> so no browser serves stale code
  bundle.js             single-file build (modules inlined, fonts embedded)
  serve.js              static server, optionally under a base path
tests/
  unit/                 node:test suites for the engine, validation, storage
  e2e/                  Playwright: flow, scenarios, a11y, responsive, deploy
.github/workflows/      test and deploy to GitHub Pages
```

The separation that matters is `calculations.js`: it imports nothing, touches
no DOM and has no side effects, so it can be unit-tested directly under Node
and reasoned about on its own. `app.js` is the only file that knows the page
exists.

There is no framework and no runtime dependency. The two dev dependencies
(Playwright and axe-core) are for testing only and never ship.

## Testing

Unit tests use Node's built-in runner, so `npm test` needs no dependencies at
all:

```bash
npm test         # calculation engine, validation, storage
npm run test:e2e # Playwright, in Chrome at desktop and Pixel 5 viewports
npm run build    # reference, secret, network and subpath checks
```

Unit coverage: bracket calculations in both whole-price and marginal modes
against the real New York tables; mortgage amortisation against the closed-form
annuity result; the interest-only transition, zero-interest loans and holds
longer than the loan term; basis and adjusted basis; mid-month depreciation in
the first and final years; separately depreciated improvements; loan-cost
amortisation; passive loss suspension, release and separation from the gain;
NIIT thresholds by filing status; NYC and NYS rate and residency differences;
gain composition and §1250 recapture; sale proceeds reconciliation; ROI, IRR
and the other return metrics; validation rules; scenario persistence, migration
from schema v1 and v2, and prototype-pollution resistance.

End-to-end coverage: the full eight-step flow; live recalculation; the mansion
tax cliff in the interface; mode switching; "How calculated" panels; validation
and the linked error summary; comparisons; the 1031 view; the report and its
source links; scenario save/load/duplicate/delete/reset; autosave across a
reload; import migration; theme persistence; an axe-core scan of every step in
both themes and both modes; dialogs; keyboard operation; the skip link; chart
alternatives; table captions and scoped headers; reduced motion; layout at
320–1920px; touch-target sizes; the print stylesheet; the GitHub Pages subpath;
asset 200s; internal links; and a zero-console-error assertion throughout.

If a Playwright browser download is not possible in your environment, point the
suite at a Chromium you already have:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npx playwright test
```

## Deployment

`.github/workflows/pages.yml` runs the build, the unit tests and the full
Playwright suite, and refuses to publish if any of them fail. It uploads
`dist/`, which includes a `.nojekyll` marker so Jekyll does not rewrite the
tree.

> **Note on the live deployment.** The public site is currently served by
> GitHub Pages *branch deployment* (`main` / root) rather than by that workflow.
> The repository was bootstrapped through the GitHub web interface, and the
> token an Actions run uses is not permitted to create files under
> `.github/workflows/`, so `pages.yml` could not be pushed from CI. It remains
> in the repository history, and pushing it from a user account works normally —
> that restriction applies only to workflow tokens. Nothing about the site
> depends on which of the two methods publishes it.

To deploy from a fresh clone:

```bash
gh repo create property-investment-tax-model --public --source=. --push
gh api -X POST repos/<owner>/property-investment-tax-model/pages \
  -f 'build_type=workflow'
```

Then, in the repository, set **Settings → Pages → Source** to **GitHub
Actions**, and push to `main`.

Asset references carry a content hash (`./src/app.js?v=72f6b765…`), regenerated
by `tools/version.js` whenever anything in `src/` changes and applied to the
stylesheet, the module entry point and every import between modules. GitHub
Pages caches files for its own lifetime, so without this a returning visitor can
run yesterday's JavaScript against today's HTML — invisible to whoever deployed,
and confusing to whoever is looking at it. A hard refresh is no longer needed
after a deploy.

Every path in the application is relative (`./src/app.js`, `./assets/...`), so
the site works both at a user-site root and under a project subpath such as
`https://<owner>.github.io/property-investment-tax-model/`. `npm run build`
fails on any root-absolute path, and the end-to-end suite serves the site under
the subpath and asserts that every asset returns 200.

## Licence

See [LICENSE](LICENSE). The repository ships with a proprietary
all-rights-reserved placeholder; replace it with MIT or Apache-2.0 if you
intend to publish under open-source terms.
