/**
 * coverage.spec.js — the interface must never claim more than the engine did.
 *
 * Every surface that says something about how trustworthy a figure is — the
 * market dropdown, the badge, the warning summary, the report — is now driven
 * by the rule registry. These tests exist because those surfaces previously
 * disagreed with each other and with the calculation: a market could be
 * labelled "Rates checked" while the engine computed it with another country's
 * tables, and the warning that fired keyed off whether the preset id began
 * with "us-".
 */

import { test, expect } from '@playwright/test';
import { openApp, trackConsole } from './helpers.js';

// Every market the product ships is researched. The unresearched markets were
// removed rather than kept behind a caveat, so these tests now assert the
// stronger property: there is no market in the dropdown that cannot be shown
// to a client.
const RESEARCHED = ['us-nyc', 'uk', 'jp'];

async function selectMarket(page, key) {
  await page.locator('[data-step="property"]').click();
  await page.locator('#f-preset').selectOption(key);
  await page.waitForTimeout(150);
}

test.describe('coverage is consistent across every surface', () => {
  test('a researched market says so, and says it is not a professional review', async ({ page }) => {
    await openApp(page);
    for (const key of RESEARCHED) {
      await selectMarket(page, key);
      const status = page.locator('#presetStatusLine');
      await expect(status).toContainText('Rates checked');
      await expect(status).toContainText('not a professional review');
      // And the dropdown must not contradict the badge.
      const label = await page.locator('#f-preset option:checked').innerText();
      expect(label).not.toMatch(/unresearched|experimental/i);
    }
  });

  test('the dropdown offers ONLY researched markets', async ({ page }) => {
    await openApp(page);
    const values = await page.locator('#f-preset option').evaluateAll(
      (opts) => opts.map((o) => o.value).filter(Boolean),
    );
    expect(values.sort()).toEqual(['jp', 'uk', 'us-nyc']);

    // And none of them is labelled unresearched or experimental.
    const labels = await page.locator('#f-preset option').allInnerTexts();
    for (const label of labels) {
      expect(label).not.toMatch(/unresearched|experimental|blank template/i);
    }
  });

  test('the region groups match the markets, with no empty group', async ({ page }) => {
    await openApp(page);
    const groups = await page.locator('#f-preset optgroup').evaluateAll(
      (gs) => gs.map((g) => ({ label: g.label, count: g.querySelectorAll('option').length })),
    );
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.count, `group "${g.label}" must not be empty`).toBeGreaterThan(0);
    }
  });

  test('a researched market does not carry the unresearched warning', async ({ page }) => {
    await openApp(page);
    for (const key of RESEARCHED) {
      await selectMarket(page, key);
      const warnings = await page.locator('#warningSummary').innerText().catch(() => '');
      expect(warnings).not.toMatch(/no researched rule pack/i);
    }
  });
});

test.describe('sourced transaction taxes', () => {
  test('a researched market shows charges with their source and access date', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();
    await selectMarket(page, 'uk');

    const panel = page.locator('#engineTaxPanel');
    await expect(panel).toContainText('Transaction taxes, computed from the published rules');
    await expect(panel).toContainText('SDLT');
    await expect(panel).toContainText('Sources');
    await expect(panel).toContainText('read 2026-08-23');

    const link = panel.locator('a').first();
    await expect(link).toHaveAttribute('href', /gov\.uk/);
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('no shipped market renders a refusal', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();
    for (const key of RESEARCHED) {
      await selectMarket(page, key);
      await expect(page.locator('#engineTaxPanel'))
        .not.toContainText('No checked rules for this market');
    }
  });

  test('a market that charges on the price cites its source; Japan explains why it cannot yet', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();

    // The United Kingdom and New York charge on the consideration, so the
    // charges compute and carry a citation with an access date.
    for (const key of ['uk', 'us-nyc']) {
      await selectMarket(page, key);
      await expect(page.locator('#engineTaxPanel')).toContainText('read 2026-08-23');
    }

    // Japan charges on the assessed value on the tax roll, which the scenario
    // does not yet collect. The right answer is to exclude the charge and say
    // what is needed — not to levy it on the purchase price.
    await selectMarket(page, 'jp');
    const panel = page.locator('#engineTaxPanel');
    await expect(panel).toContainText('incomplete');
    await expect(panel).toContainText('assessed value on the tax roll');
    await expect(panel).toContainText('Enter that figure to include the charge');
  });

  test('an incomplete total is labelled incomplete and explains why', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();
    await selectMarket(page, 'jp');

    const panel = page.locator('#engineTaxPanel');
    await expect(panel).toContainText('incomplete');
    await expect(panel).toContainText('assessed value');
  });
});

