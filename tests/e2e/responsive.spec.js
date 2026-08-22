import { test, expect } from '@playwright/test';
import { openApp, trackConsole, step } from './helpers.js';

const WIDTHS = [320, 360, 414, 768, 1024, 1280, 1440, 1920];

test.describe('responsive layout', () => {
  for (const width of WIDTHS) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openApp(page);
      for (const label of ['property', 'operations', 'results', 'compare', 'report']) {
        await step(page, label).click();
        const overflow = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
        }));
        expect(overflow.doc, `document overflows on ${label}`).toBeLessThanOrEqual(1);
        expect(overflow.body, `body overflows on ${label}`).toBeLessThanOrEqual(1);
      }
    });
  }

  test('the persistent results rail shows on desktop and the dock on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await expect(page.locator('.results-rail')).toBeVisible();
    await expect(page.locator('#resultsDock')).toBeHidden();

    await page.setViewportSize({ width: 390, height: 780 });
    await expect(page.locator('.results-rail')).toBeHidden();
    await expect(page.locator('#resultsDock')).toBeVisible();
    await expect(page.locator('#dockCash')).not.toHaveText('—');
    await page.locator('#resultsDock summary').click();
    await expect(page.locator('#dockList')).toBeVisible();
  });

  test('touch targets on mobile are at least 24px in both dimensions', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 780 });
    await openApp(page);
    const small = await page.evaluate(() => {
      const out = [];
      for (const n of document.querySelectorAll('button, a, input, select, summary')) {
        if (n.offsetParent === null && n.tagName !== 'SUMMARY') continue;
        const r = n.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.width < 24 || r.height < 24) out.push((n.id || n.textContent || n.tagName).trim().slice(0, 40));
      }
      return out;
    });
    expect(small).toEqual([]);
  });

  test('wide tables scroll inside their own container', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openApp(page);
    await page.getByRole('button', { name: 'Professional' }).click();
    await step(page, 'results').click();
    const scroller = page.locator('#yearlyTable').locator('xpath=ancestor::div[contains(@class,"table-scroll")]');
    const canScroll = await scroller.evaluate((n) => n.scrollWidth > n.clientWidth);
    expect(canScroll).toBe(true);
    const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(docOverflow).toBeLessThanOrEqual(1);
  });

  test('no console errors while resizing through every breakpoint', async ({ page }) => {
    const errors = trackConsole(page);
    await openApp(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await page.waitForTimeout(60);
    }
    expect(errors).toEqual([]);
  });
});
