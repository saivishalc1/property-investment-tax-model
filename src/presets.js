/**
 * presets.js — jurisdiction rate presets.
 *
 * VERIFICATION STATUS
 * -------------------
 * Each preset carries a `status` field. The wording is deliberately narrow,
 * because a claim of verification is only worth what was actually done:
 *
 *   'checked'       New York. Every rate was compared against the published
 *                   sources listed in `sources` on the date in `verified`.
 *                   That is a documentary check, not professional review. The
 *                   `verification` field records, per group of rates, whether
 *                   the figure came from a primary government source or from
 *                   corroborating secondary sources.
 *   'experimental'  Non-US jurisdictions. Researched, but NOT checked against
 *                   primary sources, and in several cases the engine cannot
 *                   express the local rule at all (see `omissions`). A starting
 *                   point for your own numbers, not an answer.
 *   'blank'         Empty template for a jurisdiction you enter yourself.
 *
 * NO PRESET IN THIS FILE HAS BEEN REVIEWED BY A CPA, AN ATTORNEY, AN ENROLLED
 * AGENT OR ANY OTHER TAX PROFESSIONAL, and none of it is advice. Every rate is
 * editable in the application.
 *
 * Documentary check performed 2026-08-22. What it found and fixed:
 *   - The 0.25% additional base tax on high-value conveyances applies in New
 *     York City ONLY. The outside-NYC preset had been applying it, overstating
 *     the transfer tax on a $3.5M sale upstate by $8,750. Corrected.
 *   - Income tax was a single flat rate per jurisdiction. Replaced with the
 *     real 2026 marginal schedules; see taxTables.js.
 *   - The §469(i) $25,000 allowance was missing entirely. Implemented.
 * Confirmed correct as they stood: the NYS 0.4% base transfer tax; the combined
 * NYC mansion schedule from 1% to 3.9%; NYC RPTT at 1%/1.425% residential and
 * 1.425%/2.625% commercial across the $500,000 threshold; mortgage recording
 * tax at 1.80%/1.925% residential and 2.55% commercial net of the lender's
 * 0.25%; the 25% ceiling on unrecaptured §1250 gain; NIIT at 3.8% with
 * thresholds of $200,000, $250,000 and $125,000; and 27.5 and 39-year recovery
 * periods.
 */

const L_US = {
  stateTransfer: 'State transfer tax', cityTransfer: 'City transfer tax',
  mansion: 'Mansion tax', mrt: 'Mortgage recording tax',
  fedLTCG: 'Federal long-term capital gains', recapture: 'Federal depreciation recapture (§1250)',
  niit: 'Net investment income tax', fedOrdinary: 'Federal marginal ordinary rate',
  stateOrdinary: 'State ordinary rate', cityOrdinary: 'City ordinary rate',
  stateCapGains: 'State rate on capital gain', cityCapGains: 'City rate on capital gain',
  flipTax: 'Co-op flip tax'
};
// Generic labels for everywhere that isn't the US.
function L(o) {
  return Object.assign({
    stateTransfer: 'Transfer tax / stamp duty', cityTransfer: 'Secondary transfer tax',
    mansion: 'Buyer duty / surcharge', mrt: 'Mortgage registration tax',
    fedLTCG: 'Capital gains tax', recapture: 'Depreciation recapture',
    niit: 'Investment income surtax', fedOrdinary: 'Rental income tax rate',
    stateOrdinary: 'Regional income tax', cityOrdinary: 'Municipal income tax',
    stateCapGains: 'Regional rate on gain', cityCapGains: 'Municipal rate on gain',
    flipTax: 'Flip / resale levy'
  }, o || {});
}

const NO_DEP = 1e9;   // "no depreciation relief in this jurisdiction"
const flat = r => [{ min: 0, rate: r }];
const zero = [{ min: 0, rate: 0 }];

const base = {
  currency: '$', marginalBrackets: true,
  stateTransferRes: zero, stateTransferComm: zero,
  cityTransferRes: zero, cityTransferComm: zero,
  mansion: zero, mrtResidential: zero, mrtCommercial: 0,
  cgtByYears: [], sellerDutyByYears: [],
  coopExemptFromMRT: false, coopExemptFromTitle: false,
  fedLTCG: 0, recapture: 0, niit: 0, niitEnabled: false,
  fedOrdinary: 0, stateOrdinary: 0, cityOrdinary: 0,
  stateCapGains: 0, cityCapGains: 0,
  depLifeResidential: 27.5, depLifeCommercial: 39
};
// deep-clone so no two presets ever share a bracket array
const mk = o => JSON.parse(JSON.stringify(Object.assign({}, base, o)));

