#!/usr/bin/env python3
"""Alpine HVAC — Sales dashboard metrics from QuickBooks invoices (via Windsor).

Input : Windsor quickbooks get_data JSON with fields invoices__txndate,
        invoices__customerref, invoices__totalamt, invoices__txntaxdetail
        covering at least the last 24 months.
Output: sales-metrics.json -> paste into Sales dashboard > Update data (owners).

Amounts are before HST. Contains no data itself (safe in a public repo).
Usage: python3 sales-metrics.py invoices.json <asOf YYYY-MM-DD> <bdrCostTTM> <marketingTTM> <grossMarginPct> [out.json]
"""
import json, sys, statistics
from datetime import date, timedelta
from collections import defaultdict

src, as_of, bdr, mkt, gm = sys.argv[1], date.fromisoformat(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]) / 100
out = sys.argv[6] if len(sys.argv) > 6 else "sales-metrics.json"
rows = json.load(open(src))["data"]

def net(r):
    tax = (r.get("invoices__txntaxdetail") or {}).get("TotalTax") or 0
    return (r.get("invoices__totalamt") or 0) - tax

inv = []
for r in rows:
    d = date.fromisoformat(r["invoices__txndate"][:10])
    if d > as_of: continue
    c = (r.get("invoices__customerref") or {}).get("name", "").strip()
    inv.append((d, c, net(r)))

y1 = as_of - timedelta(days=365); y2 = as_of - timedelta(days=730)
ttm = [x for x in inv if x[0] > y1]
prev = [x for x in inv if y2 < x[0] <= y1]
rev_ttm, rev_prev = sum(x[2] for x in ttm), sum(x[2] for x in prev)
first = {}
for d, c, _ in sorted(inv): first.setdefault(c, d)
new_cust = sorted(c for c, d in first.items() if d > y1 and c)
cust_ttm = {c for _, c, _ in ttm if c}
tickets = [x[2] for x in ttm if x[2] > 0]
# Retention (invoice basis): customers billed in the prior 12 months who were billed again in the last 12
prev_c = {c for _, c, _ in prev if c}
kept = prev_c & cust_ttm
monthly = defaultdict(float)
for d, _, a in inv: monthly[d.strftime("%Y-%m")] += a
res = {
    "asOf": as_of.isoformat(),
    "source": "QuickBooks invoices via Windsor, before HST",
    "revenueTTM": round(rev_ttm), "revenuePrevTTM": round(rev_prev),
    "growthYoY": round((rev_ttm / rev_prev - 1) * 100, 1) if rev_prev else None,
    "invoicesTTM": len(tickets),
    "avgTicket": round(sum(tickets) / len(tickets)) if tickets else None,
    "medianTicket": round(statistics.median(tickets)) if tickets else None,
    "customersTTM": len(cust_ttm),
    "revPerCustomer": round(rev_ttm / len(cust_ttm)) if cust_ttm else None,
    "newCustomersTTM": len(new_cust),
    "retentionInvoice": round(len(kept) / len(prev_c) * 100, 1) if prev_c else None,
    "retentionBase": len(prev_c),
    "grossMargin": round(gm * 100, 1),
    "bdrCostTTM": round(bdr), "marketingTTM": round(mkt),
    "months": [[k, round(v)] for k, v in sorted(monthly.items())][-25:],
}
res["cac"] = round((bdr + mkt) / len(new_cust)) if new_cust else None
json.dump(res, open(out, "w"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != "months"}, indent=1))
