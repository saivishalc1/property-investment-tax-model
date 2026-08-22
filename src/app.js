/**
 * app.js — user interface layer.
 *
 * The rule this file follows without exception: no user-controlled string is
 * ever assigned to innerHTML. Every value the user typed, imported, or loaded
 * reaches the page through textContent or a property assignment. The only
 * innerHTML in the file is emptying a container (`= ''`) and the small set of
 * static SVG strings built entirely from numbers.
 */

import { computeModel, computeVariant, num } from './calculations.js?v=9c3012ca52';
import { PRESETS, REGIONS } from './presets.js?v=9c3012ca52';
import { validate } from './validation.js?v=9c3012ca52';
import * as store from './storage.js?v=9c3012ca52';

/* ================================================================== *
 * DOM helpers
 * ================================================================== */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/** Build an element. Children may be strings (escaped) or nodes. */
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = v; // static markup only, never user data
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children || [])) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return node;
}

function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

/* ================================================================== *
 * Formatting
 * ================================================================== */

let currencySymbol = '$';

function money(n, dp) {
  if (!Number.isFinite(n)) return '—';
  const d = dp == null ? 0 : dp;
  const neg = n < -0.005;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (neg ? '−' : '') + currencySymbol + s;
}

function pct(n, dp) {
  if (!Number.isFinite(n)) return '—';
  const d = dp == null ? 2 : dp;
  return (n < 0 ? '−' : '') + Math.abs(n).toFixed(d) + '%';
}

function ratePct(n) { return pct(n, Math.abs(n * 1000 % 10) > 0 ? 3 : 2); }

function compact(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e9) return sign + currencySymbol + (a / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return sign + currencySymbol + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return sign + currencySymbol + Math.round(a / 1e3) + 'k';
  return sign + currencySymbol + Math.round(a);
}

const signClass = (n) => (n >= 0 ? 'pos' : 'neg');
const dateLong = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/* ================================================================== *
 * State
 * ================================================================== */

let S = store.defaultState();
let results = null;
let currentErrors = [];
let currentStep = 'property';
// Steps the user has actually opened. A tick means "you have been here and it
// holds up", never "we filled this in for you".
const visitedSteps = new Set(['property']);

const STEPS = ['property', 'financing', 'operations', 'profile', 'sale', 'results', 'compare', 'report'];
const STEP_OF_PATH = {
  'meta.': 'property', 'purchase.price': 'property', 'purchase.propType': 'property',
  'purchase.landPct': 'property', 'purchase.titlePct': 'property', 'purchase.legal': 'property',
  'purchase.inspection': 'property', 'purchase.otherBuy': 'property', 'purchase.transferTaxPayer': 'property',
  'purchase.downPct': 'financing', 'purchase.loanRate': 'financing', 'purchase.loanTermYrs': 'financing',
  'purchase.ioYears': 'financing', 'purchase.pointsPct': 'financing',
  'hold.': 'operations', 'profile.capexYear': 'operations', 'profile.capexMonth': 'operations',
  'profile.': 'profile', 'sale.': 'sale',
};

function stepForPath(path) {
  if (STEP_OF_PATH[path]) return STEP_OF_PATH[path];
  for (const [prefix, step] of Object.entries(STEP_OF_PATH)) {
    if (prefix.endsWith('.') && path.startsWith(prefix)) return step;
  }
  return 'property';
}

function getPath(obj, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  if (['__proto__', 'constructor', 'prototype'].includes(last)) return;
  let node = obj;
  for (const k of keys) node = node[k];
  node[last] = value;
}

/* ================================================================== *
 * Binding
 * ================================================================== */

function bindInputs() {
  $$('[data-bind]').forEach((input) => {
    const path = input.dataset.bind;
    const handler = () => {
      if (input.type === 'checkbox') setPath(S, path, input.checked);
      else if (input.type === 'number') setPath(S, path, input.value === '' ? '' : parseFloat(input.value));
      else setPath(S, path, input.value);
      if (path === 'meta.preset') applyPreset(input.value);
      onChange();
    };
    input.addEventListener(input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input', handler);
  });

  $$('[data-bind-radio]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) { setPath(S, input.dataset.bindRadio, input.value); onChange(); }
    });
  });
}

function syncInputs() {
  $$('[data-bind]').forEach((input) => {
    const v = getPath(S, input.dataset.bind);
    if (input.type === 'checkbox') input.checked = !!v;
    else if (document.activeElement !== input) input.value = v === null || v === undefined ? '' : v;
  });
  $$('[data-bind-radio]').forEach((input) => {
    input.checked = String(getPath(S, input.dataset.bindRadio)) === input.value;
  });
  $$('[data-currency]').forEach((n) => { n.textContent = currencySymbol; });
}

/* ================================================================== *
 * Presets
 * ================================================================== */

function buildPresetSelect() {
  const sel = $('#f-preset');
  clear(sel);
  for (const region of REGIONS) {
    const group = el('optgroup', { label: region });
    for (const [key, p] of Object.entries(PRESETS)) {
      if (p.region !== region) continue;
      const suffix = p.status === 'checked' ? '' : p.status === 'blank' ? ' (blank template)' : ' (experimental)';
      group.appendChild(el('option', { value: key, text: p.label + suffix }));
    }
    if (group.childElementCount) sel.appendChild(group);
  }
}

function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  rateFieldsBuiltFor = null;
  bracketEditorsBuiltFor = null;
  S.rates = structuredClone(preset.rates);
  S.meta.preset = key;
  // Follow the local convention for who pays transfer tax, but never touch any
  // other number the user has entered.
  const side = preset.dutySide === 'buyer' ? 'buyer' : 'seller';
  S.purchase.transferTaxPayer = side;
  S.sale.transferTaxPayer = side === 'buyer' ? 'buyer' : 'seller';
  if (preset.lossRule === true) S.hold.passiveAllowed = true;
  if (preset.lossRule === false) S.hold.passiveAllowed = false;
  announce(`Switched to the ${preset.label} preset. Tax rates updated; your property and income figures are unchanged.`);
}

/* ================================================================== *
 * Validation display
 * ================================================================== */

function renderValidation() {
  const { errors, warnings } = validate(S);
  currentErrors = errors;

  $$('[data-bind]').forEach((input) => {
    const errNode = document.getElementById(`${input.id}-err`);
    const hit = errors.find((e) => e.path === input.dataset.bind);
    if (hit) {
      input.setAttribute('aria-invalid', 'true');
      if (errNode) errNode.textContent = hit.message;
    } else {
      input.removeAttribute('aria-invalid');
      if (errNode) errNode.textContent = '';
    }
  });

  const box = $('#errorSummary');
  const list = $('#errorSummaryList');
  clear(list);
  if (errors.length) {
    for (const e of errors) {
      const input = $$('[data-bind]').find((i) => i.dataset.bind === e.path);
      const a = el('a', { href: input ? `#${input.id}` : '#main', text: e.message });
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        goTo(stepForPath(e.path));
        if (input) { input.focus(); input.scrollIntoView({ block: 'center' }); }
      });
      list.appendChild(el('li', {}, [a]));
    }
    box.hidden = false;
  } else {
    box.hidden = true;
  }

  const wbox = $('#warningSummary');
  const wlist = $('#warningList');
  clear(wlist);
  warnings.forEach((w) => wlist.appendChild(el('li', { text: w })));
  wbox.hidden = warnings.length === 0;

  // Mark step buttons that contain an error, and tick the ones already cleared.
  const bad = new Set(errors.map((e) => stepForPath(e.path)));
  $$('#stepList button').forEach((b) => {
    const step = b.dataset.step;
    const hasError = bad.has(step);
    const isDone = !hasError && step !== currentStep && visitedSteps.has(step);
    b.classList.toggle('has-error', hasError);
    b.classList.toggle('is-done', isDone);

    // The tick and the warning glyph are drawn in CSS, which keeps them out of
    // the accessible name. State is conveyed to assistive technology here
    // instead, as a real word rather than a symbol.
    let status = b.querySelector('.step-status');
    const text = hasError ? ' (needs attention)' : isDone ? ' (completed)' : '';
    if (!text) {
      if (status) status.remove();
    } else {
      if (!status) {
        status = el('span', { class: 'step-status visually-hidden' });
        b.appendChild(status);
      }
      status.textContent = text;
    }
  });

  return errors.length === 0;
}

/* ================================================================== *
 * Table helper
 * ================================================================== */

/**
 * Render rows into a table.
 * A row is { label, value, cls, kind } where kind is 'group' | 'total' | 'sub'.
 */