const PRESETS = {

/* ========================= UNITED STATES ========================= */
'us-nyc': {
  dutySide: 'seller',
  coopMarket: true,
  lossRule: false,
  label: 'New York City', region: 'United States',
  notes: 'Non-resident or resident individual holding through a pass-through. Seller normally pays NYS and NYC transfer tax; buyer pays mansion tax and mortgage recording tax. Mansion tax and RPTT are whole-price cliff brackets, so a dollar over a threshold re-rates the entire price. Does not model NY nonresident estimated tax (IT-2663), REP status or §121.',
  sample: { price: 950000, rentMo: 7000, propTaxYr: 10000, insuranceYr: 2400, hoaMo: 500, otherOpexYr: 1000, capexTotal: 25000, loanRate: 6.75, downPct: 30 },
  labels: L_US,
  rates: mk({
    marginalBrackets: false,
    stateTransferRes: [{ min: 0, rate: 0.4 }, { min: 3000000, rate: 0.65 }],
    stateTransferComm: [{ min: 0, rate: 0.4 }, { min: 2000000, rate: 0.65 }],
    cityTransferRes: [{ min: 0, rate: 1.0 }, { min: 500000.01, rate: 1.425 }],
    cityTransferComm: [{ min: 0, rate: 1.425 }, { min: 500000.01, rate: 2.625 }],
    mansion: [{ min: 0, rate: 0 }, { min: 1000000, rate: 1.0 }, { min: 2000000, rate: 1.25 },
              { min: 3000000, rate: 1.5 }, { min: 5000000, rate: 2.25 }, { min: 10000000, rate: 3.25 },
              { min: 15000000, rate: 3.5 }, { min: 20000000, rate: 3.75 }, { min: 25000000, rate: 3.9 }],
    mrtResidential: [{ min: 0, rate: 1.8 }, { min: 500000, rate: 1.925 }],
    mrtCommercial: 2.55, coopExemptFromMRT: true, coopExemptFromTitle: true,
    fedLTCG: 20, recapture: 25, niit: 3.8, niitEnabled: true,
    fedOrdinary: 37, stateOrdinary: 6.85, cityOrdinary: 3.876,
    stateCapGains: 6.85, cityCapGains: 3.876
  })
},

'us-nys': {
  dutySide: 'seller',
  coopMarket: true,
  lossRule: false,
  label: 'New York State (outside NYC)', region: 'United States',
  notes: 'The 0.4% NYS transfer tax and the 1% state mansion tax apply; no city RPTT and no NYC income tax. The additional 0.25% base tax on high-value conveyances is New York City only and is therefore NOT applied here — outside the city the rate stays 0.4% at every price. Mortgage recording tax varies by county; 1.0% is typical outside the MTA region, so check your county.',
  sample: { price: 550000, rentMo: 3400, propTaxYr: 9000, insuranceYr: 1800, hoaMo: 0, otherOpexYr: 1200, capexTotal: 20000, loanRate: 6.75, downPct: 25 },
  labels: L_US,
  rates: mk({
    marginalBrackets: false,
    stateTransferRes: [{ min: 0, rate: 0.4 }],
    stateTransferComm: [{ min: 0, rate: 0.4 }],
    mansion: [{ min: 0, rate: 0 }, { min: 1000000, rate: 1.0 }],
    mrtResidential: flat(1.0), mrtCommercial: 1.0, coopExemptFromMRT: true,
    fedLTCG: 20, recapture: 25, niit: 3.8, niitEnabled: true,
    fedOrdinary: 37, stateOrdinary: 6.85, stateCapGains: 6.85
  })
},

'us-fl': {
  dutySide: 'seller',
  lossRule: false,
  label: 'Florida', region: 'United States',
  notes: 'Documentary stamp tax on the deed is 0.70% statewide ($0.60 per $100 in Miami-Dade) and is customarily paid by the seller. Financing carries 0.35% documentary stamps on the note plus 0.20% intangible tax = 0.55% of the loan. No state income tax, so federal rates carry the whole burden.',
  sample: { price: 480000, rentMo: 3200, propTaxYr: 7200, insuranceYr: 6500, hoaMo: 350, otherOpexYr: 900, capexTotal: 15000, loanRate: 6.75, downPct: 25 },
  labels: L_US,
  rates: mk({
    marginalBrackets: false,
    stateTransferRes: flat(0.70), stateTransferComm: flat(0.70),
    mrtResidential: flat(0.55), mrtCommercial: 0.55,
    fedLTCG: 20, recapture: 25, niit: 3.8, niitEnabled: true, fedOrdinary: 37
  })
},

'us-tx': {
  dutySide: 'seller',
  lossRule: false,
  label: 'Texas', region: 'United States',
  notes: 'One of a handful of states with no real estate transfer tax and no mortgage recording tax, and no state income tax. The cost sits in property tax instead — effective rates of 1.8–2.5% of value are normal, so set the annual property tax input carefully.',
  sample: { price: 420000, rentMo: 2700, propTaxYr: 9500, insuranceYr: 3200, hoaMo: 60, otherOpexYr: 900, capexTotal: 15000, loanRate: 6.75, downPct: 25 },
  labels: L_US,
  rates: mk({
    marginalBrackets: false,
    fedLTCG: 20, recapture: 25, niit: 3.8, niitEnabled: true, fedOrdinary: 37
  })
},

'us-ca': {
  dutySide: 'seller',
  lossRule: false,
  label: 'California (Los Angeles)', region: 'United States',
  notes: 'County documentary transfer tax 0.11% plus City of LA 0.45%. The buyer-duty slot holds Measure ULA — 4% on sales above roughly $5.3M and 5.5% above $10.6M, applied to the whole price and indexed annually; it is a seller-side tax in reality, so move it to the sale side if that matters to you. California has no preferential capital gains rate: gains are ordinary income up to 13.3%.',
  sample: { price: 1100000, rentMo: 5200, propTaxYr: 13800, insuranceYr: 2600, hoaMo: 450, otherOpexYr: 1200, capexTotal: 25000, loanRate: 6.75, downPct: 30 },
  labels: Object.assign({}, L_US, { mansion: 'Measure ULA (transfer tax on high-value sales)' }),
  rates: mk({
    marginalBrackets: false,
    stateTransferRes: flat(0.11), stateTransferComm: flat(0.11),
    cityTransferRes: flat(0.45), cityTransferComm: flat(0.45),
    mansion: [{ min: 0, rate: 0 }, { min: 5300000, rate: 4 }, { min: 10600000, rate: 5.5 }],
    fedLTCG: 20, recapture: 25, niit: 3.8, niitEnabled: true,
    fedOrdinary: 37, stateOrdinary: 13.3, stateCapGains: 13.3
  })
},

/* ========================= GULF & SOUTH ASIA ========================= */
'ae-dubai': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'UAE — Dubai', region: 'Gulf & South Asia',
  notes: 'DLD transfer fee 4% of price (contractually split 50/50 in theory, borne by the buyer in practice) plus a trustee/registration fee of roughly AED 4,000 and 0.25% of any mortgage. No capital gains tax, no rental income tax and no annual property tax for individuals. Landlords do pay a 5% municipality housing fee on rent — enter that under other operating expenses. Commercial property carries 5% VAT.',
  sample: { price: 2200000, rentMo: 13000, propTaxYr: 0, insuranceYr: 3500, hoaMo: 1600, otherOpexYr: 7800, capexTotal: 40000, loanRate: 4.5, downPct: 50 },
  labels: L({ stateTransfer: 'DLD transfer fee', mrt: 'Mortgage registration fee' }),
  rates: mk({
    currency: 'AED ',
    stateTransferRes: flat(4), stateTransferComm: flat(4),
    mrtResidential: flat(0.25), mrtCommercial: 0.25,
    depLifeResidential: NO_DEP, depLifeCommercial: NO_DEP
  })
},

