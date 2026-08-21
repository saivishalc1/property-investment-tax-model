import { test, expect } from '@playwright/test';
import { openApp, trackConsole, results } from './helpers.js';

test.describe('core flow', () => {
  test('welcome screen offers all four entry points', async ({ page }) => {
    await page.goto('/');
    const dialog = page.locator('#welcomeDialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#wNew')).toBeEnabled();
    await expect(page.locator('#wExample')).toBeEnabled();
    await expect(page.locator('#wLoad')).toBeEnabled();
    // Nothing saved yet in a fresh context, so "continue" is disabled.
    await expect(page.locator('#wContinue')).toBeDisabled();
  });

  test('the NYC example loads and lands on results', async ({ page }) => {
    const errors = trackConsole(page);
    await page.goto('/');
    await page.locator('#wExample').click();
    await expect(page.locator('#panel-results')).toBeVisible();
    await expect(page.locator('#brandScenario')).toContainText('NYC example');
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
    // The rail reflects it too.
    await expect(page.locator('#railList')).toContainText('Cash to close');
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
    await page.getByRole('button', { name: 'Professional' }).click();
    await page.getByRole('button', { name: '4 Your tax profile' }).click();
    await expect(page.getByRole('heading', { name: 'Tax rates used' })).toBeVisible();
    await page.getByRole('button', { name: 'Quick estimate' }).click();
    await expect(page.getByRole('heading', { name: 'Tax rates used' })).toBeHidden();
  });

  test('"How calculated" panels show the real inputs', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').fill('1200000');
    await page.getByRole('button', { name: '6 Results' }).click();
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

    await page.getByRole('button', { name: '2 Financing' }).click();
    await page.locator('#f-loanRate').fill('99');
    await page.getByRole('button', { name: '1 Property' }).click();
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
    await page.getByRole('button', { name: '7 Comparisons' }).click();
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
    await page.getByRole('button', { name: '7 Comparisons' }).click();
    const table = page.locator('#exchangeCompare');
    await expect(table).toContainText('Tax paid now');
    await expect(table).toContainText('stay suspended');
    await expect(table).toContainText('Gain deferred, not forgiven');
  });

  test('the report contains scenario, sources, limitations and a disclaimer', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: '8 Report' }).click();
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

  test('preset status is never presented as professionally verified', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#presetStatusLine')).toContainText('Verified New York rules');
    await page.locator('#f-preset').selectOption('uk');
    await expect(page.locator('#presetStatusLine')).toContainText('Experimental preset');
    await expect(page.locator('#warningSummary')).toContainText('experimental preset');
  });

  test('switching preset changes rates but leaves the property inputs alone', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').fill('1100000');
    await page.locator('#f-preset').selectOption('us-nys');
    await expect(page.locator('#f-price')).toHaveValue('1100000');
    const cityTax = await page.evaluate(() => globalThis.__pitm.getResults().purchase.cityTransfer);
    expect(cityTax).toBe(0);
  });
});
