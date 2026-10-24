import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXdf, checkBounds, itemSpans } from '../src/xdf.js';
import { readRaw, rawRange } from '../src/codec.js';
import { P, readText, readBin } from './helpers.js';

const ems = parseXdf(readText(P.ems2kXdf));
const msv = parseXdf(readText(P.msv70Xdf));
const byTitle = (m, t) => m.items.find(i => i.title === t);

test('item counts, nothing skipped', () => {
  assert.deepEqual([ems.report.tables, ems.report.constants, ems.report.skipped], [466, 105, []]);
  assert.deepEqual([msv.report.tables, msv.report.constants, msv.report.skipped], [2183, 6086, []]);
  assert.equal(ems.items.length, 571);
});

test('CATEGORYMEM is 1-based', () => {
  assert.equal(ems.categories[0].name, 'Ignition');
  assert.equal(ems.categories[1].name, 'Fuel');
  assert.deepEqual(byTitle(ems, 'Ignition - base advance').categoryIds, [0]);
  assert.deepEqual(byTitle(ems, 'Fuel - VE / load-to-fuel factor').categoryIds, [1]);
});

test('EMS2K base ignition map definition', () => {
  const t = byTitle(ems, 'Ignition - base advance');
  assert.equal(t.kind, 'table');
  assert.equal(t.z.offset, 0x75ef2);
  assert.deepEqual([t.z.rows, t.z.cols, t.z.bits, t.z.signed, t.z.lsbFirst], [16, 12, 8, false, true]);
  assert.deepEqual([t.z.units, t.z.decimals, t.z.equation], ['deg BTDC', 2, 'X*0.375-23.625']);
  assert.equal(t.z.conv.f(63), 0);
  assert.deepEqual([t.x.kind, t.x.elem.offset, t.x.count], ['embedded', 0x74367, 12]);
  assert.deepEqual([t.y.kind, t.y.elem.offset, t.y.count], ['embedded', 0x74356, 16]);
  assert.equal(t.y.elem.conv.f(10), 320);
  assert.equal(t.readOnly, false);
  assert.deepEqual(itemSpans(t), [[0x75ef2, 0x75ef2 + 192], [0x74367, 0x74373], [0x74356, 0x74366]]);
});

test('MSV70 elements without type flags are big-endian', () => {
  const t = msv.items.find(i => i.title === 'id_maf_n_min_fcut_fast');
  const bin = readBin(P.msv70Bin);
  assert.equal(t.x.elem.lsbFirst, false);
  const xs = Array.from({ length: t.x.count }, (_, i) => t.x.elem.conv.f(readRaw(bin, t.x.elem, 0, i)));
  assert.deepEqual(xs, [1200, 2400, 3600, 4800]);
});

test('read-only items are exactly the non-invertible equations', () => {
  const ro = msv.items.filter(i => i.readOnly);
  assert.equal(ro.length, 9);
  for (const i of ro) assert.match(i.reason, /cannot be inverted/);
  assert.equal(msv.report.readOnly, 9);
  assert.equal(ems.items.filter(i => i.readOnly).length, 0);
});

