import test from 'node:test';
import assert from 'node:assert/strict';
import { BinImage } from '../src/image.js';
import { parseXdf } from '../src/xdf.js';
import { readItem, planWrites } from '../src/table.js';
import { pickPlugin } from '../src/checksums/index.js';
import { prepareSave, planChecksums, changedItems, SaveError } from '../src/save.js';
import { P, readText, readBin, tmpFile, pyVerify } from './helpers.js';

const ems = parseXdf(readText(P.ems2kXdf));
const ign = ems.items.find(i => i.title === 'Ignition - base advance');

function editedImage(file, name) {
  const im = new BinImage(readBin(file), name);
  const cells = [{ r: 0, c: 0, value: 33 }, { r: 5, c: 5, value: 11.25 }, { r: 15, c: 11, value: -7.5 }];
  im.apply('ign', planWrites(ign, im.working, cells).patches);
  assert.ok(im.editedOffsets().length > 0, 'the test edit changed nothing');
  return im;
}

test('EKII: a calibration edit is corrected and checksum.py agrees', () => {
  const im = editedImage(P.ekii, 'TB62572_EKII.bin');
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.deepEqual([res.fixed, res.notFixed, res.notCorrected], [['cal'], [], false]);
  assert.equal(res.binName, 'TB62572_EKII_edit.bin');
  assert.equal(res.zipName, 'TB62572_EKII_edit.zip');
  const py = pyVerify(tmpFile(res.binName, res.out));
  assert.deepEqual([py.boot.ok, py.prog.ok, py.cal.ok], [true, true, true]);
  const allowed = new Set([...im.editedOffsets(), 0x77fe0, 0x77fe1]);
  for (let i = 0; i < res.out.length; i++) {
    if (res.out[i] !== im.original[i] && !allowed.has(i)) assert.fail(`byte 0x${i.toString(16)} changed`);
  }
  assert.match(res.changeLog, /Ignition - base advance @0x75EF2: \d+ cells?, change /);
  assert.match(res.changeLog, /corrected: cal/);
  assert.equal(im.working[0x77fe0], im.original[0x77fe0], 'the working image is not modified by saving');
});

test('a program-area edit is never corrected and is marked in the name', () => {
  const im = editedImage(P.ekii, 'EKII.bin');
  im.apply('prog byte', [{ off: 0x20000, before: im.working[0x20000], after: im.working[0x20000] ^ 0xff }]);
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.deepEqual([res.fixed, res.notFixed, res.notCorrected], [['cal'], ['prog'], true]);
  assert.equal(res.binName, 'EKII_edit_CHECKSUM-NOT-FIXED.bin');
  assert.deepEqual([res.out[0x10010], res.out[0x10011]], [im.original[0x10010], im.original[0x10011]]);
  assert.equal(res.after.prog.ok, false);
  assert.match(res.changeLog, /NOT corrected: prog/);
  assert.match(res.changeLog, /Bytes changed outside XDF items: 1/);
});

test('EKIInonews: cal is corrected, the loaded prog mismatch is left exactly as it was', () => {
  const im = editedImage(P.nonews, 'nonews.bin');
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.deepEqual(res.fixed, ['cal']);
  assert.deepEqual(res.before.prog, { calc: 0x0263, stored: 0x5233, ok: false });
  assert.deepEqual(res.after.prog, { calc: 0x0263, stored: 0x5233, ok: false });
  assert.deepEqual([...res.out.subarray(0x10010, 0x10012)], [...im.original.subarray(0x10010, 0x10012)]);
});

test('unknown ECU: saved as-is and marked not fixed', () => {
  const msv = parseXdf(readText(P.msv70Xdf));
  const t = msv.items.find(i => i.kind === 'table' && !i.readOnly && i.z.rows > 1);
  const im = new BinImage(readBin(P.msv70Bin), 'S7581295.bin');
  const raw0 = readItem(t, im.working).raw[0][0];
  im.apply('x', planWrites(t, im.working, [{ r: 0, c: 0, value: raw0 ^ 1 }], { raw: true }).patches);
  const res = prepareSave(im, msv, pickPlugin(im.original));
  assert.equal(res.plugin, null);
  assert.equal(res.notCorrected, true);
  assert.equal(res.binName, 'S7581295_edit_CHECKSUM-NOT-FIXED.bin');
  assert.deepEqual(res.out, im.working);
  assert.match(res.changeLog, /no checksum plugin/);
});

