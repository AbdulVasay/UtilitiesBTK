# How the BTK bills are calculated

All logic is in [js/billing-calc.js](js/billing-calc.js). The worked examples below are from the SEP-2026 bills (issued 01-Oct-2026); [tests/billing-calc.test.js](tests/billing-calc.test.js) checks that the code reproduces them.

Two rules apply to all three bills:
- **Rounding:** each line amount is rounded to whole rupees before lines are added (Bahria does the same).
- **Late payment surcharge** = 10% of the "within due date" amount, rounded. After due = within due + surcharge.

## ⚡ Electricity (Net Meter / Solar)

| Step | Formula | SEP-2026 |
|---|---|---|
| K1 units (imported from K-Electric) | K1 current − K1 previous | 13043 − 12501 = **542** |
| K2 units (solar exported) | K2 current − K2 previous | 15289 − 14791 = **498** |
| K2 units adjusted | min(K1, K2) | min(542, 498) = **498** |
| K3 units (surplus solar) | max(K2 − K1, 0) | **0** |
| Amount (K1) | K1 units × import rate (84.96) | 46,048 |
| Amount (K2) | K2 adjusted × adjustment rate (50) | 24,900 |
| Amount (K3) | K3 units × NEPRA-PPA rate (22.42) | 0 |
| Total Amount | K1 − (K2 + K3) | 21,148 |
| Total Amt Payable | Total Amount − (Prev. Bill Amt + QTR-1..4 credits) | 21,148 − 0 = 21,148 |
| Net amount of current bill | Total Amt Payable; if negative → 0 | **21,148** |
| + O & M charges | | 3,000 |
| + Disconnection + Arrears − Advance (cash) | | 0 |
| **Payable within due date** | | **24,148** |
| Late surcharge | 10% | 2,415 |
| **Payable after due date** | | **26,563** |

**When K2 > K1:** Bahria credits K2 only up to K1 (K2 adjusted = K1) and credits the remaining solar units as K3 at the lower NEPRA-PPA rate. Example: K1 = 300, K2 = 500 → K2 adjusted = 300, K3 = 200 → 25,488 − (15,000 + 4,484) = 6,004 + 3,000 O&M = 9,004.

**When Total Amt Payable is negative**, the credit is not refunded. That month's bill is only the O&M charges, and the leftover credit carries forward as next month's **Prev. Bill Amt**. The app fills this in automatically when you start a new month. Example: K1 = 100, K2 = 1,000 → 8,496 − (5,000 + 20,178) = −16,682 → pay 3,000 O&M, and next month starts with Prev. Bill Amt = 16,682.

**QTR-1..4** are entered by hand as shown on the bill. They are deducted the same way as Prev. Bill Amt, and they reset to 0 each new month so the same credit isn't counted twice.

## 💧 Water

| Step | Formula | SEP-2026 |
|---|---|---|
| Units (m³) | present − previous | 1439 − 1402 = **37** |
| Gallons | m³ × 264 ("PER GALLON" on bill) | **9,768** |
| Bill Amount | gallons × 0.75 | 7,326 |
| Sewerage charges | gallons × 0.23 | 2,247 |
| Water pumping & services | fixed | 2,000 |
| + Adjustment, bowser, O&M apt/shops, arrears, fine, installment − wallet | | 0 |
| **Payable within due date** | | **11,573** |
| Late surcharge | 10% | 1,157 |
| **Payable after due date** | | **12,730** |

The sewerage rate (0.23 per gallon) does not appear on the bill. It was worked out from the bill and matches every month from MAY-2026 to SEP-2026 in the billing history. Bills from before APR-2026 don't match, so the rates were probably different then.

## 🛠️ Maintenance

| Step | Formula | SEP-2026 |
|---|---|---|
| Bill amount | flat monthly charge | 8,009 |
| + Horti, arrears, fine, installment − wallet | | 0 |
| **Payable within due date** | | **8,009** |
| Late surcharge | 10% | 801 |
| **Payable after due date** | | **8,810** |

## Assumptions to confirm on a future bill
- **Wallet / Advance (cash)** are treated as credits and deducted. They were 0 on every bill so far.
- **QTR-1..4:** it isn't yet known when Bahria moves credit into these quarterly columns, so they are entered by hand. They were 0 on SEP-2026.