function renderTable(table, caption, rows, note, hideCaption) {
  clear(table);
  if (caption) {
    // The caption is the table's accessible name and is always present. Inside
    // a card whose heading already says the same thing, the title is hidden
    // visually so sighted users do not read the same words twice — but any
    // explanatory note stays on screen.
    const cap = el('caption', { class: hideCaption && !note ? 'caption-flush' : '' });
    cap.appendChild(el('span', { class: hideCaption ? 'visually-hidden' : '', text: caption }));
    if (note) cap.appendChild(el('span', { class: 'caption-note', text: note }));
    table.appendChild(cap);
  }
  const tbody = el('tbody');
  for (const r of rows) {
    if (!r) continue;
    const tr = el('tr', { class: r.kind || '' });
    if (r.kind === 'group') {
      tr.appendChild(el('th', { scope: 'colgroup', colspan: 2, text: r.label }));
    } else {
      tr.appendChild(el('th', { scope: 'row', text: r.label }));
      tr.appendChild(el('td', { class: r.cls || '', text: r.value }));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

/** Render a matrix table: columns are scenarios, rows are metrics. */
function renderMatrix(table, caption, columns, rows, note) {
  clear(table);
  const cap = el('caption', { text: caption });
  if (note) cap.appendChild(el('span', { class: 'caption-note', text: note }));
  table.appendChild(cap);

  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', { scope: 'col', text: '' }));
  columns.forEach((c) => hr.appendChild(el('th', { scope: 'col', text: c })));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr', { class: r.kind || '' });
    tr.appendChild(el('th', { scope: 'row', text: r.label }));
    r.values.forEach((v) => tr.appendChild(el('td', { class: v.cls || '', text: v.text })));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/* ================================================================== *
 * Formula blocks
 * ================================================================== */

/** Render a "how calculated" block from an array of plain-text lines. */
function renderFormula(node, lines) {
  clear(node);
  lines.filter(Boolean).forEach((line, i) => {
    if (i) node.appendChild(el('br'));
    node.appendChild(document.createTextNode(line));
  });
}

/* ================================================================== *
 * Charts
 * ================================================================== */

function renderCashFlowChart(host, flows) {
  clear(host);
  const W = 720, H = 240, PADL = 62, PADB = 34, PADT = 12, PADR = 8;
  const values = flows.map((f) => f.value);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = (max - min) || 1;
  const plotH = H - PADB - PADT;
  const plotW = W - PADL - PADR;
  const y0 = PADT + (max / span) * plotH;
  const bw = Math.max(4, plotW / flows.length * 0.62);
  const step = plotW / flows.length;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `Bar chart of after-tax cash flow by year, from ${compact(min)} to ${compact(max)}. The same figures are available as a table below.`);

  const mk = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };

  for (let i = 0; i <= 4; i++) {
    const v = max - (span * i) / 4;
    const y = PADT + (plotH * i) / 4;
    svg.appendChild(mk('line', { class: 'grid', x1: PADL, x2: W - PADR, y1: y, y2: y }));
    const t = mk('text', { x: PADL - 8, y: y + 4, 'text-anchor': 'end' });
    t.textContent = compact(v);
    svg.appendChild(t);
  }
  svg.appendChild(mk('line', { class: 'axis', x1: PADL, x2: W - PADR, y1: y0, y2: y0 }));

  flows.forEach((f, i) => {
    const x = PADL + step * i + (step - bw) / 2;
    const h = Math.abs(f.value) / span * plotH;
    const y = f.value >= 0 ? y0 - h : y0;
    svg.appendChild(mk('rect', {
      x, y, width: bw, height: Math.max(1, h), rx: 2,
      class: f.final ? 'bar-final' : f.value >= 0 ? 'bar-pos' : 'bar-neg',
    }));
    if (flows.length <= 16 || i % 2 === 0) {
      const t = mk('text', { x: x + bw / 2, y: H - PADB + 18, 'text-anchor': 'middle' });
      t.textContent = f.label;
      svg.appendChild(t);
    }
  });

  host.appendChild(svg);
}

/* ================================================================== *
 * Rendering — per step
 * ================================================================== */

function renderPropertyStep() {
  const preset = PRESETS[S.meta.preset] || PRESETS['us-nyc'];
  const line = $('#presetStatusLine');
  clear(line);
  const badgeClass = preset.status === 'checked' ? 'verified' : preset.status === 'blank' ? 'blank' : 'experimental';
  const badgeText = preset.status === 'checked' ? `Rates checked ${preset.verified}`
    : preset.status === 'blank' ? 'Blank template' : 'Experimental preset';
  line.appendChild(el('span', { class: `badge ${badgeClass}`, text: badgeText }));
  line.appendChild(document.createTextNode(' '));
  line.appendChild(document.createTextNode(
    `Tax year ${preset.taxYear}. Rates last checked ${preset.verified}.`));

  const p = results.purchase;
  const labels = preset.labels || {};
  renderTable($('#buyTaxTable'), 'Transaction taxes on this purchase', [
    { label: labels.stateTransfer || 'State transfer tax', value: money(p.stateTransfer) },
    { label: labels.cityTransfer || 'City transfer tax', value: money(p.cityTransfer) },
    { label: `Paid by`, value: p.buyerPaysTransfer ? 'You (the buyer)' : 'The seller', kind: 'sub' },
    { label: labels.mansion || 'Mansion tax', value: money(p.mansionTax) },
    { label: labels.mrt || 'Mortgage recording tax', value: money(p.mortgageRecordingTax) },
    { label: 'Rate applied to the loan', value: pct(p.mrtRate, 3), kind: 'sub' },
    { label: 'Transaction taxes you pay at closing', value: money(p.buyerTransfer + p.mansionTax + p.mortgageRecordingTax), kind: 'total' },
  ], S.purchase.propType === 'coop' ? 'Co-op shares are personal property, so mortgage recording tax and title insurance do not apply.' : null, true);

  const marginalNote = S.rates.marginalBrackets
    ? 'Brackets are marginal: each slice of price is taxed at its own rate.'
    : 'Brackets are whole-price: the rate of the highest bracket reached applies to the entire price. One dollar over a threshold re-rates everything.';
  renderFormula($('#buyTaxFormula'), [
    marginalNote,
    '',
    `price = ${money(p.price)}`,
    `${labels.stateTransfer || 'State transfer tax'} = ${money(p.stateTransfer)}`,
    `${labels.cityTransfer || 'City transfer tax'} = ${money(p.cityTransfer)}`,
    `${labels.mansion || 'Mansion tax'} = ${money(p.mansionTax)}   (buyer always pays)`,
    `loan = price × (1 − ${pct(num(S.purchase.downPct))} down) = ${money(p.loan)}`,
    `${labels.mrt || 'Mortgage recording tax'} = loan × ${pct(p.mrtRate, 3)} = ${money(p.mortgageRecordingTax)}`,
  ]);
}

function renderFinancingStep() {
  const p = results.purchase, h = results.hold;
  const ioActive = h.ioMonths > 0;
  renderTable($('#financeTable'), 'Loan summary', [
    { label: 'Amount borrowed', value: money(p.loan) },
    { label: 'Loan to value', value: pct(p.ltv, 1), kind: 'sub' },
    { label: 'Down payment', value: money(p.downPayment) },
    { kind: 'group', label: 'Monthly payment' },
    ioActive ? { label: `Interest-only payment (first ${h.ioMonths} months)`, value: money(h.monthlyPaymentIO, 2) } : null,
    { label: ioActive ? 'Payment after the interest-only period' : 'Principal and interest', value: money(h.monthlyPaymentAmort, 2) },
    { kind: 'group', label: 'Loan costs' },
    { label: 'Origination points', value: money(p.points) },
    { label: 'Mortgage recording tax', value: money(p.mortgageRecordingTax) },
    { label: 'Total loan costs', value: money(p.financingCosts), kind: 'total' },
    { label: 'Deducted each year over the loan term', value: money(h.annualFinancingDeduction), kind: 'sub' },
    { kind: 'group', label: 'At the end of the hold' },
    { label: `Balance owing after ${h.years} years`, value: money(h.loanBalanceAtSale) },
    { label: 'Interest paid over the hold', value: money(h.table.reduce((s, y) => s + y.interest, 0)) },
  ], null, true);

  const r = num(S.purchase.loanRate) / 100 / 12;
  renderFormula($('#financeFormula'), [
    `loan = ${money(p.price)} × (1 − ${pct(num(S.purchase.downPct))}) = ${money(p.loan)}`,
    '',
    num(S.purchase.loanRate) === 0
      ? `Zero-interest loan: payment = loan ÷ amortising months = ${money(p.loan)} ÷ ${(num(S.purchase.loanTermYrs) - num(S.purchase.ioYears)) * 12} = ${money(h.monthlyPaymentAmort, 2)}`
      : `monthly rate r = ${pct(num(S.purchase.loanRate))} ÷ 12 = ${(r * 100).toFixed(5)}%`,
    num(S.purchase.loanRate) === 0 ? '' : `payment = loan × r ÷ (1 − (1 + r)^−n),  n = ${(num(S.purchase.loanTermYrs) - num(S.purchase.ioYears)) * 12} amortising months`,
    num(S.purchase.loanRate) === 0 ? '' : `        = ${money(h.monthlyPaymentAmort, 2)}`,
    ioActive ? '' : null,
    ioActive ? `During the first ${h.ioMonths} months you pay interest only (${money(h.monthlyPaymentIO, 2)}) and the balance does not fall. The payment then steps up because the original balance is repaid over the remaining ${(num(S.purchase.loanTermYrs) - num(S.purchase.ioYears)) * 12} months.` : null,
    '',
    `Loan costs of ${money(p.financingCosts)} are not added to basis. They are amortised over ${S.purchase.loanTermYrs} years at ${money(h.annualFinancingDeduction)} a year, and whatever is still unamortised (${money(h.unamortisedFinancingAtSale)}) is deducted in the year of sale.`,
  ]);
}

function renderOperationsStep() {
  const y1 = results.hold.year1;
  renderTable($('#opsTable'), 'Year one operating statement', [
    { label: 'Gross scheduled rent', value: money(y1.grossRent) },
    { label: 'Less vacancy and credit loss', value: money(-y1.vacancy), cls: 'neg' },
    { label: 'Effective gross income', value: money(y1.egi), kind: 'total' },
    { kind: 'group', label: 'Operating expenses' },
    { label: 'Property tax', value: money(y1.propTax) },
    { label: 'Insurance', value: money(y1.insurance) },
    { label: 'HOA or common charges', value: money(y1.hoa) },
    { label: 'Utilities', value: money(y1.utilities) },
    { label: 'Repairs and maintenance', value: money(y1.maint) },
    { label: 'Management', value: money(y1.mgmt) },
    { label: 'Other', value: money(y1.otherOpex) },
    { label: 'Total operating expenses', value: money(y1.opex), kind: 'total' },
    { kind: 'group', label: 'Result' },
    { label: 'Net operating income', value: money(y1.noi), kind: 'total', cls: signClass(y1.noi) },
    { label: 'Less debt service', value: money(-y1.debtService), cls: 'neg' },
    { label: 'Less capital improvements this year', value: money(-y1.capexCash), cls: y1.capexCash ? 'neg' : '' },
    { label: 'Cash flow before tax', value: money(y1.preTaxCF), kind: 'total', cls: signClass(y1.preTaxCF) },
    { label: 'Debt service coverage ratio', value: y1.dscr === null ? 'no debt' : y1.dscr.toFixed(2) + '×', kind: 'sub' },
  ], null, true);

  renderFormula($('#opsFormula'), [
    `Gross rent      = ${money(num(S.hold.rentMo))} × 12 + ${money(num(S.hold.otherIncomeYr))} other = ${money(y1.grossRent)}`,
    `Vacancy         = gross rent × ${pct(num(S.hold.vacancyPct))} = ${money(y1.vacancy)}`,
    `Effective gross = ${money(y1.egi)}`,
    `Maintenance     = gross rent × ${pct(num(S.hold.maintPct))} = ${money(y1.maint)}`,
    `Management      = effective gross × ${pct(num(S.hold.mgmtPct))} = ${money(y1.mgmt)}`,
    `NOI             = effective gross − operating expenses = ${money(y1.egi)} − ${money(y1.opex)} = ${money(y1.noi)}`,
    '',
    `Rent grows ${pct(num(S.hold.rentGrowthPct))} a year and expenses ${pct(num(S.hold.opexGrowthPct))} a year from year 2 onward.`,
    `NOI excludes the mortgage, depreciation and capital improvements by definition — it measures the property, not the financing.`,
  ]);
}

// Rebuilding an input while someone is typing into it destroys the element and
// takes the caret with it, so only the first character of a number ever lands.
// These two containers are therefore built once per preset and afterwards only
// have their values synced — never re-created on a keystroke.
let rateFieldsBuiltFor = null;
let bracketEditorsBuiltFor = null;

function renderProfileStep() {
  const preset = PRESETS[S.meta.preset] || PRESETS['us-nyc'];
  const labels = preset.labels || {};

  // --- editable rate fields ---
  const host = $('#rateFields');
  if (rateFieldsBuiltFor === S.meta.preset) {
    syncDynamic(host);
    renderBracketEditors(labels);
    renderSources(preset);
    return;
  }
  rateFieldsBuiltFor = S.meta.preset;
  bracketEditorsBuiltFor = null;
  clear(host);
  const rateFields = [
    ['rates.fedLTCG', labels.fedLTCG || 'Capital gains rate'],
    ['rates.recapture', labels.recapture || 'Depreciation recapture rate'],
    ['rates.niit', labels.niit || 'Net investment income tax'],
    ['rates.fedOrdinary', labels.fedOrdinary || 'Federal ordinary rate'],
    ['rates.stateOrdinary', labels.stateOrdinary || 'State ordinary rate'],
    ['rates.cityOrdinary', labels.cityOrdinary || 'City ordinary rate'],
    ['rates.stateCapGains', labels.stateCapGains || 'State rate on the gain'],
    ['rates.cityCapGains', labels.cityCapGains || 'City rate on the gain'],
    ['rates.depLifeResidential', 'Residential recovery period (years)'],
    ['rates.depLifeCommercial', 'Commercial recovery period (years)'],
  ];
  const grid = el('div', { class: 'card-grid' });
  for (const [path, label] of rateFields) {
    const id = 'r-' + path.replace(/\W/g, '-');
    const input = el('input', {
      type: 'number', id, step: '0.001', inputmode: 'decimal',
      'data-bind': path, value: getPath(S, path),
    });
    grid.appendChild(el('div', { class: 'field' }, [
      el('label', { for: id, text: label }),
      el('div', { class: 'control' }, [input, el('span', { class: 'affix suffix', text: path.includes('depLife') ? 'yr' : '%' })]),
    ]));
  }
  host.appendChild(grid);
  host.appendChild(el('div', { class: 'field' }, [
    el('div', { class: 'switch-row' }, [
      el('span', { class: 'switch-text' }, [
        el('label', { for: 'r-niitEnabled', text: 'Apply the net investment income surtax' }),
      ]),
      el('input', { type: 'checkbox', class: 'switch', id: 'r-niitEnabled', 'data-bind': 'rates.niitEnabled' }),
    ]),
  ]));
  host.appendChild(el('div', { class: 'field' }, [
    el('div', { class: 'switch-row' }, [
      el('span', { class: 'switch-text' }, [
        el('label', { for: 'r-marginal', text: 'Transaction-tax brackets are marginal' }),
        el('span', { class: 'help', text: 'Off means the whole price is taxed at one bracket rate, the way the New York mansion tax and the NYC transfer tax work. On means slice by slice, the way UK stamp duty works.' }),
      ]),
      el('input', { type: 'checkbox', class: 'switch', id: 'r-marginal', 'data-bind': 'rates.marginalBrackets' }),
    ]),
  ]));

  renderBracketEditors(labels);
  bindDynamic(host);
  bindDynamic($('#bracketEditors'));
  renderSources(preset);
}

/** Value-only refresh for controls that were built once. */
function syncDynamic(root) {
  $$('[data-bind]', root).forEach((input) => {
    if (document.activeElement === input) return;
    const v = getPath(S, input.dataset.bind);
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v === null || v === undefined ? '' : v;
  });
}

function renderSources(preset) {
  const sb = $('#sourcesBlock');
  clear(sb);
  const badgeClass = preset.status === 'checked' ? 'verified' : preset.status === 'blank' ? 'blank' : 'experimental';
  sb.appendChild(el('p', {}, [
    el('span', {
      class: `badge ${badgeClass}`,
      text: preset.status === 'checked' ? 'Rates checked' : preset.status === 'blank' ? 'Blank template' : 'Experimental',
    }),
    ` ${preset.label} · tax year ${preset.taxYear} · rates checked ${preset.verified}`,
  ]));
  if (preset.notes) sb.appendChild(el('p', { class: 'help', text: preset.notes }));

  if (preset.verification) {
    const v = preset.verification;
    const box = el('div', { class: 'callout info' });
    box.appendChild(el('h4', { text: 'What "checked" means here' }));
    box.appendChild(el('p', {
      text: 'Every rate below was compared against the published sources on '
        + preset.verified + '. That is a documentary check, not professional review.',
    }));
    const ul = el('ul');
    const label = { primary: 'read from the government source itself', secondary: 'from corroborating secondary sources', provisional: 'provisional', none: 'none' };
    ul.appendChild(el('li', { text: `Transfer, mansion, RPTT and mortgage recording taxes — ${label[v.transferAndTransactionTaxes] || v.transferAndTransactionTaxes}` }));
    ul.appendChild(el('li', { text: `Federal rates, thresholds and §469 rules — ${label[v.federalIncomeAndGains] || v.federalIncomeAndGains}` }));
    ul.appendChild(el('li', { text: `New York State and City bracket thresholds — ${label[v.newYorkIncomeBrackets] || v.newYorkIncomeBrackets}` }));
    ul.appendChild(el('li', { text: 'Review by a CPA, attorney or enrolled agent — none' }));
    box.appendChild(ul);
    sb.appendChild(box);
  }

  if ((preset.sources || []).length) {
    sb.appendChild(el('h4', { text: 'Official sources' }));
    const ul = el('ul');
    preset.sources.forEach((s) => {
      ul.appendChild(el('li', {}, [
        el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer external', text: s.label }),
      ]));
    });
    sb.appendChild(ul);
  }
  if ((preset.omissions || []).length) {
    const box = el('div', { class: 'callout warn mt-md' });
    box.appendChild(el('h4', { text: 'Known omissions' }));
    const ul = el('ul');
    preset.omissions.forEach((o) => ul.appendChild(el('li', { text: o })));
    box.appendChild(ul);
    sb.appendChild(box);
  }
}

function renderBracketEditors(labels) {
  const host = $('#bracketEditors');
  // Signature = preset plus the number of bands in each table. Editing a rate
  // does not change it, so the inputs survive typing; adding or removing a band
  // does, so the editor rebuilds exactly when it must.
  const signature = S.meta.preset + '|' + ['stateTransferRes', 'stateTransferComm',
    'cityTransferRes', 'cityTransferComm', 'mansion', 'mrtResidential',
    'cgtByYears', 'sellerDutyByYears']
    .map((k) => (S.rates[k] || []).length).join(',');
  if (bracketEditorsBuiltFor === signature) {
    syncDynamic(host);
    return;
  }
  bracketEditorsBuiltFor = signature;
  clear(host);
  const tables = [
    ['stateTransferRes', (labels.stateTransfer || 'State transfer tax') + ' — residential', 'price'],
    ['stateTransferComm', (labels.stateTransfer || 'State transfer tax') + ' — commercial', 'price'],
    ['cityTransferRes', (labels.cityTransfer || 'City transfer tax') + ' — residential', 'price'],
    ['cityTransferComm', (labels.cityTransfer || 'City transfer tax') + ' — commercial', 'price'],
    ['mansion', labels.mansion || 'Mansion tax', 'price'],
    ['mrtResidential', (labels.mrt || 'Mortgage recording tax') + ' — residential', 'loan'],
    ['cgtByYears', 'Capital gains rate by years held', 'years'],
    ['sellerDutyByYears', 'Seller duty by years held', 'years'],
  ];
  for (const [key, label, unit] of tables) {
    const rows = S.rates[key] || [];
    const det = el('details', { class: 'advanced' });
    det.appendChild(el('summary', { text: `${label} (${rows.length} band${rows.length === 1 ? '' : 's'})` }));
    const body = el('div', { class: 'details-body' });
    const table = el('table');
    table.appendChild(el('caption', { class: 'visually-hidden', text: label }));
    const thead = el('thead');
    thead.appendChild(el('tr', {}, [
      el('th', { scope: 'col', text: unit === 'years' ? 'From year' : `From ${unit}` }),
      el('th', { scope: 'col', text: 'Rate %' }),
      el('th', { scope: 'col', text: '' }),
    ]));
    table.appendChild(thead);
    const tbody = el('tbody');
    rows.forEach((band, i) => {
      const minInput = el('input', { type: 'number', step: '1000', value: band.min, 'aria-label': `${label} band ${i + 1} threshold` });
      const rateInput = el('input', { type: 'number', step: '0.001', value: band.rate, 'aria-label': `${label} band ${i + 1} rate` });
      minInput.addEventListener('input', () => { S.rates[key][i].min = parseFloat(minInput.value) || 0; onChange(); });
      rateInput.addEventListener('input', () => { S.rates[key][i].rate = parseFloat(rateInput.value) || 0; onChange(); });
      const del = el('button', { type: 'button', class: 'btn btn-sm', text: 'Remove' });
      del.addEventListener('click', () => {
        S.rates[key].splice(i, 1);
        bracketEditorsBuiltFor = null;
        onChange();
        renderBracketEditors(labels);
      });
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [minInput]), el('td', {}, [rateInput]), el('td', {}, [del]),
      ]));
    });
    table.appendChild(tbody);
    body.appendChild(el('div', { class: 'table-scroll', tabindex: '0' }, [table]));
    const add = el('button', { type: 'button', class: 'btn btn-sm', text: 'Add band' });
    add.addEventListener('click', () => {
      S.rates[key] = (S.rates[key] || []).concat([{ min: 0, rate: 0 }]).sort((a, b) => a.min - b.min);
      bracketEditorsBuiltFor = null;
      onChange();
      renderBracketEditors(labels);
    });
    body.appendChild(add);
    det.appendChild(body);
    host.appendChild(det);
  }
}

