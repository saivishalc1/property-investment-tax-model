import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openApp, step } from './helpers.js';

const STEPS = ['property', 'financing', 'operations', 'profile', 'sale', 'results', 'compare', 'report'];

async function scan(page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
}

test.describe('accessibility', () => {
  for (const key of STEPS) {
    test(`axe finds no violations on the ${key} step (light)`, async ({ page }) => {
      await openApp(page);
      await step(page, key).click();
      const r = await scan(page);
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
    });
  }

  test('axe finds no violations in dark theme with professional mode on', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Toggle dark theme' }).click();
    await page.getByRole('button', { name: 'Professional' }).click();
    for (const key of STEPS) {
      await step(page, key).click();
      const r = await scan(page);
      expect(r.violations.map((v) => v.id), `violations on ${key}`).toEqual([]);
    }
  });

  test('the welcome dialog is accessible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#welcomeDialog')).toBeVisible();
    const r = await scan(page);
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test('the welcome dialog traps focus and closes on Escape', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#welcomeDialog')).toBeVisible();
    // A native <dialog> opened with showModal makes the rest of the page inert.
    const inert = await page.evaluate(() => {
      const outside = document.querySelector('#f-price');
      outside.focus();
      return document.activeElement !== outside;
    });
    expect(inert).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#welcomeDialog')).toBeHidden();
  });

  test('landmarks and heading structure are present exactly once', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('header.app-header')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.locator('aside')).toHaveCount(1);
    // One h1, and it belongs to the visible step.
    const h1s = page.locator('section.panel:not([hidden]) h1');
    await expect(h1s).toHaveCount(1);
    await expect(h1s).toHaveText('The property');
  });

  test('the skip link is the first tab stop and moves focus to main', async ({ page }) => {
    await openApp(page);
    // Start from the very top of the document, as a keyboard user would.
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement.className);
    expect(focused).toContain('skip-link');
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('the whole first step is operable by keyboard alone', async ({ page }) => {
    await openApp(page);
    await page.locator('#f-price').focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('1100000');
    await expect(page.locator('#f-price')).toHaveValue('1100000');

    // Radio groups respond to arrow keys.
    await page.locator('input[name="propType"][value="residential"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('input[name="propType"][value="coop"]')).toBeChecked();

    // Tooltips open from the keyboard and close with Escape.
    const tipBtn = page.locator('button[aria-controls="tip-land"]');
    await tipBtn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tip-land')).toBeVisible();
    await expect(tipBtn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#tip-land')).toBeHidden();
  });

  test('step navigation exposes the current step to assistive technology', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#stepList button[aria-current="step"]')).toHaveText(/Property/);
    await step(page, 'results').click();
    await expect(page.locator('#stepList button[aria-current="step"]')).toHaveText(/Results/);
    await expect(page.locator('#stepList button[aria-current="step"]')).toHaveCount(1);
  });

  test('status messages reach a live region', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Professional' }).click();
    await expect(page.locator('#liveStatus')).toContainText('Professional mode', { timeout: 3000 });
  });

  test('every form control has an accessible name', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Professional' }).click();
    for (const key of ['property', 'financing', 'operations', 'profile', 'sale']) {
      await step(page, key).click();
      const unnamed = await page.locator('section.panel:not([hidden]) input, section.panel:not([hidden]) select')
        .evaluateAll((nodes) => nodes.filter((n) => {
          if (n.type === 'file' || n.offsetParent === null) return false;
          const byLabel = n.labels && n.labels.length > 0;
          return !(byLabel || n.getAttribute('aria-label') || n.getAttribute('aria-labelledby'));
        }).map((n) => n.id || n.outerHTML.slice(0, 80)));
      expect(unnamed, `unnamed controls on ${key}`).toEqual([]);
    }
  });

  test('charts have a text alternative and a data table', async ({ page }) => {
    await openApp(page);
    await step(page, 'results').click();
    const svg = page.locator('#cfChart svg');
    await expect(svg).toHaveAttribute('role', 'img');
    const label = await svg.getAttribute('aria-label');
    expect(label).toMatch(/after-tax cash flow by year/i);
    await page.locator('#cfTableDetails summary').click();
    await expect(page.locator('#cfDataTable')).toBeVisible();
    await expect(page.locator('#cfDataTable caption')).toHaveText(/cash flow by year/i);
  });

  test('data tables have captions and scoped headers', async ({ page }) => {
    await openApp(page);
    await step(page, 'results').click();
    const tables = page.locator('#panel-results table');
    const n = await tables.count();
    expect(n).toBeGreaterThan(4);
    for (let i = 0; i < n; i++) {
      const t = tables.nth(i);
      if (!(await t.isVisible())) continue;
      await expect(t.locator('caption')).toHaveCount(1);
      expect(await t.locator('th[scope]').count()).toBeGreaterThan(0);
    }
  });

  test('information is never carried by colour alone', async ({ page }) => {
    await openApp(page);
    await step(page, 'results').click();
    // Negative values are marked with a minus sign, not only a red class.
    const negatives = await page.locator('#panel-results td.neg').allTextContents();
    expect(negatives.length).toBeGreaterThan(0);
    expect(negatives.every((t) => t.includes('−') || t.includes('-'))).toBe(true);
  });

  test('reduced motion is respected', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    const duration = await page.evaluate(() => {
      const btn = document.querySelector('.btn');
      return getComputedStyle(btn).transitionDuration;
    });
    expect(parseFloat(duration)).toBeLessThan(0.01);
  });
});
