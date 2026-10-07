#!/usr/bin/env python3
"""Alpine cash dashboard forecast engine.
Usage: python3 forecast.py inputs.json data.json
Reads the day's gathered inputs, builds the 13-week committed-only forecast
plus the service-work upside line, and writes the dashboard data file."""
import json, sys, datetime as dt
D = dt.date.fromisoformat

def run(inp):
    today = D(inp["asOf"])
    W0 = today - dt.timedelta(days=today.weekday())          # Monday of this week
    weeks = [W0 + dt.timedelta(7 * i) for i in range(13)]
    wk = lambda d: (lambda i: i if 0 <= i < 13 else None)((d - W0).days // 7)
    cin = {k: [0.0] * 13 for k in ["ar", "contracts", "projects"]}
    cout = {k: [0.0] * 13 for k in ["burn", "disc", "draws", "ap", "cards", "cra", "hst", "materials", "other"]}
    notes = [[] for _ in range(13)]
    def add(t, k, d, a, note=None):
        i = wk(d)
        if i is None: return
        t[k][i] += a
        if note: notes[i].append(note)

    # 1. Open invoices: expected at invoice date + customer lag; already late -> spread weeks 1-3
    for iv in inp["openInvoices"]:
        exp = D(iv["date"]) + dt.timedelta(iv.get("lagDays", inp.get("defaultLagDays", 24)))
        if exp < today:
            for k in (0, 1, 2): add(cin, "ar", weeks[k] + dt.timedelta(3), iv["amount"] / 3)
        else:
            add(cin, "ar", exp, iv["amount"], iv.get("note"))
    # 2. Other scheduled inflows (estimates to bill, one-offs)
    for s in inp.get("scheduledIn", []):
        add(cin, s.get("cat", "ar"), D(s["date"]) + dt.timedelta(s.get("lagDays", 0)), s["amount"], s.get("note"))
    # 3. Monthly contracts
    for c in inp["contracts"]:
        m = dt.date(W0.year, W0.month, 1)
        for _ in range(5):
            bill = dt.date(m.year, m.month, c.get("day", 1))
            if bill >= today - dt.timedelta(days=45) and not (c.get("skipBilledBefore") and bill <= D(c["skipBilledBefore"])):
                add(cin, "contracts", bill + dt.timedelta(c["lagDays"]), c["amount"])
            m = dt.date(m.year + (m.month // 12), m.month % 12 + 1, 1)
    # 4. Jobs: remaining billings + materials
    table = []
    for j in inp["jobs"]:
        for e in j.get("events", []):
            add(cin, "projects", D(e["date"]) + dt.timedelta(e.get("lagDays", 30)), e["amount"],
                f'{j["name"]} {e.get("label","")} collected (${e["amount"]/1000:.1f}K)' if e["amount"] > 20000 else None)
        for mt in j.get("materials", []):
            add(cout, "materials", D(mt["date"]), mt["amount"],
                f'{j["name"]} materials paid (${mt["amount"]/1000:.1f}K)' if mt["amount"] > 30000 else None)
        ev = j.get("events", [])
        table.append(dict(name=j["name"], job=j.get("job", "—"), po=j.get("po", "—"), quoted=j["quoted"],
                          billed=j["billedQB"], left=round(j["quoted"] - j["billedQB"]), hrs=j.get("hrs"),
                          margin=j.get("margin"), next=ev[0]["date"] if ev else "", last=j.get("lastBilling") or (ev[-1]["date"] if ev else "")))
    # 5. Outflows
    b = inp["burnWeekly"]
    for i in range(13):
        cout["burn"][i] += b["core"]; cout["disc"][i] += b["discretionary"]; cout["draws"][i] += b["draws"]
    for c in inp.get("cutsWeekly", []):
        for i in range(13):
            if weeks[i] >= D(c["from"]): cout["burn"][i] -= c["weekly"]
    for bl in inp["bills"]:
        add(cout, "ap", max(D(bl["due"]), today), bl["amount"])
    for s in inp.get("scheduledOut", []):
        add(cout, s.get("cat", "other"), D(s["date"]), s["amount"], s.get("note"))
    # 6. Roll forward
    bal = inp["openingCash"]; out = []; closes = []
    for i in range(13):
        ci = sum(cin[k][i] for k in cin); co = sum(cout[k][i] for k in cout)
        bal += ci - co; closes.append(round(bal))
        out.append(dict(start=str(weeks[i]), driver="; ".join(notes[i]),
                        **{"in": {k: round(cin[k][i]) for k in cin}, "out": {k: round(cout[k][i]) for k in cout}}))
    # 7. Upside line: expected service/T&M/parts work net of parts
    u = inp.get("upside")
    upside = None
    if u:
        add_in = [0.0] * 13; add_out = [0.0] * 13
        for i in range(1, 13):
            k = wk(weeks[i] + dt.timedelta(2 + u["lagDays"]))
            if k is not None: add_in[k] += u["serviceWeekly"]
        for i in range(u.get("partsFromWeek", 5), 13): add_out[i] += u["partsWeekly"]
        run_ = inp["openingCash"]; upside = []
        for i in range(13):
            run_ += (sum(cin[k][i] for k in cin) + add_in[i]) - (sum(cout[k][i] for k in cout) + add_out[i])
            upside.append(round(run_))
    apByWeek = [round(cout["ap"][i]) for i in range(5)]
    data = dict(inp["display"])
    data.update(asOf=inp["asOf"], weeks=out, upside=upside, jobs=table)
    data.setdefault("ap", {})["byWeek"] = apByWeek
    if inp.get("profitInputs"):
        data["profit"] = profit_block(inp["profitInputs"], W0, inp.get("jobs", []))
    return data, closes


def profit_block(pi, W0, cash_jobs=()):
    """Percent-complete (cost-to-cost) profit: past weeks from QuickBooks P&L, next 13 weeks projected."""
    F = [W0 + dt.timedelta(7 * i) for i in range(13)]
    rev = [0.0] * 13; mat = [0.0] * 13; wip = []
    def spread(s, e, r, m):
        s, e = D(s), D(e); days = (e - s).days + 1
        for i, w in enumerate(F):
            ov = (min(w + dt.timedelta(6), e) - max(w, s)).days + 1
            if ov > 0: rev[i] += r * ov / days; mat[i] += m * ov / days
    groups = {}
    for j in pi["jobs"]:
        g = j.get("group")
        if g:
            G = groups.setdefault(g, dict(name=g, sub=0, costEst=0, labEst=0, labAct=0, matQB=0, billedQB=0))
            for k in ("sub", "costEst", "labEst", "labAct", "matQB", "billedQB"): G[k] += j.get(k, 0)
            for k in ("start", "end"):
                if j.get(k): G[k] = j[k]
    jobs_ = [j for j in pi["jobs"] if not j.get("group")] + list(groups.values())
    for j in jobs_:
        incurred = j.get("labAct", 0) + j.get("matQB", 0)
        pct = min(incurred / j["costEst"], 1.0) if j.get("costEst") else 0
        earned = pct * j["sub"]; billed = j.get("billedQB", 0) / 1.13
        mat_left = max(0, (j["costEst"] - j.get("labEst", 0)) - j.get("matQB", 0)) if j.get("costEst") else j.get("matLeft", 0)
        if j.get("start"): spread(j["start"], j["end"], max(0, j["sub"] - earned), mat_left)
        if j.get("costEst"):
            wip.append(dict(name=j["name"], pct=round(pct * 100), earned=round(earned), billed=round(billed),
                            underBilled=round(earned - billed), overBudget=incurred > j["costEst"] * 1.0001 and not j.get("scopeChanging"),
                            scopeChanging=bool(j.get("scopeChanging")), note=j.get("note", ""),
                            costIncurred=round(incurred), costEst=round(j["costEst"])))
    c = pi["contractsMonthly"] / 4.333
    fut = []
    for i in range(13):
        R = c + pi["serviceWeekly"] + rev[i]; V = c * 0.03 + pi["servicePartsWeekly"] + mat[i]
        fut.append(dict(week=str(F[i]), revenue=round(R), variable=round(V), fixed=round(pi["fixedWeekly"]), profit=round(R - V - pi["fixedWeekly"])))
    billed = [0.0] * 13
    for j in cash_jobs:
        for e in j.get("events", []):
            i = (D(e["date"]) - W0).days // 7
            if 0 <= i < 13: billed[i] += e["amount"] / 1.13
    for i, f in enumerate(fut):
        f["billedProfit"] = round(f["profit"] - rev[i] + billed[i]); f["jobsBilled"] = round(billed[i]); f["jobsEarned"] = round(rev[i])
    return dict(past=pi["past"], future=fut, wip=wip, pastQuarter=pi.get("pastQuarter"), notes=pi.get("notes", []),
                completed=pi.get("completed", []), jobDetail=pi.get("jobDetail", {}))

if __name__ == "__main__":
    inp = json.load(open(sys.argv[1]))
    data, closes = run(inp)
    json.dump(data, open(sys.argv[2], "w"))
    low = min(closes)
    print("Closing cash by week:", closes)
    print("Low:", low, "week of", data["weeks"][closes.index(low)]["start"])