/** Attach binding to inputs created after initial bindInputs(). */
function bindDynamic(root) {
  $$('[data-bind]', root).forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = '1';
    const path = input.dataset.bind;
    const ev = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(ev, () => {
      if (input.type === 'checkbox') setPath(S, path, input.checked);
      else if (input.type === 'number') setPath(S, path, input.value === '' ? '' : parseFloat(input.value));
      else setPath(S, path, input.value);
      onChange();
    });
    const v = getPath(S, path);
    if (input.type === 'checkbox') input.checked = !!v; else input.value = v;
  });
}

function renderSaleStep() {
  const s = results.sale;
  $('#overridePriceField').hidden = !S.sale.useOverride;
  $('#flipTaxField').hidden = S.purchase.propType !== 'coop';
  $('#projectedPriceNote').textContent = S.sale.useOverride
    ? `For reference, ${pct(num(S.hold.apprPct))} a year for ${results.hold.years} years would give ${money(s.projectedPrice)}.`
    : `Projected sale price after ${results.hold.years} years at ${pct(num(S.hold.apprPct))} a year: ${money(s.projectedPrice)}.`;
}

/* ---------- results ---------- */

function renderResultsStep() {
  const { purchase: p, hold: h, sale: s, returns: rt } = results;
  const preset = PRESETS[S.meta.preset] || PRESETS['us-nyc'];

  $('#resultsIntro').textContent =
    `${preset.label} · ${propTypeLabel()} · ${money(p.price)} purchase · ${h.years}-year hold · sale at ${money(s.salePrice)}.`;

  // ---- headline band: the four figures that decide whether to go further ----
  const headline = [
    { k: 'Cash to close', v: money(p.cashAtClosing), sub: `${pct(100 - p.ltv, 0)} down plus closing costs` },
    { k: 'After-tax cash flow', v: money(h.year1.afterTaxCF), sub: 'Year 1, after income tax', cls: signClass(h.year1.afterTaxCF) },
    { k: 'Total profit', v: money(rt.totalProfit), sub: `Over ${h.years} years, after all tax`, cls: signClass(rt.totalProfit) },
    { k: 'After-tax IRR', v: rt.irr === null ? 'n/a' : pct(rt.irr * 100), sub: rt.preTaxIrr === null ? 'Annualised return' : `Pre-tax ${pct(rt.preTaxIrr * 100)}`, cls: rt.irr === null ? '' : signClass(rt.irr) },
  ];
  const hero = $('#kpiHero');
  clear(hero);
  headline.forEach((k) => {
    hero.appendChild(el('div', { class: 'kpi-cell' }, [
      el('span', { class: 'k', text: k.k }),
      el('strong', { class: `v ${k.cls || ''}`, text: k.v }),
      el('span', { class: 'sub', text: k.sub }),
    ]));
  });

  // ---- supporting figures ----
  const kpis = [
    { k: 'Net operating income (year 1)', v: money(h.year1.noi), sub: 'Before mortgage and tax' },
    { k: 'Cap rate', v: pct(rt.capRate), sub: 'Year 1 NOI ÷ purchase price' },
    { k: 'Cash-on-cash return', v: pct(rt.cashOnCash), sub: 'Year 1 pre-tax cash flow ÷ cash invested', cls: signClass(rt.cashOnCash) },
    { k: 'Sale price', v: money(s.salePrice), sub: s.usedOverride ? 'You entered this figure' : `Projected at ${pct(num(S.hold.apprPct))} a year` },
    { k: 'Tax on the sale', v: money(s.totalSaleTax), sub: `Effective ${pct(s.effectiveGainRate)} of the gain` },
    { k: 'Net sale proceeds', v: money(s.netProceeds), sub: 'After loan payoff, costs and tax', cls: signClass(s.netProceeds) },
    { k: 'Return on investment', v: pct(rt.roi, 1), sub: `${pct(rt.annualisedRoi, 1)} a year compounded`, cls: signClass(rt.roi) },
    { k: 'Equity multiple', v: rt.equityMultiple.toFixed(2) + '×', sub: 'Total cash returned ÷ cash invested' },
  ];
  const grid = $('#kpiGrid');
  clear(grid);
  kpis.forEach((k) => {
    grid.appendChild(el('div', { class: 'kpi' }, [
      el('span', { class: 'k', text: k.k }),
      el('strong', { class: `v ${k.cls || ''}`, text: k.v }),
      el('span', { class: 'sub', text: k.sub }),
    ]));
  });

  // ---- cash required ----
  const labels = preset.labels || {};
  renderTable($('#cashTable'), 'Cash required to close', [
    { label: 'Down payment', value: money(p.downPayment) },
    { kind: 'group', label: 'Costs added to your cost basis' },
    { label: 'Title insurance', value: money(p.titleIns) },
    { label: 'Legal fees', value: money(p.buyLegal) },
    { label: 'Inspection and appraisal', value: money(p.buyInspection) },
    { label: 'Other buyer costs', value: money(p.buyOther) },
    { label: labels.mansion || 'Mansion tax', value: money(p.mansionTax) },
    { label: 'Transfer tax paid by you', value: money(p.buyerTransfer) },
    { label: 'Subtotal added to basis', value: money(p.basisCosts), kind: 'total' },
    { kind: 'group', label: 'Loan costs (not added to basis)' },
    { label: 'Origination points', value: money(p.points) },
    { label: labels.mrt || 'Mortgage recording tax', value: money(p.mortgageRecordingTax) },
    { label: 'Subtotal loan costs', value: money(p.financingCosts), kind: 'total' },
    { kind: 'group', label: '' },
    { label: 'Total cash required to close', value: money(p.cashAtClosing), kind: 'total' },
  ], null, true);
  renderFormula($('#cashFormula'), [
    `down payment  = ${money(p.price)} × ${pct(num(S.purchase.downPct))} = ${money(p.downPayment)}`,
    `basis costs   = ${money(p.basisCosts)}`,
    `loan costs    = ${money(p.financingCosts)}`,
    `cash to close = ${money(p.downPayment)} + ${money(p.basisCosts)} + ${money(p.financingCosts)} = ${money(p.cashAtClosing)}`,
    '',
    `cost basis    = price + basis costs = ${money(p.price)} + ${money(p.basisCosts)} = ${money(p.costBasis)}`,
    `land          = cost basis × ${pct(num(S.purchase.landPct))} = ${money(p.landValue)}   (never depreciable)`,
    `depreciable   = ${money(p.costBasis)} − ${money(p.landValue)} = ${money(p.depreciableBasis)}`,
  ]);

  // ---- operating ----
  const totalNoi = h.table.reduce((a, y) => a + y.noi, 0);
  const totalTax = h.table.reduce((a, y) => a + y.tax, 0);
  renderTable($('#noiTable'), `Operating results over ${h.years} years`, [
    { label: 'Net operating income, year 1', value: money(h.year1.noi) },
    { label: 'Net operating income, final year', value: money(h.table[h.years - 1].noi) },
    { label: 'Cumulative net operating income', value: money(totalNoi), kind: 'total' },
    { kind: 'group', label: 'Cash flow' },
    { label: 'Cumulative pre-tax cash flow', value: money(h.cumPreTaxCF), cls: signClass(h.cumPreTaxCF) },
    { label: 'Cumulative income tax on the rental', value: money(totalTax), cls: totalTax < 0 ? 'pos' : '' },
    { label: 'Cumulative after-tax cash flow', value: money(h.cumAfterTaxCF), kind: 'total', cls: signClass(h.cumAfterTaxCF) },
    { kind: 'group', label: 'Ratios' },
    { label: 'Cap rate on purchase price', value: pct(rt.capRate) },
    { label: 'Cap rate on total cost', value: pct(rt.capRateOnCost) },
    { label: 'Cash-on-cash, year 1 (pre-tax)', value: pct(rt.cashOnCash), cls: signClass(rt.cashOnCash) },
    { label: 'Cash-on-cash, year 1 (after tax)', value: pct(rt.afterTaxCashOnCash), cls: signClass(rt.afterTaxCashOnCash) },
    { label: 'Gross rent multiplier', value: rt.grm === null ? '—' : rt.grm.toFixed(1) + '×' },
  ]);
  renderFormula($('#noiFormula'), [
    `cap rate        = year 1 NOI ÷ purchase price = ${money(h.year1.noi)} ÷ ${money(p.price)} = ${pct(rt.capRate)}`,
    `cap rate on cost= year 1 NOI ÷ cost basis     = ${money(h.year1.noi)} ÷ ${money(p.costBasis)} = ${pct(rt.capRateOnCost)}`,
    `cash-on-cash    = year 1 pre-tax cash flow ÷ cash invested = ${money(h.year1.preTaxCF)} ÷ ${money(p.cashAtClosing)} = ${pct(rt.cashOnCash)}`,
    '',
    h.useBrackets
      ? `Income tax on the rental is the tax this property ADDS to your bill: your other income of ${money(num(S.profile.otherMAGI))} is the base, and the rental result stacks on top of it through the federal, New York State and New York City schedules. That works out to ${pct(h.ordinaryRate)} on the next dollar — not the ${pct(h.flatOrdinaryRate)} top-of-scale figure.`
      : `Flat-rate mode: a combined ordinary rate of ${pct(h.flatOrdinaryRate)} = federal ${pct(num(S.rates.fedOrdinary))} + state ${pct(num(S.rates.stateOrdinary))} + city ${pct(h.cityOrdinaryRate)}.`,
    S.profile.nycResident ? '' : '  (no city tax: you are not a New York City resident)',
    h.allowanceCap > 0
      ? `§469(i) special allowance available this year: ${money(h.allowanceCap)}. Rental losses up to that amount are deductible now rather than suspended.`
      : '',
  ]);

  // ---- chart ----
  const flows = h.table.map((y) => ({
    label: 'Y' + y.year,
    value: y.afterTaxCF + (y.year === h.years ? s.netProceeds : 0),
    final: y.year === h.years,
  }));
  renderCashFlowChart($('#cfChart'), flows);
  $('#cfChartCaption').textContent =
    `After-tax cash flow by year. The final year includes ${money(s.netProceeds)} of net sale proceeds.`;
  renderTable($('#cfDataTable'), 'After-tax cash flow by year',
    [{ label: 'Year 0 (cash invested)', value: money(-p.cashAtClosing), cls: 'neg' }].concat(
      flows.map((f, i) => ({
        label: `Year ${i + 1}` + (f.final ? ' (includes sale)' : ''),
        value: money(f.value), cls: signClass(f.value),
      }))), null, true);

  // ---- depreciation & passive losses ----
  renderTable($('#depTable'), 'Depreciation and suspended losses', [
    { kind: 'group', label: 'Depreciation' },
    { label: 'Depreciable basis at purchase', value: money(p.depreciableBasis) },
    { label: 'Recovery period', value: `${h.depLife} years` },
    { label: 'Full-year deduction', value: money(h.annualDep) },
    { label: `Year 1 deduction (mid-month, placed in service month ${S.profile.serviceMonth})`, value: money(h.year1.dep), kind: 'sub' },
    { label: 'Capital improvements depreciated separately', value: money(h.capexTotal) },
    { label: 'Full-year deduction on improvements', value: money(h.annualCapexDep), kind: 'sub' },
    { label: 'Total depreciation taken over the hold', value: money(h.accumDep), kind: 'total' },
    { kind: 'group', label: 'Loan cost amortisation' },
    { label: 'Deducted each year', value: money(h.annualFinancingDeduction) },
    { label: 'Remaining balance deducted at sale', value: money(h.unamortisedFinancingAtSale) },
    { kind: 'group', label: 'Passive losses' },
    { label: S.hold.passiveAllowed ? 'Losses deducted as they arise' : 'Losses suspended under §469' , value: S.hold.passiveAllowed ? 'Yes' : 'Yes' },
    { label: '§469(i) allowance available each year', value: money(h.allowanceCap) },
    { label: 'Losses deducted now under that allowance', value: money(h.allowanceUsedTotal), cls: h.allowanceUsedTotal ? 'pos' : '' },
    { label: 'Suspended losses carried to the sale', value: money(h.suspendedAtSale) },
    { label: 'Released on a fully taxable disposition', value: money(s.releasedLosses) },
    { label: 'Tax benefit at your ordinary rate', value: money(s.releasedLossTaxBenefit), cls: 'pos', kind: 'total' },
  ], 'Suspended losses are released against ordinary income. They are never netted against the capital gain or the depreciation recapture before those are taxed.', true);

  renderFormula($('#depFormula'), [
    `depreciable basis = cost basis − land = ${money(p.costBasis)} − ${money(p.landValue)} = ${money(p.depreciableBasis)}`,
    `annual deduction  = ${money(p.depreciableBasis)} ÷ ${h.depLife} = ${money(h.annualDep)}`,
    `year 1 fraction   = (12 − ${S.profile.serviceMonth} + 0.5) ÷ 12 = ${h.placedFraction.toFixed(4)}   (IRS mid-month convention)`,
    `year 1 deduction  = ${money(h.annualDep)} × ${h.placedFraction.toFixed(4)} = ${money(h.annualDep * h.placedFraction)}`,
    `sale year fraction= (${S.sale.saleMonth} − 0.5) ÷ 12 = ${h.saleFraction.toFixed(4)}`,
    '',
    h.capexTotal > 0
      ? `improvements      = ${money(h.capexTotal)} ÷ ${h.depLife} = ${money(h.annualCapexDep)} a year, beginning in year ${h.capexYear}. Improvements carry no land component, so the whole amount is depreciable.`
      : 'No capital improvements entered.',
    '',
    S.hold.passiveAllowed
      ? 'Rental losses are being deducted in the year they arise, so nothing accumulates for release at sale.'
      : `Rental losses are passive under §469, so they are suspended and carried forward. ${money(h.suspendedAtSale)} remains at the sale and is released in full, worth ${money(s.releasedLossTaxBenefit)} at ${pct(h.ordinaryRate)}.`,
  ]);

  // ---- sale ----
  renderTable($('#saleTable'), 'Sale proceeds and gain', [
    { label: 'Sale price', value: money(s.salePrice) },
    { kind: 'group', label: 'Selling costs' },
    { label: 'Broker commission', value: money(-s.broker), cls: 'neg' },
    { label: labels.stateTransfer || 'State transfer tax', value: money(-s.sellStateTransfer), cls: s.sellStateTransfer ? 'neg' : '' },
    { label: labels.cityTransfer || 'City transfer tax', value: money(-s.sellCityTransfer), cls: s.sellCityTransfer ? 'neg' : '' },
    S.purchase.propType === 'coop' ? { label: 'Co-op flip tax', value: money(-s.flipTax), cls: s.flipTax ? 'neg' : '' } : null,
    { label: 'Legal and closing', value: money(-s.sellLegal), cls: 'neg' },
    { label: 'Other selling costs', value: money(-s.sellOther), cls: s.sellOther ? 'neg' : '' },
    { label: 'Total selling costs', value: money(-s.sellingCosts), kind: 'total', cls: 'neg' },
    { label: 'Amount realised', value: money(s.amountRealized), kind: 'total' },
    { kind: 'group', label: 'Adjusted basis' },
    { label: 'Original cost basis', value: money(s.costBasis) },
    { label: 'Plus capital improvements', value: money(s.capexTotal) },
    { label: 'Less depreciation taken', value: money(-s.accumDep), cls: 'neg' },
    { label: 'Adjusted basis', value: money(s.adjustedBasis), kind: 'total' },
    { kind: 'group', label: 'Gain' },
    { label: 'Total gain', value: money(s.totalGain), kind: 'total', cls: signClass(s.totalGain) },
    { label: 'Of which unrecaptured §1250 gain (depreciation)', value: money(s.unrecaptured), kind: 'sub' },
    { label: 'Of which long-term capital gain', value: money(s.capitalGain), kind: 'sub' },
    { kind: 'group', label: 'Proceeds' },
    { label: 'Loan payoff', value: money(-s.loanPayoff), cls: 'neg' },
    { label: 'Gross proceeds before tax', value: money(s.grossProceeds), kind: 'total' },
    { label: 'Less tax on the sale', value: money(-s.totalSaleTax), cls: 'neg' },
    { label: 'Plus benefit of released passive losses', value: money(s.releasedLossTaxBenefit), cls: 'pos' },
    s.lossTaxBenefit > 0 ? { label: 'Plus benefit of the §1231 loss on sale', value: money(s.lossTaxBenefit), cls: 'pos' } : null,
    { label: 'Net proceeds to you', value: money(s.netProceeds), kind: 'total', cls: signClass(s.netProceeds) },
  ], null, true);
  renderFormula($('#saleFormula'), [
    s.usedOverride
      ? `sale price      = ${money(s.salePrice)} (you entered this)`
      : `sale price      = ${money(p.price)} × (1 + ${pct(num(S.hold.apprPct))})^${h.years} = ${money(s.salePrice)}`,
    `amount realised = sale price − selling costs = ${money(s.salePrice)} − ${money(s.sellingCosts)} = ${money(s.amountRealized)}`,
    `adjusted basis  = ${money(s.costBasis)} + ${money(s.capexTotal)} improvements − ${money(s.accumDep)} depreciation = ${money(s.adjustedBasis)}`,
    `total gain      = ${money(s.amountRealized)} − ${money(s.adjustedBasis)} = ${money(s.totalGain)}`,
    '',
    `Depreciation comes out of the gain first, capped at the amount actually taken:`,
    `  unrecaptured §1250 = min(${money(s.accumDep)}, ${money(Math.max(0, s.totalGain))}) = ${money(s.unrecaptured)}`,
    `  capital gain       = ${money(Math.max(0, s.totalGain))} − ${money(s.unrecaptured)} = ${money(s.capitalGain)}`,
    '',
    `gross proceeds  = amount realised − loan payoff = ${money(s.amountRealized)} − ${money(s.loanPayoff)} = ${money(s.grossProceeds)}`,
    `net proceeds    = ${money(s.grossProceeds)} − ${money(s.totalSaleTax)} tax + ${money(s.releasedLossTaxBenefit)} released losses = ${money(s.netProceeds)}`,
  ]);

  // ---- sale tax ----
  renderTable($('#saleTaxTable'), 'Tax on the sale, by component', [
    { label: `Depreciation recapture (§1250) — ${money(s.unrecaptured)} at ${pct(s.effectiveRecaptureRate)}`, value: money(s.fedRecaptureTax) },
    { label: `Federal capital gains — ${money(s.capitalGain)} at ${pct(s.effectiveCapGainsRate)}`, value: money(s.fedCapGainsTax) },
    { label: `Net investment income tax — ${money(s.niitBase)} at ${pct(num(S.rates.niit))}`, value: money(s.niitTax) },
    { label: `New York State — ${money(s.taxableGain)} at ${pct(s.effectiveStateRate)}`, value: money(s.stateGainTax) },
    { label: `New York City — ${money(s.taxableGain)} at ${pct(s.effectiveCityRate)}`, value: money(s.cityGainTax) },
    { label: 'Total tax on the sale', value: money(s.totalSaleTax), kind: 'total' },
    { label: 'Effective rate on the gain', value: pct(s.effectiveGainRate), kind: 'sub' },
    { kind: 'group', label: 'Separately, at your ordinary rate' },
    { label: `Released passive losses — ${money(s.releasedLosses)} at ${pct(h.ordinaryRate)}`, value: money(-s.releasedLossTaxBenefit), cls: 'pos' },
  ], 'Transaction taxes on the sale (transfer tax, flip tax) sit in selling costs above, not here — they reduce the gain rather than being levied on it.', true);

  renderFormula($('#saleTaxFormula'), [
    `NIIT threshold for ${filingLabel()} = ${money(s.niitThreshold)}`,
    `MAGI before this property = ${money(num(S.profile.otherMAGI))}`,
    `NIIT base = min(gain, MAGI + gain − threshold)`,
    `          = min(${money(s.taxableGain)}, ${money(num(S.profile.otherMAGI))} + ${money(s.taxableGain)} − ${money(s.niitThreshold)})`,
    `          = ${money(s.niitBase)}`,
    `NIIT      = ${money(s.niitBase)} × ${pct(num(S.rates.niit))} = ${money(s.niitTax)}`,
    '',
    S.profile.nycResident
      ? `New York City tax applies at ${pct(s.cityGainRate)} because you are a city resident.`
      : 'New York City tax is zero because you are not a city resident. New York State tax still applies to New York-source gain.',
    '',
    `Each tax has its own base. Recapture applies to ${money(s.unrecaptured)} only; the long-term rate applies only to the ${money(s.capitalGain)} above it. New York has no preferential capital gains rate, so the whole gain runs through its ordinary schedule.`,
    '',
    h.useBrackets
      ? `Rates are worked out from your income, not from a single top rate. Your other income of ${money(num(S.profile.otherMAGI))} is the starting point; this property's income and gain stack on top of it and run through the ${results.meta.taxYear || 2026} schedules. Unrecaptured §1250 gain is taxed at ordinary rates capped at 25% — the cap is a ceiling, not a flat rate, so ${pct(s.effectiveRecaptureRate)} is what actually applies here.`
      : `Flat-rate mode: one marginal rate is applied to everything, using the rates you entered. This overstates the tax for anyone below the top bracket.`,
  ]);

  // ---- returns ----
  renderTable($('#returnsTable'), 'Final returns', [
    { label: 'Cash invested at closing', value: money(rt.cashInvested) },
    { label: 'Cumulative after-tax cash flow', value: money(h.cumAfterTaxCF), cls: signClass(h.cumAfterTaxCF) },
    { label: 'Net sale proceeds', value: money(s.netProceeds) },
    { label: 'Total profit', value: money(rt.totalProfit), kind: 'total', cls: signClass(rt.totalProfit) },
    { kind: 'group', label: 'Returns' },
    { label: 'Return on investment', value: pct(rt.roi, 1), cls: signClass(rt.roi) },
    { label: 'Annualised (compound) return', value: pct(rt.annualisedRoi, 1) },
    { label: 'After-tax IRR', value: rt.irr === null ? 'not defined' : pct(rt.irr * 100), cls: rt.irr === null ? '' : signClass(rt.irr) },
    { label: 'Pre-tax IRR', value: rt.preTaxIrr === null ? 'not defined' : pct(rt.preTaxIrr * 100) },
    { label: 'Equity multiple', value: rt.equityMultiple.toFixed(2) + '×' },
    { kind: 'group', label: 'Tax paid, all in' },
    { label: 'Transaction taxes (transfer, mansion, recording, flip)', value: money(rt.transactionTaxes) },
    { label: 'Income tax during the hold', value: money(h.cumHoldTax), cls: h.cumHoldTax < 0 ? 'pos' : '' },
    { label: 'Tax on the sale', value: money(s.totalSaleTax) },
    { label: 'Less benefit of released losses', value: money(-s.releasedLossTaxBenefit), cls: 'pos' },
    { label: 'Total tax paid', value: money(rt.totalTaxPaid), kind: 'total' },
  ], null, true);
  renderFormula($('#returnsFormula'), [
    `total profit = cumulative after-tax cash flow + net proceeds − cash invested`,
    `             = ${money(h.cumAfterTaxCF)} + ${money(s.netProceeds)} − ${money(rt.cashInvested)} = ${money(rt.totalProfit)}`,
    `ROI          = ${money(rt.totalProfit)} ÷ ${money(rt.cashInvested)} = ${pct(rt.roi, 1)}`,
    `annualised   = (1 + ROI)^(1/${h.years}) − 1 = ${pct(rt.annualisedRoi, 1)}`,
    '',
    `IRR solves for the rate r where the present value of every cash flow is zero:`,
    `  ${rt.cashFlows.map((c, i) => (i === 0 ? money(c) : `${money(c)}/(1+r)^${i}`)).join(' + ')} = 0`,
    `  r = ${rt.irr === null ? 'not defined for this cash-flow pattern' : pct(rt.irr * 100)}`,
    '',
    `IRR is found by bisection on the net present value, not by an approximation formula, so it is exact to the limits of double precision and identical on every run.`,
  ]);

  renderYearlyTable();
}

