// Run with: node --test tests/billing-calc.test.js
// Expected figures are copied from the printed SEP-2026 bills (Villa_*.pdf).
const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../js/billing-calc.js');

test('electric — SEP-2026 bill (K1 > K2, no K3)', () => {
    const r = Calc.calculateElectric({ k1Prev: 12501, k1Curr: 13043, k2Prev: 14791, k2Curr: 15289 });
    assert.deepEqual(r.units, { k1Units: 542, k2Units: 498, k2Adjusted: 498, k3Units: 0 });
    assert.equal(r.amounts.k1Amount, 46048);
    assert.equal(r.amounts.k2Amount, 24900);
    assert.equal(r.amounts.k3Amount, 0);
    assert.equal(r.amounts.currentBill, 21148);
    assert.equal(r.withinDue, 24148);
    assert.equal(r.lateSurcharge, 2415);
    assert.equal(r.afterDue, 26563);
});

test('electric — K2 > K1: K2 capped at K1, surplus goes to K3', () => {
    const r = Calc.calculateElectric({ k1Prev: 0, k1Curr: 300, k2Prev: 0, k2Curr: 500 });
    assert.deepEqual(r.units, { k1Units: 300, k2Units: 500, k2Adjusted: 300, k3Units: 200 });
    assert.equal(r.amounts.k1Amount, 25488);   // 300 × 84.96
    assert.equal(r.amounts.k2Amount, 15000);   // 300 × 50
    assert.equal(r.amounts.k3Amount, 4484);    // 200 × 22.42
    assert.equal(r.amounts.netEnergy, 6004);
    assert.equal(r.withinDue, 9004);
});

test('electric — negative net: only O&M payable, credit carried forward', () => {
    const r = Calc.calculateElectric({ k1Prev: 0, k1Curr: 100, k2Prev: 0, k2Curr: 1000 });
    // 8,496 − (5,000 + 20,178) = −16,682
    assert.equal(r.amounts.netEnergy, -16682);
    assert.equal(r.amounts.currentBill, 0);
    assert.equal(r.amounts.creditForward, 16682);
    assert.equal(r.withinDue, 3000);
    assert.equal(r.notes.length, 1);
});

test('electric — Prev. Bill Amt and QTR credits reduce Total Amt Payable', () => {
    // SEP-2026 readings (Total Amount 21,148) with 5,000 + 1,148 credit
    const r = Calc.calculateElectric({
        k1Prev: 12501, k1Curr: 13043, k2Prev: 14791, k2Curr: 15289, prevBillCredit: 5000, qtr2: 1148
    });
    assert.equal(r.amounts.totalPayable, 15000);
    assert.equal(r.amounts.creditForward, 0);
    assert.equal(r.withinDue, 18000);
});

test('electric — credit larger than bill: remainder carries forward again', () => {
    const r = Calc.calculateElectric({
        k1Prev: 12501, k1Curr: 13043, k2Prev: 14791, k2Curr: 15289, prevBillCredit: 30000
    });
    assert.equal(r.amounts.totalPayable, -8852);
    assert.equal(r.amounts.creditForward, 8852);
    assert.equal(r.withinDue, 3000);
});

test('water — SEP-2026 bill', () => {
    const r = Calc.calculateWater({ prev: 1402, curr: 1439 });
    assert.equal(r.units.units, 37);
    assert.equal(r.units.gallons, 9768);
    assert.equal(r.amounts.waterAmount, 7326);
    assert.equal(r.amounts.sewerage, 2247);
    assert.equal(r.withinDue, 11573);
    assert.equal(r.lateSurcharge, 1157);
    assert.equal(r.afterDue, 12730);
});

test('water — matches bill history for AUG/JUL/JUN/MAY-2026', () => {
    // [m³ consumed, billed amount] — m³ back-solved from the billing history table
    [[70, 20110], [44, 13384], [43, 13125], [32, 10279]].forEach(([m3, billed]) => {
        assert.equal(Calc.calculateWater({ prev: 0, curr: m3 }).withinDue, billed);
    });
});

test('maintenance — SEP-2026 bill', () => {
    const r = Calc.calculateMaintenance({});
    assert.equal(r.withinDue, 8009);
    assert.equal(r.lateSurcharge, 801);
    assert.equal(r.afterDue, 8810);
});

test('all — SEP-2026 total', () => {
    const r = Calc.calculateAll({
        electric: { k1Prev: 12501, k1Curr: 13043, k2Prev: 14791, k2Curr: 15289 },
        water: { prev: 1402, curr: 1439 },
        maintenance: {}
    });
    assert.equal(r.total.withinDue, 24148 + 11573 + 8009);
    assert.equal(r.total.afterDue, 26563 + 12730 + 8810);
});
