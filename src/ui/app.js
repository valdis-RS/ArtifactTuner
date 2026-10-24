// Application state and wiring: loading files, choosing items, editing,
// undo/redo, saving, and the window.xdfedit test hook.
import { parseXdf, checkBounds } from '../xdf.js';
import { BinImage } from '../image.js';
import { readItem, planWrites, formatValue, formatAxis, defaultStep } from '../table.js';
import { normSel, opSet, opAdd, opScale, opInterpolate, opSmooth, opRevert, opPaste, toTsv, parseNumber } from '../ops.js';
import { pickPlugin } from '../checksums/index.js';
import { prepareSave, planChecksums } from '../save.js';
import { zip } from '../zip.js';
import { $, h, hex, prefs, debounce, resetTheme } from './dom.js';
import { setStatus, showBanner, hideBanner, askConfirm, renderChecks } from './status.js';
import { renderTree } from './sidebar.js';
import { renderGrid, paintSelection, attachGrid } from './grid.js';
import { renderToolbar } from './toolbar.js';
import { drawSurface, attachOrbit, DEFAULT_CAM } from './surface3d.js';
import { drawCurve } from './graph2d.js';
import { demoFiles } from './demo.js';

const state = {
  model: null, xdfName: '',
  image: null, pick: null, verified: null, bounds: null, plan: null,
  item: null, view: null, refView: null, sel: null,
  rawMode: false, query: '', modOnly: false, open: new Set(), demo: false,
};

const app = { state, select, edit, refresh, status: setStatus };

// ---- loading -------------------------------------------------------------

function leaveDemo() {
  if (!state.demo) return;
  Object.assign(state, { demo: false, model: null, xdfName: '', image: null, pick: null, verified: null, bounds: null, item: null, sel: null });
  state.open.clear();
  hideBanner();
}

function loadXdfText(text, name) {
  let model;
  try {
    model = parseXdf(text);
  } catch (err) {
    setStatus(`Could not read ${name}: ${err.message}`, 'error');
    return false;
  }
  leaveDemo();
  Object.assign(state, { model, xdfName: name, item: null, sel: null });
  state.open.clear();
  state.bounds = state.image ? checkBounds(model, state.image.original.length) : null;
  afterLoad();
  return true;
}

async function loadBinBytes(bytes, name) {
  const im = state.image;
  if (!state.demo && im?.unsaved && im.changed.size &&
      !(await askConfirm(`Discard the unsaved edits to ${im.name}?`, 'Discard edits'))) return false;
  leaveDemo();
  state.image = new BinImage(bytes, name);
  state.pick = pickPlugin(state.image.original);
  state.verified = state.pick.plugin ? state.pick.plugin.verify(state.image.original) : null;
  state.bounds = state.model ? checkBounds(state.model, bytes.length) : null;
  afterLoad();
  return true;
}

function loadCompare(bytes, name) {
  if (!state.image || state.demo) {
    setStatus('Open your BIN before choosing a file to compare with.', 'warn');
    return false;
  }
  try {
    state.image.setReference(bytes, name);
  } catch (err) {
    setStatus(err.message, 'error');
    return false;
  }
  refresh();
  setStatus(`Comparing against ${name}. Cells that differ are outlined.`);
  return true;
}

function afterLoad() {
  hideBanner();
  renderReport();
  refresh();
  const { model, image } = state;
  if (model && !image) setStatus(`Loaded ${state.xdfName}. Now open the BIN file it describes.`);
  else if (image && !model) setStatus(`Loaded ${image.name}. Now open its XDF definition.`);
  else if (model && image) setStatus(`Ready: ${model.items.length} items from ${state.xdfName}. Pick a map on the left.`, 'ok');
}