function renderYearlyTable() {
  const table = $('#yearlyTable');
  clear(table);
  table.appendChild(el('caption', { text: 'Year-by-year detail' }));
  const cols = ['Year', 'Gross rent', 'NOI', 'Interest', 'Principal', 'Balance',
    'Depreciation', 'Taxable', 'Suspended', 'Tax', 'Pre-tax CF', 'After-tax CF'];
  const thead = el('thead');
  const hr = el('tr');
  cols.forEach((c) => hr.appendChild(el('th', { scope: 'col', text: c })));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  results.hold.table.forEach((y) => {
    const tr = el('tr');
    tr.appendChild(el('th', { scope: 'row', text: String(y.year) }));
    [
      [money(y.grossRent)], [money(y.noi)], [money(y.interest)], [money(y.principalPaid)],
      [money(y.balance)], [money(y.dep)], [money(y.taxable), signClass(y.taxable)],
      [money(y.suspendedBalance)], [money(y.tax)],
      [money(y.preTaxCF), signClass(y.preTaxCF)], [money(y.afterTaxCF), signClass(y.afterTaxCF)],
    ].forEach(([t, cls]) => tr.appendChild(el('td', { class: cls || '', text: t })));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

/* ---------- comparisons ---------- */

function variantColumn(patch) {
  const v = computeVariant(S, patch);
  return v ? v.results : null;
}

const COMPARE_ROWS = (r) => ([
  { label: 'Cash required to close', text: money(r.purchase.cashAtClosing) },
  { label: 'Year 1 net operating income', text: money(r.hold.year1.noi) },
  { label: 'Cap rate', text: pct(r.returns.capRate) },
  { label: 'Cash-on-cash (year 1)', text: pct(r.returns.cashOnCash), cls: signClass(r.returns.cashOnCash) },
  { label: 'Cumulative after-tax cash flow', text: money(r.hold.cumAfterTaxCF), cls: signClass(r.hold.cumAfterTaxCF) },
  { label: 'Sale price', text: money(r.sale.salePrice) },
  { label: 'Tax on the sale', text: money(r.sale.totalSaleTax) },
  { label: 'Net sale proceeds', text: money(r.sale.netProceeds) },
  { label: 'Total profit', text: money(r.returns.totalProfit), cls: signClass(r.returns.totalProfit) },
  { label: 'Return on investment', text: pct(r.returns.roi, 1), cls: signClass(r.returns.roi) },
  { label: 'After-tax IRR', text: r.returns.irr === null ? 'n/a' : pct(r.returns.irr * 100), cls: r.returns.irr === null ? '' : signClass(r.returns.irr) },
]);

function buildComparison(table, caption, variants, note) {
  const computed = variants.map((v) => ({ label: v.label, r: variantColumn(v.patch) })).filter((c) => c.r);
  if (!computed.length) return;
  const rowLabels = COMPARE_ROWS(computed[0].r).map((x) => x.label);
  const rows = rowLabels.map((label, i) => ({
    label,
    values: computed.map((c) => {
      const cell = COMPARE_ROWS(c.r)[i];
      return { text: cell.text, cls: cell.cls };
    }),
  }));
  renderMatrix(table, caption, computed.map((c) => c.label), rows, note);
}

function renderCompareStep() {
  const years = results.hold.years;
  const custom = Math.max(1, Math.min(50, Math.round(num($('#f-customHold').value) || 20)));

  const holds = [5, 10, 15];
  if (!holds.includes(years)) holds.unshift(years);
  if (!holds.includes(custom)) holds.push(custom);
  buildComparison($('#holdCompare'), 'The same property held for different lengths of time',
    holds.sort((a, b) => a - b).map((y) => ({
      label: `${y} years${y === years ? ' (yours)' : ''}`, patch: { 'hold.years': y },
    })),
    'Sale price is re-projected from the appreciation rate for each hold length.');

  const appr = num(S.hold.apprPct);
  const rent = num(S.hold.rentGrowthPct);
  buildComparison($('#growthCompare'), 'Different appreciation and rent growth', [
    { label: 'Pessimistic (−2 pts each)', patch: { 'hold.apprPct': appr - 2, 'hold.rentGrowthPct': rent - 2 } },
    { label: 'Cautious (−1 pt each)', patch: { 'hold.apprPct': appr - 1, 'hold.rentGrowthPct': rent - 1 } },
    { label: `Your assumption (${pct(appr, 1)} / ${pct(rent, 1)})`, patch: {} },
    { label: 'Optimistic (+1 pt each)', patch: { 'hold.apprPct': appr + 1, 'hold.rentGrowthPct': rent + 1 } },
    { label: 'Bullish (+2 pts each)', patch: { 'hold.apprPct': appr + 2, 'hold.rentGrowthPct': rent + 2 } },
  ], 'Appreciation drives the sale price; rent growth drives operating cash flow. Both compound.');

  const down = num(S.purchase.downPct);
  const rate = num(S.purchase.loanRate);
  buildComparison($('#financeCompare'), 'Financing variations', [
    { label: '20% down', patch: { 'purchase.downPct': 20 } },
    { label: `${pct(down, 0)} down (yours)`, patch: {} },
    { label: '50% down', patch: { 'purchase.downPct': 50 } },
    { label: 'All cash', patch: { 'purchase.downPct': 100 } },
    { label: `Rate −1 pt (${pct(Math.max(0, rate - 1))})`, patch: { 'purchase.loanRate': Math.max(0, rate - 1) } },
    { label: '5 years interest-only', patch: { 'purchase.ioYears': 5 } },
  ], 'Leverage raises the return when the property outperforms the loan rate and deepens the loss when it does not.');

  const base = results.sale.salePrice;
  buildComparison($('#priceCompare'), 'What if the sale price is different', [
    { label: `−20% (${compact(base * 0.8)})`, patch: { 'sale.useOverride': true, 'sale.overridePrice': base * 0.8 } },
    { label: `−10% (${compact(base * 0.9)})`, patch: { 'sale.useOverride': true, 'sale.overridePrice': base * 0.9 } },
    { label: `Projected (${compact(base)})`, patch: {} },
    { label: `+10% (${compact(base * 1.1)})`, patch: { 'sale.useOverride': true, 'sale.overridePrice': base * 1.1 } },
    { label: `+20% (${compact(base * 1.2)})`, patch: { 'sale.useOverride': true, 'sale.overridePrice': base * 1.2 } },
  ]);

  // ---- 1031 ----
  const x = results.exchange;
  const s = results.sale;
  renderMatrix($('#exchangeCompare'), 'Selling and paying the tax, versus exchanging into a replacement property',
    ['Taxable sale', '§1031 exchange'], [
      { label: 'Gross proceeds after loan payoff', values: [{ text: money(s.grossProceeds) }, { text: money(s.grossProceeds) }] },
      { label: 'Tax paid now', values: [{ text: money(s.totalSaleTax), cls: 'neg' }, { text: money(0) }] },
      { label: 'Of which depreciation recapture', values: [{ text: money(s.fedRecaptureTax) }, { text: 'deferred' }] },
      { label: 'Suspended passive losses released', values: [{ text: money(s.releasedLosses) }, { text: 'stay suspended' }] },
      { label: 'Tax benefit of those losses', values: [{ text: money(s.releasedLossTaxBenefit), cls: 'pos' }, { text: money(0) }] },
      { label: 'Equity available to reinvest', values: [{ text: money(x.equityIfSold) }, { text: money(x.equityIfExchange) }], kind: 'total' },
      { label: 'Extra equity from exchanging', values: [{ text: '—' }, { text: money(x.extraEquity), cls: 'pos' }] },
      { label: `Buying power at ${pct(x.ltv, 0)} leverage`, values: [{ text: money(x.buyingPowerSold) }, { text: money(x.buyingPowerExchange) }] },
      { label: 'Basis carried into the next property', values: [{ text: 'fresh basis at purchase price' }, { text: money(x.carryoverBasis) }] },
      { label: 'Gain deferred, not forgiven', values: [{ text: '—' }, { text: money(x.deferredGain) }] },
    ], 'A §1031 exchange defers tax; it does not cancel it. The deferred gain follows you into the replacement property through a reduced basis, and the depreciation you already claimed is recaptured whenever you finally sell for cash.');

  renderFormula($('#exchangeFormula'), [
    `equity if you sell      = gross proceeds − tax + released losses = ${money(s.grossProceeds)} − ${money(s.totalSaleTax)} + ${money(s.releasedLossTaxBenefit)} = ${money(x.equityIfSold)}`,
    `equity if you exchange  = gross proceeds = ${money(x.equityIfExchange)}`,
    `extra equity            = ${money(x.extraEquity)}`,
    `carryover basis         = adjusted basis of this property = ${money(x.carryoverBasis)}`,
    '',
    'Not modelled: the 45-day identification and 180-day closing deadlines, qualified intermediary fees, boot received, debt-relief boot when the replacement carries a smaller mortgage, and state clawback rules. A §1031 exchange is not available for a property held mainly for resale.',
  ]);
}

/* ---------- report ---------- */

function renderReportStep() {
  const root = $('#reportRoot');
  clear(root);
  const preset = PRESETS[S.meta.preset] || PRESETS['us-nyc'];
  const { purchase: p, hold: h, sale: s, returns: rt } = results;

  const section = (title, node) => {
    root.appendChild(el('h3', { text: title }));
    root.appendChild(node);
  };
  const kvTable = (caption, rows) => {
    const t = el('table');
    renderTable(t, caption, rows);
    return el('div', { class: 'table-scroll', tabindex: '0' }, [t]);
  };

  root.appendChild(el('h2', { text: S.meta.name || 'Property investment analysis' }));
  const meta = el('p', { class: 'report-meta' });
  meta.appendChild(document.createTextNode(
    `${preset.label} · ${propTypeLabel()} · Generated ${dateLong(new Date().toISOString())} · Tax year ${preset.taxYear} · Rates checked ${preset.verified} · Model schema v${store.SCHEMA_VERSION}`));
  root.appendChild(meta);

  const statusBox = el('p', {}, [
    el('span', {
      class: `badge ${preset.status === 'checked' ? 'verified' : preset.status === 'blank' ? 'blank' : 'experimental'}`,
      text: preset.status === 'checked' ? `Rates checked ${preset.verified}` : preset.status === 'blank' ? 'Blank template' : 'Experimental preset — unverified',
    }),
  ]);
  root.appendChild(statusBox);

  section('Investor and property assumptions', el('div', { class: 'report-cols' }, [
    kvTable('Investor', [
      { label: 'Filing status', value: filingLabel() },
      { label: 'Other income (MAGI)', value: money(num(S.profile.otherMAGI)) },
      { label: 'New York City resident', value: S.profile.nycResident ? 'Yes' : 'No' },
      { label: 'Ownership', value: ownerLabel() },
      { label: 'Combined ordinary rate', value: pct(h.ordinaryRate) },
      { label: 'Rental losses', value: S.hold.passiveAllowed ? 'Deducted as they arise' : 'Suspended under §469' },
    ]),
    kvTable('Property', [
      { label: 'Purchase price', value: money(p.price) },
      { label: 'Property type', value: propTypeLabel() },
      { label: 'Land share', value: pct(num(S.purchase.landPct), 0) },
      { label: 'Cost basis', value: money(p.costBasis) },
      { label: 'Depreciable basis', value: money(p.depreciableBasis) },
      { label: 'Recovery period', value: `${h.depLife} years` },
    ]),
    kvTable('Financing', [
      { label: 'Down payment', value: `${money(p.downPayment)} (${pct(100 - p.ltv, 0)})` },
      { label: 'Loan amount', value: money(p.loan) },
      { label: 'Interest rate', value: pct(num(S.purchase.loanRate)) },
      { label: 'Term', value: `${S.purchase.loanTermYrs} years` },
      { label: 'Interest-only period', value: h.ioMonths ? `${h.ioMonths / 12} years` : 'None' },
      { label: 'Monthly payment', value: money(h.monthlyPaymentAmort, 2) },
    ]),
  ]));

  section('Operating results', kvTable(`Year 1 and the ${h.years}-year hold`, [
    { label: 'Gross scheduled rent (year 1)', value: money(h.year1.grossRent) },
    { label: 'Effective gross income', value: money(h.year1.egi) },
    { label: 'Operating expenses', value: money(h.year1.opex) },
    { label: 'Net operating income', value: money(h.year1.noi), kind: 'total' },
    { label: 'Debt service', value: money(h.year1.debtService) },
    { label: 'Pre-tax cash flow (year 1)', value: money(h.year1.preTaxCF), cls: signClass(h.year1.preTaxCF) },
    { label: 'After-tax cash flow (year 1)', value: money(h.year1.afterTaxCF), cls: signClass(h.year1.afterTaxCF) },
    { label: 'Cumulative after-tax cash flow', value: money(h.cumAfterTaxCF), kind: 'total', cls: signClass(h.cumAfterTaxCF) },
    { label: 'Total depreciation claimed', value: money(h.accumDep) },
    { label: 'Suspended passive losses at sale', value: money(h.suspendedAtSale) },
  ]));

  section('Sale and tax breakdown', el('div', { class: 'report-cols' }, [
    kvTable('Sale', [
      { label: 'Sale price', value: money(s.salePrice) },
      { label: 'Selling costs', value: money(s.sellingCosts) },
      { label: 'Amount realised', value: money(s.amountRealized) },
      { label: 'Adjusted basis', value: money(s.adjustedBasis) },
      { label: 'Total gain', value: money(s.totalGain), kind: 'total' },
      { label: 'Unrecaptured §1250 gain', value: money(s.unrecaptured) },
      { label: 'Long-term capital gain', value: money(s.capitalGain) },
      { label: 'Loan payoff', value: money(s.loanPayoff) },
      { label: 'Net proceeds', value: money(s.netProceeds), kind: 'total' },
    ]),
    kvTable('Tax', [
      { label: 'Transfer and transaction taxes', value: money(rt.transactionTaxes) },
      { label: 'Income tax during the hold', value: money(h.cumHoldTax) },
      { label: 'Depreciation recapture', value: money(s.fedRecaptureTax) },
      { label: 'Federal capital gains', value: money(s.fedCapGainsTax) },
      { label: 'Net investment income tax', value: money(s.niitTax) },
      { label: 'New York State', value: money(s.stateGainTax) },
      { label: 'New York City', value: money(s.cityGainTax) },
      { label: 'Benefit of released losses', value: money(-s.releasedLossTaxBenefit) },
      { label: 'Total tax paid', value: money(rt.totalTaxPaid), kind: 'total' },
    ]),
  ]));

  section('Final returns', kvTable('Returns', [
    { label: 'Cash invested', value: money(rt.cashInvested) },
    { label: 'Total profit', value: money(rt.totalProfit), kind: 'total', cls: signClass(rt.totalProfit) },
    { label: 'Return on investment', value: pct(rt.roi, 1) },
    { label: 'Annualised return', value: pct(rt.annualisedRoi, 1) },
    { label: 'After-tax IRR', value: rt.irr === null ? 'not defined' : pct(rt.irr * 100) },
    { label: 'Pre-tax IRR', value: rt.preTaxIrr === null ? 'not defined' : pct(rt.preTaxIrr * 100) },
    { label: 'Equity multiple', value: rt.equityMultiple.toFixed(2) + '×' },
    { label: 'Cap rate', value: pct(rt.capRate) },
    { label: 'Cash-on-cash (year 1)', value: pct(rt.cashOnCash) },
  ]));

  // Comparisons in the report
  const holdTable = el('table', { class: 'compare-table' });
  const holds = [5, 10, 15].concat(results.hold.years).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  const cols = holds.map((y) => ({ label: `${y} yr`, r: variantColumn({ 'hold.years': y }) })).filter((c) => c.r);
  renderMatrix(holdTable, 'Hold-period comparison', cols.map((c) => c.label),
    COMPARE_ROWS(cols[0].r).map((row, i) => ({
      label: row.label,
      values: cols.map((c) => {
        const cell = COMPARE_ROWS(c.r)[i];
        return { text: cell.text, cls: cell.cls };
      }),
    })));
  section('Scenario comparison', el('div', { class: 'table-scroll', tabindex: '0' }, [holdTable]));

  const x = results.exchange;
  section('Taxable sale versus §1031 exchange', kvTable('Comparison', [
    { label: 'Tax paid on a taxable sale', value: money(s.totalSaleTax) },
    { label: 'Tax deferred by exchanging', value: money(x.taxesDeferred) },
    { label: 'Equity if you sell', value: money(x.equityIfSold) },
    { label: 'Equity if you exchange', value: money(x.equityIfExchange) },
    { label: 'Extra equity available', value: money(x.extraEquity) },
    { label: 'Basis carried into the replacement', value: money(x.carryoverBasis) },
  ]));

  // Sources
  const srcNode = el('div');
  if ((preset.sources || []).length) {
    const ul = el('ul');
    preset.sources.forEach((src) => ul.appendChild(el('li', {}, [
      el('a', { href: src.url, rel: 'noopener noreferrer external', text: src.label }),
    ])));
    srcNode.appendChild(ul);
  } else {
    srcNode.appendChild(el('p', { class: 'help', text: 'This preset has no official source list. Rates were entered manually or drawn from general research.' }));
  }
  section('Sources', srcNode);

  const limNode = el('div');
  const ul = el('ul');
  (preset.omissions || []).forEach((o) => ul.appendChild(el('li', { text: o })));
  limNode.appendChild(ul);
  section('Limitations', limNode);

  const disc = el('div', { class: 'disclaimer' });
  disc.appendChild(el('p', { text: 'This is planning software, not tax-preparation software. It produces an estimate from the assumptions entered above, using published statutory rates. Those rates were compared against the government sources listed above on ' + (preset.verified || 'the date shown') + '; that is a documentary check only. It has not been reviewed or validated by a certified public accountant, an attorney, an enrolled agent or any other tax professional, and no such review is claimed.' }));
  disc.appendChild(el('p', { text: 'Real transactions turn on facts this model does not capture: your full bracket structure, other income and losses, state residency and sourcing, entity structure, withholding obligations, elections and deadlines. Nothing here is tax, legal or investment advice. Confirm every figure with a qualified adviser before acting on it.' }));
  disc.appendChild(el('p', { text: 'All figures are computed in your browser. No input is transmitted, logged or stored anywhere outside this device.' }));
  section('Disclaimer', disc);
}

/* ================================================================== *
 * Live summary rail and dock
 * ================================================================== */

function renderSummary() {
  const { purchase: p, hold: h, sale: s, returns: rt } = results;
  const items = [
    { k: 'Cash to close', v: money(p.cashAtClosing), headline: true },
    { k: 'Year 1 NOI', v: money(h.year1.noi) },
    { k: 'Cap rate', v: pct(rt.capRate) },
    { k: 'Cash-on-cash', v: pct(rt.cashOnCash), cls: signClass(rt.cashOnCash) },
    { k: 'After-tax cash flow (yr 1)', v: money(h.year1.afterTaxCF), cls: signClass(h.year1.afterTaxCF) },
    { k: 'Sale price', v: money(s.salePrice) },
    { k: 'Tax on sale', v: money(s.totalSaleTax) },
    { k: 'Net proceeds', v: money(s.netProceeds) },
    { k: 'Total profit', v: money(rt.totalProfit), cls: signClass(rt.totalProfit) },
    { k: 'ROI', v: pct(rt.roi, 1), cls: signClass(rt.roi) },
    { k: 'After-tax IRR', v: rt.irr === null ? 'n/a' : pct(rt.irr * 100), cls: rt.irr === null ? '' : signClass(rt.irr), headline: true },
  ];

  [['#railList', true], ['#dockList', false]].forEach(([sel]) => {
    const list = $(sel);
    if (!list) return;
    clear(list);
    items.forEach((i) => {
      list.appendChild(el('li', { class: i.headline ? 'headline' : '' }, [
        el('span', { class: 'k', text: i.k }),
        el('span', { class: `v ${i.cls || ''}`, text: i.v }),
      ]));
    });
  });

  $('#railSub').textContent = `${PRESETS[S.meta.preset].label} · ${h.years}-year hold`;
  $('#dockCash').textContent = money(results.purchase.cashAtClosing);
  $('#dockIrr').textContent = rt.irr === null ? 'n/a' : pct(rt.irr * 100);
  $('#brandScenario').textContent = PRESETS[S.meta.preset] ? PRESETS[S.meta.preset].label : '';
}

/* ================================================================== *
 * Labels
 * ================================================================== */

function propTypeLabel() {
  return { residential: 'Residential', coop: 'Co-op', commercial: 'Commercial' }[S.purchase.propType] || 'Residential';
}
function filingLabel() {
  return { single: 'single or head of household', mfj: 'married filing jointly', mfs: 'married filing separately' }[S.profile.filingStatus] || 'single';
}
function ownerLabel() {
  return { individual: 'Individual', partnership: 'Partnership or LLC', corporation: 'Corporation' }[S.profile.ownerType] || 'Individual';
}

/* ================================================================== *
 * Orchestration
 * ================================================================== */

let announceTimer = null;
function announce(message) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { $('#liveStatus').textContent = message; }, 150);
}

let saveTimer = null;
function onChange() {
  currencySymbol = S.rates.currency || '$';
  const ok = renderValidation();
  if (ok) {
    try {
      results = computeModel(S);
    } catch (err) {
      console.error('Model error', err);
      return;
    }
    renderAll();
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    S.meta.updated = new Date().toISOString();
    store.saveAutosave(S);
  }, 400);
}