'sa': {
  dutySide: 'seller',
  lossRule: true,
  label: 'Saudi Arabia', region: 'Gulf & South Asia',
  notes: 'Real Estate Transaction Tax (RETT) of 5% on the disposal value, replacing the old 15% VAT on property. Legally the seller\'s liability but routinely negotiated onto the buyer — the preset puts it on the buyer. Resident individuals pay no personal income tax on rent or gains; non-GCC corporate investors face 20% corporate income tax and withholding, which this preset does not model.',
  sample: { price: 1800000, rentMo: 9000, propTaxYr: 0, insuranceYr: 4000, hoaMo: 800, otherOpexYr: 6000, capexTotal: 40000, loanRate: 5.5, downPct: 40 },
  labels: L({ stateTransfer: 'Real Estate Transaction Tax (RETT)' }),
  rates: mk({
    currency: 'SAR ',
    stateTransferRes: flat(5), stateTransferComm: flat(5),
    depLifeResidential: NO_DEP, depLifeCommercial: NO_DEP
  })
},

'in-mh': {
  dutySide: 'buyer',
  lossRule: false,
  label: 'India — Maharashtra (Mumbai/Pune)', region: 'Gulf & South Asia',
  notes: 'Stamp duty 6% in Mumbai (5% base plus 1% metro cess) and 1% registration, capped at ₹30,000 — the cap is not modelled, so registration is overstated above ₹30 lakh. NRI long-term capital gains are 12.5% without indexation once held over 24 months; below that, slab rates. TDS on an NRI sale is withheld at roughly 20% plus surcharge and cess. Individuals get a flat 30% standard deduction on rental income instead of depreciation — enter it as an operating expense rather than using the depreciation fields. Stamp duty varies widely by state.',
  sample: { price: 15000000, rentMo: 45000, propTaxYr: 25000, insuranceYr: 8000, hoaMo: 6000, otherOpexYr: 20000, capexTotal: 300000, loanRate: 8.5, downPct: 25 },
  labels: L({ stateTransfer: 'Stamp duty', cityTransfer: 'Registration charge' }),
  rates: mk({
    currency: '₹',
    stateTransferRes: flat(6), stateTransferComm: flat(6),
    cityTransferRes: flat(1), cityTransferComm: flat(1),
    cgtByYears: [{ min: 0, rate: 31.2 }, { min: 2, rate: 12.5 }],
    fedLTCG: 12.5, fedOrdinary: 31.2,
    depLifeResidential: NO_DEP, depLifeCommercial: NO_DEP
  })
},

/* ========================= WESTERN EUROPE ========================= */
'uk': {
  dutySide: 'buyer',
  lossRule: false,
  label: 'United Kingdom — buy-to-let', region: 'Western Europe',
  notes: 'SDLT at the additional-property rates in force from April 2025, plus the 2% non-resident surcharge, giving 7/9/12/17/19% marginal bands. Capital gains on residential property at the 24% higher rate. Rental taxed at 40% under the non-resident landlord scheme. Two things this cannot capture: individuals get no depreciation on buildings, and mortgage interest relief is restricted to a 20% basic-rate tax credit rather than a deduction — so the model over-relieves interest for higher-rate taxpayers. Scotland (LBTT) and Wales (LTT) have separate schedules.',
  sample: { price: 425000, rentMo: 1950, propTaxYr: 0, insuranceYr: 450, hoaMo: 150, otherOpexYr: 900, capexTotal: 12000, loanRate: 5.4, downPct: 30 },
  labels: L({ stateTransfer: 'SDLT (incl. 2% non-resident surcharge)' }),
  rates: mk({
    currency: '£',
    stateTransferRes: [{ min: 0, rate: 7 }, { min: 125000, rate: 9 }, { min: 250000, rate: 12 },
                       { min: 925000, rate: 17 }, { min: 1500000, rate: 19 }],
    stateTransferComm: [{ min: 0, rate: 0 }, { min: 150000, rate: 2 }, { min: 250000, rate: 5 }],
    fedLTCG: 24, fedOrdinary: 40,
    depLifeResidential: NO_DEP, depLifeCommercial: 33.33
  })
},

