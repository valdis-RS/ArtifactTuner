// Edit operations on a decoded grid of values. Each returns the cells to
// write as [{r, c, value}]; nothing here touches bytes.

export function normSel(s) {
  return { r0: Math.min(s.r0, s.r1), c0: Math.min(s.c0, s.c1), r1: Math.max(s.r0, s.r1), c1: Math.max(s.c0, s.c1) };
}

function each(sel, fn) {
  const s = normSel(sel), out = [];
  for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) out.push({ r, c, value: fn(r, c, s) });
  return out;
}

export const opSet = (grid, sel, v) => each(sel, () => v);
export const opAdd = (grid, sel, d) => each(sel, (r, c) => grid[r][c] + d);
export const opScale = (grid, sel, pct) => each(sel, (r, c) => grid[r][c] * (1 + pct / 100));
export const opRevert = (refGrid, sel) => each(sel, (r, c) => refGrid[r][c]);

export function strictlyMonotonic(a) {
  if (a.length < 2) return true;
  const d = Math.sign(a[1] - a[0]);
  if (!d) return false;
  for (let i = 1; i < a.length; i++) if (Math.sign(a[i] - a[i - 1]) !== d) return false;
  return true;
}

const usable = axis => Array.isArray(axis) && axis.every(v => typeof v === 'number' && Number.isFinite(v)) && strictlyMonotonic(axis);

function fraction(pos, i, i0, i1) {
  if (i1 === i0) return 0;
  return pos ? (pos[i] - pos[i0]) / (pos[i1] - pos[i0]) : (i - i0) / (i1 - i0);
}

const lerp = (a, b, t) => a + (b - a) * t;

export function opInterpolate(grid, sel, mode, xs = null, ys = null) {
  const px = usable(xs) ? xs : null, py = usable(ys) ? ys : null;
  const s = normSel(sel);
  let m = mode;
  if (m === 'bilinear' && (s.r0 === s.r1 || s.c0 === s.c1)) m = s.r0 === s.r1 ? 'h' : 'v';
  return each(s, (r, c) => {
    const tx = fraction(px, c, s.c0, s.c1), ty = fraction(py, r, s.r0, s.r1);
    if (m === 'h') return lerp(grid[r][s.c0], grid[r][s.c1], tx);
    if (m === 'v') return lerp(grid[s.r0][c], grid[s.r1][c], ty);
    return lerp(lerp(grid[s.r0][s.c0], grid[s.r0][s.c1], tx), lerp(grid[s.r1][s.c0], grid[s.r1][s.c1], tx), ty);
  });
}

export function opSmooth(grid, sel) {
  return each(sel, (r, c, s) => {
    let sum = 0, n = 0;
    for (let rr = Math.max(s.r0, r - 1); rr <= Math.min(s.r1, r + 1); rr++) {
      for (let cc = Math.max(s.c0, c - 1); cc <= Math.min(s.c1, c + 1); cc++) {
        sum += grid[rr][cc];
        n++;
      }
    }
    return sum / n;
  });
}

export function toTsv(grid, sel, fmt = v => String(v)) {
  const s = normSel(sel), lines = [];
  for (let r = s.r0; r <= s.r1; r++) {
    const row = [];
    for (let c = s.c0; c <= s.c1; c++) row.push(fmt(grid[r][c]));
    lines.push(row.join('\t'));
  }
  return lines.join('\n');
}

export const AMBIGUOUS_COMMA = /^[-+]?[1-9]\d{0,2},\d{3}$/;      // 1,500: thousands or decimal? refuse to guess

// Plain decimal numbers only (no hex, binary or Infinity). A comma decimal such
// as 1,5 or 0,125 is accepted; the ambiguous thousands form is NaN.
export function parseNumber(text) {
  let t = String(text ?? '').trim();
  if (AMBIGUOUS_COMMA.test(t)) return NaN;
  if (/^[-+]?\d+,\d+$/.test(t)) t = t.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return NaN;
  return Number(t);
}

export function parseTsv(text) {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!body.trim()) throw new Error('Nothing to paste');
  return body.split('\n').map(line => line.split('\t').map(cell => {
    if (AMBIGUOUS_COMMA.test(cell.trim())) throw new Error(`"${cell}" is ambiguous: write 1.5 or 1500`);
    const v = parseNumber(cell);
    if (Number.isNaN(v)) throw new Error(`"${cell}" is not a number`);
    return v;
  }));
}

export function opPaste(grid, sel, block) {
  const s = normSel(sel);
  if (block.length === 1 && block[0].length === 1) return each(s, () => block[0][0]);
  const rows = grid.length, cols = grid[0].length, out = [];
  block.forEach((line, i) => line.forEach((value, j) => {
    const r = s.r0 + i, c = s.c0 + j;
    if (r < rows && c < cols) out.push({ r, c, value });
  }));
  return out;
}