function renderAll() {
  syncInputs();
  applyModeVisibility();
  renderSummary();
  renderPropertyStep();
  renderFinancingStep();
  renderOperationsStep();
  renderSaleStep();
  if (currentStep === 'profile') renderProfileStep();
  renderResultsStep();
  if (currentStep === 'compare' || currentStep === 'report') renderCompareStep();
  if (currentStep === 'report') renderReportStep();
}

/**
 * Show one step.
 * @param {string} step
 * @param {boolean} [moveFocus=true] Move focus to the step heading. False on
 *   the very first render, so the skip link remains the first tab stop and the
 *   page does not open with focus already parked inside the form.
 */
function goTo(step, moveFocus = true) {
  if (!STEPS.includes(step)) step = 'property';
  currentStep = step;
  visitedSteps.add(step);
  STEPS.forEach((s) => { $(`#panel-${s}`).hidden = s !== step; });
  $$('#stepList button').forEach((b) => {
    if (b.dataset.step === step) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  });
  renderValidation();
  if (step === 'profile') renderProfileStep();
  if (step === 'compare') renderCompareStep();
  if (step === 'report') { renderCompareStep(); renderReportStep(); }
  const heading = $(`#panel-${step} h1`);
  if (heading && moveFocus) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
  announce(`Step ${STEPS.indexOf(step) + 1} of 8: ${heading ? heading.textContent : step}`);
  // The step is deliberately NOT written into the URL. A reload should return
  // the user to the welcome screen — where "Continue where you left off" is
  // waiting — rather than silently dropping them back into a form. A #step in
  // the address bar is still honoured as a deep link on first load.
}

