"""Decode gz2-catalogue.json (Rosse's "Any Galaxy Zoo 2 galaxy" catalogue) into Python arrays.

Layout: base64 -> gzip -> for each field in hdr["fields"], N bytes (one per galaxy);
then RA and Dec as 24-bit planes (3 x N bytes each, high byte first); then object IDs as
delta-coded unsigned LEB128 varints (each ID = previous ID + varint).

Byte -> value (as in Rosse's catVotes / catExtra / showCat):
  vote fractions (smooth ... acant):  byte / 15        (so 0..17; >1 means rounding headroom; clip to 1)
  q (axis ratio b/a):                 (byte - 1) / 254, 0 = missing (Rosse uses 0.8)
  pa (position angle, deg):           byte / 255 * 180
  wind (Galaxy Zoo 1 winding):        signed byte / 127 (|w| > 0.25 treated as a winding sense)
  nvotes:                             byte (number of volunteers, capped)
  conc:  byte / 60 + 1     r90: byte / 4     gr: byte / 170 - 0.3     z: byte / 800
  fdev:  (byte - 1) / 254              (0 = missing for conc, r90, gr, z, fdev)
"""
import base64, gzip, json, sys
import numpy as np

def decode(path="gz2-catalogue.json"):
    c = json.load(open(path)); h = c["hdr"]; N = h["n"]; F = h["fields"]
    buf = np.frombuffer(gzip.decompress(base64.b64decode(c["b64"])), dtype=np.uint8)
    off, cols = 0, {}
    for f in F:
        cols[f] = buf[off:off + N].copy(); off += N
    def u24(o):
        a, b, cc = (buf[o + k * N:o + (k + 1) * N].astype(np.uint32) for k in range(3))
        return ((a << 16) | (b << 8) | cc) / 16777215.0
    ra = u24(off) * 360.0; off += 3 * N
    dec = u24(off) * 180.0 - 90.0; off += 3 * N
    ids, cur, j = [], 0, off
    for _ in range(N):
        v = sh = 0
        while True:
            byte = int(buf[j]); j += 1; v |= (byte & 127) << sh; sh += 7
            if not byte & 128: break
        cur += v; ids.append(cur)
    return {"n": N, "cols": cols, "ra": ra, "dec": dec, "objid": ids}

if __name__ == "__main__":
    cat = decode(sys.argv[1] if len(sys.argv) > 1 else "gz2-catalogue.json")
    print(cat["n"], "galaxies; first:", cat["objid"][0], round(cat["ra"][0], 5), round(cat["dec"][0], 5))
