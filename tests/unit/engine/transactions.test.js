/**
 * transactions.test.js — the engine layer between a scenario and the rules.
 *
 * Two guarantees dominate this file, and both exist because an earlier version
 * of the engine broke them:
 *
 *   A charge is never computed on the wrong amount. A rule declares what it is
 *   charged on, and if the scenario does not supply that amount the charge is
 *   OMITTED with a reason rather than levied on the purchase price.
 *
 *   A total that is missing a charge is never presented as verified. A nil
 *   total caused by an absent input looks identical to a genuine nil charge,
 *   which is the most dangerous output the product could produce.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { defaultState } from '../../../src/storage.js';
import { Money } from '../../../src/core/money.js';
import { STATUS } from '../../../src/core/trace.js';
import { computeTransactionTaxes, byPayer, transactionTrace, factsFromScenario } from '../../../src/engine/transactions.js';
import { jurisdictionFor, isModelled, modelledPresetKeys, COVERAGE } from '../../../src/engine/jurisdiction.js';

function scenario(preset, over = {}) {
  const s = defaultState();
  s.meta.preset = preset;
  Object.assign(s.purchase, over.purchase || {});
  Object.assign(s.profile, over.profile || {});
  return s;
}

const run = (preset, price, ccy, opts = {}, over = {}) => computeTransactionTaxes(
  scenario(preset, over),
  { side: 'acquisition', consideration: Money.of(price, ccy), on: '2025-06-01', ...opts },
);

describe('Only researched jurisdictions are treated as modelled', () => {
  test('the three researched presets are modelled', () => {
    assert.deepEqual(modelledPresetKeys().sort(), ['jp', 'uk', 'us-nyc']);
    for (const k of modelledPresetKeys()) assert.ok(isModelled(k), `${k} is modelled`);
  });

  test('every other preset is legacy and says why', () => {
    for (const k of ['de', 'fr', 'sg', 'us-tx', 'ca-on', 'intl']) {
      const j = jurisdictionFor(k);
      assert.equal(j.coverage, COVERAGE.LEGACY, `${k} is legacy`);
      assert.match(j.reason, /no researched rule pack/);
      assert.match(j.reason, /rough sketch/);
    }
  });

  test('a legacy preset computes nothing at all rather than something wrong', () => {
    const r = run('de', '450000', 'USD');
    assert.equal(r.charges.length, 0);
    assert.equal(r.total, null);
    assert.equal(r.status, STATUS.UNSUPPORTED);
    assert.equal(r.totalStatus, STATUS.UNSUPPORTED);
    assert.equal(r.complete, false);
  });

  test('a modelled preset states what it does and does not cover', () => {
    assert.match(jurisdictionFor('uk').note, /Scotland charges LBTT and Wales charges LTT/);
    assert.match(jurisdictionFor('jp').note, /Tokyo/);
    assert.match(jurisdictionFor('us-nyc').note, /supplemental transfer tax/);
  });
});

describe('A charge is never computed on the wrong amount', () => {
  test('the UK lease charge is excluded from a freehold purchase', () => {
    const r = run('uk', '425000', 'GBP', {}, { purchase: { propType: 'commercial' } });
    const ids = r.charges.map((c) => c.id);
    assert.ok(ids.includes('gb-eaw.sdlt.nonresidential'), 'the premium charge applies');
    assert.ok(!ids.includes('gb-eaw.sdlt.nonresidential.lease-npv'), 'the lease charge does not');
    assert.match(
      r.incomplete.map((i) => i.reason).join(' '),
      /net present value of rent over a new lease/,
    );
  });

  test('supplying the lease NPV includes the charge, computed on that figure', () => {
    const r = run('uk', '425000', 'GBP',
      { leaseNpv: Money.of('300000', 'GBP') },
      { purchase: { propType: 'commercial' } });
    const lease = r.charges.find((c) => c.id === 'gb-eaw.sdlt.nonresidential.lease-npv');
    assert.ok(lease, 'the lease charge now applies');
    // 1% of the slice above £150,000 of the NPV: 1% of £150,000 = £1,500.
    assert.equal(lease.amount.amount.toString(), '1500');
  });

  test('Japanese charges are omitted without an assessed value, not levied on price', () => {
    const r = run('jp', '45000000', 'JPY');
    assert.equal(r.charges.length, 0, 'nothing is charged on the purchase price');
    assert.equal(r.total.amount.toString(), '0');
    assert.match(
      r.incomplete.map((i) => i.reason).join(' '),
      /assessed value on the tax roll, not the purchase price/,
    );
  });

  test('supplying the assessed value computes them on it', () => {
    const r = run('jp', '45000000', 'JPY', { assessedValue: Money.of('31500000', 'JPY') });
    const acq = r.charges.find((c) => c.id === 'jp.acquisition-tax.building.residential');
    const reg = r.charges.find((c) => c.id === 'jp.registration-tax.building.sale');
    assert.equal(acq.amount.amount.toString(), '945000'); // 3% of 31,500,000
    assert.equal(reg.amount.amount.toString(), '630000'); // 2% of 31,500,000

    // And materially less than charging the market price would have produced.
    const onPrice = Money.of('45000000', 'JPY').multiply('0.03');
    assert.ok(acq.amount.lt(Money.of(onPrice.amount, 'JPY')));
  });
});

describe('An incomplete total is never presented as verified', () => {
  test('a nil total caused by a missing input is ESTIMATED, not VERIFIED', () => {
    const r = run('jp', '45000000', 'JPY');
    assert.equal(r.total.amount.toString(), '0');
    assert.equal(r.status, STATUS.VERIFIED, 'the charges we did compute are sound');
    assert.equal(r.totalStatus, STATUS.ESTIMATED, 'but the total is not the whole bill');
    assert.equal(r.complete, false);
  });

  test('a complete bill is verified end to end', () => {
    const r = run('uk', '425000', 'GBP');
    assert.equal(r.complete, true);
    assert.equal(r.totalStatus, STATUS.VERIFIED);
    assert.equal(r.incomplete.length, 0);
  });

  test('New York discloses that mortgage recording tax is missing', () => {
    const r = run('us-nyc', '1200000', 'USD');
    assert.equal(r.complete, false);
    assert.match(r.incomplete.map((i) => i.reason).join(' '), /Mortgage recording tax is not modelled/);
  });

  test('the disclosure is side-aware', () => {
    // Mortgage recording tax is a buyer cost; it must not appear on a sale.
    const sale = computeTransactionTaxes(scenario('us-nyc'), {
      side: 'disposal', consideration: Money.of('1200000', 'USD'), on: '2025-06-01',
    });
    assert.ok(!sale.incomplete.some((i) => /Mortgage recording/.test(i.reason)));
  });

  test('the combined trace carries the warning through to a report', () => {
    const r = run('jp', '45000000', 'JPY');
    const t = transactionTrace(r, 'Acquisition');
    const warnings = t.allWarnings().map((w) => w.message).join(' ');
    assert.match(warnings, /understates what will actually be payable/);
    assert.equal(t.status, STATUS.ESTIMATED);
  });
});

describe('Charges land on the correct side and the correct party', () => {
  test('New York buyer pays the mansion tax, seller pays the transfer taxes', () => {
    const buy = run('us-nyc', '1200000', 'USD');
    assert.deepEqual(buy.charges.map((c) => c.id), ['us-ny.mansion-tax']);
    assert.equal(buy.charges[0].payer, 'buyer');

    const sell = computeTransactionTaxes(scenario('us-nyc'), {
      side: 'disposal', consideration: Money.of('1200000', 'USD'), on: '2025-06-01',
    });
    assert.ok(sell.charges.every((c) => c.payer === 'seller'));
    assert.ok(sell.charges.some((c) => c.id === 'us-ny.nyc.rptt.residential'));
  });

  test('byPayer splits a bill the way a closing statement does', () => {
    const sell = computeTransactionTaxes(scenario('us-nyc'), {
      side: 'disposal', consideration: Money.of('1200000', 'USD'), on: '2025-06-01',
    });
    const split = byPayer(sell);
    assert.equal(split.buyer.length, 0);
    assert.ok(split.seller.length > 0);
  });

  test('residency changes which SDLT table applies', () => {
    const resident = run('uk', '425000', 'GBP', {}, { profile: { taxResident: true } });
    const nonResident = run('uk', '425000', 'GBP', {}, { profile: { taxResident: false } });
    assert.ok(nonResident.total.gt(resident.total), 'the non-resident surcharge costs more');
    assert.equal(nonResident.total.subtract(resident.total).amount.toString(), '8500'); // 2% of 425,000
  });

  test('facts are translated from the application vocabulary', () => {
    const f = factsFromScenario(scenario('us-nyc', { purchase: { propType: 'coop' } }));
    assert.equal(f.propertyClass, 'residential', 'a co-op is residential for tax');
    assert.equal(f.ownership, 'individual');
    assert.equal(f.residency, 'resident');
  });
});

describe('Currency is enforced at the engine boundary', () => {
  test('a yen consideration against a UK preset throws', () => {
    assert.throws(
      () => run('uk', '425000', 'JPY'),
      /uk is denominated in GBP but the consideration is JPY/,
    );
  });

  test('each modelled jurisdiction reports in its own currency', () => {
    assert.equal(run('uk', '425000', 'GBP').currency, 'GBP');
    assert.equal(run('jp', '45000000', 'JPY').currency, 'JPY');
    assert.equal(run('us-nyc', '950000', 'USD').currency, 'USD');
  });
});