test.describe('the residency switch actually changes the tax', () => {
  test('toggling UK residency moves SDLT by the 2% surcharge', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();
    await selectMarket(page, 'uk');

    const readSdlt = async () => {
      await page.locator('[data-step="property"]').click();
      await page.waitForTimeout(200);
      return page.locator('#engineTaxPanel').innerText();
    };

    await page.locator('[data-step="profile"]').click();
    await page.locator('#f-usTaxResident').setChecked(true);
    const resident = await readSdlt();
    expect(resident).toContain('additional property (higher rates)');

    await page.locator('[data-step="profile"]').click();
    await page.locator('#f-usTaxResident').setChecked(false);
    const nonResident = await readSdlt();
    expect(nonResident).toContain('non-UK resident');

    // The control was previously bound to the DOM and read by nothing.
    expect(resident).not.toEqual(nonResident);
  });

  test('the residency label is worded for the market being modelled', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();

    const cases = [
      ['us-nyc', 'US tax resident'],
      ['uk', 'UK tax resident'],
      ['jp', 'Japan tax resident'],
    ];
    for (const [key, expected] of cases) {
      await selectMarket(page, key);
      await page.locator('[data-step="profile"]').click();
      await expect(page.locator('label[for="f-usTaxResident"]')).toHaveText(expected);
    }
  });
});

test('switching between every market raises no console errors', async ({ page }) => {
  const errors = trackConsole(page);
  await openApp(page);
  await page.locator('#modePro').click();
  for (const key of RESEARCHED) {
    await selectMarket(page, key);
  }
  expect(errors).toEqual([]);
});


test.describe('help text is written for the market being modelled', () => {
  test('no United States tax concept appears on a UK or Japanese screen', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();

    for (const key of ['uk', 'jp']) {
      await selectMarket(page, key);
      const help = await page.locator('#propTypeHelp').innerText();
      // 27.5 and 39 year lives are US MACRS. Neither country uses them, so if
      // the figures appear at all they must appear as a disclaimer — the test
      // is that they are never presented as applicable here.
      if (/27\.5|39 year/.test(help)) {
        expect(help).toMatch(/United States rules and do not apply|do not apply/);
      }
      expect(help).not.toMatch(/New York/);

      const payer = await page.locator('#buyTransferSellerLabel').innerText();
      expect(payer).not.toMatch(/New York/);

      // The New York City residency switch has no analogue abroad.
      await page.locator('[data-step="profile"]').click();
      await expect(page.locator('#nycResidentRow')).toBeHidden();
    }
  });

  test('New York keeps its own wording and its own controls', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();
    await selectMarket(page, 'us-nyc');
    await expect(page.locator('#propTypeHelp')).toContainText('27.5');
    await expect(page.locator('#buyTransferSellerLabel')).toContainText('New York');
    await page.locator('[data-step="profile"]').click();
    await expect(page.locator('#nycResidentRow')).toBeVisible();
  });

  test('the document title names the market being modelled', async ({ page }) => {
    await openApp(page);
    await selectMarket(page, 'jp');
    await expect(page).toHaveTitle(/Japan/);
    await selectMarket(page, 'uk');
    await expect(page).toHaveTitle(/England/);
  });
});