function renderReport() {
  const el = $('report');
  const { model, image, bounds, pick } = state;
  if (!model && !image) {
    el.hidden = true;
    return;
  }
  const n = v => v.toLocaleString('en-US');
  const lines = [];
  if (model) {
    const r = model.report;
    lines.push(h('p', {}, h('strong', { text: model.title }), ` · ${r.tables} tables, ${r.constants} constants` + (r.readOnly ? `, ${r.readOnly} read-only` : '')));
    if (r.skipped.length) {
      lines.push(h('details', {},
        h('summary', { text: `${r.skipped.length} item(s) skipped as unsupported` }),
        h('ul', {}, r.skipped.map(s => h('li', { text: `${s.title}: ${s.reason}` })))));
    }
    const ignored = Object.entries(r.ignored);
    if (ignored.length) lines.push(h('p', { text: 'Not shown: ' + ignored.map(([tag, count]) => `${count} × ${tag}`).join(', ') }));
  }
  if (image) {
    const checks = pick.plugin
      ? `Checksums: ${pick.plugin.name}.`
      : `No checksum plugin recognises this file (${pick.reasons.map(x => x.reason).join('; ')}). Saved files will be marked CHECKSUM-NOT-FIXED.`;
    lines.push(h('p', {}, h('strong', { text: image.name }), ` · ${n(image.original.length)} bytes. ${checks}`));
  }
  if (bounds?.sizeMismatch) lines.push(h('p', { class: 'warn-text', text: `The XDF describes ${n(model.regionSize)} bytes but the BIN has ${n(image.original.length)}.` }));
  if (bounds?.disabled) lines.push(h('p', { class: 'warn-text', text: `${bounds.disabled} item(s) point past the end of the BIN and are disabled.` }));
  el.replaceChildren(h('div', { class: 'report-body' }, lines), h('button', { type: 'button', class: 'link', onclick: () => { el.hidden = true; } }, 'Hide'));
  el.hidden = false;
}

// ---- rendering -----------------------------------------------------------

function select(item) {
  state.item = item;
  state.sel = item ? { r0: 0, c0: 0, r1: 0, c1: 0 } : null;
  refresh();
  setDrawer(false);
}

function refresh() {
  const { item, image } = state;
  const live = Boolean(item && image && !item.disabled);
  state.view = live ? readItem(item, image.working) : null;
  state.refView = live ? readItem(item, image.reference) : null;
  if (state.sel && state.view) {
    const s = state.sel, maxR = state.view.rows - 1, maxC = state.view.cols - 1;
    state.sel = { r0: Math.min(s.r0, maxR), c0: Math.min(s.c0, maxC), r1: Math.min(s.r1, maxR), c1: Math.min(s.c1, maxC) };
  }
  state.plan = image ? planChecksums(image, state.pick) : null;
  renderChecks(state);
  renderCompareChip();
  renderTree(app);
  renderMain();
  renderGraph();
  $('undoBtn').disabled = !image?.undoStack.length;
  $('redoBtn').disabled = !image?.redoStack.length;
  $('saveBtn').disabled = !image || state.demo;
  $('logBtn').disabled = !image || state.demo;
}

function renderHead() {
  const el = $('itemHead');
  const { item, model, image } = state;
  if (!item) {
    const hint = !model ? 'Open an XDF definition and a BIN file, or drop both anywhere on this page.'
      : !image ? 'Now open the BIN file this XDF describes.'
        : 'Pick a map or value from the list.';
    el.replaceChildren(h('p', { class: 'empty', text: hint }));
    return;
  }
  const z = item.z;
  const order = z.bits > 8 ? (z.lsbFirst ? ' LE' : ' BE') : '';
  const type = z.float ? `float${order}` : `${z.signed ? 'signed' : 'unsigned'} ${z.bits}-bit${order}`;
  const shape = item.kind === 'constant' ? 'single value' : `${z.rows} × ${z.cols}`;
  // replaceChildren() would turn a null argument into the text "null", so drop the empty slots first.
  el.replaceChildren(...[
    h('div', { class: 'head-row' },
      h('h2', { text: item.title }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Show values as' },
        h('button', { type: 'button', 'aria-pressed': String(!state.rawMode), onclick: () => setRaw(false) }, 'Physical'),
        h('button', { type: 'button', 'aria-pressed': String(state.rawMode), onclick: () => setRaw(true) }, 'Raw'))),
    h('p', { class: 'meta' }, h('code', { text: hex(z.offset, 5) }),
      ` · ${shape} · ${type}` + (z.units ? ` · ${z.units}` : '') + (z.equation !== 'X' ? ` · ${z.equation}` : '')),
    item.desc ? h('p', { class: 'desc', text: item.desc }) : null,
    item.disabled ? h('p', { class: 'warn-text', text: `Disabled: ${item.disabledReason}` })
      : item.readOnly ? h('p', { class: 'warn-text', text: `Read-only: ${item.reason}` }) : null,
  ].filter(Boolean));
}

