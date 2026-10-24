// Item-level reading and writing: decode a whole table with its axes, and
// turn physical (or raw) cell values into byte patches.
import { readRaw, encodeRaw, cellOffset, rawRange } from './codec.js';

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
