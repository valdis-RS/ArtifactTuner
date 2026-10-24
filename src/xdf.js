// TunerPro XDF -> editor model. The format facts this relies on are in the
// design spec, section 2 (byte order from mmedtypeflags only, 1-based
// CATEGORYMEM, strides in bits, BASEOFFSET).
import { parseXml, child, childrenOf, textOf } from './xml.js';
import { converter, MathError } from './math.js';
import { rawRange, elemSpan } from './codec.js';

const SIGNED = 0x01, LSB_FIRST = 0x02, COL_MAJOR = 0x04, FLOAT = 0x10000;
const KNOWN_FLAGS = SIGNED | LSB_FIRST | COL_MAJOR | FLOAT;

class Unsupported extends Error {}

const num = s => (/^\s*-?0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10));
function numOr(s, fallback) {
  const v = s === undefined ? NaN : num(s);
  return Number.isFinite(v) ? v : fallback;
}

function readElem(owner, ctx, shape) {
  const ed = child(owner, 'EMBEDDEDDATA');
  if (!ed || ed.attrs.mmedaddress === undefined) throw new Unsupported('no data address');
  const a = ed.attrs;
  const flags = numOr(a.mmedtypeflags, 0);
  if (flags & ~KNOWN_FLAGS) throw new Unsupported(`unknown type flags 0x${flags.toString(16)}`);
  const bits = numOr(a.mmedelementsizebits, ctx.defaultBits);
  const float = Boolean(flags & FLOAT);
  if (![8, 16, 32].includes(bits)) throw new Unsupported(`${bits}-bit elements`);
  if (float && bits !== 32) throw new Unsupported(`${bits}-bit float elements`);
  const majorStride = numOr(a.mmedmajorstridebits, 0);
  const minorStride = numOr(a.mmedminorstridebits, 0);
  if (majorStride % 8 || minorStride % 8) throw new Unsupported('strides that are not whole bytes');
  const addr = num(a.mmedaddress);
  const offset = ctx.subtract ? addr - ctx.baseOffset : addr + ctx.baseOffset;
  if (!Number.isFinite(offset) || offset < 0) throw new Unsupported(`bad data address "${a.mmedaddress}"`);
  const e = {
    offset, bits, float,
    signed: Boolean(flags & SIGNED),
    lsbFirst: Boolean(flags & LSB_FIRST),
    colMajor: Boolean(flags & COL_MAJOR),
    rows: shape ? shape.rows : Math.max(1, numOr(a.mmedrowcount, 1)),
    cols: shape ? shape.cols : Math.max(1, numOr(a.mmedcolcount, 1)),
    majorStride, minorStride,
    units: textOf(owner, 'units'),
    decimals: ctx.defaultDecimals,
    equation: 'X',
    conv: null,
  };
  const dp = textOf(owner, 'decimalpl');
  if (dp !== '') e.decimals = Math.max(0, Math.min(10, numOr(dp, ctx.defaultDecimals)));
  const math = child(owner, 'MATH');
  if (math && childrenOf(math, 'VAR').some(v => v.attrs.id !== 'X')) throw new Unsupported('equations with variables other than X');
  e.equation = (math?.attrs.equation ?? '').trim() || 'X';
  const [lo, hi] = rawRange(e);
  try {
    e.conv = converter(e.equation, lo, hi, float);
  } catch (err) {
    if (err instanceof MathError) throw new Unsupported(`equation "${e.equation}": ${err.message}`);
    throw err;
  }
  return e;
}

function readAxis(ax, ctx, count) {
  if (!ax) return { kind: 'index', count, units: '' };
  const units = textOf(ax, 'units');
  const type = numOr(child(ax, 'embedinfo')?.attrs.type, 0);
  if (type === 2 || type === 3) throw new Unsupported(`linked axis (embedinfo type ${type})`);
  const declared = textOf(ax, 'indexcount');
  if (declared !== '' && numOr(declared, count) !== count) {
    throw new Unsupported(`axis has ${declared} entries but the table has ${count}`);
  }
  const ed = child(ax, 'EMBEDDEDDATA');
  if (ed && ed.attrs.mmedaddress !== undefined) {
    return { kind: 'embedded', count, units, elem: readElem(ax, ctx, { rows: 1, cols: count }) };
  }
  const labels = childrenOf(ax, 'LABEL')
    .map(l => [numOr(l.attrs.index, 0), l.attrs.value ?? ''])
    .sort((p, q) => p[0] - q[0])
    .map(p => p[1]);
  if (labels.length) return { kind: 'labels', count, units, labels: Array.from({ length: count }, (_, i) => labels[i] ?? '') };
  return { kind: 'index', count, units };
}