'es': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Spain', region: 'Western Europe',
  notes: 'ITP transfer tax on resale property is set regionally and runs 6–11% — 10% here as a mid-range figure (Madrid 6%, Andalusia 7%, Valencia 10%, Catalonia 10–13%). New-build purchases instead carry 10% VAT plus 1.5% AJD. Notary and registry of roughly 1.5% sit in the secondary slot. Non-resident capital gains are a flat 19% and the buyer withholds 3% of the price on account. Rental income: EU residents are taxed at 19% on net income; non-EU residents pay 24% on gross with no deductions at all, so if you are non-EU the expense deductions in this model do not apply.',
  sample: { price: 350000, rentMo: 1700, propTaxYr: 900, insuranceYr: 400, hoaMo: 120, otherOpexYr: 800, capexTotal: 12000, loanRate: 3.5, downPct: 30 },
  labels: L({ stateTransfer: 'ITP transfer tax', cityTransfer: 'Notary & land registry' }),
  rates: mk({
    currency: '€',
    stateTransferRes: flat(10), stateTransferComm: flat(10),
    cityTransferRes: flat(1.5), cityTransferComm: flat(1.5),
    fedLTCG: 19, fedOrdinary: 24,
    depLifeResidential: 33.33, depLifeCommercial: 33.33
  })
},

'pt': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Portugal', region: 'Western Europe',
  notes: 'From 2026 non-residents pay a flat 7.5% IMT regardless of value, instead of the progressive resident scale that runs 1–8%. Stamp duty (Imposto do Selo) adds 0.8%. Capital gains for non-residents are taxed at a flat 28%, though you may elect the progressive scale with 50% of the gain excluded. Rental income is taxed at a flat 28%. Annual IMI of 0.3–0.45% of rateable value belongs in operating expenses. Individuals cannot depreciate the building against category F rental income.',
  sample: { price: 380000, rentMo: 1600, propTaxYr: 1300, insuranceYr: 350, hoaMo: 90, otherOpexYr: 700, capexTotal: 12000, loanRate: 3.4, downPct: 30 },
  labels: L({ stateTransfer: 'IMT (non-resident flat rate)', cityTransfer: 'Stamp duty (Imposto do Selo)' }),
  rates: mk({
    currency: '€',
    stateTransferRes: flat(7.5), stateTransferComm: flat(7.5),
    cityTransferRes: flat(0.8), cityTransferComm: flat(0.8),
    fedLTCG: 28, fedOrdinary: 28,
    depLifeResidential: NO_DEP, depLifeCommercial: NO_DEP
  })
},

'fr': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'France', region: 'Western Europe',
  notes: 'Droits de mutation at 6.32% — most départements took up the 2025–2028 option to raise the rate from 5.81% — plus notaire fees and disbursements of roughly 1.2%, together the "frais de notaire" of about 7.5%. Non-resident capital gains are 19% income tax plus 17.2% social charges = 36.2%, tapering to exempt at 22 years for income tax and 30 years for social charges. The taper between years 6 and 21 is gradual; the preset approximates it in three steps, so mid-hold figures are rough. Rental income for non-residents carries a 20% minimum rate plus social charges. Depreciation is unavailable for unfurnished lettings — it exists only under the furnished LMNP régime réel.',
  sample: { price: 400000, rentMo: 1500, propTaxYr: 1400, insuranceYr: 400, hoaMo: 180, otherOpexYr: 900, capexTotal: 15000, loanRate: 3.6, downPct: 25 },
  labels: L({ stateTransfer: 'Droits de mutation (DMTO)', cityTransfer: 'Notaire fees & disbursements' }),
  rates: mk({
    currency: '€',
    stateTransferRes: flat(6.32), stateTransferComm: flat(6.32),
    cityTransferRes: flat(1.2), cityTransferComm: flat(1.2),
    cgtByYears: [{ min: 0, rate: 36.2 }, { min: 22, rate: 9 }, { min: 30, rate: 0 }],
    fedLTCG: 36.2, fedOrdinary: 37.2,
    depLifeResidential: NO_DEP, depLifeCommercial: NO_DEP
  })
},

