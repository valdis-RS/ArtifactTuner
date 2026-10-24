// Building the file to save: the checksum policy (design spec, section 4),
// the post-fix self-check, file names and the change log.
import { readItem } from './table.js';
import { itemSpans } from './xdf.js';

export class SaveError extends Error {}

const hex = (n, width = 4) => '0x' + n.toString(16).toUpperCase().padStart(width, '0');

export function planChecksums(image, pick) {
  const edited = image.editedOffsets();
  const plugin = pick?.plugin ?? null;
  const fixed = [], notFixed = [];
  if (plugin && edited.length) {
    for (const [region, ranges] of Object.entries(plugin.coverage(image.original))) {
      if (!edited.some(o => ranges.some(([s, e]) => o >= s && o <= e))) continue;
      (plugin.fixable.includes(region) ? fixed : notFixed).push(region);
    }
  }
  return { plugin, fixed, notFixed, edited };
}

export function prepareSave(image, model, pick, when = new Date()) {
  const { plugin, fixed, notFixed, edited } = planChecksums(image, pick);
  const out = image.working.slice();
  const before = plugin ? plugin.verify(image.original) : null;
  for (const region of fixed) plugin.fix(out, region);
  const after = plugin ? plugin.verify(out) : null;
  for (const region of fixed) {
    if (!after[region].ok) throw new SaveError(`The ${region} checksum did not verify after correction. Nothing was saved.`);
  }
  // An edit can break a checksum without touching its summed ranges (for example
  // its range header). Any region that verified in the loaded file but fails now,
  // and was not corrected, is reported as not fixed.
  if (plugin) {
    for (const [region, r] of Object.entries(after)) {
      if (before[region].ok && !r.ok && !fixed.includes(region) && !notFixed.includes(region)) notFixed.push(region);
    }
  }
  const allowed = new Set(edited);
  for (const region of fixed) for (const o of plugin.storedAt(out, region)) allowed.add(o);
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== image.original[i] && !allowed.has(i)) {
      throw new SaveError(`Byte ${hex(i, 5)} changed without being edited. Nothing was saved.`);
    }
  }
  const notCorrected = edited.length > 0 && (!plugin || notFixed.length > 0);
  const stem = image.name.replace(/\.[^.]*$/, '') + '_edit' + (notCorrected ? '_CHECKSUM-NOT-FIXED' : '');
  const res = { out, plugin, fixed, notFixed, notCorrected, before, after, binName: stem + '.bin', zipName: stem + '.zip' };
  res.changeLog = changeLog(image, model, res, when);
  return res;
}

export function changedItems(image, model, against = image.original) {
  const rows = [];
  for (const item of model?.items ?? []) {
    if (item.disabled) continue;
    const [s, e] = itemSpans(item)[0];
    let differs = false;
    for (let i = s; i < e && !differs; i++) differs = image.working[i] !== against[i];
    if (!differs) continue;
    const a = readItem(item, against), b = readItem(item, image.working);
    let cells = 0, lo = Infinity, hi = -Infinity;
    for (let r = 0; r < a.rows; r++) {
      for (let c = 0; c < a.cols; c++) {
        if (a.raw[r][c] === b.raw[r][c]) continue;
        const d = b.phys[r][c] - a.phys[r][c];
        cells++;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
    }
    rows.push({ item, cells, lo, hi });
  }
  return rows;
}

function bytesOutsideItems(image, model) {
  const mask = new Uint8Array(image.working.length);
  for (const item of model?.items ?? []) {
    for (const [s, e] of itemSpans(item)) mask.fill(1, Math.max(0, s), Math.min(mask.length, e));
  }
  return image.editedOffsets().filter(o => !mask[o]).length;
}

const signed = (v, d) => (v > 0 ? '+' : '') + v.toFixed(d);

function fmtChecks(v) {
  return Object.entries(v)
    .map(([name, r]) => `${name} ${hex(r.calc).slice(2)}/${hex(r.stored).slice(2)} ${r.ok ? 'OK' : 'MISMATCH'}`)
    .join(', ');
}

function changeLog(image, model, res, when) {
  const L = [
    'XDF Map Editor - change log',
    `Saved: ${when.toISOString()}`,
    `Loaded BIN: ${image.name}`,
    `Saved BIN: ${res.binName}`,
  ];
  if (model) L.push(`XDF: ${model.title}`);
  if (image.referenceName) L.push(`Compared against: ${image.referenceName}`);
  L.push('');
  if (res.plugin) {
    L.push(`Checksums: ${res.plugin.name}`,
      `  loaded file: ${fmtChecks(res.before)}`,
      `  saved file:  ${fmtChecks(res.after)}`,
      `  corrected: ${res.fixed.join(', ') || 'none needed'}`);
    if (res.notFixed.length) L.push(`  NOT corrected: ${res.notFixed.join(', ')} (edited bytes affect a checksum this tool does not correct)`);
  } else {
    L.push('Checksums: no checksum plugin for this file, so nothing was corrected');
  }
  if (res.notCorrected) L.push('', 'WARNING: correct the checksum in WinOLS or your flashing tool before writing this file to an ECU.');
  L.push('');
  const items = changedItems(image, model);
  L.push(`Changed items: ${items.length}`);
  for (const { item, cells, lo, hi } of items) {
    const d = item.z.decimals, unit = item.z.units ? ' ' + item.z.units : '';
    const delta = cells ? `, change ${signed(lo, d)} to ${signed(hi, d)}${unit}` : '';
    L.push(`  ${item.title} @${hex(item.z.offset, 5)}: ${cells} cell${cells === 1 ? '' : 's'}${delta}`);
  }
  const outside = bytesOutsideItems(image, model);
  if (outside) L.push(`Bytes changed outside XDF items: ${outside}`);
  return L.join('\n') + '\n';
}
