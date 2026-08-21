import { test, expect } from '@playwright/test';
import { openApp, trackConsole } from './helpers.js';

test.describe('scenario management and persistence', () => {
  test('save, rename, duplicate, load and delete a scenario', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').fill('880000');

    await page.getByRole('button', { name: 'Scenarios' }).click();
    const dlg = page.locator('#scenarioDialog');
    await expect(dlg).toBeVisible();

    await page.locator('#f-scenarioName').fill('Bushwick triplex');
    await page.locator('#sSave').click();
    await expect(page.locator('#scenarioList')).toContainText('Bushwick triplex');

    await page.locator('#sDuplicate').click();
    await expect(page.locator('#scenarioList')).toContainText('Bushwick triplex (copy)');

    // Change the live scenario, then load the saved one back.
    await page.locator('#scenarioClose').click();
    await page.locator('#f-price').fill('123456');
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('#scenarioList li', { hasText: 'Bushwick triplex (copy)' })
      .getByRole('button', { name: 'Load' }).click();
    await expect(page.locator('#f-price')).toHaveValue('880000');

    await page.getByRole('button', { name: 'Scenarios' }).click();
    const count = await page.locator('#scenarioList li').count();
    await page.locator('#scenarioList li').first().getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('#scenarioList li')).toHaveCount(count - 1);
  });

  test('autosave survives a reload and is offered as "continue"', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').fill('765000');
    await page.waitForTimeout(700); // debounce

    await page.reload();
    await expect(page.locator('#wContinue')).toBeEnabled();
    await page.locator('#wContinue').click();
    await expect(page.locator('#f-price')).toHaveValue('765000');
  });

  test('a version 1 file imports and migrates', async ({ page }) => {
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

  test('a hostile scenario file cannot pollute the prototype chain', async ({ page }) => {
    await openApp(page);
    const safe = await page.evaluate(async () => {
      const mod = await import('./src/storage.js');
      mod.migrate(JSON.parse('{"purchase":{"__proto__":{"pwned":1},"price":500000}}'));
      return { pwned: ({}).pwned === undefined, stillWorks: !!globalThis.__pitm.getResults() };
    });
    expect(safe).toEqual({ pwned: true, stillWorks: true });
  });

  test('reset returns to the default scenario and clears autosave', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').fill('2000000');
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('#sReset').click();
    await expect(page.locator('#f-price')).toHaveValue('950000');
    await expect(page.locator('#panel-property')).toBeVisible();
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
