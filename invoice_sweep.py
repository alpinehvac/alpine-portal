#!/usr/bin/env python3
"""Match BuildOps invoices to QuickBooks for Operations > Invoicing (JOB-DETAILS-REFRESH.md Part B6).

  python3 -I invoice_sweep.py BO_INVOICES.csv QB_INVOICES.json YYYY-MM-DD > sweep.json

BO_INVOICES.csv   lines from buildops-invoices.js: no,job,sa,amount,issued,by (non-void, last 180 days)
QB_INVOICES.json  Windsor quickbooks rows: invoices__docnumber, __txndate, __totalamt, __balance, __customerref, __privatenote

QuickBooks is the record of what was sent. Clarissa enters an invoice once it has gone out, under the BuildOps number, so
INV-20261301 in BuildOps is 20261301 in QuickBooks. That number match comes first. Deposits are sometimes entered under the
quote number (Q20261142), so a BuildOps invoice with no number match can still match a Q-numbered QuickBooks invoice of the
same total, each used once.

Left out of notInQB:
  anything older than 120 days; and agreement invoices with no job or visit number (SA1009): monthly
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


def bo_rows(path):
    with open(path) as f:
        for line in f:
            p = line.rstrip("\n").split(",")
            if len(p) >= 6 and p[0].startswith("INV"):
                yield {"no": p[0], "job": p[1], "sa": p[2], "amount": float(p[3]) if p[3] else None, "issued": p[4], "by": p[5]}


def main(bo_path, qb_path, today):
    now = dt.date.fromisoformat(today)
    qb = {}
    for r in rows(qb_path):
        doc = str(r.get("invoices__docnumber") or "").strip()
        if doc:
            qb[doc] = {"doc": doc, "date": r.get("invoices__txndate"), "total": r.get("invoices__totalamt"), "balance": r.get("invoices__balance")}
    not_in, diff, ids = [], [], set()
    by_quote = [q for d, q in qb.items() if d.startswith("Q")]
    for r in bo_rows(bo_path):
        job = r.get("job") or ""
        sa = r.get("sa") or ""
        if job:
            ids.add(job)
        no = str(r.get("no") or "")
        key = re.sub(r"^INV-?", "", no, flags=re.I)
        q = qb.get(key)
        if not q and r.get("amount") is not None:
            q = next((x for x in by_quote if x["total"] is not None and abs(x["total"] - r["amount"]) < 0.05), None)
            if q:
                by_quote.remove(q)
                qb[key] = q
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
        not_in.append({"no": no, "job": job, "issued": r.get("issued"), "by": r.get("by") or "", "amount": r.get("amount")})
    not_in.sort(key=lambda x: x["issued"] or "")
    json.dump({"asOf": today, "qb": qb, "notInQB": not_in, "amountDiff": diff, "invoicedIds": sorted(ids)}, sys.stdout)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
