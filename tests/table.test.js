import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseXdf } from '../src/xdf.js';
import { readItem, planWrites, defaultStep, formatValue, formatAxis, axisValues, copyText } from '../src/table.js';
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