'de': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Germany — Berlin', region: 'Western Europe',
  notes: 'Grunderwerbsteuer is set by Land and ranges 3.5% (Bavaria) to 6.5% (NRW, Brandenburg, Saarland, Schleswig-Holstein, Thuringia); Berlin is 6%. Notary and land registry add roughly 1.75%. The big rule is the Spekulationsfrist: sell after more than ten years and the gain is entirely tax free, sell inside ten years and it is taxed at your marginal rate — 42% plus the 5.5% solidarity surcharge here. Rental income is taxed on the same progressive scale. AfA depreciation is 2% a year on buildings completed from 1925 (50 years); new builds completed after 2022 get 3%, so set 33.3 years for those.',
  sample: { price: 450000, rentMo: 1450, propTaxYr: 600, insuranceYr: 400, hoaMo: 250, otherOpexYr: 900, capexTotal: 15000, loanRate: 3.7, downPct: 30 },
  labels: L({ stateTransfer: 'Grunderwerbsteuer', cityTransfer: 'Notary & land registry' }),
  rates: mk({
    currency: '€',
    stateTransferRes: flat(6), stateTransferComm: flat(6),
    cityTransferRes: flat(1.75), cityTransferComm: flat(1.75),
    cgtByYears: [{ min: 0, rate: 44.31 }, { min: 10, rate: 0 }],
    fedLTCG: 44.31, fedOrdinary: 44.31,
    depLifeResidential: 50, depLifeCommercial: 33.33
  })
},

'nl': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Netherlands', region: 'Western Europe',
  notes: 'Transfer tax for investors and second homes fell from 10.4% to 8% on 1 January 2026 (owner-occupiers pay 2%). The Dutch system does not tax actual rental income or actual capital gains for private investors — instead Box 3 levies tax on a notional return of about 7.78% of asset value at 36%, an annual charge of roughly 2.8% of the property\'s value. That has no equivalent in this model, so the income and gains rates are set to zero and you should enter about 2.8% of value as an annual operating expense. Box 3 is under reform following Supreme Court rulings; check the current position.',
  sample: { price: 420000, rentMo: 1600, propTaxYr: 500, insuranceYr: 350, hoaMo: 160, otherOpexYr: 11800, capexTotal: 15000, loanRate: 4.2, downPct: 35 },
  labels: L({ stateTransfer: 'Overdrachtsbelasting (investor rate)', cityTransfer: 'Notary & registry' }),
  rates: mk({
    currency: '€',
    stateTransferRes: flat(8), stateTransferComm: flat(8),
    cityTransferRes: flat(1.2), cityTransferComm: flat(1.2),
    depLifeResidential: NO_DEP, depLifeCommercial: NO_DEP
  })
},

/* ========================= ASIA-PACIFIC ========================= */
'sg': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Singapore', region: 'Asia-Pacific',
  notes: 'Buyer\'s Stamp Duty runs 1–6% on marginal bands, and foreigners pay Additional Buyer\'s Stamp Duty of 60% on top of it — the single steepest foreign-buyer charge in this list. Seller\'s Stamp Duty applies to disposals within four years for property bought on or after 4 July 2025, at 16/12/8/4% by year held, and the model applies it automatically from your hold period. Singapore has no capital gains tax. Non-resident rental income is taxed at 24%. Annual property tax on annual value belongs in operating expenses, and residential buildings are not depreciable.',
  sample: { price: 1800000, rentMo: 5500, propTaxYr: 12000, insuranceYr: 800, hoaMo: 350, otherOpexYr: 2000, capexTotal: 25000, loanRate: 3.2, downPct: 25 },
  labels: L({ stateTransfer: 'Buyer\'s Stamp Duty (BSD)', mansion: 'ABSD — foreigner surcharge' }),
  rates: mk({
    currency: 'S$',
    stateTransferRes: [{ min: 0, rate: 1 }, { min: 180000, rate: 2 }, { min: 360000, rate: 3 },
                       { min: 1000000, rate: 4 }, { min: 1500000, rate: 5 }, { min: 3000000, rate: 6 }],
    stateTransferComm: [{ min: 0, rate: 1 }, { min: 180000, rate: 2 }, { min: 640000, rate: 3 }],
    mansion: flat(60),
    sellerDutyByYears: [{ min: 0, rate: 16 }, { min: 1, rate: 12 }, { min: 2, rate: 8 },
                        { min: 3, rate: 4 }, { min: 4, rate: 0 }],
    fedOrdinary: 24,
    depLifeResidential: NO_DEP, depLifeCommercial: NO_DEP
  })
},

'au-nsw': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Australia — NSW', region: 'Asia-Pacific',
  notes: 'NSW transfer duty on indexed marginal bands from 1.25% to 7%, with the premium rate starting above $3.87M, plus 9% surcharge purchaser duty for foreign buyers. Foreign residents do not get the 50% CGT discount and are taxed at non-resident marginal rates with no tax-free threshold — 37% is used here as a mid-band figure. Since January 2025 the purchaser withholds 15% of the gross price on any sale by a foreign resident, with no minimum value. Division 43 capital works deduction is 2.5% a year over 40 years and only on qualifying construction. Annual land tax surcharges for foreign owners are not modelled — put them in operating expenses. Duty schedules differ in every state.',
  sample: { price: 950000, rentMo: 2800, propTaxYr: 3000, insuranceYr: 1600, hoaMo: 700, otherOpexYr: 1500, capexTotal: 20000, loanRate: 6.1, downPct: 30 },
  labels: L({ stateTransfer: 'NSW transfer duty', mansion: 'Surcharge purchaser duty (foreign)' }),
  rates: mk({
    currency: 'A$',
    stateTransferRes: [{ min: 0, rate: 1.25 }, { min: 18000, rate: 1.5 }, { min: 38000, rate: 1.75 },
                       { min: 103000, rate: 3.5 }, { min: 387000, rate: 4.5 },
                       { min: 1290000, rate: 5.5 }, { min: 3870000, rate: 7 }],
    stateTransferComm: [{ min: 0, rate: 1.25 }, { min: 18000, rate: 1.5 }, { min: 38000, rate: 1.75 },
                        { min: 103000, rate: 3.5 }, { min: 387000, rate: 4.5 },
                        { min: 1290000, rate: 5.5 }, { min: 3870000, rate: 7 }],
    mansion: flat(9),
    fedLTCG: 37, fedOrdinary: 37,
    depLifeResidential: 40, depLifeCommercial: 40
  })
},

