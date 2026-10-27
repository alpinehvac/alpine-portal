#!/usr/bin/env python3
"""Alpine HVAC — Outbound map: pack a payload for obImport in outbound.html.

Usage: python3 outbound-pack.py <leads|customers|targets> <data.json> [chunk_chars]
Writes pack-<kind>-NN.txt files (base64 of gzip JSON {kind, data}), each small enough
to pass to obImport.add('...') in one Claude-in-Chrome javascript call.
"""
import base64, gzip, json, sys

kind, path = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 60000
data = json.load(open(path, encoding="utf-8"))
blob = base64.b64encode(gzip.compress(json.dumps({"kind": kind, "data": data}, ensure_ascii=False, separators=(",", ":")).encode())).decode()
parts = [blob[i:i + size] for i in range(0, len(blob), size)]
for n, p in enumerate(parts):
    open(f"pack-{kind}-{n:02d}.txt", "w").write(p)
print(f"{kind}: {len(data.get('rows', []))} rows -> {len(blob)} chars in {len(parts)} chunk(s)")