function readTable(el, ctx) {
  const axes = Object.fromEntries(childrenOf(el, 'XDFAXIS').map(a => [a.attrs.id, a]));
  if (!axes.z) throw new Unsupported('table without a z axis');
  const z = readElem(axes.z, ctx, null);
  return { kind: 'table', z, x: readAxis(axes.x, ctx, z.cols), y: readAxis(axes.y, ctx, z.rows) };
}

function readConstant(el, ctx) {
  return { kind: 'constant', z: readElem(el, ctx, { rows: 1, cols: 1 }), x: null, y: null };
}

export function parseXdf(text) {
  const doc = parseXml(text);
  if (doc.tag !== 'XDFFORMAT') throw new Error(`Not an XDF file (the root element is <${doc.tag}>)`);
  const head = child(doc, 'XDFHEADER') ?? { tag: 'XDFHEADER', attrs: {}, children: [], text: '' };
  const base = child(head, 'BASEOFFSET')?.attrs ?? {};
  const defs = child(head, 'DEFAULTS')?.attrs ?? {};
  const ctx = {
    baseOffset: numOr(base.offset, 0),
    subtract: base.subtract === '1',
    defaultBits: numOr(defs.datasizeinbits, 8),
    defaultDecimals: numOr(defs.sigdigits, 2),
  };
  const region = childrenOf(head, 'REGION')[0];
  const model = {
    title: textOf(head, 'deftitle') || 'Untitled XDF',
    description: textOf(head, 'description'),
    baseOffset: ctx.baseOffset,
    subtract: ctx.subtract,
    regionSize: region ? numOr(region.attrs.size, 0) : 0,
    categories: childrenOf(head, 'CATEGORY').map(c => ({ id: numOr(c.attrs.index, 0), name: c.attrs.name ?? '' })),
    items: [],
    report: { tables: 0, constants: 0, readOnly: 0, skipped: [], ignored: {} },
  };
  for (const el of doc.children) {
    if (el.tag === 'XDFTABLE' || el.tag === 'XDFCONSTANT') {
      const title = textOf(el, 'title') || `(untitled ${el.attrs.uniqueid ?? ''})`;
      try {
        const item = el.tag === 'XDFTABLE' ? readTable(el, ctx) : readConstant(el, ctx);
        item.key = `${item.kind[0]}${model.items.length}`;
        item.uid = el.attrs.uniqueid ?? '';
        item.title = title;
        item.desc = textOf(el, 'description');
        item.categoryIds = childrenOf(el, 'CATEGORYMEM').map(m => numOr(m.attrs.category, 0) - 1).filter(id => id >= 0);
        item.readOnly = !item.z.conv.toRaw;
        item.reason = item.readOnly ? `equation "${item.z.equation}" cannot be inverted for writing` : '';
        item.disabled = false;
        item.disabledReason = '';
        model.items.push(item);
        model.report[item.kind === 'table' ? 'tables' : 'constants']++;
        if (item.readOnly) model.report.readOnly++;
      } catch (err) {
        if (!(err instanceof Unsupported)) throw err;
        model.report.skipped.push({ title, reason: err.message });
      }
    } else if (el.tag !== 'XDFHEADER') {
      model.report.ignored[el.tag] = (model.report.ignored[el.tag] ?? 0) + 1;
    }
  }
  return model;
}

export function itemSpans(item) {
  const spans = [elemSpan(item.z)];
  for (const ax of [item.x, item.y]) if (ax?.kind === 'embedded') spans.push(elemSpan(ax.elem));
  return spans;
}

export function checkBounds(model, binLength) {
  let disabled = 0;
  for (const item of model.items) {
    const out = itemSpans(item).some(([s, e]) => s < 0 || e > binLength);
    item.disabled = out;
    item.disabledReason = out ? `its data lies outside the ${binLength}-byte BIN` : '';
    if (out) disabled++;
  }
  return { sizeMismatch: model.regionSize > 0 && model.regionSize !== binLength, disabled };
}
