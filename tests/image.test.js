import test from 'node:test';
import assert from 'node:assert/strict';
import { BinImage } from '../src/image.js';

test('apply, undo and redo', () => {
  const im = new BinImage(Uint8Array.from([1, 2, 3, 4]), 'a.bin');
  assert.equal(im.apply('none', []), false);
  assert.equal(im.undoStack.length, 0);
  assert.equal(im.apply('set', [{ off: 1, before: 2, after: 9 }, { off: 3, before: 4, after: 8 }]), true);
  assert.deepEqual([...im.working], [1, 9, 3, 8]);
  assert.deepEqual(im.editedOffsets(), [1, 3]);
  assert.equal(im.undo().label, 'set');
  assert.deepEqual([...im.working], [1, 2, 3, 4]);
  assert.deepEqual(im.editedOffsets(), []);
  assert.equal(im.redo().label, 'set');
  assert.deepEqual([...im.working], [1, 9, 3, 8]);
  assert.equal(im.redo(), null);
  assert.equal(new BinImage(new Uint8Array(1), 'b').undo(), null);
});

test('a new edit clears redo', () => {
  const im = new BinImage(new Uint8Array(4), 'a');
  im.apply('a', [{ off: 0, before: 0, after: 1 }]);
  im.undo();
  im.apply('b', [{ off: 1, before: 0, after: 1 }]);
  assert.equal(im.redo(), null);
  assert.deepEqual(im.undoStack.map(g => g.label), ['b']);
});

test('editing a byte back to its original value is not an edit', () => {
  const im = new BinImage(Uint8Array.from([5]), 'a');
  im.apply('up', [{ off: 0, before: 5, after: 6 }]);
  im.apply('back', [{ off: 0, before: 6, after: 5 }]);
  assert.deepEqual(im.editedOffsets(), []);
});

test('the original is a private copy and never changes', () => {
  const src = Uint8Array.from([1, 2]);
  const im = new BinImage(src, 'a');
  src[0] = 99;
  im.apply('x', [{ off: 1, before: 2, after: 7 }]);
  assert.deepEqual([...im.original], [1, 2]);
  assert.deepEqual([...im.working], [1, 7]);
});

test('reference compare and size check', () => {
  const im = new BinImage(Uint8Array.from([1, 2, 3]), 'a');
  assert.equal(im.reference, im.original);
  const stock = Uint8Array.from([1, 0, 3]);
  im.setReference(stock, 'stock.bin');
  stock[0] = 9;                                          // the reference is a private copy
  assert.equal(im.referenceName, 'stock.bin');
  assert.deepEqual([...im.reference], [1, 0, 3]);
  assert.throws(() => im.setReference(new Uint8Array(2), 'x'), /2 bytes but the loaded BIN is 3 bytes/);
  im.clearReference();
  assert.equal(im.referenceName, '');
  assert.equal(im.reference, im.original);
});

test('unsaved tracking', () => {
  const im = new BinImage(new Uint8Array(2), 'a');
  assert.equal(im.unsaved, false);
  im.apply('x', [{ off: 0, before: 0, after: 1 }]);
  assert.equal(im.unsaved, true);
  im.markSaved();
  assert.equal(im.unsaved, false);
  im.undo();
  assert.equal(im.unsaved, true);
});
