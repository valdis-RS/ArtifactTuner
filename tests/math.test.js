import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, converter, MathError } from '../src/math.js';

const FLT_MAX = 3.4028234663852886e38;

test('compiles the equation forms used by real XDFs', () => {
  const cases = [
    ['X', 7, 7],
    ['X*0.75-48', 100, 27],
    ['(X-128)*0.375', 136, 3],
    ['X*0.375-23.625', 63, 0],
    ['X/32768', 16384, 0.5],
    ['0.750000 * X+ -48.000000', 100, 27],
    ['1.000000 * X+ -32768.000000', 32769, 1],
    ['X/256*0.75-48', 25600, 27],
    ['2^3+X', 1, 9],
    ['-X+10', 4, 6],
    ['x * 2', 3, 6],
    ['1e2*X', 2, 200],
  ];
  for (const [eq, x, y] of cases) assert.equal(compile(eq)(x), y, eq);
});

test('rejects unsupported syntax', () => {
  for (const eq of ['ABS(X)', 'X*', '(X+1', 'X Y', '']) assert.throws(() => compile(eq), MathError, eq);
});

test('linear converter inverts exactly over the full 8-bit range', () => {
  const c = converter('X*0.375-23.625', 0, 255, false);
  assert.equal(c.linear, true);
  assert.equal(c.step, 0.375);
  for (let r = 0; r <= 255; r++) assert.deepEqual(c.toRaw(c.f(r)), { raw: r, clamped: false });
});

test('linear converter rounds to the nearest raw step and clamps', () => {
  const c = converter('X*0.375-23.625', 0, 255, false);
  assert.deepEqual(c.toRaw(20), { raw: 116, clamped: false });   // (20 + 23.625) / 0.375 = 116.33
  assert.deepEqual(c.toRaw(1000), { raw: 255, clamped: true });
  assert.deepEqual(c.toRaw(-100), { raw: 0, clamped: true });
  assert.throws(() => c.toRaw(NaN), MathError);
});

test('offset equation over a 16-bit range', () => {
  const c = converter('1.000000 * X+ -32768.000000', 0, 65535, false);
  assert.deepEqual(c.toRaw(-32768), { raw: 0, clamped: false });
  assert.deepEqual(c.toRaw(32767), { raw: 65535, clamped: false });
});

test('non-linear monotonic equation picks the nearest raw value', () => {
  const c = converter('X*X', 0, 255, false);
  assert.equal(c.linear, false);
  assert.deepEqual(c.toRaw(100), { raw: 10, clamped: false });
  assert.deepEqual(c.toRaw(101), { raw: 10, clamped: false });
  assert.deepEqual(c.toRaw(c.f(200)), { raw: 200, clamped: false });
  assert.deepEqual(c.toRaw(1e9), { raw: 255, clamped: true });
});

test('non-monotonic and flat equations cannot be written', () => {
  assert.equal(converter('(X-128)*(X-128)', 0, 255, false).toRaw, null);
  assert.equal(converter('0.000000 * X', 0, 65535, false).toRaw, null);
});

test('float elements are not rounded', () => {
  const c = converter('X*2', -FLT_MAX, FLT_MAX, true);
  assert.deepEqual(c.toRaw(3), { raw: 1.5, clamped: false });
});
