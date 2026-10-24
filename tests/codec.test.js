import test from 'node:test';
import assert from 'node:assert/strict';
import { cellOffset, elemSpan, rawRange, readRaw, encodeRaw, FLT_MAX } from '../src/codec.js';

const E = o => ({ offset: 0, bits: 8, signed: false, lsbFirst: true, float: false, colMajor: false,
  rows: 1, cols: 1, majorStride: 0, minorStride: 0, ...o });

test('16-bit little- and big-endian, signed and unsigned', () => {
  const img = Uint8Array.from([0x12, 0x34, 0xff, 0xfe]);
  assert.equal(readRaw(img, E({ bits: 16 }), 0, 0), 0x3412);
  assert.equal(readRaw(img, E({ bits: 16, lsbFirst: false }), 0, 0), 0x1234);
  assert.equal(readRaw(img, E({ bits: 16, offset: 2, signed: true }), 0, 0), -257);
  assert.equal(readRaw(img, E({ bits: 16, offset: 2, signed: true, lsbFirst: false }), 0, 0), -2);
});

test('32-bit integers and floats', () => {
  const img = new Uint8Array(8);
  const dv = new DataView(img.buffer);
  dv.setUint32(0, 0xdeadbeef, false);
  dv.setFloat32(4, 1.5, true);
  assert.equal(readRaw(img, E({ bits: 32, lsbFirst: false }), 0, 0), 0xdeadbeef);
  assert.equal(readRaw(img, E({ bits: 32, offset: 4, float: true }), 0, 0), 1.5);
});

test('row-major, column-major and strided cell offsets', () => {
  assert.equal(cellOffset(E({ offset: 100, bits: 16, rows: 3, cols: 4 }), 2, 1), 100 + (2 * 4 + 1) * 2);
  assert.equal(cellOffset(E({ offset: 100, bits: 16, rows: 3, cols: 4, colMajor: true }), 2, 1), 100 + (1 * 3 + 2) * 2);
  assert.equal(cellOffset(E({ bits: 8, rows: 2, cols: 3, minorStride: 16 }), 1, 2), 10);
  assert.equal(cellOffset(E({ bits: 8, rows: 2, cols: 3, majorStride: 64 }), 1, 2), 10);
  assert.deepEqual(elemSpan(E({ offset: 10, bits: 16, rows: 2, cols: 3 })), [10, 22]);
});

test('raw ranges', () => {
  assert.deepEqual(rawRange(E({ bits: 8 })), [0, 255]);
  assert.deepEqual(rawRange(E({ bits: 16, signed: true })), [-32768, 32767]);
  assert.deepEqual(rawRange(E({ bits: 32 })), [0, 4294967295]);
  assert.deepEqual(rawRange(E({ bits: 32, float: true })), [-FLT_MAX, FLT_MAX]);
});

test('encodeRaw is the inverse of readRaw', () => {
  const elems = [E({ bits: 8, signed: true }), E({ bits: 16 }), E({ bits: 16, lsbFirst: false, signed: true }),
    E({ bits: 32, lsbFirst: false }), E({ bits: 32, signed: true }), E({ bits: 32, float: true })];
  for (const e of elems) {
    const [lo, hi] = rawRange(e);
    const values = e.float ? [-2.5, 0, 1024.25] : e.signed ? [lo, -1, 0, 1, hi] : [lo, 1, hi];
    for (const v of values) assert.equal(readRaw(encodeRaw(e, v), e, 0, 0), v, `${JSON.stringify(e)} ${v}`);
  }
});
