import { test, expect } from '@playwright/test';
import { openApp, trackConsole } from './helpers.js';

/**
 * Saving, naming, duplicating and importing named scenarios was removed: for
 * someone running a single property it was the most confusing part of the tool,
 * and this is a calculator rather than a document manager. What remains is the
 * behaviour a user actually relies on — work is never lost, and starting over
 * is one obvious button.
 */
test.describe('persistence and starting over', () => {
  test('the interface exposes no scenario-management machinery', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('button', { name: 'Scenarios' })).toHaveCount(0);
    await expect(page.locator('#scenarioDialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible();
  });

  test('work is saved to the library and comes back after a reload', async ({ page }) => {
    // The old modal asked "continue where you left off?". The library answers
    // that by simply having the property in it.
    await openApp(page);
    await page.locator('#f-address').fill('Autosave check');
    await page.locator('#f-price').fill('765000');
    await page.waitForTimeout(1400); // autosave debounce

    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await expect(page.locator('#workspace')).toBeVisible();

    const row = page.locator('.property-open', { hasText: 'Autosave check' });
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(page.locator('#f-price')).toHaveValue('765000');
  });

  test('"Start over" clears the work and returns to step one', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').fill('2000000');
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.locator('#f-price')).toHaveValue('950000');
    await expect(page.locator('#panel-property')).toBeVisible();
  });

  test('the report can be given a title for the client', async ({ page }) => {
    await openApp(page);
    await page.locator('#stepList button[data-step="report"]').click();
    await page.locator('#f-reportTitle').fill('42 Bergen Street — acquisition analysis');
    await expect(page.locator('#reportRoot h2')).toHaveText('42 Bergen Street — acquisition analysis');
  });

  test('an older saved file is migrated rather than rejected', async ({ page }) => {
    await openApp(page);
    const migrated = await page.evaluate(async () => {
      const mod = await import('./src/storage.js');
      const s = mod.migrate({
        meta: { name: 'Legacy import', preset: 'us-nyc' },
        purchase: { price: 640000, buyerPaysTransferTax: true },
        hold: { years: 8, depMonthsY1: 6 },
      });
      return { name: s.meta.name, price: s.purchase.price, payer: s.purchase.transferTaxPayer, month: s.profile.serviceMonth, v: s.schemaVersion };
    });
    expect(migrated).toMatchObject({
      name: 'Legacy import', price: 640000, payer: 'buyer', month: 7, v: 3,
    });
  });

  test('a hostile saved file cannot pollute the prototype chain', async ({ page }) => {
    await openApp(page);
    const safe = await page.evaluate(async () => {
      const mod = await import('./src/storage.js');
      mod.migrate(JSON.parse('{"purchase":{"__proto__":{"pwned":1},"price":500000}}'));
      return { pwned: ({}).pwned === undefined, stillWorks: !!globalThis.__pitm.getResults() };
    });
    expect(safe).toEqual({ pwned: true, stillWorks: true });
  });

  test('the theme choice persists across reloads', async ({ page }) => {
    const errors = trackConsole(page);
    await openApp(page);
    await page.getByRole('button', { name: 'Toggle dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(errors).toEqual([]);
  });
});
