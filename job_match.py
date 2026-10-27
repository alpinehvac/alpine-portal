#!/usr/bin/env python3
"""Alpine HVAC — match QuickBooks bills and invoices to BuildOps jobs (for job.html costs).

Usage:
  python3 -I job_match.py BILLS.json INVOICES.json JOBS.json > qb.json

  BILLS.json     Windsor get_data (connector "quickbooks") with fields
                 bills__docnumber, bills__txndate, bills__totalamt, bills__vendorref, bills__privatenote, bills__line
  INVOICES.json  Windsor get_data with fields
                 invoices__docnumber, invoices__txndate, invoices__totalamt, invoices__balance, invoices__customerref, invoices__privatenote
  JOBS.json      [{"id": "JO20261176", "po": "TM00747", "invoices": ["INV-20261290"]}, ...]

Output: {"qb": {"JO20261176": {"poKeys", "poSharedWith", "bills", "qbInvoices", "billedQB", "qbAt"}}}
  bills        supplier bills whose memo or line descriptions carry the job's Alpine PO (00xxx)
  qbInvoices   invoices whose number matches a BuildOps invoice number, or that carry the PO
  billedQB     sum of matched invoice totals, pre-HST (total / 1.13)
Bill amounts are as entered in QuickBooks (pre-tax for most suppliers).
"""
import json, re, sys, datetime

HST = 1.13
PO_RE = re.compile(r"(?<![\dA-Z])(?:P|TM|EQ|SC|M)?(00\d{3})(?!\d)", re.I)


def rows(path):
    d = json.load(open(path))
    return d["data"] if isinstance(d, dict) else d


def po_key(po):
    m = re.fullmatch(r"(?:P|TM|EQ|SC|M)?(00\d{3})", (po or "").strip(), re.I)
    return m.group(1) if m else None


def name(ref):
    return ref.get("name") if isinstance(ref, dict) else (ref or "")


def bill_text(b):
    parts = [b.get("bills__privatenote") or ""]
    for line in b.get("bills__line") or []:
        parts.append(line.get("Description") or "")
    return "\n".join(parts)


def main(bills_p, inv_p, jobs_p):
    bills, invs, jobs = rows(bills_p), rows(inv_p), json.load(open(jobs_p))
    key_jobs = {}
    for j in jobs:
        k = po_key(j.get("po"))
        if k:
            key_jobs.setdefault(k, []).append(j["id"])

    by_key = {}
    seen = set()
    for b in bills:
        sig = (b.get("bills__docnumber"), b.get("bills__txndate"), b.get("bills__totalamt"), name(b.get("bills__vendorref")))
        if sig in seen:
            continue
        seen.add(sig)
        text = bill_text(b)
        keys = {m.group(1) for m in PO_RE.finditer(text)}
        for k in keys & set(key_jobs):
            by_key.setdefault(k, []).append({
                "date": b.get("bills__txndate"), "vendor": name(b.get("bills__vendorref")),
                "doc": b.get("bills__docnumber") or "", "amount": b.get("bills__totalamt"),
                "memo": re.sub(r"\s+", " ", (b.get("bills__privatenote") or "").strip())[:160],
                "multiPO": len(keys) > 1,
            })

    out = {}
    for j in jobs:
        jid, k = j["id"], po_key(j.get("po"))
        inv_digits = {re.sub(r"\D", "", x) for x in j.get("invoices") or [] if re.sub(r"\D", "", x)}
        q_inv, used = [], set()
        for i in invs:
            doc = i.get("invoices__docnumber") or ""
            sig = (doc, i.get("invoices__txndate"))
            if sig in used:
                continue
            note = (i.get("invoices__privatenote") or "")
            hit = re.sub(r"\D", "", doc) in inv_digits if inv_digits else False
            if not hit and k and len(key_jobs.get(k, [])) == 1:  # shared PO: match by invoice number only
                hit = any(m.group(1) == k for m in PO_RE.finditer(doc + "\n" + note))
            if hit:
                used.add(sig)
                q_inv.append({"doc": doc, "date": i.get("invoices__txndate"), "total": i.get("invoices__totalamt"),
                              "balance": i.get("invoices__balance"), "customer": name(i.get("invoices__customerref")),
                              "memo": re.sub(r"\s+", " ", note.strip())[:120]})
        rec = {
            "poKeys": [k] if k else [],
            "poSharedWith": [x for x in key_jobs.get(k, []) if x != jid] if k else [],
            "bills": sorted(by_key.get(k, []), key=lambda x: x["date"] or "") if k else [],
            "qbInvoices": sorted(q_inv, key=lambda x: x["date"] or ""),
            "qbAt": datetime.date.today().isoformat(),
        }
        rec["billedQB"] = round(sum((x["total"] or 0) for x in q_inv) / HST, 2) if q_inv else None
        out[jid] = rec
    json.dump({"qb": out}, sys.stdout)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