'jp': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Japan', region: 'Asia-Pacific',
  notes: 'Real estate acquisition tax of about 3% plus registration licence tax, judicial scrivener and stamp duty of roughly 1.5%. The five-year line drives everything on exit: sell in year five or earlier and the combined rate is 39.63% (30.63% for non-residents, who pay the national component only); hold beyond five years and it drops to 20.315% (15.315% non-resident). The model applies this automatically from your hold period. The buyer withholds 10.21% of the gross price on a non-resident sale. Reinforced-concrete buildings depreciate over 47 years; wooden structures over 22. Annual fixed asset tax of about 1.7% belongs in operating expenses.',
  sample: { price: 45000000, rentMo: 180000, propTaxYr: 700000, insuranceYr: 40000, hoaMo: 25000, otherOpexYr: 120000, capexTotal: 1500000, loanRate: 2.0, downPct: 30 },
  labels: L({ stateTransfer: 'Real estate acquisition tax', cityTransfer: 'Registration & scrivener' }),
  rates: mk({
    currency: '¥',
    stateTransferRes: flat(3), stateTransferComm: flat(4),
    cityTransferRes: flat(1.5), cityTransferComm: flat(1.5),
    cgtByYears: [{ min: 0, rate: 30.63 }, { min: 5, rate: 15.315 }],
    fedLTCG: 15.315, fedOrdinary: 20.42,
    depLifeResidential: 47, depLifeCommercial: 47
  })
},

'hk': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Hong Kong', region: 'Asia-Pacific',
  notes: 'Ad valorem stamp duty on Scale 2 only: nothing meaningful below HK$4M (a flat HK$100), then 1.5% rising to 4.25%. These are whole-value rates with marginal-relief transition bands at each threshold that the model simplifies away, so figures just above a threshold are overstated. Buyer\'s Stamp Duty, the Double/New Residential rates for non-permanent residents and Special Stamp Duty were all abolished in February 2024, so foreign buyers now pay the same as residents. Hong Kong has no capital gains tax. Property tax is 15% on 80% of rental income, an effective 12% of gross rent.',
  sample: { price: 8000000, rentMo: 22000, propTaxYr: 5000, insuranceYr: 4000, hoaMo: 3500, otherOpexYr: 12000, capexTotal: 150000, loanRate: 4.0, downPct: 40 },
  labels: L({ stateTransfer: 'Ad valorem stamp duty (Scale 2)' }),
  rates: mk({
    currency: 'HK$', marginalBrackets: false,
    stateTransferRes: [{ min: 0, rate: 0 }, { min: 4000000, rate: 1.5 }, { min: 4500000, rate: 2.25 },
                       { min: 6000000, rate: 3 }, { min: 9000000, rate: 3.75 },
                       { min: 20000000, rate: 4.25 }],
    stateTransferComm: [{ min: 0, rate: 0 }, { min: 4000000, rate: 1.5 }, { min: 4500000, rate: 2.25 },
                        { min: 6000000, rate: 3 }, { min: 9000000, rate: 3.75 },
                        { min: 20000000, rate: 4.25 }],
    fedOrdinary: 15,
    depLifeResidential: NO_DEP, depLifeCommercial: 25
  })
},

'nz': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'New Zealand', region: 'Asia-Pacific',
  notes: 'No stamp duty and no general capital gains tax. The bright-line test is the exception: sell within two years of acquisition and the gain is ordinary income at your marginal rate, up to 39%; sell after two years and it is untaxed. The model applies this from your hold period. Depreciation on residential buildings has been zero since April 2024, though chattels and fit-out still depreciate. Full mortgage interest deductibility was restored from the 2025-26 year. Foreign buyers are largely barred from buying existing residential property under the Overseas Investment Act.',
  sample: { price: 800000, rentMo: 2600, propTaxYr: 3200, insuranceYr: 2200, hoaMo: 0, otherOpexYr: 1500, capexTotal: 18000, loanRate: 5.6, downPct: 35 },
  labels: L({ stateTransfer: 'Transfer duty (none in NZ)' }),
  rates: mk({
    currency: 'NZ$',
    cgtByYears: [{ min: 0, rate: 39 }, { min: 2, rate: 0 }],
    fedLTCG: 39, fedOrdinary: 39,
    depLifeResidential: NO_DEP, depLifeCommercial: NO_DEP
  })
},

