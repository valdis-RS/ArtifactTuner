import test from 'node:test';
import assert from 'node:assert/strict';
import { normSel, opSet, opAdd, opScale, opRevert, opInterpolate, opSmooth, toTsv, parseTsv, opPaste, parseNumber, strictlyMonotonic } from '../src/ops.js';

const G = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
const val = cells => cells.map(c => c.value);

test('set, add, scale and revert cover the normalised selection', () => {
  const sel = { r0: 1, c0: 2, r1: 0, c1: 1 };                     // dragged up and to the left
  assert.deepEqual(normSel(sel), { r0: 0, c0: 1, r1: 1, c1: 2 });
  assert.deepEqual(opSet(G, sel, 0).map(c => [c.r, c.c]), [[0, 1], [0, 2], [1, 1], [1, 2]]);
  assert.deepEqual(val(opAdd(G, sel, 1)), [3, 4, 6, 7]);
  assert.deepEqual(val(opScale(G, sel, 50)), [3, 4.5, 7.5, 9]);
  assert.deepEqual(val(opRevert([[0, 0, 0], [0, 0, 0], [0, 0, 0]], sel)), [0, 0, 0, 0]);
});

test('horizontal interpolation by position and by axis value', () => {
  const g = [[0, 99, 10], [0, 0, 0]];
  const row = { r0: 0, c0: 0, r1: 0, c1: 2 };
  assert.deepEqual(val(opInterpolate(g, row, 'h')), [0, 5, 10]);
  assert.deepEqual(val(opInterpolate(g, row, 'h', [1000, 1500, 3000])), [0, 2.5, 10]);
  assert.deepEqual(val(opInterpolate(g, row, 'h', ['a', 'b', 'c'])), [0, 5, 10]);
  assert.deepEqual(val(opInterpolate(g, row, 'h', [1, 1, 2])), [0, 5, 10]);   // not strictly monotonic
});

test('vertical and bilinear interpolation', () => {
  const g = [[0, 0, 10], [0, 0, 0], [20, 0, 30]];
  assert.deepEqual(val(opInterpolate(g, { r0: 0, c0: 0, r1: 2, c1: 0 }, 'v')), [0, 10, 20]);
  assert.deepEqual(val(opInterpolate(g, { r0: 0, c0: 0, r1: 2, c1: 2 }, 'bilinear')), [0, 5, 10, 10, 15, 20, 20, 25, 30]);
  assert.deepEqual(val(opInterpolate(g, { r0: 0, c0: 0, r1: 0, c1: 2 }, 'bilinear')), [0, 5, 10]);  // one row falls back to 'h'
});

test('smooth averages within the selection only', () => {
  assert.deepEqual(val(opSmooth(G, { r0: 0, c0: 0, r1: 1, c1: 1 })), [3, 3, 3, 3]);
  const all = opSmooth(G, { r0: 0, c0: 0, r1: 2, c1: 2 });
  assert.equal(all[4].value, 5);
  assert.equal(all[0].value, 3);
});

test('TSV copy and parse', () => {
  assert.equal(toTsv(G, { r0: 0, c0: 1, r1: 1, c1: 2 }, v => v.toFixed(1)), '2.0\t3.0\n5.0\t6.0');
  assert.deepEqual(parseTsv('1\t2,5\r\n-3\t4e1\n'), [[1, 2.5], [-3, 40]]);
  assert.throws(() => parseTsv('1\tx'), /"x" is not a number/);
  assert.throws(() => parseTsv('  \n'), /Nothing to paste/);
});

test('paste is clipped to the table; a single value fills the selection', () => {
  const p = opPaste(G, { r0: 2, c0: 1, r1: 2, c1: 1 }, [[10, 11, 12], [13, 14, 15]]);
  assert.deepEqual(p, [{ r: 2, c: 1, value: 10 }, { r: 2, c: 2, value: 11 }]);
  assert.deepEqual(val(opPaste(G, { r0: 0, c0: 0, r1: 1, c1: 0 }, [[7]])), [7, 7]);
});

test('parseNumber and strictlyMonotonic', () => {
  assert.equal(parseNumber(' 2,5 '), 2.5);
  assert.equal(parseNumber('-1e2'), -100);
  assert.ok(Number.isNaN(parseNumber('')));
  assert.ok(Number.isNaN(parseNumber('x')));
  assert.equal(strictlyMonotonic([1, 2, 5]), true);
  assert.equal(strictlyMonotonic([3, 2, 1]), true);
  assert.equal(strictlyMonotonic([1, 1, 2]), false);
  assert.equal(strictlyMonotonic([7]), true);
});

test('parseNumber reads decimals only and refuses the ambiguous thousands form', () => {
  assert.ok(Number.isNaN(parseNumber('1,500')));
  assert.ok(Number.isNaN(parseNumber('-1,500')));
  assert.equal(parseNumber('0,125'), 0.125);
  assert.equal(parseNumber('1,5'), 1.5);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('1e3'), 1000);
  assert.equal(parseNumber('-.5'), -0.5);
  assert.ok(Number.isNaN(parseNumber('0x10')));
  assert.ok(Number.isNaN(parseNumber('0b11')));
  assert.equal(parseNumber(' 7 '), 7);
  assert.throws(() => parseTsv('1,500'), /ambiguous/);
  assert.deepEqual(parseTsv('1\t2,5\r\n-3\t4e1\n'), [[1, 2.5], [-3, 40]]);
});
