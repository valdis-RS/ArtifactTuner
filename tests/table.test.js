import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseXdf, itemSpans } from '../src/xdf.js';
import { readItem, planWrites, defaultStep, formatValue, formatAxis, axisValues, copyText, diffItem, deltaView, outsideDiffs } from '../src/table.js';
import { rawRange } from '../src/codec.js';
import { parseNumber } from '../src/ops.js';
import { P, APP, ROOT, readText, readBin, tmpFile } from './helpers.js';

const ems = parseXdf(readText(P.ems2kXdf));
const ekii = readBin(P.ekii);
const fxPath = tmpFile('ems2k_tables.json', '');
execFileSync('python3', [path.join(APP, 'tests', 'fixtures', 'make_fixtures.py'), fxPath],
  { env: { ...process.env, ARTIFACT_TUNER_DATA: ROOT } });
const fx = JSON.parse(readText(fxPath));
const itemAt = off => ems.items.find(i => i.z.offset === off);

test('diffItem counts differing cells and notices axis changes', () => {
  const ign = itemAt(0x75ef2);
  assert.equal(diffItem(ign, ekii, ekii), null);
  const b = ekii.slice();
  b[0x75ef2 + 13] ^= 1;
  b[0x75ef2 + 40] ^= 1;
  assert.deepEqual(diffItem(ign, ekii, b), { cells: 2, axes: false });
  const y = ekii.slice();
  y[0x74356 + 3] ^= 1;                                   // RPM axis only
  assert.deepEqual(diffItem(ign, ekii, y), { cells: 0, axes: true });
  y[0x75ef2] ^= 1;
  assert.deepEqual(diffItem(ign, ekii, y), { cells: 1, axes: true });
  const ve = itemAt(0x7c69a);                            // both bytes of one 16-bit cell count once
  const w = ekii.slice();
  w[0x7c69a] ^= 1;
  w[0x7c69a + 1] ^= 1;
  assert.deepEqual(diffItem(ve, ekii, w), { cells: 1, axes: false });
});

test('outsideDiffs lists changed bytes that no item covers', () => {
  assert.deepEqual(outsideDiffs(ems.items, ekii, ekii), { ranges: [], bytes: 0, erased: [] });
  const free = 0x71100;                                  // unused calibration space, inside no item
  assert.ok(!ems.items.some(i => itemSpans(i).some(([s, e]) => free >= s && free < e + 64)));
  const b = ekii.slice();
  b[0x75ef2 + 13] ^= 1;                                  // inside base ignition: the map shows it
  b[free] ^= 1;
  b[free + 3] ^= 1;                                      // 2 equal bytes apart: one place
  b[free + 40] ^= 1;                                     // far enough to be a second place
  assert.deepEqual(outsideDiffs(ems.items, ekii, b), {
    ranges: [{ start: free, end: free + 4, bytes: 2 }, { start: free + 40, end: free + 41, bytes: 1 }],
    bytes: 3, erased: [],
  });
});

test('outsideDiffs sets aside areas erased on one side only', () => {
  const b = ekii.slice();
  b.fill(0xff, 0, 0x70000);                              // a calibration-only file: code area blank
  b[0x71100] ^= 1;
  const out = outsideDiffs(ems.items, ekii, b);
  assert.deepEqual(out.ranges, [{ start: 0x71100, end: 0x71101, bytes: 1 }]);
  assert.equal(out.bytes, 1);
  assert.ok(out.erased.length >= 1 && out.erased.every(r => r.side === 'b' && r.end <= 0x70000));
  assert.equal(out.erased[0].start, 0);
  const flipped = outsideDiffs(ems.items, b, ekii);      // the blank file loaded as A
  assert.deepEqual(flipped.ranges, out.ranges);
  assert.ok(flipped.erased.every(r => r.side === 'a'));
  const short = ekii.slice();
  short.fill(0xff, 0x40000, 0x40000 + 255);              // under 256 bytes: an ordinary difference
  const s = outsideDiffs(ems.items, ekii, short);
  assert.deepEqual(s.erased, []);
  assert.ok(s.bytes > 0);
});

