#!/usr/bin/env python3
"""Alpine revenue-mix builder ("Where revenue goes").
Usage: python3 mix.py gl_by_month.json inputs.json [--quarter-months 2026-07,2026-08,2026-09] [--mtd-through 2026-10-06]
gl_by_month.json: Windsor quickbooks rows with year_month, generalledger__item__account_name,
generalledger__item__debt_amt, generalledger__item__credit_amt (one row per account per month).
Writes inputs["display"]["profitMix"] in place. Categories are Jake's rules (Oct 2026)."""
import json, sys, re

POLICY_DIVIDENDS_MONTHLY = 10000      # $5K per owner per month (replaces 37000 Dividends as recorded)
EXTRA_DIVIDENDS_MONTHLY = 10000       # FY2027 extra dividends, paid first in the allocation waterfall
TOOLS_GROWTH_SHARE = 0.75             # Small Tools & Supplies: 75% growth, 25% direct

def num(name):
    m = re.match(r"\s*(\d{5})", name or ""); return int(m.group(1)) if m else None

def classify(name):
    """Return (sector, label) or None for balance-sheet accounts. Sector 'revenue' for income."""
    n = num(name); u = (name or "").upper()
    if u == "ADVERTISING & PROMOTION": return ("growth", "Marketing & advertising")
    if u == "INSURANCE": return ("indirect", "Insurance")
    if n is None: return None
    if 40000 <= n < 50000: return ("revenue", "Revenue")
    if n == 71000: return None                                   # interest income: not operating revenue
    if n == 50060: return ("tools", "Small tools & supplies")
    if n in (51000,): return ("direct", "Materials & supplies")
    if n == 55000: return ("direct", "Subcontractors")
    if n in (52000, 53000, 54000): return ("direct", "Equipment rental, disposal & permits")
    if 56000 <= n < 57000: return ("direct", "Field labour (wages, CPP/EI, benefits)")
    if 50010 <= n <= 50090 and n != 50060 and n != 50070: return ("direct", "Vehicles (fuel, insurance, repairs, tolls, lease)")
    if n == 50070: return ("direct", "Uniforms")
    if n in (60000, 60200): return ("growth", "Marketing & advertising")
    if n == 68000: return ("growth", "Training & education")
    if n == 60400: return ("owner", "Charitable donations")
    if n in (63100, 63200): return ("owner", "Meals, entertainment & tips")
    if n == 67400: return ("owner", "Travel")
    if n in (67800, 67900): return ("owner", "Owner building materials")
    if n == 67910: return ("owner", "Non-recoverable COGS")
    if 66500 <= n < 67000: return ("indirect", "Office & admin payroll")
    if 61200 <= n <= 61300: return ("indirect", "Bank, interest & payment fees")
    if 61400 <= n < 62000: return ("indirect", "Software, AI, CRM & subscriptions")
    if 62000 <= n < 63000: return ("indirect", "Insurance")
    if n == 65300: return ("indirect", "Office support fees")
    if 65000 <= n < 66000: return ("indirect", "Professional fees")
    if 50000 <= n < 90000: return ("indirect", "Rent, phone, office & other overhead")
    return None                                                  # assets, liabilities, equity (incl. 37000 Dividends)

SECT = ("direct", "indirect", "owner", "growth")

def build(rows, quarter, mtd_month, mtd_through, label, prev=None):
    by = {}
    for r in rows:
        ym = r["year_month"].replace("|", "-"); y, m = ym.split("-"); ym = f"{y}-{int(m):02d}"
        c = classify(r["generalledger__item__account_name"])
        if not c: continue
        dr, cr = r.get("generalledger__item__debt_amt") or 0, r.get("generalledger__item__credit_amt") or 0
        B = by.setdefault(ym, {"revenue": 0.0, **{s: 0.0 for s in SECT}, "items": {s: {} for s in SECT}})
        sec, lab = c
        if sec == "revenue": B["revenue"] += cr - dr; continue
        amt = dr - cr
        parts = [("growth", "Tools (75%)", amt * TOOLS_GROWTH_SHARE), ("direct", "Small tools & supplies (25%)", amt * (1 - TOOLS_GROWTH_SHARE))] if sec == "tools" else [(sec, lab, amt)]
        for s, l, a in parts:
            B[s] += a; B["items"][s][l] = B["items"][s].get(l, 0) + a
    def month_row(ym, days_frac=1.0):
        B = by.get(ym, {"revenue": 0, **{s: 0 for s in SECT}, "items": {s: {} for s in SECT}})
        pol = POLICY_DIVIDENDS_MONTHLY * days_frac
        B["owner"] += pol; B["items"]["owner"]["Dividends at policy ($5K per owner per month)"] = pol
        return B
    months = []; items = {s: {} for s in SECT}
    for ym in quarter:
        B = month_row(ym)
        months.append({"month": ym, "revenue": round(B["revenue"]), **{s: round(B[s]) for s in SECT}})
        for s in SECT:
            for l, a in B["items"][s].items(): items[s][l] = items[s].get(l, 0) + a
    mtd = None
    if mtd_month:
        import calendar, datetime as dt
        t = dt.date.fromisoformat(mtd_through); dim = calendar.monthrange(t.year, t.month)[1]
        B = month_row(mtd_month, t.day / dim)
        mtd = {"month": mtd_month, "through": mtd_through, "revenue": round(B["revenue"]), **{s: round(B[s]) for s in SECT}}
    # Weekly fixed-cost split for projections: trailing quarter, excluding job-variable costs and policy dividends.
    var_labels = {"Materials & supplies", "Subcontractors", "Equipment rental, disposal & permits"}
    wk = len(quarter) * 4.333
    fixed = {s: round(sum(a for l, a in items[s].items() if l not in var_labels and not l.startswith("Dividends at policy")) / wk) for s in SECT}
    out = {"label": label, "months": months, "mtd": mtd,
           "items": {s: sorted([[l, round(a)] for l, a in items[s].items() if round(a)], key=lambda x: -x[1]) for s in SECT},
           "fixedWeekly": fixed, "policyDividendsMonthly": POLICY_DIVIDENDS_MONTHLY, "extraDividendsMonthly": EXTRA_DIVIDENDS_MONTHLY}
    if prev and prev.get("earnedNotBilled") is not None: out["earnedNotBilled"] = prev["earnedNotBilled"]
    return out

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument("gl"); ap.add_argument("inputs")
    ap.add_argument("--quarter-months", required=True); ap.add_argument("--label", required=True)
    ap.add_argument("--mtd-through"); a = ap.parse_args()
    rows = json.load(open(a.gl)); rows = rows.get("data", rows) if isinstance(rows, dict) else rows
    inp = json.load(open(a.inputs))
    q = a.quarter_months.split(",")
    mix = build(rows, q, a.mtd_through[:7] if a.mtd_through else None, a.mtd_through, a.label, inp["display"].get("profitMix"))
    inp["display"]["profitMix"] = mix
    json.dump(inp, open(a.inputs, "w"), indent=1)
    for m in mix["months"] + ([mix["mtd"]] if mix["mtd"] else []):
        c = sum(m[s] for s in SECT); print(m["month"], "rev", m["revenue"], {s: m[s] for s in SECT}, "profit", m["revenue"] - c)
    print("fixedWeekly", mix["fixedWeekly"])
