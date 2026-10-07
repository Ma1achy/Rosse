"""Reference vectors for the catalogue decode, from assets/data/rosse/decode_gz2_catalogue.py.

Writes tests/vectors/gz2-catalogue.json: for every column the SHA-256 of its bytes, of RA and Dec
(float64, little endian) and of the object ids (uint64, little endian), plus sampled rows with
every field's byte and the decoded RA, Dec and id. tests/unit/catalogue.test.ts and
tests/gpu/catalogue.ts check the TypeScript decode against it, exactly.

    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install numpy
    /tmp/venv/bin/python tools/catalogue-reference/make_vectors.py
    npx prettier --write tests/vectors/gz2-catalogue.json
"""
import hashlib, json, os, sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "assets", "data", "rosse"))
from decode_gz2_catalogue import decode  # noqa: E402

cat = decode(os.path.join(ROOT, "assets", "data", "rosse", "gz2-catalogue.json"))
N = cat["n"]
sha = lambda b: hashlib.sha256(b).hexdigest()
fields = list(cat["cols"].keys())

c = cat["cols"]
# v21's TYPES (app23.js:L1797) as numpy masks on the byte columns: the counts the tools must give
masks = {
    "any": np.ones(N, bool),
    "a spiral": (c["spiral"] > 10) & (c["feat"] > 9),
    "barred": c["bar"] > 11,
    "edge-on": c["edge"] > 12,
    "smooth": c["smooth"] > 12,
    "merger": (c["odd"] > 9) & (c["merger"] > 9),
    "ring": (c["odd"] > 9) & (c["ring"] > 10),
    "irregular": (c["odd"] > 9) & (c["irregular"] > 9),
    "many arms": (c["spiral"] > 10) & ((c["amore"] > 7) | (c["a4"] > 7)),
    "tight arms": (c["spiral"] > 10) & (c["tight"] > 10),
    "loose arms": (c["spiral"] > 10) & (c["loose"] > 9),
}
type_counts = {k: int(m.sum()) for k, m in masks.items()}
type_first = {k: [int(i) for i in np.flatnonzero(m)[:5]] for k, m in masks.items()}

ids = np.array(cat["objid"], dtype="<u8")
rows = sorted(set([0, 1, 2, N - 2, N - 1] + list(range(0, N, 997))))
out = {
    "about": "Reference for the catalogue decode, from assets/data/rosse/decode_gz2_catalogue.py "
    "(tools/catalogue-reference/make_vectors.py). Checksums are SHA-256 of each column's bytes "
    "(ra, dec: float64 little endian; objid: uint64 little endian).",
    "n": N,
    "fields": fields,
    "sha256": {
        **{f: sha(cat["cols"][f].tobytes()) for f in fields},
        "ra": sha(cat["ra"].astype("<f8").tobytes()),
        "dec": sha(cat["dec"].astype("<f8").tobytes()),
        "objid": sha(ids.tobytes()),
    },
    "typeCounts": type_counts,
    "typeFirst": type_first,
    "rowIndices": rows,
    "rows": [
        {
            "i": i,
            "objid": str(cat["objid"][i]),
            "ra": float(cat["ra"][i]),
            "dec": float(cat["dec"][i]),
            "bytes": [int(cat["cols"][f][i]) for f in fields],
        }
        for i in rows
    ],
}
dest = os.path.join(ROOT, "tests", "vectors", "gz2-catalogue.json")
with open(dest, "w") as fh:
    json.dump(out, fh)
print(dest, len(rows), "rows")