/** Per-step wording for what Quick estimate is standing in for. */
const QUICK_NOTES = {
  property: 'closing costs and who pays the transfer tax',
  financing: 'interest-only periods and origination points',
  operations: 'other income, expense inflation and improvement timing',
  profile: 'the passive-loss election and the full rate engine',
  sale: 'selling costs and who pays the transfer tax on the sale',
};

function applyModeVisibility() {
  const pro = S.meta.mode === 'pro';
  $$('[data-mode="pro"]').forEach((n) => { n.hidden = !pro; });
  $$('[data-mode="quick"]').forEach((n) => { n.hidden = pro; });
  $('#modeQuick').setAttribute('aria-pressed', String(!pro));
  $('#modePro').setAttribute('aria-pressed', String(pro));

  // A mode switch that changes nothing visible reads as a broken button. Each
  // step says what Quick estimate is deciding on the user's behalf, and how
  // many settings that covers, so the toggle always has a visible effect.
  for (const [step, what] of Object.entries(QUICK_NOTES)) {
    const note = $(`#modeNote-${step}`);
    if (!note) continue;
    const panel = $(`#panel-${step}`);
    const count = panel.querySelectorAll('[data-mode="pro"] input, [data-mode="pro"] select').length;
    clear(note);
    note.appendChild(el('strong', { text: 'Quick estimate' }));
    note.appendChild(document.createTextNode(
      ` is using standard values for ${what}${count ? ` — ${count} setting${count === 1 ? '' : 's'}` : ''}. Switch to `));
    // Distinct accessible name: "Professional" alone would collide with the
    // header toggle for anyone navigating by control name.
    const link = el('button', {
      type: 'button', class: 'linklike', text: 'Professional',
      'aria-label': 'Switch to Professional mode',
    });
    link.addEventListener('click', () => {
      S.meta.mode = 'pro';
      onChange();
      announce('Professional mode. All settings and the full rate engine are visible.');
    });
    note.appendChild(link);
    note.appendChild(document.createTextNode(' to see and change them.'));
  }
}

