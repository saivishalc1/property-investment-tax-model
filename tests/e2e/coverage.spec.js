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

const RESEARCHED = ['us-nyc', 'uk', 'jp'];
const UNRESEARCHED = ['de', 'fr', 'us-tx', 'us-fl', 'sg'];

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

  test('an unresearched market says so on the badge AND in the dropdown', async ({ page }) => {
    await openApp(page);
    for (const key of UNRESEARCHED) {
      await selectMarket(page, key);
      await expect(page.locator('#presetStatusLine')).toContainText('Experimental preset');
      await expect(page.locator('#presetStatusLine')).toContainText('no researched rule pack');
      const label = await page.locator('#f-preset option:checked').innerText();
      expect(label).toMatch(/unresearched/i);
    }
  });

  test('Texas and Florida warn, which the old prefix test never did', async ({ page }) => {
    // The previous rule warned only when the preset id did NOT start with
    // "us-", so every unresearched United States market was silently trusted.
    await openApp(page);
    for (const key of ['us-tx', 'us-fl', 'us-ca']) {
      await selectMarket(page, key);
      await expect(page.locator('#warningSummary')).toContainText('no researched rule pack');
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

  test('an unresearched market renders a refusal, not a number', async ({ page }) => {
    await openApp(page);
    await page.locator('#modePro').click();
    await selectMarket(page, 'de');

    const panel = page.locator('#engineTaxPanel');
    await expect(panel).toContainText('No checked rules for this market');
    await expect(panel).not.toContainText('Total');
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
      ['de', 'Tax resident where the property is'],
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
  for (const key of [...RESEARCHED, ...UNRESEARCHED, 'intl']) {
    await selectMarket(page, key);
  }
  expect(errors).toEqual([]);
});