test('diffItem checks each axis element, not the bytes between strided elements', () => {
  const E = o => ({ offset: 0, bits: 8, signed: false, lsbFirst: true, float: false, colMajor: false,
    rows: 1, cols: 1, majorStride: 0, minorStride: 0, ...o });
  const item = { z: E({ offset: 4 }), x: { kind: 'embedded', count: 2, elem: E({ cols: 2, minorStride: 16 }) }, y: null };
  const a = new Uint8Array(8);
  const gap = a.slice();
  gap[1] = 9;                                            // between axis elements 0 (byte 0) and 1 (byte 2)
  assert.equal(diffItem(item, a, gap), null);
  const axis = a.slice();
  axis[2] = 1;
  assert.deepEqual(diffItem(item, a, axis), { cells: 0, axes: true });
});

test('deltaView gives A − B for changed cells and blanks the rest', () => {
  const ign = itemAt(0x75ef2);
  assert.ok(ekii[0x75ef2 + 13] < 250 && ekii[0x75ef2 + 40] > 0, 'test cells must not wrap');
  const b = ekii.slice();
  b[0x75ef2 + 13] += 2;                                  // B two raw steps higher at row 1, col 1
  b[0x75ef2 + 40] -= 1;                                  // B one raw step lower at row 3, col 4
  const dv = deltaView(readItem(ign, ekii), readItem(ign, b));
  assert.equal(dv.cells[1][1], -0.75);
  assert.equal(dv.cells[3][4], 0.375);
  assert.deepEqual([dv.changed[1][1], dv.changed[3][4], dv.changed[0][0]], [true, true, false]);
  assert.equal(dv.cells[0][0], 0);
  assert.equal(dv.maxAbs, 0.75);
  assert.equal(dv.changed.flat().filter(Boolean).length, 2);
  const raw = deltaView(readItem(ign, ekii), readItem(ign, b), true);
  assert.deepEqual([raw.cells[1][1], raw.cells[3][4], raw.maxAbs], [-2, 1, 2]);
  const same = deltaView(readItem(ign, ekii), readItem(ign, ekii));
  assert.equal(same.maxAbs, 0);
});

test('decoded tables match the independent Python read', () => {
  for (const off of [0x75ef2, 0x7c69a]) {
    const want = fx['0x' + off.toString(16)];
    const got = readItem(itemAt(off), ekii);
    assert.equal(itemAt(off).title, want.title);
    assert.deepEqual(got.phys, want.z);
    assert.deepEqual(got.xs, want.x);
    assert.deepEqual(got.ys, want.y);
    assert.equal(got.raw.length, got.rows);
  }
});

test('physical write rounds to the raw step and reports clamping', () => {
  const ign = itemAt(0x75ef2);
  const img = ekii.slice();
  const { patches, clamped } = planWrites(ign, img, [{ r: 0, c: 0, value: 20 }, { r: 0, c: 1, value: 1000 }]);
  const expect = [[0x75ef2, 116], [0x75ef3, 255]].filter(([o, v]) => img[o] !== v);
  assert.deepEqual(patches.map(p => [p.off, p.after]), expect);
  for (const p of patches) assert.equal(p.before, ekii[p.off]);
  assert.deepEqual(clamped, [{ r: 0, c: 1, value: 1000, stored: 72 }]);
});

test('16-bit little-endian write puts the low byte first', () => {
  const ve = itemAt(0x7c69a);
  const { patches } = planWrites(ve, new Uint8Array(ekii.length), [{ r: 1, c: 2, value: 0.75 }]);   // raw 0x6000
  const off = 0x7c69a + (1 * 12 + 2) * 2;
  assert.deepEqual(patches, [{ off: off + 1, before: 0, after: 0x60 }]);
});

test('raw mode writes raw values and clamps to the type range', () => {
  const ign = itemAt(0x75ef2);
  const { patches, clamped } = planWrites(ign, new Uint8Array(ekii.length), [{ r: 0, c: 0, value: 300 }], { raw: true });
  assert.deepEqual(patches, [{ off: 0x75ef2, before: 0, after: 255 }]);
  assert.deepEqual(clamped, [{ r: 0, c: 0, value: 300, stored: 255 }]);
});

