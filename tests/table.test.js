import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseXdf } from '../src/xdf.js';
import { readItem, planWrites, defaultStep, formatValue, formatAxis, axisValues } from '../src/table.js';
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