/* ================================================================== *
 * Theme
 * ================================================================== */

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const isDark = theme === 'dark';
  $('#themeBtn').setAttribute('aria-pressed', String(isDark));
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme')
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

/* ================================================================== *
 * Wiring
 * ================================================================== */

function wire() {
  buildPresetSelect();
  bindInputs();

  $$('#stepList button').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.step)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.goto)));

  $('#modeQuick').addEventListener('click', () => { S.meta.mode = 'quick'; onChange(); announce('Quick estimate mode. Advanced settings are hidden.'); });
  $('#modePro').addEventListener('click', () => { S.meta.mode = 'pro'; onChange(); announce('Professional mode. All settings and the full rate engine are visible.'); });

  $('#themeBtn').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    const prefs = store.loadPrefs();
    prefs.theme = next;
    store.savePrefs(prefs);
    announce(`${next === 'dark' ? 'Dark' : 'Light'} theme enabled.`);
  });

  // tooltips
  $$('.tip-btn').forEach((btn) => {
    const body = document.getElementById(btn.getAttribute('aria-controls'));
    if (!body) return;
    body.hidden = true;
    const close = () => { body.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      $$('.tip-body').forEach((b) => { b.hidden = true; });
      $$('.tip-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      if (!open) { body.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    });
    btn.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.addEventListener('click', (e) => {
      if (!btn.parentElement.contains(e.target)) close();
    });
  });

  $('#f-customHold').addEventListener('input', () => renderCompareStep());
  $('#printBtn').addEventListener('click', () => window.print());

  // Start over. The only scenario action the interface exposes: saving,
  // naming, duplicating and importing named scenarios turned out to be the most
  // confusing part of the tool for someone running a single property, and this
  // is a calculator, not a document manager. Work is still kept safe by the
  // silent autosave, which the welcome screen offers back as "continue".
  $('#resetBtn').addEventListener('click', () => {
    S = store.defaultState();
    store.clearAutosave();
    onChange();
    goTo('property');
    announce('Started over with the default New York City scenario.');
  });

  // welcome dialog
  const wel = $('#welcomeDialog');
  const saved = store.loadAutosave();
  const cont = $('#wContinue');
  if (saved) {
    cont.disabled = false;
    $('#wContinueDesc').textContent = `${saved.meta.name} · last edited ${dateLong(saved.meta.updated)}`;
  } else {
    cont.disabled = true;
  }
  const start = (state, step) => {
    S = state;
    wel.close();
    onChange();
    // The dialog returns focus to the page; leave it at the top so the skip
    // link is still the first thing a keyboard user reaches.
    goTo(step || 'property', false);
    document.activeElement && document.activeElement.blur();
  };
  $('#wNew').addEventListener('click', () => start(store.defaultState()));
  $('#wExample').addEventListener('click', () => start(store.nycExampleState(), 'results'));
  $('#wContinue').addEventListener('click', () => start(saved || store.defaultState()));
  wel.addEventListener('close', () => { if (!results) onChange(); });

  // keyboard: Escape closes tooltips
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.tip-body').forEach((b) => { b.hidden = true; });
      $$('.tip-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    }
  });

  return { wel, saved };
}

function init() {
  const prefs = store.loadPrefs();
  if (prefs.theme) applyTheme(prefs.theme);

  const { wel, saved } = wire();

  const hash = (location.hash || '').replace('#', '');
  const deepLinked = STEPS.includes(hash);
  const skipWelcome = deepLinked || new URLSearchParams(location.search).has('nowelcome');

  if (saved) S = saved;
  onChange();
  goTo(deepLinked ? hash : 'property', false);

  if (!skipWelcome && typeof wel.showModal === 'function') {
    wel.showModal();
  }

  document.documentElement.dataset.ready = 'true';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Exposed for end-to-end tests only. No secrets, no network, read-only view.
globalThis.__pitm = {
  getState: () => structuredClone(S),
  getResults: () => results,
  goTo,
};