/* ========================= AMERICAS ========================= */
'ca-on': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Canada — Toronto, Ontario', region: 'Americas',
  notes: 'Ontario provincial land transfer tax plus Toronto\'s municipal land transfer tax, both on marginal bands, so a Toronto purchase pays roughly double the provincial figure. The buyer-duty slot carries the combined foreign-buyer charge: Ontario\'s Non-Resident Speculation Tax at 25% province-wide, plus Toronto\'s own 10% municipal NRST from January 2025 — 35% together. Capital gains use a 50% inclusion rate at marginal rates, an effective 26.8% at the top Ontario bracket. Non-residents face 25% withholding on gross rent unless they elect section 216, and a section 116 clearance certificate on sale. CCA depreciation is 4% declining balance, approximated here as 25-year straight line; note CCA cannot create a rental loss and is fully recaptured on sale.',
  sample: { price: 900000, rentMo: 3200, propTaxYr: 6500, insuranceYr: 1800, hoaMo: 650, otherOpexYr: 1500, capexTotal: 20000, loanRate: 4.9, downPct: 35 },
  labels: L({ stateTransfer: 'Ontario land transfer tax', cityTransfer: 'Toronto municipal LTT',
              mansion: 'Non-Resident Speculation Tax (ON 25% + Toronto 10%)' }),
  rates: mk({
    currency: 'C$',
    stateTransferRes: [{ min: 0, rate: 0.5 }, { min: 55000, rate: 1 }, { min: 250000, rate: 1.5 },
                       { min: 400000, rate: 2 }, { min: 2000000, rate: 2.5 }],
    stateTransferComm: [{ min: 0, rate: 0.5 }, { min: 55000, rate: 1 }, { min: 250000, rate: 1.5 },
                        { min: 400000, rate: 2 }],
    cityTransferRes: [{ min: 0, rate: 0.5 }, { min: 55000, rate: 1 }, { min: 250000, rate: 1.5 },
                      { min: 400000, rate: 2 }, { min: 2000000, rate: 2.5 }, { min: 3000000, rate: 4.4 },
                      { min: 4000000, rate: 5.45 }, { min: 5000000, rate: 6.5 },
                      { min: 10000000, rate: 7.55 }, { min: 20000000, rate: 8.6 }],
    cityTransferComm: [{ min: 0, rate: 0.5 }, { min: 55000, rate: 1 }, { min: 250000, rate: 1.5 },
                       { min: 400000, rate: 2 }],
    mansion: flat(35),
    fedLTCG: 26.77, recapture: 53.53, fedOrdinary: 25,
    depLifeResidential: 25, depLifeCommercial: 25
  })
},

'mx': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Mexico', region: 'Americas',
  notes: 'Acquisition tax (ISAI) is municipal and runs 2–5%; 2% is used here. Notary, appraisal and registry add roughly 4–5% in total, so budget 6–7% all-in. A non-resident seller chooses between 25% of the gross sale price with no deductions, or 35% of the net gain with a Mexican legal representative and proper invoices — the preset uses the 35% net-gain option, which usually wins on a modest gain but loses on a large one. Rental income for non-residents is withheld at 25% of gross. Construction depreciates at 5% a year. Foreigners buying in the restricted coastal and border zones must hold through a fideicomiso bank trust, which carries annual fees.',
  sample: { price: 4500000, rentMo: 22000, propTaxYr: 6000, insuranceYr: 9000, hoaMo: 3500, otherOpexYr: 18000, capexTotal: 120000, loanRate: 10.5, downPct: 50 },
  labels: L({ stateTransfer: 'Acquisition tax (ISAI)', cityTransfer: 'Notary & registry' }),
  rates: mk({
    currency: 'MX$',
    stateTransferRes: flat(2), stateTransferComm: flat(2),
    cityTransferRes: flat(0.5), cityTransferComm: flat(0.5),
    fedLTCG: 35, fedOrdinary: 25,
    depLifeResidential: 20, depLifeCommercial: 20
  })
},

'br': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Brazil — São Paulo', region: 'Americas',
  notes: 'ITBI transfer tax is municipal, 3% in São Paulo and 2–3% elsewhere, plus notary and registry fees of roughly 1.2%. Capital gains for individuals are progressive: 15% up to R$5M, then 17.5%, 20% and 22.5% on higher slices — only the 15% first band is applied here, so gains above R$5M are understated. Non-resident rental income is withheld at 15% of gross. Individuals cannot depreciate residential property against rental income.',
  sample: { price: 900000, rentMo: 4500, propTaxYr: 6000, insuranceYr: 1500, hoaMo: 900, otherOpexYr: 3000, capexTotal: 30000, loanRate: 11.0, downPct: 40 },
  labels: L({ stateTransfer: 'ITBI transfer tax', cityTransfer: 'Notary & registry (cartório)' }),
  rates: mk({
    currency: 'R$',
    stateTransferRes: flat(3), stateTransferComm: flat(3),
    cityTransferRes: flat(1.2), cityTransferComm: flat(1.2),
    fedLTCG: 15, fedOrdinary: 15,
    depLifeResidential: NO_DEP, depLifeCommercial: NO_DEP
  })
},

/* ========================= GENERIC ========================= */
'intl': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Generic / blank slate', region: 'Build your own',
  notes: 'Every rate zeroed. Start here for a jurisdiction not on the list: set the currency symbol, add the stamp duty bands, choose whether brackets are marginal or whole-price, and fill in the capital gains and rental income rates. Use the holding-period tables if the country rates gains by how long you held, and set the recovery period to a very large number where no depreciation relief exists.',
  sample: { price: 500000, rentMo: 2500, propTaxYr: 3000, insuranceYr: 1200, hoaMo: 200, otherOpexYr: 1000, capexTotal: 15000, loanRate: 6, downPct: 30 },
  labels: L(),
  rates: mk({})
}

};

