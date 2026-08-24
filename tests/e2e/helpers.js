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

/**
 * Open the app and start a new analysis.
 *
 * The entry point is the saved property library rather than a modal, so this
 * clicks through to a fresh analysis. Each test gets its own browser context,
 * so the library starts empty.
 */
export async function openApp(page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await page.locator('#wsNew').click();
  await page.locator('#workspace').waitFor({ state: 'hidden' });
}

/** Open the app and stay in the library. */
export async function openLibrary(page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await page.locator('#workspace').waitFor({ state: 'visible' });
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

/**
 * Expand the supporting detail on Results.
 *
 * Those sections are collapsed in Standard view, so their tables are not
 * rendered at all until opened — which is what a reader does before reading
 * one. Switching to Detailed opens every section at once, which is the same
 * thing a reader does when they want all of it.
 */
export async function expandResultDetail(page) {
  await page.locator('#modePro').click();
  await page.waitForFunction(
    () => [...document.querySelectorAll('.result-detail')].every((d) => d.open),
  );
}
