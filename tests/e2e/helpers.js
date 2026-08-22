/** Shared helpers for the end-to-end suite. */

/** Collect console errors and page exceptions for the life of a page. */
export function trackConsole(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    // Ignore aborted navigations; report genuine load failures.
    const f = r.failure();
    if (f && !/ERR_ABORTED/.test(f.errorText)) errors.push(`requestfailed: ${r.url()} ${f.errorText}`);
  });
  return errors;
}

/** Open the app and dismiss the welcome dialog by starting a new analysis. */
export async function openApp(page, url = '/') {
  await page.goto(url);
  const dialog = page.locator('#welcomeDialog');
  await dialog.waitFor({ state: 'visible' });
  await page.locator('#wNew').click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
}

/** Read a value from the exposed read-only test bridge. */
export async function results(page) {
  return page.evaluate(() => {
    const r = globalThis.__pitm.getResults();
    return {
      cashAtClosing: r.purchase.cashAtClosing,
      noi: r.hold.year1.noi,
      capRate: r.returns.capRate,
      salePrice: r.sale.salePrice,
      totalSaleTax: r.sale.totalSaleTax,
      netProceeds: r.sale.netProceeds,
      totalProfit: r.returns.totalProfit,
      roi: r.returns.roi,
      irr: r.returns.irr,
    };
  });
}

/**
 * Locate a step button by the step it navigates to.
 *
 * Deliberately not by accessible name: a step button's name changes as its
 * state changes (a completed step announces itself as completed), and a test
 * that breaks when a label gains a word is testing the label, not the app.
 */
export function step(page, key) {
  return page.locator(`#stepList button[data-step="${key}"]`);
}
