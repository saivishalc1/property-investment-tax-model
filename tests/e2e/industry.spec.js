import { test, expect } from '@playwright/test';
import { openApp, step, expandResultDetail } from './helpers.js';

/**
 * The tool is used by people who read a property the way the industry does.
 * These cover the vocabulary and the metrics that audience expects to find.
 */
test.describe('real estate presentation', () => {
  test('the deal header states the property and its headline metrics', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-address').fill('412 Bergen Street, Brooklyn');
    const strip = page.locator('#dealStrip');
    await expect(strip).toBeVisible();
    await expect(page.locator('#dealName')).toHaveText('412 Bergen Street, Brooklyn');
    await expect(page.locator('#dealSub')).toContainText('New York City');
    await expect(page.locator('#dealSub')).toContainText('sq ft');
    for (const metric of ['Price', 'Price / sq ft', 'Going-in cap', 'Exit cap', 'LTV', 'DSCR (min)']) {
      await expect(strip.getByText(metric, { exact: true })).toBeVisible();
    }
  });

  test('a debt service coverage below 1.00 is called out, not just coloured', async ({ page }) => {
    await openApp(page);
    const dscr = await page.evaluate(() => globalThis.__pitm.getResults().returns.minDscr);
    if (dscr < 1) {
      await expect(page.locator('#dealMetrics dd.neg')).toContainText('below 1.00');
    }
  });

  test('the exit can be underwritten off a cap rate', async ({ page }) => {
    await openApp(page);
    await step(page, 'sale').click();
    const before = await page.evaluate(() => globalThis.__pitm.getResults().sale.salePrice);

    await page.locator('input[name="saleBasis"][value="exitCap"]').check();
    await expect(page.locator('#exitCapField')).toBeVisible();
    await page.locator('#f-exitCapPct').fill('5');

    const after = await page.evaluate(() => globalThis.__pitm.getResults());
    expect(after.sale.saleBasis).toBe('exitCap');
    expect(Math.abs(after.sale.exitCapRate - 5)).toBeLessThan(0.001);
    expect(after.sale.salePrice).not.toBe(before);
    // The note explains what the price is derived from.
    await expect(page.locator('#projectedPriceNote')).toContainText('net operating income');
  });

  test('sources and uses balance on the results page', async ({ page }) => {
    await openApp(page);
    await step(page, 'results').click();
    await expandResultDetail(page);
    const table = page.locator('#sourcesUsesTable');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Total uses');
    await expect(table).toContainText('Total sources');
    await expect(table).toContainText('Balanced');
    const balanced = await page.evaluate(() => globalThis.__pitm.getResults().sourcesAndUses.balanced);
    expect(balanced).toBe(true);
  });

  test('results use the terms the industry uses', async ({ page }) => {
    await openApp(page);
    await step(page, 'results').click();
    const panel = page.locator('#panel-results');
    for (const term of ['Net operating income (NOI)', 'Going-in cap rate', 'Exit cap rate',
      'Debt service coverage', 'Price per square foot', 'Levered IRR, after tax']) {
      await expect(panel.getByText(term, { exact: true }).first()).toBeVisible();
    }
  });

  test('per-unit pricing appears for a multi-unit property only', async ({ page }) => {
    await openApp(page);
    await step(page, 'results').click();
    await expect(page.locator('#panel-results').getByText('Price per unit', { exact: true })).toHaveCount(0);

    await step(page, 'property').click();
    await page.locator('#f-units').fill('4');
    await step(page, 'results').click();
    await expect(page.locator('#panel-results').getByText('Price per unit', { exact: true })).toBeVisible();
    await expect(page.locator('#dealStrip').getByText('Price / unit', { exact: true })).toBeVisible();
  });

  test('the printed report carries the address', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-address').fill('412 Bergen Street, Brooklyn');
    await step(page, 'report').click();
    await expect(page.locator('#reportRoot .report-address')).toHaveText('412 Bergen Street, Brooklyn');
  });
});