/* ---------------------------------------------------------------------------
   Verification metadata. Applied to every preset above so the UI can always
   show the user how much weight a preset's numbers can carry.
   --------------------------------------------------------------------------- */

const VERIFICATION = {
  'us-nyc': {
    status: 'checked',
    taxYear: 2026,
    verified: '2026-08-22',
    verification: {
      transferAndTransactionTaxes: 'primary',
      federalIncomeAndGains: 'primary',
      newYorkIncomeBrackets: 'secondary',
      professionalReview: 'none',
    },
    sources: [
      { label: 'NYS Tax Dept — Real estate transfer tax', url: 'https://www.tax.ny.gov/bus/transfer/rptidx.htm' },
      { label: 'NYS Tax Dept — Additional (mansion) tax on residential conveyances', url: 'https://www.tax.ny.gov/bus/transfer/rptmansion.htm' },
      { label: 'NYC Dept of Finance — Real Property Transfer Tax (RPTT)', url: 'https://www.nyc.gov/site/finance/property/property-real-property-transfer-tax-rptt.page' },
      { label: 'NYS Tax Dept — Mortgage recording tax', url: 'https://www.tax.ny.gov/bus/transfer/mortgage.htm' },
      { label: 'IRS Publication 527 — Residential Rental Property', url: 'https://www.irs.gov/publications/p527' },
      { label: 'IRS Publication 925 — Passive Activity and At-Risk Rules', url: 'https://www.irs.gov/publications/p925' },
      { label: 'IRS Topic 409 — Capital gains and losses', url: 'https://www.irs.gov/taxtopics/tc409' },
      { label: 'IRS — Net Investment Income Tax (\u00a71411)', url: 'https://www.irs.gov/individuals/net-investment-income-tax' },
      { label: 'IRS — Like-Kind Exchanges (\u00a71031), Form 8824', url: 'https://www.irs.gov/forms-pubs/about-form-8824' },
      { label: 'NYC Dept of Finance — Personal income tax rates', url: 'https://www.nyc.gov/site/finance/taxes/business-nyc-personal-income-tax.page' }
    ],
    omissions: [
      'IT-2663 nonresident estimated income tax on the sale of NY real property.',
      '\u00a7121 principal-residence exclusion (this is an investment-property model).',
      'Grossing-up of consideration when the buyer pays the seller\u2019s NY transfer tax.',
      'NY real estate professional (REP) status under \u00a7469(c)(7).',
      'The \u00a7469 $25,000 active-participation allowance and its MAGI phase-out.',
      'The \u00a7199A qualified business income deduction.',
      'Depreciation recapture is applied at a flat 25% cap; the actual \u00a71250 rate is the lesser of 25% and your marginal rate.',
      'Federal and NY tax brackets are entered as single marginal rates, not full bracket tables.',
      'The SALT deduction and any state deduction for federal tax.',
      'Alternative Minimum Tax, and entity-level tax for corporate owners.'
    ]
  },
  'us-nys': {
    status: 'checked',
    taxYear: 2026,
    verified: '2026-08-22',
    verification: {
      transferAndTransactionTaxes: 'primary',
      federalIncomeAndGains: 'primary',
      newYorkIncomeBrackets: 'secondary',
      professionalReview: 'none',
    },
    sources: [
      { label: 'NYS Tax Dept — Real estate transfer tax', url: 'https://www.tax.ny.gov/bus/transfer/rptidx.htm' },
      { label: 'NYS Tax Dept — Additional (mansion) tax', url: 'https://www.tax.ny.gov/bus/transfer/rptmansion.htm' },
      { label: 'NYS Tax Dept — Mortgage recording tax', url: 'https://www.tax.ny.gov/bus/transfer/mortgage.htm' },
      { label: 'IRS Publication 527 — Residential Rental Property', url: 'https://www.irs.gov/publications/p527' },
      { label: 'IRS Publication 925 — Passive Activity and At-Risk Rules', url: 'https://www.irs.gov/publications/p925' }
    ],
    omissions: [
      'County mortgage recording tax varies; 1.0% is a typical non-MTA figure and must be checked locally.',
      'Some counties and towns levy their own transfer tax (for example Peconic Bay towns).',
      'Everything listed as omitted for New York City also applies here.'
    ]
  }
};

const EXPERIMENTAL_NOTE =
  'Experimental preset. Researched from public sources but not independently ' +
  'verified, and the engine cannot express every local rule \u2014 read the notes ' +
  'before relying on any figure. Confirm rates with a local adviser.';

for (const [key, preset] of Object.entries(PRESETS)) {
  const v = VERIFICATION[key];
  if (v) {
    Object.assign(preset, v);
  } else {
    preset.status = key === 'intl' ? 'blank' : 'experimental';
    preset.taxYear = 2026;
    preset.verified = '2026-08-21';
    preset.sources = preset.sources || [];
    preset.omissions = preset.omissions || [EXPERIMENTAL_NOTE];
  }
}

export const REGIONS = ['United States', 'Gulf & South Asia', 'Western Europe',
  'Asia-Pacific', 'Americas', 'Build your own'];

export { PRESETS, L_US, NO_DEP };