test.describe('the printed report cannot overclaim', () => {
  test('every market prints the authority its rules were read from', async ({ page }) => {
    await openApp(page);
    for (const [key, authority] of [
      ['us-nyc', 'IRS'], ['uk', 'HM Revenue'], ['jp', 'National Tax Agency'],
    ]) {
      await selectMarket(page, key);
      await page.locator('[data-step="report"]').click();
      const meta = page.locator('.report-meta');
      await expect(meta).toContainText('Rules read from');
      await expect(meta).toContainText(authority);
      await expect(meta).not.toContainText('unverified sketch');
    }
  });

  test('a researched market prints its charges with a citation and access date', async ({ page }) => {
    await openApp(page);
    await selectMarket(page, 'uk');
    await page.locator('[data-step="report"]').click();
    const main = page.locator('main');
    await expect(main).toContainText('Transaction taxes, from the published rules');
    await expect(main).toContainText('SDLT');
    await expect(main).toContainText('Where these transaction figures come from');
    await expect(main).toContainText('read 2026-08-23');
  });
});

test.describe('No United States tax concept reaches a UK or Japanese screen', () => {
  // Each of these is a United States statute, agency or currency. Showing any
  // of them on a British or Japanese analysis is not a wording slip — it is a
  // statement about the law, made in the same voice as the numbers, and the
  // reader has no way to tell which parts of the page were localised.
  const US_ONLY = [
    { re: /§469\b/, what: 'section 469 passive losses' },
    { re: /§1031\b/, what: 'section 1031 exchanges' },
    { re: /§1250\b/, what: 'section 1250 recapture' },
    { re: /§1411\b/, what: 'the net investment income tax' },
    { re: /FIRPTA/, what: 'FIRPTA withholding' },
    { re: /\bIRS\b/, what: 'the IRS' },
    { re: /MACRS/, what: 'MACRS' },
    { re: /New York/, what: 'New York' },
    { re: /\$\d/, what: 'a dollar amount' },
  ];

  for (const market of ['uk', 'jp']) {
    test(`${market}: every step is free of US concepts and of USD`, async ({ page }) => {
      await openApp(page);
      await page.locator('#f-preset').selectOption(market);
      await page.locator('#f-address').fill('Locale check');
      await page.locator('#modePro').click();
      await page.waitForTimeout(400);

      const steps = ['property', 'financing', 'operations', 'profile', 'sale', 'results', 'compare', 'report'];
      const found = [];

      for (const step of steps) {
        await page.locator(`[data-step="${step}"]`).click();
        // Expand the content disclosures: anything inside a closed one is not
        // rendered, so leaving them shut would let a leak hide behind a
        // collapsed panel. The results dock is excluded — it is a fixed bottom
        // bar on mobile and opening it covers the step navigation.
        await page.evaluate(() => {
          document.querySelectorAll('.result-detail, details.how')
            .forEach((d) => { d.open = true; });
        });
        await page.waitForTimeout(120);

        // The market <select> legitimately names every market, including New
        // York. It is taken out of the reading, not out of the page.
        const text = await page.evaluate(() => {
          const sel = document.querySelector('#f-preset');
          if (sel) sel.style.display = 'none';
          const t = document.querySelector('main').innerText;
          if (sel) sel.style.display = '';
          return t;
        });

        for (const { re, what } of US_ONLY) {
          if (re.test(text)) found.push(`${step}: ${what}`);
        }
      }

      expect(found, `US concepts visible in the ${market} market`).toEqual([]);
    });
  }

  test('New York keeps its own statutes, which are correct there', async ({ page }) => {
    // The gating must be by jurisdiction, not by deletion.
    await openApp(page);
    await page.locator('#modePro').click();
    await page.locator('[data-step="profile"]').click();
    await expect(page.locator('main')).toContainText('§469');
    await page.locator('[data-step="results"]').click();
    await page.evaluate(() => {
      document.querySelectorAll('.result-detail, details.how').forEach((d) => { d.open = true; });
    });
    await expect(page.locator('main')).toContainText('§1250');
  });
});
