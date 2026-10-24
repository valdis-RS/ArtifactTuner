// XDF MATH equations: compile "X*0.75-48" style expressions to functions of
// X, and build the raw <-> physical converter used to read and write cells.

export class MathError extends Error {}

const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([Xx])|([-+*/^()]))/y;

function tokenize(expr) {
  const out = [];
  let pos = 0;
  while (pos < expr.length) {
    if (/^\s*$/.test(expr.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(expr);
    if (!m) throw new MathError(`Unsupported text "${expr.slice(pos).trim()}" in "${expr}"`);
    out.push(m[1] !== undefined ? { num: parseFloat(m[1]) } : m[2] ? { x: true } : { op: m[3] });
    pos = TOKEN.lastIndex;
  }
  return out;
}

export function compile(expr) {
  const toks = tokenize(expr);
  let i = 0;
  const isOp = (t, ops) => Boolean(t && t.op && ops.includes(t.op));

  function primary() {
    const t = toks[i++];
    if (!t) throw new MathError(`Unexpected end of "${expr}"`);
    if (t.num !== undefined) return () => t.num;
    if (t.x) return x => x;
    if (t.op === '(') {
      const e = sum();
      if (!isOp(toks[i++], ')')) throw new MathError(`Missing ")" in "${expr}"`);
      return e;
    }
    throw new MathError(`Unexpected "${t.op}" in "${expr}"`);
  }
  function power() {
    const base = primary();
    if (!isOp(toks[i], '^')) return base;
    i++;
    const exp = unary();
    return x => base(x) ** exp(x);
  }
  function unary() {
    if (isOp(toks[i], '-')) { i++; const u = unary(); return x => -u(x); }
    if (isOp(toks[i], '+')) { i++; return unary(); }
    return power();
  }
  function product() {
    let left = unary();
    while (isOp(toks[i], '*/')) {
      const op = toks[i++].op, a = left, b = unary();
      left = op === '*' ? x => a(x) * b(x) : x => a(x) / b(x);
    }
    return left;
  }
  function sum() {
    let left = product();
    while (isOp(toks[i], '+-')) {
      const op = toks[i++].op, a = left, b = product();
      left = op === '+' ? x => a(x) + b(x) : x => a(x) - b(x);
    }
    return left;
  }

  const f = sum();
  if (i < toks.length) throw new MathError(`Unexpected "${toks[i].op ?? toks[i].num ?? 'X'}" in "${expr}"`);
  return f;
}

const SPAN = 1048576;                                   // 2^20: keeps the slope estimate exact for decimal factors
const FLOAT_PROBES = [-1e6, -1, 1, 3, 1e6];

function isLinear(f, a, b, probes) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return false;
  return probes.every(p => {
    const y = f(p);
    return Math.abs(y - (a * p + b)) <= 1e-9 * Math.max(1, Math.abs(y), Math.abs(a * p));
  });
}

// 1 = increasing, -1 = decreasing, 0 = neither (or flat somewhere).
function monotonic(f, lo, hi) {
  const exhaustive = hi - lo <= 65535;
  const n = exhaustive ? hi - lo : 4096;
  let dir = 0, prev = f(lo);
  for (let k = 1; k <= n; k++) {
    const y = f(exhaustive ? lo + k : lo + Math.round(((hi - lo) * k) / n));
    if (!Number.isFinite(y)) return 0;
    const d = Math.sign(y - prev);
    if (d === 0) return 0;
    if (dir === 0) dir = d;
    else if (d !== dir) return 0;
    prev = y;
  }
  return dir;
}

function nearestRaw(f, lo, hi, dir, y) {
  let a = lo, b = hi;
  while (a < b) {
    const m = Math.floor((a + b) / 2);
    if (dir * f(m) < dir * y) a = m + 1;
    else b = m;
  }
  if (a > lo && Math.abs(f(a - 1) - y) <= Math.abs(f(a) - y)) return a - 1;
  return a;
}

export function converter(expr, lo, hi, isFloat) {
  const f = compile(expr);
  const conv = { f, linear: false, step: 0, toRaw: null };
  const check = y => {
    if (typeof y !== 'number' || !Number.isFinite(y)) throw new MathError(`"${y}" is not a number`);
    return y;
  };
  const b = f(0);
  const a = (f(SPAN) - b) / SPAN;
  const probes = isFloat ? FLOAT_PROBES : [lo, hi, Math.round((lo + hi) / 2), lo + 1];
  if (isLinear(f, a, b, probes)) {
    conv.linear = true;
    conv.step = Math.abs(a);
    conv.toRaw = y => {
      const exact = (check(y) - b) / a;
      const r = isFloat ? exact : Math.round(exact);
      const v = Math.min(hi, Math.max(lo, r));
      return { raw: v === 0 ? 0 : v, clamped: v !== r };
    };
  } else if (!isFloat) {
    const dir = monotonic(f, lo, hi);
    if (dir !== 0) {
      const mid = Math.round((lo + hi) / 2);
      const ylo = Math.min(f(lo), f(hi)), yhi = Math.max(f(lo), f(hi));
      conv.step = Math.abs(f(Math.min(hi, mid + 1)) - f(mid));
      conv.toRaw = y => {
        check(y);
        return { raw: nearestRaw(f, lo, hi, dir, y), clamped: y < ylo || y > yhi };
      };
    }
  }
  return conv;
}
