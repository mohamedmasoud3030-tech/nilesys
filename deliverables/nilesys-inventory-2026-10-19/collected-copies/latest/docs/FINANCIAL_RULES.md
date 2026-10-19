# Financial Rules

**Version:** 1.0 · **Authority:** the single source of truth for every calculation. Code implements this file;
where they disagree, this file wins. **Sources:** PRD §9.2, FR-2/3/7/8/9/10, D27, D32, D33 · ADR-0004, 0006, 0007

## 1. Absolute rules
1. All arithmetic uses **decimal**, never binary floating point.
2. Values cross every boundary as **strings**.
3. **Round per line to 2 dp, then sum.** Never sum unrounded and round once.
4. Weights are stored and computed in **kilograms**; tons are a pricing unit only.
5. Every figure derived from an estimate is labelled **`تقريبي`** in the UI.
6. Rounding mode: **half-up** (`ROUND_HALF_UP`), applied only at the defined points below.

## 2. Weight
```
deduction_kg = deduction_type = 'percent' ? gross_kg × deduction_value / 100
             : deduction_type = 'kg'      ? deduction_value
             : 0
net_kg       = round(gross_kg − deduction_kg, 2)      -- CHECK: > 0 and <= gross_kg
```
Gross/tare mode: `gross_kg := gross_in − tare_out` (CHECK `tare_out < gross_in`), then the deduction applies to that.

## 3. Money and the unit
```
price_per_kg = line.price_unit = 'ton' ? unit_price / 1000 : unit_price     -- 6 dp, stored
line_total   = round(net_kg × price_per_kg, 2)
total_amount = Σ line_total
balance      = total_amount − amount_cash
```
The unit belongs to **the line**, not the material (D20). Switching a line's unit **does not convert the entered
price** — the user is quoting anew.

## 4. Weighted moving average (ADR-0006)
On every posted inbound line (purchase, opening, positive adjustment, regrade output):
```
new_avg = (qty_kg × avg_cost + net_kg × cost_per_kg_in) / (qty_kg + net_kg)     -- 6 dp
-- if (qty_kg + net_kg) = 0 → avg unchanged
```
On a sale line:
```
cost_snapshot_per_kg = avg_cost at posting time        -- stored on the line, frozen
gross_profit         = line_total − round(net_kg × cost_snapshot_per_kg, 2)
margin_pct           = line_total > 0 ? gross_profit / line_total × 100 : null
-- cost_snapshot_per_kg = 0 → profit reported as "غير محسوب", never as 100 %
```

## 5. Cash
```
expected_posted   = opening_amount + Σ posted cash in − Σ posted cash out
pending_cash      = Σ cash movements with status = 'pending'
expected_in_drawer = expected_posted + pending_cash            -- what the count is compared against
difference         = counted_amount − expected_in_drawer
```
Pending cash counts toward the **drawer** and never toward revenue, profit or a final party balance (ADR-0009).
The two lines are displayed separately and never merged.

## 6. Regrade allocation (ADR-0007)
```
consumed_value = round(consumed_kg × source_avg_cost, 2)
notional_i     = output_kg_i × ref_sell_price_per_kg_snapshot_i
notional_total = Σ notional_i                      -- outputs only; loss contributes nothing
value_i        = round(consumed_value × notional_i / notional_total, 2)
cost_per_kg_i  = value_i / output_kg_i                                     -- 6 dp
```
- Snapshots are frozen at save and **never re-read** (D27).
- If **any** output lacks a price → defer **entirely** (all-or-nothing) and hold `unallocated_regrade_cost = consumed_value`.
- If **all** prices are 0 → `weight_fallback`, stated on screen.
- Rounding residue from the last output is adjusted so `Σ value_i = consumed_value` **exactly**.

## 7. Deferred allocation resolution (D33)
```
sold_kg_i      = min(Σ outbound of material i between regrade and resolution, output_kg_i)
remaining_kg_i = output_kg_i − sold_kg_i
unattributed_i = round(value_i × sold_kg_i      / output_kg_i, 2)   -- current period cost line
to_inventory_i = value_i − unattributed_i    -- inventory only; keeps the rounding residue
                                             -- INSIDE the output so the sum is exact
new_avg        = (current_value + to_inventory_i) / current_quantity_kg
```
`Σ(unattributed_i + to_inventory_i) = consumed_value` **exactly**. Past sales are never rewritten and keep
`غير محسوب`. `sold_kg_i` is a ledger approximation — no lot tracking (D24).

