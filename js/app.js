/**
 * BTK Bills — UI and storage. All calculations live in billing-calc.js.
 *
 * Each billing month is saved in localStorage as
 *   btk_month_YYYY-MM = { electric: {...}, water: {...}, maintenance: {...} }
 * Bills saved by the old electric-only app (bill_YYYY-MM-DD) are imported once.
 */
$(function () {
    const STORE_PREFIX = 'btk_month_';
    const LEGACY_PREFIX = 'bill_';
    const UTILITIES = ['electric', 'water', 'maintenance'];
    const NAMES = { electric: '⚡ Electric', water: '💧 Water', maintenance: '🛠️ Maintenance' };
    const D = BillingCalc.DEFAULTS;

    // Form layout per utility. A section is either always visible, or a collapsible
    // panel ('rates' = changes rarely, 'extras' = usually zero; opens itself when not).
    //   units  — result.units key shown as a badge next to the section title
    //   short  — label used in the collapsed 'rates' panel summary
    //   next   — how a field is pre-filled when starting a new month from the previous one:
    //     'keep'          copy last month's value (rates, fixed charges)
    //     'reset'         back to the default (one-off charges, credits)
    //     'clear'         leave empty (current meter readings)
    //     { from: key }   last month's value of another field (previous ← current reading)
    //     'creditForward' last month's unused electric solar credit (→ Prev. Bill Amt)
    const FORMS = {
        electric: [
            { title: 'K1 — Consumption (from K-Electric)', units: 'k1Units', unitLabel: 'units', fields: [
                { key: 'k1Prev', label: 'Previous Reading', reading: true, next: { from: 'k1Curr' } },
                { key: 'k1Curr', label: 'Current Reading', reading: true, next: 'clear' }
            ] },
            { title: 'K2 — Solar export', units: 'k2Units', unitLabel: 'units', fields: [
                { key: 'k2Prev', label: 'Previous Reading', reading: true, next: { from: 'k2Curr' } },
                { key: 'k2Curr', label: 'Current Reading', reading: true, next: 'clear' }
            ] },
            { title: 'Rates & fixed charges', panel: 'rates', fields: [
                { key: 'k1Rate', label: 'K1 Import Rate', short: 'K1', next: 'keep' },
                { key: 'k2Rate', label: 'K2 Adjustment Rate', short: 'K2', next: 'keep' },
                { key: 'k3Rate', label: 'K3 NEPRA-PPA Rate', short: 'K3', next: 'keep' },
                { key: 'omCharges', label: 'O & M Charges', short: 'O&M', next: 'keep' },
                { key: 'latePct', label: 'Late Surcharge %', next: 'keep' }
            ] },
            { title: 'Credits & extra charges', panel: 'extras', fields: [
                { key: 'prevBillCredit', label: 'Prev. Bill Amt', hint: 'Solar credit from last month', next: 'creditForward' },
                { key: 'qtr1', label: 'QTR-1', next: 'reset' },
                { key: 'qtr2', label: 'QTR-2', next: 'reset' },
                { key: 'qtr3', label: 'QTR-3', next: 'reset' },
                { key: 'qtr4', label: 'QTR-4', next: 'reset' },
                { key: 'advance', label: 'Advance (Cash)', next: 'reset' },
                { key: 'arrears', label: 'Arrears', next: 'reset' },
                { key: 'disconnectionCharges', label: 'Disconnection', next: 'reset' }
            ], note: 'Prev. Bill Amt, QTR and Advance are credits and are deducted.' }
        ],
        water: [
            { title: 'Water meter (m³)', units: 'units', unitLabel: 'm³', fields: [
                { key: 'prev', label: 'Previous Reading', reading: true, next: { from: 'curr' } },
                { key: 'curr', label: 'Present Reading', reading: true, next: 'clear' }
            ] },
            { title: 'Rates & fixed charges', panel: 'rates', fields: [
                { key: 'gallonsPerUnit', label: 'Gallons per m³', short: 'Gal/m³', next: 'keep' },
                { key: 'ratePerGallon', label: 'Water Rate / Gallon', short: 'Water', next: 'keep' },
                { key: 'sewerageRatePerGallon', label: 'Sewerage Rate / Gallon', short: 'Sewerage', next: 'keep' },
                { key: 'pumpingCharges', label: 'Pumping & Services', short: 'Pumping', next: 'keep' },
                { key: 'omApartments', label: 'O & M Apartments', next: 'keep' },
                { key: 'omShops', label: 'O & M Shops', next: 'keep' },
                { key: 'latePct', label: 'Late Surcharge %', next: 'keep' }
            ] },
            { title: 'Credits & extra charges', panel: 'extras', fields: [
                { key: 'wallet', label: 'Wallet', next: 'reset' },
                { key: 'adjustment', label: 'Adjustment', hint: 'Use minus for a credit', next: 'reset' },
                { key: 'arrears', label: 'Arrears', next: 'reset' },
                { key: 'arrearsInstallment', label: 'Arrears Installment', next: 'reset' },
                { key: 'fine', label: 'Fine / DC Charges', next: 'reset' },
                { key: 'bowserCharges', label: 'Water Bowser', next: 'reset' }
            ], note: 'Wallet is a credit and is deducted.' }
        ],
        maintenance: [
            { title: 'Monthly charge', fields: [
                { key: 'billAmount', label: 'Bill Amount', reading: true, next: 'keep' }
            ] },
            { title: 'Rates', panel: 'rates', fields: [
                { key: 'latePct', label: 'Late Surcharge %', short: 'Late %', next: 'keep' }
            ] },
            { title: 'Credits & extra charges', panel: 'extras', fields: [
                { key: 'wallet', label: 'Wallet', next: 'reset' },
                { key: 'arrears', label: 'Arrears', next: 'reset' },
                { key: 'arrearsInstallment', label: 'Arrears Installment', next: 'reset' },
                { key: 'fine', label: 'Fine', next: 'reset' },
                { key: 'hortiCharges', label: 'Horti Charges', next: 'reset' }
            ], note: 'Wallet is a credit and is deducted.' }
        ]
    };

    // ---------- formatting ----------

    function rs(value) {
        return 'Rs ' + BillingCalc.format(Math.round(value));
    }

    function escapeHtml(text) {
        return $('<div>').text(text).html();
    }

    // ---------- storage ----------

    function readStore(key) {
        try {
            return JSON.parse(localStorage.getItem(key));
        } catch (e) {
            return null;
        }
    }

    function savedMonths() {
        return Object.keys(localStorage)
            .filter(key => key.startsWith(STORE_PREFIX))
            .map(key => key.slice(STORE_PREFIX.length))
            .sort()
            .reverse();
    }

    // The old app keyed electric bills by date (bill_2026-09-21) with snake_case fields.
    function importLegacyBills() {
        Object.keys(localStorage).filter(key => key.startsWith(LEGACY_PREFIX)).forEach(key => {
            const month = key.slice(LEGACY_PREFIX.length, LEGACY_PREFIX.length + 7);
            const old = readStore(key);
            if (!old || !/^\d{4}-\d{2}$/.test(month) || localStorage.getItem(STORE_PREFIX + month)) return;
            localStorage.setItem(STORE_PREFIX + month, JSON.stringify({
                electric: {
                    k1Prev: old.k1_prev, k1Curr: old.k1_curr, k1Rate: old.k1_rate,
                    k2Prev: old.k2_prev, k2Curr: old.k2_curr, k2Rate: old.k2_rate,
                    k3Rate: old.k3_rate, omCharges: old.fix_charges
                }
            }));
        });
    }

    // ---------- form ----------

    function renderFields(utility, fields) {
        const col = fields.length <= 2 && fields.some(f => f.reading) ? 'col-6' : 'col-6 col-md-4';
        return `
            <div class="row g-2">
                ${fields.map(f => `
                    <div class="${col}">
                        <label class="form-label" for="${utility}-${f.key}">${f.label}</label>
                        <input type="number" step="any" class="form-control${f.reading ? ' reading' : ''}"
                               id="${utility}-${f.key}" data-utility="${utility}" data-key="${f.key}">
                        ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
                    </div>`).join('')}
            </div>`;
    }

    function renderForms() {
        UTILITIES.forEach(utility => {
            const html = FORMS[utility].map(section => {
                if (section.panel) {
                    return `
                        <details class="panel" data-panel="${section.panel}" data-utility="${utility}">
                            <summary>
                                <span class="panel-title">${section.title}</span>
                                <span class="panel-info"></span>
                            </summary>
                            <div class="panel-body">
                                ${renderFields(utility, section.fields)}
                                ${section.note ? `<div class="form-hint mt-2">${section.note}</div>` : ''}
                            </div>
                        </details>`;
                }
                const badge = section.units
                    ? `<span class="units-badge" data-units="${utility}.${section.units}" data-unit-label="${section.unitLabel}"></span>`
                    : '';
                return `
                    <div class="section-title"><span class="text">${section.title}</span>${badge}</div>
                    ${renderFields(utility, section.fields)}`;
            }).join('');
            $(`#form-${utility}`).html(html);
        });
    }

    function panelFields(utility, panel) {
        const section = FORMS[utility].find(s => s.panel === panel);
        return section ? section.fields : [];
    }

    function activeExtras(utility, values) {
        return panelFields(utility, 'extras').filter(f => parseFloat(values[f.key]) || 0).length;
    }

    // Collapsed panel headers show what's inside: current rates, or how many extras are set.
    function updatePanelInfo(data) {
        UTILITIES.forEach(utility => {
            const values = data[utility];
            const rates = panelFields(utility, 'rates')
                .filter(f => f.short)
                .map(f => `${f.short} ${BillingCalc.format(parseFloat(values[f.key]) || 0)}`)
                .join(' · ');
            $(`#form-${utility} [data-panel="rates"] .panel-info`).text(rates);

            const count = activeExtras(utility, values);
            $(`#form-${utility} [data-panel="extras"] .panel-info`)
                .text(count ? `${count} active` : 'None')
                .toggleClass('active', count > 0);
        });
    }

    // Open the extras panel whenever a loaded month has something in it, so nothing is hidden.
    function openActivePanels(data) {
        UTILITIES.forEach(utility => {
            $(`#form-${utility} [data-panel="extras"]`).prop('open', activeExtras(utility, data[utility]) > 0);
        });
    }

    function readForm() {
        const data = {};
        UTILITIES.forEach(utility => {
            data[utility] = {};
            $(`#form-${utility} input`).each(function () {
                data[utility][$(this).data('key')] = $(this).val();
            });
        });
        return data;
    }

    function writeForm(data) {
        UTILITIES.forEach(utility => {
            const values = (data && data[utility]) || {};
            $(`#form-${utility} input`).each(function () {
                const key = $(this).data('key');
                const value = values[key];
                $(this).val(value === undefined || value === null ? D[utility][key] : value);
            });
        });
        openActivePanels(readForm());
    }

    // Start a new month from the latest saved month before it.
    function carryForward(previous) {
        const data = {};
        UTILITIES.forEach(utility => {
            const prev = (previous && previous[utility]) || {};
            data[utility] = {};
            FORMS[utility].forEach(section => section.fields.forEach(f => {
                const has = k => prev[k] !== undefined && prev[k] !== null && prev[k] !== '';
                if (f.next === 'creditForward') data[utility][f.key] = BillingCalc.calculateElectric(prev).amounts.creditForward;
                else if (f.next === 'clear') data[utility][f.key] = '';
                else if (f.next === 'keep' && has(f.key)) data[utility][f.key] = prev[f.key];
                else if (f.next.from) data[utility][f.key] = has(f.next.from) ? prev[f.next.from] : '';
                else data[utility][f.key] = D[utility][f.key];
            }));
        });
        return data;
    }

    // ---------- results ----------

    function renderSteps(result) {
        const rows = result.steps.map(s => {
            let value;
            if (s.kind === 'units') value = BillingCalc.format(s.value);
            else if (s.kind === 'credit') value = '− ' + rs(s.value);
            else value = rs(s.value);
            return `
                <tr class="${s.kind}">
                    <td>${escapeHtml(s.label)}${s.formula ? `<div class="formula">${escapeHtml(s.formula)}</div>` : ''}</td>
                    <td class="amount">${value}</td>
                </tr>`;
        }).join('');
        const notes = result.notes.map(n => `<div class="calc-note">${escapeHtml(n)}</div>`).join('');
        return `
            <div class="section-title"><span class="text">How it's calculated</span></div>
            ${notes}
            <table class="table table-sm calc-table"><tbody>${rows}</tbody></table>`;
    }

    function renderSummary(results) {
        const rows = UTILITIES.map(u => `
            <tr>
                <td>${NAMES[u]}</td>
                <td class="amount">${rs(results[u].withinDue)}</td>
                <td class="amount">${rs(results[u].lateSurcharge)}</td>
                <td class="amount">${rs(results[u].afterDue)}</td>
            </tr>`).join('');
        $('#summary').html(`
            <div class="section-title"><span class="text">All bills for ${escapeHtml($('#bill_month').val() || '')}</span></div>
            <div class="table-responsive">
                <table class="table calc-table">
                    <thead><tr><th>Bill</th><th class="amount">Within Due Date</th><th class="amount">Late Surcharge</th><th class="amount">After Due Date</th></tr></thead>
                    <tbody>
                        ${rows}
                        <tr class="total">
                            <td>Total</td>
                            <td class="amount">${rs(results.total.withinDue)}</td>
                            <td class="amount">${rs(results.total.lateSurcharge)}</td>
                            <td class="amount">${rs(results.total.afterDue)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>`);
    }

    function recalculate() {
        const data = readForm();
        const results = BillingCalc.calculateAll(data);
        UTILITIES.forEach(u => {
            $(`#result-${u}`).html(renderSteps(results[u]));
            $(`[data-total="${u}"]`).text(rs(results[u].withinDue));
        });
        $('[data-total="all"]').text(rs(results.total.withinDue));
        $('[data-units]').each(function () {
            const [utility, key] = $(this).data('units').split('.');
            $(this).text(`${BillingCalc.format(results[utility].units[key])} ${$(this).data('unit-label')}`);
        });
        updatePanelInfo(data);
        renderSummary(results);
    }

    // ---------- months ----------

    function refreshMonthDropdown(selected) {
        const select = $('#saved_months');
        select.empty().append('<option value="">-- Select --</option>');
        savedMonths().forEach(month => select.append(`<option value="${month}">${month}</option>`));
        select.val(selected && savedMonths().includes(selected) ? selected : '');
    }

    function loadMonth(month) {
        const saved = readStore(STORE_PREFIX + month);
        if (saved) {
            writeForm(saved);
            $('#month_status').text(`Loaded saved bill for ${month}.`);
        } else {
            const earlier = savedMonths().find(m => m < month);
            writeForm(carryForward(earlier ? readStore(STORE_PREFIX + earlier) : null));
            $('#month_status').text(earlier
                ? `New month — previous readings, rates and credit carried forward from ${earlier}.`
                : 'New month — enter your meter readings.');
        }
        refreshMonthDropdown(month);
        recalculate();
    }

    function previousCalendarMonth() {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    // ---------- events ----------

    $(document).on('input', '.tab-content input', recalculate);

    $('#bill_month').on('change', function () {
        if ($(this).val()) loadMonth($(this).val());
    });

    $('#saved_months').on('change', function () {
        const month = $(this).val();
        if (month) {
            $('#bill_month').val(month);
            loadMonth(month);
        }
    });

    $('#save_month').on('click', function () {
        const month = $('#bill_month').val();
        if (!month) {
            alert('Please select a billing month first.');
            return;
        }
        localStorage.setItem(STORE_PREFIX + month, JSON.stringify(readForm()));
        refreshMonthDropdown(month);
        $('#month_status').text(`Saved bill for ${month}.`);
    });

    $('#delete_month').on('click', function () {
        const month = $('#saved_months').val();
        if (!month) {
            alert('Please select a saved month to delete.');
            return;
        }
        if (!confirm(`Are you sure you want to delete the bills for ${month}?`)) return;
        localStorage.removeItem(STORE_PREFIX + month);
        loadMonth($('#bill_month').val() || month);
        $('#month_status').text(`Bills for ${month} deleted.`);
    });

    // ---------- start ----------

    importLegacyBills();
    renderForms();
    const startMonth = savedMonths()[0] || previousCalendarMonth();
    $('#bill_month').val(startMonth);
    loadMonth(startMonth);
});
