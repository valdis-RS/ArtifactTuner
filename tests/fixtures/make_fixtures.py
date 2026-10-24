"""Independent decode of two EMS2K tables straight from the XDF text and the
BIN bytes (regex + struct + eval of the equation; no code shared with the JS
engine). The test runs this into a temp folder: decoded ECU data is never
committed to the repository.

Usage: python3 tests/fixtures/make_fixtures.py OUT.json
"""
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('ARTIFACT_TUNER_DATA') or os.path.abspath(os.path.join(HERE, '..', '..', '..'))
XDF = os.path.join(ROOT, 'Mini', 'EMS2K_111441901203EHC3.xdf')
BIN = os.path.join(ROOT, 'Mini', 'TB62572_EMS2K_111441901203EHC3_fullread_EKII.bin')
TABLES = [0x75EF2, 0x7C69A]


def attr(block, name, default=None):
    m = re.search(name + r'="([^"]+)"', block)
    return m.group(1) if m else default


def element(block):
    ed = re.search(r'<EMBEDDEDDATA[^>]*/>', block).group(0)
    flags = int(attr(ed, 'mmedtypeflags', '0'), 16)
    bits = int(attr(ed, 'mmedelementsizebits', '8'))
    code = {8: 'B', 16: 'H', 32: 'I'}[bits]
    if flags & 1:
        code = code.lower()
    fmt = ('<' if flags & 2 else '>') + code
    eq = re.search(r'equation="([^"]+)"', block).group(1)
    return int(attr(ed, 'mmedaddress'), 16), bits // 8, fmt, eq


def decode(img, addr, size, fmt, eq, n):
    return [eval(eq, {}, {'X': struct.unpack_from(fmt, img, addr + i * size)[0]}) for i in range(n)]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    xdf = open(XDF, encoding='utf-8').read()
    img = open(BIN, 'rb').read()
    out = {}
    for t in re.findall(r'<XDFTABLE.*?</XDFTABLE>', xdf, re.S):
        axes = {m.group(1): m.group(0) for m in re.finditer(r'<XDFAXIS id="(\w)".*?</XDFAXIS>', t, re.S)}
        za, zs, zf, zeq = element(axes['z'])
        if za not in TABLES:
            continue
        rows = int(attr(axes['z'], 'mmedrowcount'))
        cols = int(attr(axes['z'], 'mmedcolcount'))
        flat = decode(img, za, zs, zf, zeq, rows * cols)
        xa, xs, xf, xeq = element(axes['x'])
        ya, ys, yf, yeq = element(axes['y'])
        out[hex(za)] = {
            'title': re.search(r'<title>(.*?)</title>', t).group(1),
            'x': decode(img, xa, xs, xf, xeq, cols),
            'y': decode(img, ya, ys, yf, yeq, rows),
            'z': [flat[r * cols:(r + 1) * cols] for r in range(rows)],
        }
    assert sorted(out) == sorted(hex(a) for a in TABLES), list(out)
    with open(sys.argv[1], 'w') as f:
        json.dump(out, f, indent=1)
    print('wrote', len(out), 'tables')


if __name__ == '__main__':
    main()