let toolbarFor = {};

function renderMain() {
  renderHead();
  const ok = Boolean(state.item && state.view);
  $('gridWrap').hidden = !ok;
  const key = { item: state.item, raw: state.rawMode, ref: state.image?.referenceName, ok };
  if (key.item !== toolbarFor.item || key.raw !== toolbarFor.raw || key.ref !== toolbarFor.ref || key.ok !== toolbarFor.ok) {
    toolbarFor = key;                             // re-render only when it changes, so typed step/percent values survive edits
    renderToolbar(app);
  }
  renderGrid(app);
}

const cam = { ...DEFAULT_CAM, ...prefs.get('cam', {}) };

function renderGraph() {
  const wrap = $('graphWrap'), canvas = $('graph');
  const { item, view, refView } = state;
  const show = Boolean(item && view && item.kind === 'table' && view.rows * view.cols > 1);
  wrap.hidden = !show;
  wrap.parentElement.classList.toggle('with-graph', show);
  if (!show) return;
  const grid = state.rawMode ? view.raw : view.phys;
  const ref = state.rawMode ? refView.raw : refView.phys;
  const differs = view.raw.some((row, r) => row.some((v, c) => v !== refView.raw[r][c]));
  const d = state.rawMode ? 0 : item.z.decimals;
  const fmtZ = v => formatValue(v, d);
  if (view.rows > 1 && view.cols > 1) {
    canvas.dataset.mode = 'surface';
    $('graphHint').textContent = 'Drag to rotate · scroll to zoom · double-click to reset' + (differs ? ' · dashed: compare values' : '');
    drawSurface(canvas, {
      grid, ref: differs ? ref : null, sel: state.sel, xs: view.xs, ys: view.ys,
      fmtX: v => formatAxis(item.x, v), fmtY: v => formatAxis(item.y, v), fmtZ,
      xLabel: item.x.units, yLabel: item.y.units, zLabel: item.z.units,
    }, cam);
  } else {
    canvas.dataset.mode = 'curve';
    const alongCols = view.rows === 1;
    const line = g => (alongCols ? g[0] : g.map(row => row[0]));
    const axis = alongCols ? item.x : item.y;
    const s = state.sel ? normSel(state.sel) : null;
    $('graphHint').textContent = differs ? 'Dashed line: compare values' : '';
    drawCurve(canvas, {
      values: line(grid), ref: differs ? line(ref) : null, xs: alongCols ? view.xs : view.ys,
      selIdx: s ? (alongCols ? [s.c0, s.c1] : [s.r0, s.r1]) : null,
      fmtX: v => formatAxis(axis, v), fmtY: fmtZ,
    });
  }
}

function renderCompareChip() {
  const chip = $('cmpChip');
  const name = state.image?.referenceName;
  chip.hidden = !name;
  if (!name) return;
  chip.replaceChildren(h('span', { text: `vs ${name}` }), h('button', {
    type: 'button', title: 'Stop comparing', 'aria-label': 'Stop comparing',
    onclick: () => {
      state.image.clearReference();
      refresh();
      setStatus('Comparing against the loaded file again.');
    },
  }, '×'));
}

