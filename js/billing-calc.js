/**
 * BTK Bills — calculation logic.
 *
 * Pure functions only: no DOM, no jQuery, no localStorage. Every function takes
 * a plain object of inputs and returns the computed figures plus a `steps` list
 * that explains how each figure was reached (the UI renders those steps as-is).
 *
 * Works in the browser (window.BillingCalc) and in Node (require) for tests.
 *
 * Rounding: Bahria rounds every line amount to whole rupees before adding them
 * up, so each line is rounded with Math.round() — this is what makes the totals
 * match the printed bills exactly.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BillingCalc = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Defaults taken from the SEP-2026 bills (issued 01-Oct-2026).
    const DEFAULTS = {
        electric: {
            k1Prev: 0, k1Curr: 0, k1Rate: 84.96,     // K1: units imported from K-Electric
            k2Prev: 0, k2Curr: 0, k2Rate: 50,        // K2: solar units exported (adjusted against K1)
            k3Rate: 22.42,                           // K3: surplus solar bought back at NEPRA-PPA rate
            prevBillCredit: 0,                       // Prev. Bill Amt — solar credit carried from last month
            qtr1: 0, qtr2: 0, qtr3: 0, qtr4: 0,      // QTR-1..4 — quarterly solar credits
            omCharges: 3000,                        // O & M Charges (was "Fixed Charges" in the old app)
            disconnectionCharges: 0,
            arrears: 0,
            advance: 0,                              // Advance (Cash) — a credit, deducted
            latePct: 10
        },
        water: {
            prev: 0, curr: 0,                        // meter readings in m³
            gallonsPerUnit: 264,                     // "PER GALLON" on the bill: gallons per m³
            ratePerGallon: 0.75,
            sewerageRatePerGallon: 0.23,
            pumpingCharges: 2000,                    // Water Pumping & Services Charges
            bowserCharges: 0,
            omApartments: 0,
            omShops: 0,
            adjustment: 0,
            arrears: 0,
            fine: 0,
            arrearsInstallment: 0,
            wallet: 0,                               // credit, deducted
            latePct: 10
        },
        maintenance: {
            billAmount: 8009,                        // flat monthly charge
            hortiCharges: 0,
            arrears: 0,
            fine: 0,
            arrearsInstallment: 0,
            wallet: 0,                               // credit, deducted
            latePct: 10
        }
    };

    function num(value) {
        const n = parseFloat(value);
        return isFinite(n) ? n : 0;
    }

    function round(value) {
        return Math.round(value);
    }

    function fmt(value) {
        return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
    }

    function withDefaults(type, input) {
        const out = {};
        Object.keys(DEFAULTS[type]).forEach(key => {
            const raw = input ? input[key] : undefined;
            out[key] = raw === undefined || raw === null || raw === '' ? DEFAULTS[type][key] : num(raw);
        });
        return out;
    }

    // Late payment surcharge = latePct% of the "within due date" amount, rounded.
    function latePayment(withinDue, latePct) {
        return round(Math.max(withinDue, 0) * latePct / 100);
    }

    // kind: 'units' (no currency), 'money', 'credit' (deducted), 'subtotal', 'total'
    function step(label, formula, value, kind) {
        return { label, formula, value, kind: kind || 'money' };
    }

    // Adds a step for an optional charge/credit only when it is non-zero.
    function optional(steps, label, value, kind) {
        if (value) steps.push(step(label, '', value, kind));
    }

    function dueSteps(steps, withinDue, latePct, lateSurcharge, afterDue) {
        steps.push(step('Payable within due date', '', withinDue, 'total'));
        steps.push(step('Late payment surcharge', `${fmt(latePct)}% × ${fmt(withinDue)}`, lateSurcharge));
        steps.push(step('Payable after due date', `${fmt(withinDue)} + ${fmt(lateSurcharge)}`, afterDue, 'total'));
    }

    /**
     * Electricity (Net Meter, solar).
     *
     *   K1 units  = K1 current − K1 previous                (imported from grid)
     *   K2 units  = K2 current − K2 previous                (solar exported)
     *   K2 adj.   = min(K1, K2)                             (solar credited at K2 rate)
     *   K3 units  = max(K2 − K1, 0)                         (surplus credited at NEPRA-PPA rate)
     *   Total Amount     = K1 amount − (K2 amount + K3 amount)
     *   Total Amt Payable = Total Amount − (Prev. Bill Amt + QTR-1..4 credits)
     *   Current          = max(Total Amt Payable, 0)
     *   Credit forward   = max(−Total Amt Payable, 0)      (becomes next month's Prev. Bill Amt)
     *   Within due       = Current + O&M + disconnection + arrears − advance
     */
    function calculateElectric(input) {
        const v = withDefaults('electric', input);

        const k1Units = Math.max(v.k1Curr - v.k1Prev, 0);
        const k2Units = Math.max(v.k2Curr - v.k2Prev, 0);
        // Bahria caps the solar adjustment at what was consumed (K2 adjusted = K1)...
        const k2Adjusted = Math.min(k1Units, k2Units);
        // ...and the remaining solar units go to K3 at the NEPRA-PPA rate.
        const k3Units = Math.max(k2Units - k1Units, 0);

        const k1Amount = round(k1Units * v.k1Rate);
        const k2Amount = round(k2Adjusted * v.k2Rate);
        const k3Amount = round(k3Units * v.k3Rate);

        const netEnergy = k1Amount - (k2Amount + k3Amount);
        const carriedCredit = v.prevBillCredit + v.qtr1 + v.qtr2 + v.qtr3 + v.qtr4;
        const totalPayable = netEnergy - carriedCredit;
        const currentBill = Math.max(totalPayable, 0);
        // Unused solar credit is not refunded; it carries to next month's Prev. Bill Amt.
        const creditForward = Math.max(-totalPayable, 0);

        const withinDue = currentBill + v.omCharges + v.disconnectionCharges + v.arrears - v.advance;
        const lateSurcharge = latePayment(withinDue, v.latePct);
        const afterDue = withinDue + lateSurcharge;

        const steps = [
            step('K1 units consumed', `${fmt(v.k1Curr)} − ${fmt(v.k1Prev)}`, k1Units, 'units'),
            step('K2 units generated (solar)', `${fmt(v.k2Curr)} − ${fmt(v.k2Prev)}`, k2Units, 'units'),
            step('K2 units adjusted', `min(K1 ${fmt(k1Units)}, K2 ${fmt(k2Units)})`, k2Adjusted, 'units'),
            step('K3 units (surplus solar)', `max(K2 ${fmt(k2Units)} − K1 ${fmt(k1Units)}, 0)`, k3Units, 'units'),
            step('Amount (K1)', `${fmt(k1Units)} × ${fmt(v.k1Rate)}`, k1Amount),
            step('Amount (K2)', `${fmt(k2Adjusted)} × ${fmt(v.k2Rate)}`, k2Amount, 'credit'),
            step('Amount (K3)', `${fmt(k3Units)} × ${fmt(v.k3Rate)}`, k3Amount, 'credit'),
            step('Total amount: K1 − (K2 + K3)', `${fmt(k1Amount)} − (${fmt(k2Amount)} + ${fmt(k3Amount)})`, netEnergy, 'subtotal')
        ];
        optional(steps, 'Prev. Bill Amt (credit)', v.prevBillCredit, 'credit');
        ['qtr1', 'qtr2', 'qtr3', 'qtr4'].forEach((key, i) => optional(steps, `QTR-${i + 1} (credit)`, v[key], 'credit'));
        if (carriedCredit) {
            steps.push(step('Total amt payable', `${fmt(netEnergy)} − ${fmt(carriedCredit)}`, totalPayable, 'subtotal'));
        }
        if (totalPayable < 0) {
            steps.push(step('Net amount of current bill', 'negative → 0, credit carried forward', currentBill, 'subtotal'));
        }
        steps.push(step('O & M charges', '', v.omCharges));
        optional(steps, 'Disconnection charges', v.disconnectionCharges);
        optional(steps, 'Arrears', v.arrears);
        optional(steps, 'Advance (cash)', v.advance, 'credit');
        dueSteps(steps, withinDue, v.latePct, lateSurcharge, afterDue);

        const notes = [];
        if (creditForward) {
            notes.push(`Solar credit exceeds this month's charges. Rs ${fmt(creditForward)} carries forward as next month's Prev. Bill Amt; this month you pay only the O & M charges.`);
        }

        return {
            inputs: v,
            units: { k1Units, k2Units, k2Adjusted, k3Units },
            amounts: { k1Amount, k2Amount, k3Amount, netEnergy, carriedCredit, totalPayable, currentBill, creditForward },
            withinDue, lateSurcharge, afterDue, steps, notes
        };
    }

    /**
     * Water.
     *
     *   Units (m³) = present − previous
     *   Gallons    = units × gallonsPerUnit (264)
     *   Bill Amount = gallons × ratePerGallon (0.75)
     *   Sewerage   = gallons × sewerageRatePerGallon (0.23)
     *   Within due = Bill Amount + sewerage + pumping + bowser + O&M + adjustment
     *                + arrears + fine + installment − wallet
     */
    function calculateWater(input) {
        const v = withDefaults('water', input);

        const units = Math.max(v.curr - v.prev, 0);
        const gallons = units * v.gallonsPerUnit;
        const waterAmount = round(gallons * v.ratePerGallon);
        const sewerage = round(gallons * v.sewerageRatePerGallon);

        const withinDue = waterAmount + v.adjustment + v.bowserCharges + v.arrears + v.fine
            + v.arrearsInstallment + v.omApartments + v.omShops + v.pumpingCharges + sewerage - v.wallet;
        const lateSurcharge = latePayment(withinDue, v.latePct);
        const afterDue = withinDue + lateSurcharge;

        const steps = [
            step('Units consumed (m³)', `${fmt(v.curr)} − ${fmt(v.prev)}`, units, 'units'),
            step('Gallons', `${fmt(units)} × ${fmt(v.gallonsPerUnit)}`, gallons, 'units'),
            step('Bill amount (water)', `${fmt(gallons)} × ${fmt(v.ratePerGallon)}`, waterAmount),
            step('Sewerage charges', `${fmt(gallons)} × ${fmt(v.sewerageRatePerGallon)}`, sewerage),
            step('Water pumping & services charges', '', v.pumpingCharges)
        ];
        optional(steps, 'Adjustment', v.adjustment);
        optional(steps, 'Water bowser charges', v.bowserCharges);
        optional(steps, 'O & M charges (apartments)', v.omApartments);
        optional(steps, 'O & M charges (shops)', v.omShops);
        optional(steps, 'Arrears', v.arrears);
        optional(steps, 'Fine / DC charges', v.fine);
        optional(steps, 'Arrears installment', v.arrearsInstallment);
        optional(steps, 'Wallet', v.wallet, 'credit');
        dueSteps(steps, withinDue, v.latePct, lateSurcharge, afterDue);

        return {
            inputs: v,
            units: { units, gallons },
            amounts: { waterAmount, sewerage },
            withinDue, lateSurcharge, afterDue, steps, notes: []
        };
    }

    /**
     * Maintenance.
     *
     *   Within due = bill amount + horti + arrears + fine + installment − wallet
     */
    function calculateMaintenance(input) {
        const v = withDefaults('maintenance', input);

        const withinDue = v.billAmount + v.hortiCharges + v.arrears + v.fine + v.arrearsInstallment - v.wallet;
        const lateSurcharge = latePayment(withinDue, v.latePct);
        const afterDue = withinDue + lateSurcharge;

        const steps = [step('Bill amount', 'flat monthly charge', v.billAmount)];
        optional(steps, 'Horti charges', v.hortiCharges);
        optional(steps, 'Arrears', v.arrears);
        optional(steps, 'Fine', v.fine);
        optional(steps, 'Arrears installment', v.arrearsInstallment);
        optional(steps, 'Wallet', v.wallet, 'credit');
        dueSteps(steps, withinDue, v.latePct, lateSurcharge, afterDue);

        return { inputs: v, units: {}, amounts: {}, withinDue, lateSurcharge, afterDue, steps, notes: [] };
    }

    function calculateAll(month) {
        const electric = calculateElectric(month && month.electric);
        const water = calculateWater(month && month.water);
        const maintenance = calculateMaintenance(month && month.maintenance);
        const all = [electric, water, maintenance];
        return {
            electric, water, maintenance,
            total: {
                withinDue: all.reduce((sum, r) => sum + r.withinDue, 0),
                lateSurcharge: all.reduce((sum, r) => sum + r.lateSurcharge, 0),
                afterDue: all.reduce((sum, r) => sum + r.afterDue, 0)
            }
        };
    }

    return {
        DEFAULTS,
        calculateElectric,
        calculateWater,
        calculateMaintenance,
        calculateAll,
        format: fmt
    };
});
