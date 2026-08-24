import { test, expect } from '@playwright/test';
import { openApp, trackConsole, results, step } from './helpers.js';

test.describe('core flow', () => {
  test('the library is the entry point and starts empty', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#wsEmpty')).toBeVisible();
    await expect(page.locator('#workspaceCount')).toContainText('No saved analyses');
    await expect(page.locator('#wsNew')).toBeEnabled();
    await expect(page.locator('#wsExample')).toBeEnabled();
    // The analysis shell is not on screen until a property is opened.
    await expect(page.locator('.shell')).toBeHidden();
  });

  test('the NYC example loads and lands on results', async ({ page }) => {
    const errors = trackConsole(page);
    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await page.locator('#wsExample').click();
    await expect(page.locator('#panel-results')).toBeVisible();
    await expect(page.locator('#brandScenario')).toContainText('New York City');
    const r = await results(page);
    expect(r.cashAtClosing).toBeGreaterThan(0);
    expect(r.salePrice).toBeGreaterThan(1250000);
    expect(errors).toEqual([]);
  });

  test('walks every step and produces finite headline numbers', async ({ page }) => {
    const errors = trackConsole(page);
    await openApp(page);

    await page.getByRole('button', { name: /Next: Financing/ }).click();
    await expect(page.locator('#panel-financing')).toBeVisible();

    await page.locator('#f-downPct').fill('25');
    await page.locator('#f-loanRate').fill('6.25');
    await page.getByRole('button', { name: /Next: Rental operations/ }).click();
    await expect(page.locator('#panel-operations')).toBeVisible();

    await page.locator('#f-rentMo').fill('7500');
    await page.locator('#f-years').fill('10');
    await page.getByRole('button', { name: /Next: Your tax profile/ }).click();
    await expect(page.locator('#panel-profile')).toBeVisible();

    await page.getByRole('button', { name: /Next: Sale assumptions/ }).click();
    await expect(page.locator('#panel-sale')).toBeVisible();

    await page.getByRole('button', { name: /See results/ }).click();
    await expect(page.locator('#panel-results')).toBeVisible();

    const r = await results(page);
    for (const [k, v] of Object.entries(r)) {
      if (k === 'irr' && v === null) continue;
      expect(Number.isFinite(v), `${k} is not finite`).toBe(true);
    }
    expect(r.salePrice).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('changing an input updates the live summary immediately', async ({ page }) => {
    await openApp(page);
    const before = await results(page);
    await page.locator('#f-price').fill('1500000');
    await expect.poll(async () => (await results(page)).cashAtClosing)
      .toBeGreaterThan(before.cashAtClosing);
    // The rail reflects it too, in the industry's own vocabulary.
    await expect(page.locator('#railList')).toContainText('Equity to close');
    await expect(page.locator('#railList')).toContainText('Going-in cap');
  });

  test('the mansion-tax cliff is visible in the interface', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').fill('999999');
    const under = await page.evaluate(() => globalThis.__pitm.getResults().purchase.mansionTax);
    await page.locator('#f-price').fill('1000000');
    await expect.poll(async () => page.evaluate(() => globalThis.__pitm.getResults().purchase.mansionTax))
      .toBe(10000);
    expect(under).toBe(0);
  });

  test('professional mode reveals advanced settings, quick mode hides them', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();
    await step(page, 'profile').click();
    await expect(page.getByRole('heading', { name: 'Tax rates used' })).toBeVisible();
    await page.locator('#modeQuick').click();
    await expect(page.getByRole('heading', { name: 'Tax rates used' })).toBeHidden();
  });

  test('"How calculated" panels show the real inputs', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').fill('1200000');
    await step(page, 'results').click();
    const how = page.locator('#cashFormula');
    await expect(how).toContainText('1,200,000');
    await expect(how).toContainText('cost basis');
  });

  test('validation blocks bad input, links to the field, and never rewrites it', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').fill('0');
    const summary = page.locator('#errorSummary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Purchase price');
    await expect(page.locator('#f-price')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#f-price-err')).toContainText('Purchase price');

    await step(page, 'financing').click();
    await page.locator('#f-loanRate').fill('99');
    await step(page, 'property').click();
    await summary.getByRole('link', { name: /Interest rate/ }).click();
    await expect(page.locator('#panel-financing')).toBeVisible();
    await expect(page.locator('#f-loanRate')).toBeFocused();
    await expect(page.locator('#f-loanRate')).toHaveValue('99', { timeout: 2000 });
  });

  test('warnings appear without blocking the calculation', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-landPct').fill('0');
    await expect(page.locator('#warningSummary')).toBeVisible();
    await expect(page.locator('#errorSummary')).toBeHidden();
    const r = await results(page);
    expect(Number.isFinite(r.totalProfit)).toBe(true);
  });

  test('comparison tables render every scenario column', async ({ page }) => {
    await openApp(page);
    await step(page, 'compare').click();
    await expect(page.locator('#holdCompare')).toBeVisible();
    const headers = await page.locator('#holdCompare thead th').allTextContents();
    expect(headers.join(' ')).toContain('5 years');
    expect(headers.join(' ')).toContain('10 years');
    expect(headers.join(' ')).toContain('15 years');

    await page.locator('#f-customHold').fill('25');
    await expect(page.locator('#holdCompare thead')).toContainText('25 years');

    for (const id of ['#growthCompare', '#financeCompare', '#priceCompare', '#exchangeCompare']) {
      await expect(page.locator(`${id} tbody tr`).first()).toBeVisible();
    }
  });

  test('the 1031 comparison keeps deferral and passive losses distinct', async ({ page }) => {
    await openApp(page);
    await step(page, 'compare').click();
    const table = page.locator('#exchangeCompare');
    await expect(table).toContainText('Tax paid now');
    await expect(table).toContainText('stay suspended');
    await expect(table).toContainText('Gain deferred, not forgiven');
  });

  test('the report contains scenario, sources, limitations and a disclaimer', async ({ page }) => {
    await openApp(page);
    await step(page, 'report').click();
    const report = page.locator('#reportRoot');
    await expect(report).toBeVisible();
    await expect(report).toContainText('New York City');
    await expect(report).toContainText('Tax year 2026');
    await expect(report.getByRole('heading', { name: 'Sources' })).toBeVisible();
    await expect(report.getByRole('heading', { name: 'Limitations' })).toBeVisible();
    await expect(report).toContainText('not tax-preparation software');
    await expect(report).toContainText('has not been reviewed or validated by a certified public accountant');
    // Sources point at official government hosts.
    const hrefs = await report.locator('a[href^="http"]').evaluateAll((as) => as.map((a) => a.href));
    expect(hrefs.length).toBeGreaterThan(3);
    expect(hrefs.every((h) => /(^https:\/\/)(www\.)?(tax\.ny\.gov|www\.nyc\.gov|www\.irs\.gov|nyc\.gov|irs\.gov)/.test(h))).toBe(true);
    // External links must be safe.
    const rels = await report.locator('a[href^="http"]').evaluateAll((as) => as.map((a) => a.rel));
    expect(rels.every((r) => r.includes('noopener'))).toBe(true);
  });

  test('preset status claims a documentary check, never professional review', async ({ page }) => {
    await openApp(page);
    const status = page.locator('#presetStatusLine');
    await expect(status).toContainText('Rates checked');
    // The word "verified" on its own overstates what was done; it must not appear.
    await expect(status).not.toContainText(/verified/i);

    // The United Kingdom now has a researched rule pack, so it is no longer
    // experimental. Germany still has none, and must still say so.
    await page.locator('#f-preset').selectOption('uk');
    await expect(status).toContainText('Rates checked');
    await expect(status).toContainText('HM Revenue');

    await page.locator('#f-preset').selectOption('jp');
    await expect(status).toContainText('Rates checked');
    await expect(status).toContainText('National Tax Agency');
  });

  test('the tax profile states exactly what was and was not checked', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();
    await step(page, 'profile').click();
    const sources = page.locator('#sourcesBlock');
    await expect(sources).toContainText('documentary check, not professional review');
    await expect(sources).toContainText('read from the government source itself');
    await expect(sources).toContainText('corroborating secondary sources');
    await expect(sources).toContainText('Review by a CPA, attorney or enrolled agent — none');
  });

  test('rates are worked out from income rather than a single top rate', async ({ page }) => {
    await openApp(page);
    const rates = await page.evaluate(() => {
      const r = globalThis.__pitm.getResults();
      return { marginal: r.hold.ordinaryRate, flatTop: r.hold.flatOrdinaryRate, usingBrackets: r.hold.useBrackets };
    });
    expect(rates.usingBrackets).toBe(true);
    // A $150,000 earner must not be charged at the top of the scale.
    expect(rates.marginal).toBeLessThan(rates.flatTop - 5);
  });

  test('switching preset changes rates but leaves the property inputs alone', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').fill('1100000');

    const read = () => page.evaluate(() => {
      const r = globalThis.__pitm.getResults();
      return { rate: r.meta.ordinaryRate, currency: r.meta.jurisdiction.currency };
    });
    const before = await read();

    await page.locator('#f-preset').selectOption('jp');
    // The number the user typed is never rewritten by a market change.
    await expect(page.locator('#f-price')).toHaveValue('1100000');

    const after = await read();
    expect(after.currency).toBe('JPY');
    expect(before.currency).toBe('USD');
    // And the rates DID change — the whole point of switching market.
    expect(after.rate).not.toBeCloseTo(before.rate, 3);
  });
});
