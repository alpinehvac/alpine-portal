#!/usr/bin/env python3
"""Match BuildOps invoices to QuickBooks for Operations > Invoicing (JOB-DETAILS-REFRESH.md Part B6).

  python3 -I invoice_sweep.py BO_INVOICES.json QB_INVOICES.json YYYY-MM-DD > sweep.json

BO_INVOICES.json  rows from buildops-invoices.js: no, sa, job, amount, issued, status, property, by
QB_INVOICES.json  Windsor quickbooks rows: invoices__docnumber, __txndate, __totalamt, __balance, __customerref, __privatenote

QuickBooks is the record of what was sent. Clarissa enters an invoice once it has gone out, under the BuildOps number, so
INV-20261301 in BuildOps is 20261301 in QuickBooks. An exact number match is the only match used.

Left out of notInQB:
  void invoices; anything older than 120 days; and agreement invoices with no job or visit number (SA1009): monthly
  contracts are raised in QuickBooks under C-numbers, so these BuildOps copies never match.

Output: {asOf, qb: {doc: {doc, date, total, balance}}, notInQB: [...], amountDiff: [...], invoicedIds: [...]}
"""
import datetime as dt
import json
import re
import sys

WINDOW = 120


def rows(path):
    with open(path) as f:
        d = json.load(f)
    return d.get("data", d) if isinstance(d, dict) else d


def main(bo_path, qb_path, today):
    now = dt.date.fromisoformat(today)
    qb = {}
    for r in rows(qb_path):
        doc = str(r.get("invoices__docnumber") or "").strip()
        if doc:
            qb[doc] = {"doc": doc, "date": r.get("invoices__txndate"), "total": r.get("invoices__totalamt"), "balance": r.get("invoices__balance")}
    not_in, diff, ids = [], [], set()
    for r in rows(bo_path):
        if (r.get("status") or "").lower() == "void":
            continue
        job = r.get("job") or ""
        sa = r.get("sa") or ""
        if job:
            ids.add(job)
        no = str(r.get("no") or "")
        key = re.sub(r"^INV-?", "", no, flags=re.I)
        q = qb.get(key)
        if q:
            if r.get("amount") is not None and q["total"] is not None and abs(r["amount"] - q["total"]) > 1:
                diff.append({"no": no, "job": job, "amount": r["amount"], "qb": q["total"]})
            continue
        try:
            age = (now - dt.date.fromisoformat(r.get("issued") or "")).days
        except ValueError:
            continue
        if age > WINDOW or (sa and not job):
            continue
        not_in.append({"no": no, "job": job, "property": r.get("property") or "", "issued": r.get("issued"), "by": r.get("by") or "", "amount": r.get("amount")})
    not_in.sort(key=lambda x: x["issued"] or "")
    json.dump({"asOf": today, "qb": qb, "notInQB": not_in, "amountDiff": diff, "invoicedIds": sorted(ids)}, sys.stdout)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
