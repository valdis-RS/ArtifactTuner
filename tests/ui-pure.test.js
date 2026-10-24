import test from 'node:test';
import assert from 'node:assert/strict';
import { demoFiles } from '../src/ui/demo.js';
import { itemMatches, itemDiff, diffLabel } from '../src/ui/sidebar.js';
import { niceTicks } from '../src/ui/graph2d.js';
import { parseXdf, checkBounds } from '../src/xdf.js';
import { readItem } from '../src/table.js';
import { BinImage } from '../src/image.js';
import { P, readText, readBin } from './helpers.js';

const ems = parseXdf(readText(P.ems2kXdf));
const ign = ems.items.find(i => i.title === 'Ignition - base advance');

test('example data parses and decodes to plausible values', () => {
  const d = demoFiles();
  const m = parseXdf(d.xdfText);
  assert.deepEqual(m.report.skipped, []);
  assert.deepEqual(m.items.map(i => i.title), ['Ignition advance (example)', 'Warm-up enrichment (example)', 'Rev limit (example)']);
  assert.deepEqual(checkBounds(m, d.bin.length), { sizeMismatch: false, disabled: 0 });
  const adv = readItem(m.items[0], d.bin);
  assert.deepEqual([adv.rows, adv.cols, adv.ys[0], adv.xs[11]], [16, 12, 800, 100]);
  for (const row of adv.phys) for (const v of row) assert.ok(v > -5 && v < 45, `advance ${v}`);
  const warm = readItem(m.items[1], d.bin);
  assert.equal(warm.xs[0], -30);
  assert.ok(warm.phys[0][0] > 1.5 && warm.phys[0][9] < 1.05);
  assert.equal(readItem(m.items[2], d.bin).phys[0][0], 6560);
  assert.equal(d.binName, 'example.bin');
});

test('search by title, description and hex address', () => {
  assert.equal(itemMatches(ign, ''), true);
  assert.equal(itemMatches(ign, 'BASE ADVANCE'), true);
  assert.equal(itemMatches(ign, 'knock-limited'), true);
  assert.equal(itemMatches(ign, '0x75F00'), true);          // inside the 192-byte table
  assert.equal(itemMatches(ign, '75ef2'), true);
  assert.equal(itemMatches(ign, '0x75FB2'), false);         // first byte after the table
  assert.equal(itemMatches(ign, 'lambda'), false);
});

test('itemDiff reports edits against the loaded file', () => {
  const im = new BinImage(readBin(P.ekii), 'a.bin');
  assert.equal(itemDiff(ign, im), null);
  const off = 0x75ef2 + 10;
  im.apply('x', [{ off, before: im.working[off], after: im.working[off] ^ 1 }]);
  assert.deepEqual(itemDiff(ign, im), { cells: 1, axes: false });
});

test('itemDiff flags value and axis differences against the compare file', () => {
  const im = new BinImage(readBin(P.ekii), 'a.bin');
  assert.equal(itemDiff(ign, im), null);
  const stock = readBin(P.ekii);
  stock[0x74356 + 2] ^= 1;                               // the compare file differs only in the RPM axis
  im.setReference(stock, 'stock.bin');
  assert.deepEqual(itemDiff(ign, im), { cells: 0, axes: true });
  assert.equal(itemDiff({ ...ign, disabled: true }, im), null);
  assert.equal(itemDiff(ign, null), null);
});

test('diffLabel says what differs', () => {
  assert.equal(diffLabel({ cells: 1, axes: false }), '1 cell');
  assert.equal(diffLabel({ cells: 23, axes: false }), '23 cells');
  assert.equal(diffLabel({ cells: 0, axes: true }), 'axes');
  assert.equal(diffLabel({ cells: 5, axes: true }), '5 cells + axes');
});

test('niceTicks covers the range with round steps', () => {
  assert.deepEqual(niceTicks(0, 10), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(-23.6, 72), [-40, -20, 0, 20, 40, 60, 80]);
  assert.deepEqual(niceTicks(0, 1), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(niceTicks(5, 5), [5, 6]);
});
