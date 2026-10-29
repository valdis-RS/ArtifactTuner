// Item-level reading and writing: decode a whole table with its axes, and
// turn physical (or raw) cell values into byte patches.
import { readRaw, encodeRaw, cellOffset, rawRange } from './codec.js';
import { itemSpans } from './xdf.js';

export function axisValues(axis, img) {
  if (!axis) return [];
  if (axis.kind === 'labels') return axis.labels.slice();
  if (axis.kind === 'index') return Array.from({ length: axis.count }, (_, i) => i);
  return Array.from({ length: axis.count }, (_, i) => axis.elem.conv.f(readRaw(img, axis.elem, 0, i)));
}

export function readItem(item, img) {
  const z = item.z;
  const raw = [], phys = [];
  for (let r = 0; r < z.rows; r++) {
    const rr = [], pr = [];
    for (let c = 0; c < z.cols; c++) {
      const v = readRaw(img, z, r, c);
      rr.push(v);
      pr.push(z.conv.f(v));
    }
    raw.push(rr);
    phys.push(pr);
  }
  return { rows: z.rows, cols: z.cols, raw, phys, xs: axisValues(item.x, img), ys: axisValues(item.y, img) };
}

const bytesDiffer = (a, b, start, end) => {
  for (let i = start; i < end; i++) if (a[i] !== b[i]) return true;
  return false;
};

// How one item differs between two images: the number of cells whose bytes
// differ, and whether any embedded axis differs. Null when nothing differs.
const cellDiffers = (e, a, b, r, c) => {
  const off = cellOffset(e, r, c);
  return bytesDiffer(a, b, off, off + (e.bits >> 3));
};

export function diffItem(item, a, b) {
  const z = item.z;
  let cells = 0;
  for (let r = 0; r < z.rows; r++) {
    for (let c = 0; c < z.cols; c++) if (cellDiffers(z, a, b, r, c)) cells++;
  }
  const axes = [item.x, item.y].some(ax => {
    if (ax?.kind !== 'embedded') return false;
    for (let i = 0; i < ax.count; i++) if (cellDiffers(ax.elem, a, b, 0, i)) return true;
    return false;
  });
  return cells || axes ? { cells, axes } : null;
}

// Runs of 256+ erased bytes (0xFF) on side x where the other side has data in
// at least a quarter of the run: a calibration-only file is blank outside its
// calibration. A few edits into erased free space do not count.
const ERASED_MIN = 256;

function erasedRuns(x, y, n, side) {
  const runs = [];
  for (let i = 0; i < n;) {
    if (x[i] !== 0xff) { i++; continue; }
    let j = i, data = 0;
    for (; j < n && x[j] === 0xff; j++) if (y[j] !== 0xff) data++;
    if (j - i >= ERASED_MIN && data * 4 >= j - i) runs.push({ side, start: i, end: j });
    i = j;
  }
  return runs;
}

// Bytes that differ between a and b but lie in no item: changes the XDF cannot
// show. Differing bytes up to 8 apart form one range. Areas erased on one side
// (see erasedRuns) are returned apart and their bytes are not counted.
export function outsideDiffs(items, a, b) {
  const n = Math.min(a.length, b.length);
  const skip = new Uint8Array(n);
  for (const item of items) for (const [s, e] of itemSpans(item)) skip.fill(1, Math.max(0, s), Math.min(n, e));
  const erased = [...erasedRuns(a, b, n, 'a'), ...erasedRuns(b, a, n, 'b')].sort((p, q) => p.start - q.start);
  for (const r of erased) skip.fill(1, r.start, r.end);
  const ranges = [];
  let bytes = 0;
  for (let i = 0; i < n; i++) {
    if (skip[i] || a[i] === b[i]) continue;
    bytes++;
    const last = ranges[ranges.length - 1];
    if (last && i - last.end < 8) {
      last.end = i + 1;
      last.bytes++;
    } else {
      ranges.push({ start: i, end: i + 1, bytes: 1 });
    }
  }
  return { ranges, bytes, erased };
}

// A − B for one item while comparing: per-cell differences in physical (or
// raw) units, which cells' raw values differ, and the largest |difference|.
// Unchanged cells read 0.
export function deltaView(view, refView, raw = false) {
  const a = raw ? view.raw : view.phys, b = raw ? refView.raw : refView.phys;
  const changed = view.raw.map((row, r) => row.map((v, c) => !Object.is(v, refView.raw[r][c])));
  let maxAbs = 0;
  const cells = a.map((row, r) => row.map((v, c) => {
    if (!changed[r][c]) return 0;
    const d = v - b[r][c];
    if (Number.isFinite(d)) maxAbs = Math.max(maxAbs, Math.abs(d));
    return d;
  }));
  return { cells, changed, maxAbs };
}

function rawResult(z, lo, hi, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`"${value}" is not a number`);
  const v = z.float ? value : Math.round(value);
  const k = Math.min(hi, Math.max(lo, v));
  return { raw: k === 0 ? 0 : k, clamped: k !== v };
}

export function planWrites(item, img, cells, { raw = false } = {}) {
  if (item.readOnly) throw new Error(`${item.title} is read-only: ${item.reason}`);
  if (item.disabled) throw new Error(`${item.title} is disabled: ${item.disabledReason}`);
  const z = item.z;
  const [lo, hi] = rawRange(z);
  const bytes = new Map();                  // offset -> new byte; a later write to the same cell wins
  const clamped = [];
  for (const { r, c, value } of cells) {
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= z.rows || c >= z.cols) {
      throw new RangeError(`Cell (${r}, ${c}) is outside ${item.title} (${z.rows} × ${z.cols})`);
    }
    const res = raw ? rawResult(z, lo, hi, value) : z.conv.toRaw(value);
    if (res.clamped) clamped.push({ r, c, value, stored: raw ? res.raw : z.conv.f(res.raw) });
    const off = cellOffset(z, r, c);
    encodeRaw(z, res.raw).forEach((b, k) => bytes.set(off + k, b));
  }
  const patches = [];
  for (const [off, after] of [...bytes].sort((p, q) => p[0] - q[0])) {
    if (img[off] !== after) patches.push({ off, before: img[off], after });
  }
  return { patches, clamped };
}

export function defaultStep(item, raw = false) {
  if (raw) return 1;
  if (item.z.float) return 10 ** -item.z.decimals;
  return item.z.conv.step;
}

export function formatValue(v, decimals) {
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return String(v);
  return v.toFixed(decimals);
}

// Text for the clipboard: 12 significant digits round-trips every 8/16/32-bit
// raw and every float32, so a copied block pastes back to the same bytes.
export function copyText(v) {
  return Number.isFinite(v) ? String(Number(v.toPrecision(12))) : String(v);
}

export function formatAxis(axis, v) {
  if (!axis || axis.kind !== 'embedded') return String(v);
  return formatValue(v, axis.elem.decimals);
}