test('writing the current value produces no patches', () => {
  const ign = itemAt(0x75ef2);
  const v = readItem(ign, ekii).phys[3][4];
  assert.deepEqual(planWrites(ign, ekii, [{ r: 3, c: 4, value: v }]).patches, []);
});

test('read-only and disabled items refuse writes', () => {
  const ign = itemAt(0x75ef2);
  assert.throws(() => planWrites({ ...ign, readOnly: true, reason: 'x' }, ekii, []), /read-only/);
  assert.throws(() => planWrites({ ...ign, disabled: true, disabledReason: 'y' }, ekii, []), /disabled/);
});

test('cells outside the table are refused', () => {
  const ign = itemAt(0x75ef2);
  for (const cell of [{ r: 16, c: 0 }, { r: 0, c: 12 }, { r: -1, c: 0 }, { r: 1.5, c: 0 }]) {
    assert.throws(() => planWrites(ign, ekii, [{ ...cell, value: 10 }]), /outside/, JSON.stringify(cell));
  }
  assert.throws(() => planWrites(ign, ekii, [{ r: 16, c: 0, value: 10 }]),
    /Cell \(16, 0\) is outside Ignition - base advance \(16 × 12\)/);
  assert.doesNotThrow(() => planWrites(ign, ekii, [{ r: 15, c: 11, value: 10 }]));   // the last cell is inside
});

test('steps, axes and formatting', () => {
  const ign = itemAt(0x75ef2);
  assert.equal(defaultStep(ign), 0.375);
  assert.equal(defaultStep(ign, true), 1);
  assert.deepEqual(axisValues({ kind: 'index', count: 3 }, ekii), [0, 1, 2]);
  assert.deepEqual(axisValues(null, ekii), []);
  assert.equal(formatValue(1.5, 2), '1.50');
  assert.equal(formatAxis({ kind: 'labels' }, 'lo'), 'lo');
  assert.equal(formatAxis({ kind: 'index' }, 4), '4');
  assert.equal(formatAxis(ign.y, 3200), '3200');
});

test('copied text pastes back to the same raw for every writable element kind', () => {
  const msv = parseXdf(readText(P.msv70Xdf));
  const seen = new Set(), rawsSeen = new Set();
  for (const m of [ems, msv]) {
    for (const it of m.items) {
      for (const e of [it.z, it.x?.elem, it.y?.elem]) {
        if (!e || !e.conv.toRaw) continue;
        const key = `${e.equation}|${e.bits}|${e.signed}|${e.float}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [lo, hi] = rawRange(e);
        const n = e.bits <= 16 ? hi - lo : 10000;
        const rawCheck = !rawsSeen.has(`${lo}|${hi}`);           // raw-mode copies: once per raw range
        rawsSeen.add(`${lo}|${hi}`);
        for (let k = 0; k <= n; k++) {
          const raw = e.bits <= 16 ? lo + k : lo + Math.round(((hi - lo) * k) / n);
          const text = copyText(e.conv.f(raw));
          const back = e.conv.toRaw(parseNumber(text)).raw;
          if (back !== raw) assert.fail(`${key}: raw ${raw} copied as "${text}" pasted back as ${back}`);
          if (rawCheck && Number.isInteger(raw) && parseNumber(copyText(raw)) !== raw) assert.fail(`${key}: raw ${raw} copied as "${copyText(raw)}"`);
        }
      }
    }
  }
  assert.ok(rawsSeen.size >= 4, `only ${rawsSeen.size} raw ranges checked`);
  assert.ok(seen.size > 50, `only ${seen.size} element kinds checked`);
  for (const v of [0.1, 16.13, -23.625, 3.4028234663852886e38, 1.401298464324817e-45, 1 / 3]) {
    const f = Math.fround(v);
    assert.equal(Math.fround(parseNumber(copyText(f))), f, `float32 ${f}`);
  }
  assert.equal(copyText(16.125), '16.125');
  assert.equal(copyText(NaN), 'NaN');
});