## 8. Historical correction (ADR-0008)
**Open day:** reverse + re-enter, then replay that material forward in `(business_date, created_at, id)` order,
recomputing the running average and every subsequent sale's cost snapshot. Blocked if the balance would go negative.
**Closed day:** no rewrite. `cost_adjustment` dated today:
```
delta_value = corrected_value − originally_recorded_value
new_avg     = quantity_kg > 0 ? (quantity_kg × avg_cost + delta_value) / quantity_kg : avg_cost
```
`delta_value` is reported in the current period as `فروق تصحيح مشتريات سابقة`.

## 9. Reporting
```
inventory_cost   = Σ stock_balances.total_value
sales_value      = Σ posted sale line_total in period
gross_profit     = Σ posted sale gross_profit in period        -- excludes lines marked غير محسوب
profit_after_exp = gross_profit − Σ expenses in period
margin_material  = Σ profit / Σ revenue per material
```

## 10. Stagnation indicators (D24)
```
days_since_last_in  = today − last_in_date
days_since_last_out = today − last_out_date                    -- headline stagnation figure
avg_daily_out_30    = Σ outbound net_kg over trailing 30 days / 30
days_of_cover       = avg_daily_out_30 > 0 ? quantity_kg / avg_daily_out_30 : null
```
Not inventory age. No FIFO implied.

---

## 11. Golden examples — results must never change

| # | Scenario | Expected |
|---|---|---|
| **G-1** | 100 kg @ 20.00/kg, 5 % deduction | net 95.00 kg · total **1,900.00** |
| **G-2** | 100 kg @ 20.00/kg, 12 kg deduction | net 88.00 kg · total **1,760.00** |
| **G-3** | 1,250 kg @ 8,000.00/**ton** | price_per_kg 8.000000 · total **10,000.00** |
| **G-4** | gross_in 12,400 kg, tare_out 4,100 kg | net **8,300.00 kg** |
| **G-5** | Buy 1,000 kg @ 10.00, then 500 kg @ 16.00 | avg **12.000000**/kg · qty 1,500.00 · value **18,000.00** |
| **G-6** | From G-5, sell 400 kg @ 20.00 | revenue 8,000.00 · cost 4,800.00 · **profit 3,200.00** · margin **40.000 %** |
| **G-7** | Sell 100 kg @ 15.00 where avg cost = 0 | revenue 1,500.00 · profit **`غير محسوب`** (not 100 %) |
| **G-8** | Regrade 1,000 kg @ 20.00 (= 20,000.00) → 100 kg copper (sell 400.00) + 900 kg iron (sell 8.00) | notional 40,000 / 7,200 / 47,200 · copper **16,949.15** (**169.491500**/kg) · iron **3,050.85** (**3.389833**/kg) · Σ = **20,000.00** |
| **G-9** | G-8 deferred (copper unpriced), 50 kg copper + 400 kg iron sold, then copper priced at 400.00 and resolved | unattributed **9,830.51** (copper 8,474.58 + iron 1,355.93) · to inventory **10,169.49** (copper **8,474.57** + iron 1,694.92) · Σ = **20,000.00** · past sales remain `غير محسوب` |
| **G-10** | Opening 45,000.00; posted in 20,000.00; posted out 8,000.00; pending in 12,000.00 | expected_posted **57,000.00** · pending **12,000.00** · expected_in_drawer **69,000.00** |
| **G-11** | G-10 counted 68,600.00 | difference **−400.00** |
| **G-12** | Closed-day purchase corrected: recorded 5,000.00, correct 4,600.00, current qty 500 kg @ 12.000000 | delta **−400.00** · new avg **11.200000**/kg · current period shows `فروق تصحيح مشتريات سابقة` −400.00 |
| **G-13** | Three lines: 10.005, 10.005, 10.005 rounded per line then summed | **30.03**, not 30.02 (proves per-line rounding) |
| **G-14** | Pending sale of 12,000.00 resolved | exactly **one** cash movement of 12,000.00 exists, status flips pending → posted |

Every golden example is an automated test. Changing one requires an ADR.