test('no edits: identical bytes, plain name', () => {
  const im = new BinImage(readBin(P.ekii), 'EKII.bin');
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.deepEqual([res.fixed, res.notCorrected, res.binName], [[], false, 'EKII_edit.bin']);
  assert.deepEqual(res.out, im.original);
  assert.match(res.changeLog, /Changed items: 0/);
  assert.match(res.changeLog, /corrected: none needed/);
});

test('the self-check aborts on unexpected bytes or a failed correction', () => {
  const im = editedImage(P.ekii, 'EKII.bin');
  const real = pickPlugin(im.original).plugin;
  const rogue = { ...real, fix(img, region) { real.fix(img, region); img[0x70000] ^= 1; } };
  assert.throws(() => prepareSave(im, ems, { plugin: rogue, reasons: [] }), SaveError);
  const lazy = { ...real, fix() {} };
  assert.throws(() => prepareSave(im, ems, { plugin: lazy, reasons: [] }), /did not verify/);
});

test('planChecksums and changedItems', () => {
  const im = editedImage(P.ekii, 'EKII.bin');
  const p = planChecksums(im, pickPlugin(im.original));
  assert.deepEqual([p.fixed, p.notFixed], [['cal'], []]);
  const ch = changedItems(im, ems);
  assert.deepEqual(ch.map(c => c.item.title), ['Ignition - base advance']);
  assert.ok(ch[0].cells >= 1 && ch[0].cells <= 3);
});

test('an edit that breaks a checksum it could not correct is marked not fixed', () => {
  const im = new BinImage(readBin(P.ekii), 'EKII.bin');
  im.apply('cal range header', [{ off: 0x77fe4, before: im.working[0x77fe4], after: im.working[0x77fe4] ^ 1 }]);
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.deepEqual(res.fixed, []);
  assert.deepEqual(res.notFixed, ['cal']);
  assert.equal(res.after.cal.ok, false);
  assert.equal(res.notCorrected, true);
  assert.equal(res.binName, 'EKII_edit_CHECKSUM-NOT-FIXED.bin');
  assert.match(res.changeLog, /NOT corrected: cal \(edited bytes affect a checksum this tool does not correct\)/);
  assert.match(res.changeLog, /\n {2}corrected: none\n/);
});

test('EKII: a cal edit plus a cal range header edit is never corrected', () => {
  const im = editedImage(P.ekii, 'EKII.bin');
  im.apply('cal range header', [{ off: 0x77fe4, before: im.working[0x77fe4], after: im.working[0x77fe4] ^ 1 }]);
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.ok(!res.fixed.includes('cal'), `fixed is ${JSON.stringify(res.fixed)}`);
  assert.ok(res.notFixed.includes('cal'), `notFixed is ${JSON.stringify(res.notFixed)}`);
  assert.equal(new Set(res.notFixed).size, res.notFixed.length, 'notFixed has duplicates');
  assert.equal(res.notCorrected, true);
  assert.match(res.binName, /_edit_CHECKSUM-NOT-FIXED\.bin$/);
  assert.deepEqual([res.out[0x77fe0], res.out[0x77fe1]], [im.original[0x77fe0], im.original[0x77fe1]],
    'the cal CRC was recomputed over the edited range');
});

test('EKIInonews: an edit to the prog range table is marked not fixed', () => {
  const im = new BinImage(readBin(P.nonews), 'nonews.bin');
  im.apply('prog range table', [{ off: 0x10014, before: im.working[0x10014], after: im.working[0x10014] ^ 1 }]);
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.ok(res.notFixed.includes('prog'), `notFixed is ${JSON.stringify(res.notFixed)}`);
  assert.equal(res.notCorrected, true);
  assert.equal(res.binName, 'nonews_edit_CHECKSUM-NOT-FIXED.bin');
});