test('every writable element round-trips raw -> physical -> raw', () => {
  const seen = new Set();
  for (const m of [ems, msv]) {
    for (const it of m.items) {
      for (const e of [it.z, it.x?.elem, it.y?.elem]) {
        if (!e || !e.conv.toRaw) continue;
        const key = `${e.equation}|${e.bits}|${e.signed}|${e.float}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [lo, hi] = rawRange(e);
        const n = e.bits <= 16 ? hi - lo : 10000;
        for (let k = 0; k <= n; k++) {
          const raw = e.bits <= 16 ? lo + k : lo + Math.round(((hi - lo) * k) / n);
          const back = e.conv.toRaw(e.conv.f(raw));
          if (back.raw !== raw || back.clamped) assert.fail(`${key}: raw ${raw} came back as ${back.raw}`);
        }
      }
    }
  }
  assert.ok(seen.size > 50, `only ${seen.size} element kinds checked`);
});

const SYN = `<XDFFORMAT version="1.70"><XDFHEADER><deftitle>Syn</deftitle>
<BASEOFFSET offset="0x10" subtract="1" /><DEFAULTS datasizeinbits="16" sigdigits="3" />
<REGION size="0x40" /><CATEGORY index="0x0" name="A" /></XDFHEADER>
<XDFCONSTANT uniqueid="0x1"><title>float const</title><CATEGORYMEM index="0" category="1" />
 <EMBEDDEDDATA mmedtypeflags="0x10002" mmedaddress="0x10" mmedelementsizebits="32" /><MATH equation="X*2"><VAR id="X" /></MATH></XDFCONSTANT>
<XDFCONSTANT uniqueid="0x2"><title>default size const</title><EMBEDDEDDATA mmedaddress="0x14" /></XDFCONSTANT>
<XDFTABLE uniqueid="0x3"><title>label table</title>
 <XDFAXIS id="x"><indexcount>2</indexcount><LABEL index="1" value="hi" /><LABEL index="0" value="lo" /></XDFAXIS>
 <XDFAXIS id="z"><EMBEDDEDDATA mmedtypeflags="0x01" mmedaddress="0x16" mmedelementsizebits="8" mmedrowcount="1" mmedcolcount="2" /></XDFAXIS></XDFTABLE>
<XDFTABLE uniqueid="0x4"><title>bad flags</title><XDFAXIS id="z"><EMBEDDEDDATA mmedtypeflags="0x100" mmedaddress="0x20" /></XDFAXIS></XDFTABLE>
<XDFTABLE uniqueid="0x5"><title>linked axis</title><XDFAXIS id="x"><embedinfo type="3" linkobjid="0x1" /><indexcount>1</indexcount></XDFAXIS><XDFAXIS id="z"><EMBEDDEDDATA mmedaddress="0x20" /></XDFAXIS></XDFTABLE>
<XDFCONSTANT uniqueid="0x6"><title>two vars</title><EMBEDDEDDATA mmedaddress="0x20" /><MATH equation="X+A"><VAR id="X" /><VAR id="A" /></MATH></XDFCONSTANT>
<XDFCONSTANT uniqueid="0x7"><title>function</title><EMBEDDEDDATA mmedaddress="0x20" /><MATH equation="ABS(X)"><VAR id="X" /></MATH></XDFCONSTANT>
<XDFCONSTANT uniqueid="0x8"><title>past end</title><EMBEDDEDDATA mmedaddress="0x4f" mmedelementsizebits="16" /></XDFCONSTANT>
<XDFFLAG uniqueid="0x9"><title>a flag</title></XDFFLAG>
</XDFFORMAT>`;

test('synthetic XDF: flags, defaults, base offset, labels and unsupported features', () => {
  const m = parseXdf(SYN);
  const t = n => m.items.find(i => i.title === n);
  assert.deepEqual(m.report.skipped.map(s => s.title).sort(), ['bad flags', 'function', 'linked axis', 'two vars']);
  assert.match(m.report.skipped.find(s => s.title === 'bad flags').reason, /0x100/);
  assert.deepEqual(m.report.ignored, { XDFFLAG: 1 });
  const f = t('float const');
  assert.deepEqual([f.z.offset, f.z.bits, f.z.float, f.z.lsbFirst, f.x, f.y], [0, 32, true, true, null, null]);
  assert.deepEqual(f.categoryIds, [0]);
  const d = t('default size const');
  assert.deepEqual([d.z.offset, d.z.bits, d.z.decimals, d.z.lsbFirst, d.z.signed], [4, 16, 3, false, false]);
  const l = t('label table');
  assert.deepEqual([l.z.offset, l.z.signed, l.z.cols], [6, true, 2]);
  assert.deepEqual(l.x.labels, ['lo', 'hi']);
  assert.deepEqual(l.y, { kind: 'index', count: 1, units: '' });
  const inBin = checkBounds(m, 0x40);
  assert.deepEqual(inBin, { sizeMismatch: false, disabled: 1 });
  assert.equal(t('past end').disabled, true);
  assert.match(t('past end').disabledReason, /outside the 64-byte BIN/);
  assert.equal(checkBounds(m, 0x80).sizeMismatch, true);
  assert.equal(t('past end').disabled, false);
});

test('MSV70 BIN is shorter than the XDF region but every item fits', () => {
  assert.deepEqual(checkBounds(msv, readBin(P.msv70Bin).length), { sizeMismatch: true, disabled: 0 });
});

test('rejects files that are not XDFs', () => {
  assert.throws(() => parseXdf('<html></html>'), /Not an XDF file/);
});
