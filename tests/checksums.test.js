import test from 'node:test';
import assert from 'node:assert/strict';
import { ems2k } from '../src/checksums/ems2k.js';
import { pickPlugin } from '../src/checksums/index.js';
import { BinImage } from '../src/image.js';
import { prepareSave, SaveError } from '../src/save.js';
import { P, readBin, tmpFile, pyVerify } from './helpers.js';

test('verify matches checksum.py on all three EMS2K reads', () => {
  for (const f of [P.ekii, P.nonews, P.mapswitch]) assert.deepEqual(ems2k.verify(readBin(f)), pyVerify(f), f);
  assert.deepEqual(ems2k.verify(readBin(P.nonews)).prog, { calc: 0x0263, stored: 0x5233, ok: false });
  assert.deepEqual(ems2k.verify(readBin(P.ekii)).cal, { calc: 0xfb17, stored: 0xfb17, ok: true });
});

test('detect accepts the EMS2K reads and explains rejections', () => {
  for (const f of [P.ekii, P.nonews, P.mapswitch]) assert.deepEqual(ems2k.detect(readBin(f)), { ok: true, reason: '' });
  assert.match(ems2k.detect(readBin(P.msv70Bin)).reason, /not a 512 KB/);
  const badCal = readBin(P.ekii);
  badCal[0x75ef2] ^= 1;
  assert.match(ems2k.detect(badCal).reason, /does not match/);
  const noTable = readBin(P.ekii);
  noTable[0x11234] ^= 1;
  assert.match(ems2k.detect(noTable).reason, /no CRC-16\/ARC table/);
  const badHeader = readBin(P.ekii);
  badHeader[0x77fe2] = 0;                                         // zero cal ranges
  assert.match(ems2k.detect(badHeader).reason, /calibration checksum header/);
});

test('pickPlugin', () => {
  assert.equal(pickPlugin(readBin(P.ekii)).plugin, ems2k);
  const none = pickPlugin(readBin(P.msv70Bin));
  assert.equal(none.plugin, null);
  assert.equal(none.reasons.length, 1);
  assert.match(none.reasons[0].reason, /not a 512 KB/);
});

test('fix(cal) after an edit satisfies checksum.py', () => {
  const img = readBin(P.ekii);
  img[0x75ef2] = (img[0x75ef2] + 1) & 0xff;
  ems2k.fix(img, 'cal');
  const v = pyVerify(tmpFile('fixed.bin', img));
  assert.deepEqual([v.boot.ok, v.prog.ok, v.cal.ok], [true, true, true]);
  assert.throws(() => ems2k.fix(img, 'prog'), /never corrected/);
  assert.throws(() => ems2k.fix(img, 'boot'), /never corrected/);
});

test('the cal-only rule cannot be changed at run time', () => {
  const img = readBin(P.ekii);
  assert.throws(() => ems2k.fixable.push('prog'), TypeError);
  assert.deepEqual(ems2k.fixable, ['cal']);
  const { fix } = ems2k;
  assert.throws(() => fix(img, 'prog'), /never corrected/);
  assert.throws(() => fix.call({ fixable: ['prog'] }, img, 'prog'), /never corrected/);
});

test('coverage and storedAt', () => {
  const img = readBin(P.ekii);
  const cov = ems2k.coverage(img);
  assert.deepEqual(cov.cal, [[0x70094, 0x77fdf], [0x78000, 0x7ef03]]);
  assert.deepEqual(cov.boot, [[0x0, 0x3d8f]]);
  assert.equal(cov.prog.length, 6);
  assert.deepEqual(ems2k.storedAt(img, 'cal'), [0x77fe0, 0x77fe1]);
  assert.deepEqual(ems2k.layout(img).cal, { at: 0x77fe0, seed: 0x3046, ranges: cov.cal });
});

test('a checksum range that points outside the file is refused', () => {
  const img = readBin(P.ekii);
  img[0x77fea] = 0xff;                                            // segment word of the first cal range end
  assert.match(ems2k.detect(img).reason, /outside the file/);
  assert.throws(() => ems2k.layout(img), RangeError);
  const im = new BinImage(readBin(P.ekii), 'EKII.bin');
  im.apply('cal range end segment', [{ off: 0x77fea, before: im.working[0x77fea], after: 0xff }]);
  assert.throws(() => prepareSave(im, null, pickPlugin(im.original)),
    err => err instanceof SaveError && /points outside the file/.test(err.message));
});
