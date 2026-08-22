import { test, expect } from '@playwright/test';
import { openApp, trackConsole, step } from './helpers.js';

const SUBPATH = 'http://127.0.0.1:4174/property-investment-tax-model/';

test.describe('deployment shape', () => {
  test('the site works under a GitHub Pages project subpath', async ({ page }) => {
    const errors = trackConsole(page);
    await openApp(page, SUBPATH);
    await expect(page.locator('#panel-property')).toBeVisible();
    await step(page, 'results').click();
    await expect(page.locator('#kpiGrid .kpi').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('every asset loads with a 200 under the subpath', async ({ page }) => {
    const bad = [];
    page.on('response', (r) => {
      const url = r.url();
      if (url.startsWith('http://127.0.0.1:4174') && r.status() >= 400) bad.push(`${r.status()} ${url}`);
    });
    await openApp(page, SUBPATH);
    await step(page, 'report').click();
    await page.waitForTimeout(300);
    expect(bad).toEqual([]);
  });

  test('no reference uses a root-absolute path', async ({ page }) => {
    await page.goto(SUBPATH);
    const rooted = await page.evaluate(() => {
      const out = [];
      for (const n of document.querySelectorAll('[src],[href]')) {
        const v = n.getAttribute('src') || n.getAttribute('href');
        if (v && v.startsWith('/') && !v.startsWith('//')) out.push(v);
      }
      return out;
    });
    expect(rooted).toEqual([]);
  });

  test('metadata, icons and manifest are present', async ({ page, request }) => {
    await page.goto(SUBPATH);
    await expect(page).toHaveTitle(/Property Investment Tax Model/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /New York/);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', './assets/favicon.svg');
    for (const path of ['assets/favicon.svg', 'assets/icon-180.png', 'assets/site.webmanifest', 'robots.txt']) {
      const r = await request.get(SUBPATH + path);
      expect(r.status(), path).toBe(200);
    }
  });

  test('the content security policy is present and blocks external origins', async ({ page }) => {
    await page.goto('/');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    // frame-ancestors is intentionally absent: browsers ignore it in a meta
    // tag and log a console error for it.
    expect(csp).not.toContain('frame-ancestors');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('unsafe-inline');
  });

  test('the application makes no network request other than its own assets', async ({ page }) => {
    const external = [];
    page.on('request', (r) => {
      if (!r.url().startsWith('http://127.0.0.1:4173')) external.push(r.url());
    });
    await openApp(page);
    await page.locator('#f-price').fill('1450000');
    await step(page, 'results').click();
    await step(page, 'compare').click();
    await page.waitForTimeout(500);
    expect(external).toEqual([]);
  });

  test('every internal link resolves', async ({ page, request }) => {
    await openApp(page);
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && !h.startsWith('http') && !h.startsWith('#') && !h.startsWith('mailto:')));
    for (const h of hrefs) {
      const r = await request.get(new URL(h, 'http://127.0.0.1:4173/').toString());
      expect(r.status(), h).toBeLessThan(400);
    }
  });

  test('no console errors anywhere in the app', async ({ page }) => {
    const errors = trackConsole(page);
    await openApp(page);
    await page.locator('#modePro').click();
    for (const label of ['property', 'financing', 'operations', 'profile',
      'sale', 'results', 'compare', 'report']) {
      await step(page, label).click();
      await page.waitForTimeout(80);
    }
    await page.getByRole('button', { name: 'Toggle dark theme' }).click();
    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });

  test('the print stylesheet hides navigation and shows the report', async ({ page }) => {
    await openApp(page);
    await step(page, 'report').click();
    await page.emulateMedia({ media: 'print' });
    const state = await page.evaluate(() => ({
      header: getComputedStyle(document.querySelector('.app-header')).display,
      nav: getComputedStyle(document.querySelector('.stepnav')).display,
      rail: getComputedStyle(document.querySelector('.results-rail')).display,
      dock: getComputedStyle(document.querySelector('#resultsDock')).display,
      report: getComputedStyle(document.querySelector('#reportRoot')).display,
      actions: getComputedStyle(document.querySelector('#panel-report .step-actions')).display,
    }));
    expect(state.header).toBe('none');
    expect(state.nav).toBe('none');
    expect(state.rail).toBe('none');
    expect(state.dock).toBe('none');
    expect(state.actions).toBe('none');
    expect(state.report).not.toBe('none');
    await page.emulateMedia({ media: 'screen' });
  });

  test('the report still prints when a different step is on screen', async ({ page }) => {
    await openApp(page);
    await step(page, 'report').click();
    await step(page, 'property').click();
    await page.emulateMedia({ media: 'print' });
    const visible = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#panel-report')).display);
    expect(visible).toBe('block');
    await page.emulateMedia({ media: 'screen' });
  });
});