function setRaw(v) {
  state.rawMode = v;
  prefs.set('raw', v);
  refresh();
}

function setDrawer(open) {
  $('side').classList.toggle('open', open);
  $('scrim').hidden = !open;
  $('menuBtn').setAttribute('aria-expanded', String(open));
}

// ---- editing -------------------------------------------------------------

function edit(label, cells) {
  const { item, image } = state;
  if (!item || !image) return;
  if (item.readOnly || item.disabled) {
    setStatus(`${item.title} can't be edited: ${item.reason || item.disabledReason}`, 'warn');
    return;
  }
  let res;
  try {
    res = planWrites(item, image.working, cells, { raw: state.rawMode });
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  if (!image.apply(`${label} · ${item.title}`, res.patches)) {
    setStatus(`${label}: no change. The new values round to what is already stored.`);
    return;
  }
  refresh();
  if (res.clamped.length) {
    const d = state.rawMode ? 0 : item.z.decimals;
    setStatus(`${label}: ${res.clamped.length} value(s) were outside the allowed range and were clamped (for example to ${formatValue(res.clamped[0].stored, d)}).`, 'warn');
  } else {
    setStatus(`${label}: ${cells.length} cell(s) updated.`);
  }
}

function undo() {
  const g = state.image?.undo();
  if (!g) return;
  refresh();
  setStatus(`Undid: ${g.label}`);
}

function redo() {
  const g = state.image?.redo();
  if (!g) return;
  refresh();
  setStatus(`Redid: ${g.label}`);
}

const gridNow = () => (state.rawMode ? state.view.raw : state.view.phys);

function ready() {
  if (state.view && state.sel) return true;
  setStatus('Pick a map and select some cells first.', 'warn');
  return false;
}

function setSel(sel) {
  state.sel = sel;
  paintSelection(app);
  renderGraph();
}

function applyValue() {
  if (!ready()) return;
  const v = parseNumber($('valIn')?.value);
  if (Number.isNaN(v)) {
    setStatus('Type a number in the Value box first.', 'warn');
    return;
  }
  edit('Set', opSet(gridNow(), state.sel, v));
  $('valIn').value = '';
  focusGrid();
}

function step(dir) {
  if (!ready()) return;
  const typed = parseNumber($('stepIn')?.value);
  const size = typed > 0 ? typed : defaultStep(state.item, state.rawMode);
  edit(dir > 0 ? 'Step up' : 'Step down', opAdd(gridNow(), state.sel, dir * size));
}

function scale() {
  if (!ready()) return;
  const p = parseNumber($('pctIn')?.value);
  if (Number.isNaN(p)) {
    setStatus('Type a percentage first.', 'warn');
    return;
  }
  edit(`Scale ${p > 0 ? '+' : ''}${p}%`, opScale(gridNow(), state.sel, p));
}

function interpolate(mode) {
  if (!ready()) return;
  const nums = a => (a.every(v => typeof v === 'number') ? a : null);
  edit('Interpolate', opInterpolate(gridNow(), state.sel, mode, nums(state.view.xs), nums(state.view.ys)));
}

function smooth() {
  if (ready()) edit('Smooth', opSmooth(gridNow(), state.sel));
}

function revert() {
  if (ready()) edit('Revert', opRevert(state.rawMode ? state.refView.raw : state.refView.phys, state.sel));
}

function selectionTsv() {
  const d = state.rawMode ? 0 : state.item.z.decimals;
  return toTsv(gridNow(), state.sel, v => formatValue(v, d));
}

async function copy() {
  if (!ready()) return;
  try {
    await navigator.clipboard.writeText(selectionTsv());
    setStatus('Copied the selection.');
  } catch {
    setStatus('Copying was blocked here. Click the grid and press ⌘C or Ctrl+C instead.', 'warn');
  }
}

function paste(block) {
  const cells = opPaste(gridNow(), state.sel, block);
  if (!cells.length) return;
  edit('Paste', cells);
  const end = cells[cells.length - 1];
  setSel({ r0: cells[0].r, c0: cells[0].c, r1: end.r, c1: end.c });
}

function beginEntry(first) {
  const el = $('valIn');
  if (!el || el.disabled) return;
  el.value = first;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

function focusGrid() {
  const sink = $('keysink');
  sink.value = ' ';                               // a selection must exist for ⌘C to fire a copy event in Safari
  sink.focus({ preventScroll: true });
  sink.select();
}

Object.assign(app, { setSel, step, applyValue, scale, interpolate, smooth, revert, copy, paste, selectionTsv, beginEntry, focusGrid });

// ---- saving --------------------------------------------------------------

let dlPromise = null;
function downloadsCap() {
  dlPromise ??= window.claude?.use
    ? Promise.resolve(window.claude.use('downloads')).then(dl => ({ local: false, dl }), () => ({ local: false, dl: null }))
    : Promise.resolve({ local: true, dl: null });
  return dlPromise;
}

function blobDownload(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const SAVE_ERRORS = {
  declined: ['Save cancelled.', 'info'],
  rate_limited: ['Another save prompt is already open. Try again in a moment.', 'warn'],
  too_large: ['The file is too large to save here.', 'error'],
};

async function deliverFile(name, bytes) {
  const { local, dl } = await downloadsCap();
  if (local) {
    blobDownload(name, bytes);
    return true;
  }
  if (!dl) {
    setStatus('Saving files is not available in this view.', 'error');
    return false;
  }
  try {
    await dl.save({ filename: name, data: new Blob([bytes]) });
    return true;
  } catch (err) {
    const [msg, kind] = SAVE_ERRORS[err?.code] ?? [`Saving is not available here (${err?.code ?? err?.message ?? 'unknown error'}).`, 'error'];
    setStatus(msg, kind);
    return false;
  }
}

async function save() {
  const { image, model } = state;
  if (!image || state.demo) {
    setStatus('Open your own BIN file to save.', 'warn');
    return;
  }
  let res;
  try {
    res = prepareSave(image, model, state.pick);
  } catch (err) {
    showBanner(err.message, 'error');
    setStatus('Save stopped by the safety check.', 'error');
    return;
  }
  if (res.notCorrected) {
    const why = res.plugin ? `edits in the ${res.notFixed.join(', ')} area` : 'no checksum plugin for this file';
    showBanner(`Checksum NOT corrected (${why}). Correct it in WinOLS or your flashing tool before writing ${res.binName} to an ECU.`, 'error');
  }
  const { local } = await downloadsCap();
  const name = local ? res.binName : res.zipName;
  const bytes = local ? res.out
    : zip([{ name: res.binName, bytes: res.out }, { name: 'changes.txt', bytes: new TextEncoder().encode(res.changeLog) }]);
  if (!(await deliverFile(name, bytes))) return;
  image.markSaved();
  const fixedNote = res.fixed.length ? ` with the ${res.fixed.join(', ')} checksum corrected` : '';
  setStatus(`Saved ${name}${fixedNote}.`, res.notCorrected ? 'warn' : 'ok');
}

async function exportLog() {
  if (!state.image || state.demo) return;
  let res;
  try {
    res = prepareSave(state.image, state.model, state.pick);
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  const name = res.binName.replace(/\.bin$/, '_changes.txt');
  if (await deliverFile(name, new TextEncoder().encode(res.changeLog))) setStatus(`Saved ${name}.`, 'ok');
}

// ---- wiring --------------------------------------------------------------

const decode = bytes => new TextDecoder().decode(bytes);

function looksXml(b) {
  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  return b[i] === 0x3c && /[A-Za-z?!]/.test(String.fromCharCode(b[i + 1] ?? 0));
}

const isXdfFile = (name, bytes) => /\.(xdf|xml)$/i.test(name) || (!/\.(bin|ori|mod)$/i.test(name) && looksXml(bytes));

async function readFiles(files) {
  const parts = await Promise.all([...files].map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  const xdfs = parts.filter(p => isXdfFile(p.name, p.bytes));
  const bins = parts.filter(p => !isXdfFile(p.name, p.bytes));
  if (xdfs.length > 1 || bins.length > 1) {
    setStatus('Drop one XDF and one BIN at a time.', 'warn');
    return;
  }
  if (xdfs[0]) loadXdfText(decode(xdfs[0].bytes), xdfs[0].name);
  if (bins[0]) await loadBinBytes(bins[0].bytes, bins[0].name);
}

function onPick(id, handler) {
  $(id).addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) await handler(new Uint8Array(await f.arrayBuffer()), f.name);
  });
}

function onKey(e) {
  if (e.key === 'Escape' && $('side').classList.contains('open')) {
    setDrawer(false);
    return;
  }
  const t = e.target;
  const typing = (t.tagName === 'INPUT' && t.type !== 'checkbox') || (t.tagName === 'TEXTAREA' && t.id !== 'keysink');
  if (!(e.metaKey || e.ctrlKey) || typing) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
  else if (k === 's') { e.preventDefault(); save(); }
}

function wire() {
  onPick('xdfInput', (bytes, name) => loadXdfText(decode(bytes), name));
  onPick('binInput', loadBinBytes);
  onPick('cmpInput', loadCompare);
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('saveBtn').addEventListener('click', save);
  $('logBtn').addEventListener('click', exportLog);
  $('search').addEventListener('input', debounce(e => { state.query = e.target.value; renderTree(app); }, 120));
  $('modOnly').addEventListener('change', e => { state.modOnly = e.target.checked; renderTree(app); });
  $('menuBtn').addEventListener('click', () => setDrawer(!$('side').classList.contains('open')));
  $('scrim').addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', onKey);
  attachGrid(app);
  attachOrbit($('graph'), cam, persist => {
    renderGraph();
    if (persist) prefs.set('cam', cam);
  }, () => $('graph').dataset.mode === 'surface');
  new ResizeObserver(() => renderGraph()).observe($('graphWrap'));

  let depth = 0;
  const hasFiles = e => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  document.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    depth++;
    document.body.classList.add('dropping');
  });
  document.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dropping');
  });
  document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropping');
    readFiles(e.dataTransfer.files);
  });

  addEventListener('beforeunload', e => {
    if (!state.demo && state.image?.unsaved && state.image.changed.size) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  const retheme = () => {
    resetTheme();
    refresh();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

function boot() {
  state.rawMode = prefs.get('raw', false) === true;
  wire();
  const demo = demoFiles();
  state.model = parseXdf(demo.xdfText);
  state.xdfName = 'example.xdf';
  state.image = new BinImage(demo.bin, demo.binName);
  state.pick = pickPlugin(state.image.original);
  state.bounds = checkBounds(state.model, demo.bin.length);
  state.demo = true;
  state.open.add('0');
  state.item = state.model.items[0];
  state.sel = { r0: 4, c0: 3, r1: 6, c1: 6 };
  refresh();
  showBanner('You are looking at made-up example data. Open your XDF and BIN files, or drop them anywhere on this page, to start.', 'info');
  setStatus('Example loaded.');
}

window.xdfedit = {
  app,
  load(xdfText, binBytes, binName = 'test.bin') {
    loadXdfText(xdfText, 'test.xdf');
    return loadBinBytes(binBytes, binName);
  },
  loadCompare: (bytes, name = 'compare.bin') => loadCompare(bytes, name),
  select(query) {
    const it = state.model?.items.find(i => i.title === query || i.z.offset === query);
    if (it) select(it);
    return Boolean(it);
  },
  prepareSave: () => prepareSave(state.image, state.model, state.pick),
};

boot();
