#!/usr/bin/env python3
"""Alpine HVAC — Outbound map: turn the lead sheet into the portal payload.

Input : the text the Microsoft 365 connector returns for "Alpine Leads 2026"
        (tab-separated rows; header row starts with "City").
Output: outbound-payload.json  ->  {"syncedAt", "rows": [...], "warnings": [...]}

Columns are matched by header name, so Natalie can move or add columns freely.
Status comes from the "Status" column when it is filled in; otherwise it is
derived from Contacted / Quoted. Contains no data itself (safe in a public repo).

Usage: python3 outbound-build.py <connector-output.txt> [out.json]
"""
import hashlib, json, re, sys
from datetime import date

STATUSES = ["Not contacted", "Contacted", "Follow-up booked", "Quoted",
            "Bid list", "Bids & tenders only", "Converted", "Dead"]
ALIASES = {  # loose spellings people type -> canonical status
    "not contacted": "Not contacted", "new": "Not contacted",
    "contacted": "Contacted", "spoke": "Contacted",
    "follow-up booked": "Follow-up booked", "follow up booked": "Follow-up booked", "followup": "Follow-up booked",
    "follow-up": "Follow-up booked", "follow up": "Follow-up booked", "calendar follow-up": "Follow-up booked", "yellow": "Follow-up booked",
    "quoted": "Quoted", "quote": "Quoted",
    "bid list": "Bid list", "blue": "Bid list",
    "bids & tenders only": "Bids & tenders only", "bids and tenders only": "Bids & tenders only", "tenders": "Bids & tenders only", "grey": "Bids & tenders only",
    "converted": "Converted", "won": "Converted", "customer": "Converted", "green": "Converted",
    "dead": "Dead", "lost": "Dead", "red": "Dead", "not interested": "Dead",
}
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
FIELDS = {  # output key -> header names to accept (lower-case, trimmed)
    "city": ["city"], "incoming": ["incoming"], "rep": ["lead source"], "company": ["company"],
    "address": ["address"], "type": ["building type"], "contact": ["contact name"], "phone": ["phone #", "phone"],
    "email": ["email"], "contacted": ["contacted"], "quoted": ["quoted"], "lastTouch": ["last touch"],
    "followUp": ["follow-up", "follow up"], "notes": ["notes"], "status": ["status"], "zone": ["zone"],
}
CITY_FIX = {"jorden": "Jordan", "kit/miss": "Kitchener", "kwc": "Kitchener", "tri-city": "Kitchener",
            "niagara": "", "halton": "", "mix territory": "", "see notes": "", "": ""}
UNMAPPABLE = re.compile(r"^(\?|canada|multiple locations?|hq toronto|n/?a|-)?$", re.I)


def parse_date(s):
    """'Aug 11th 2026', 'July.9th2026', 'July 16th/26', 'Sept 4th' -> ISO or ''."""
    s = (s or "").strip()
    m = re.search(r"([A-Za-z]{3,9})[\s.]*(\d{1,2})(?:st|nd|rd|th)?[\s.,/\-]*(\d{2,4})?", s)
    if not m or m.group(1)[:3].lower() not in MONTHS:
        return ""
    mo, d = MONTHS[m.group(1)[:3].lower()], int(m.group(2))
    y = m.group(3)
    if y and len(y) == 2 and not 24 <= int(y) <= 35:
        y = None  # 'Oct 19th/20' is a day range, not the year 2020
    if y and len(y) == 3:
        y = None
    y = (2000 + int(y) if len(y) == 2 else int(y)) if y else date.today().year
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return ""


def norm_status(raw, contacted, quoted):
    v = (raw or "").strip().lower()
    if v in ALIASES:
        return ALIASES[v], True
    for s in STATUSES:
        if v == s.lower():
            return s, True
    q, c = (quoted or "").strip().upper(), (contacted or "").strip().upper()
    if q.startswith("Y"):
        return "Quoted", False
    if c.startswith("Y"):
        return "Contacted", False
    return "Not contacted", False


def build(text):
    lines = text.split("\n")
    hi = next(i for i, l in enumerate(lines) if l.lower().startswith("city\t"))
    hdr = [h.strip().lower() for h in lines[hi].split("\t")]
    col = {k: next((hdr.index(n) for n in names if n in hdr), None) for k, names in FIELDS.items()}
    rows, warnings, seen = [], [], {}
    for n, line in enumerate(lines[hi + 1:], start=hi + 2):
        if line.startswith("Formulas") or line.startswith("## "):
            break
        cells = line.split("\t")
        if not any(c.strip() for c in cells):
            continue
        get = lambda k: (cells[col[k]].strip() if col[k] is not None and col[k] < len(cells) else "")
        r = {k: get(k) for k in FIELDS}
        if not (r["company"] or r["address"]):
            continue
        status, explicit = norm_status(r["status"], r["contacted"], r["quoted"])
        if r["status"] and not explicit:
            warnings.append(f"Row {n}: unknown Status '{r['status']}' ({r['company']}); used {status}")
        city = CITY_FIX.get(r["city"].lower(), r["city"])
        addr = re.sub(r"\s+", " ", r["address"]).strip()
        mappable = bool(addr) and not UNMAPPABLE.match(addr)
        key = hashlib.sha1((r["company"].lower() + "|" + addr.lower()).encode()).hexdigest()[:12]
        if key in seen:
            seen[key] += 1
            key = f"{key}-{seen[key]}"
        else:
            seen[key] = 1
        rows.append({
            "id": key, "row": n, "company": r["company"], "address": addr, "city": city, "cityRaw": r["city"],
            "type": r["type"], "incoming": r["incoming"], "rep": r["rep"], "contact": r["contact"],
            "phone": r["phone"], "email": r["email"], "status": status, "statusSet": explicit,
            "contacted": r["contacted"], "quoted": r["quoted"],
            "lastTouch": parse_date(r["lastTouch"]), "lastTouchRaw": r["lastTouch"],
            "followUp": parse_date(r["followUp"]), "followUpRaw": r["followUp"],
            "notes": r["notes"][:700], "mappable": mappable,
            "geoQuery": f"{addr}, {city + ', ' if city and city.lower() not in addr.lower() else ''}Ontario, Canada" if mappable else "",
        })
    return {"syncedAt": date.today().isoformat(), "hasStatusColumn": col["status"] is not None,
            "rows": rows, "warnings": warnings}


if __name__ == "__main__":
    out = build(open(sys.argv[1], encoding="utf-8").read())
    path = sys.argv[2] if len(sys.argv) > 2 else "outbound-payload.json"
    json.dump(out, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    from collections import Counter
    print(len(out["rows"]), "leads;", "Status column present" if out["hasStatusColumn"] else "NO Status column (derived)")
    print(dict(Counter(r["status"] for r in out["rows"])))
    print("unmappable:", sum(not r["mappable"] for r in out["rows"]), "| warnings:", len(out["warnings"]))
