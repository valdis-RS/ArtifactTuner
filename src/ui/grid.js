// The map grid: heat-coloured cells with compare outlines, the A / B / Δ
// compare views, mouse and keyboard selection, and copy/paste through the
// hidden key sink.
import { $, esc, css, rampRgb } from './dom.js';
import { formatValue, formatAxis, deltaView } from '../table.js';
import { normSel, parseTsv } from '../ops.js';

const signedFmt = (v, d) => (v > 0 ? '+' : '') + formatValue(v, d);

// Tooltip for a value that differs: A/B names while comparing, loaded → now otherwise.
const diffTip = (comparing, a, b, fmt, delta) => (comparing
  ? `A ${fmt(a)} · B ${fmt(b)}${delta ? ` · Δ ${delta}` : ''}`
  : `loaded ${fmt(b)} → now ${fmt(a)}${delta ? ` (Δ ${delta})` : ''}`);

// An axis header cell showing `shown`, outlined when the A and B axis values differ.
function axisHead(axis, shown, a, b, comparing, cls, data) {
  const changed = axis.kind === 'embedded' && !Object.is(a, b);
  const tip = changed ? ` title="${esc(diffTip(comparing, a, b, v => formatAxis(axis, v)))}"` : '';
  return `<th class="${cls}${changed ? ' chg' : ''}" ${data}${tip}>${esc(formatAxis(axis, shown))}</th>`;
}

export function renderGrid(app) {
  const { state } = app;
  const { item, view, refView } = state;
  const table = $('grid');
  if (!item || !view) {
    table.replaceChildren();
    return;
  }
  const comparing = Boolean(state.image?.referenceName);
  const mode = comparing ? state.cmpView : 'a';            // 'a' loaded, 'b' compare file, 'd' A − B
  const A = state.rawMode ? view.raw : view.phys;
  const B = state.rawMode ? refView.raw : refView.phys;
  const d = state.rawMode ? 0 : item.z.decimals;
  const fmt = v => formatValue(v, d);
  const delta = mode === 'd' ? deltaView(view, refView, state.rawMode) : null;
  const shown = mode === 'b' ? B : A;
  const axes = mode === 'b' ? refView : view;
  let lo = Infinity, hi = -Infinity;
  for (const row of shown) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const background = delta
    ? (r, c) => (delta.changed[r][c] ? css(rampRgb(0.5 + delta.cells[r][c] / (2 * (delta.maxAbs || 1)), 'dheat')) : '')
    : (r, c) => css(rampRgb((shown[r][c] - lo) / span));
  const isTable = item.kind === 'table';
  const html = [];
  if (isTable) {
    const corner = `${item.y.units || 'rows'} ↓  ${item.x.units || 'columns'} →`;
    html.push(`<thead><tr><th class="corner" data-all="1" title="${esc(corner)} (click to select all)">${esc(corner)}</th>`);
    axes.xs.forEach((x, c) => html.push(axisHead(item.x, x, view.xs[c], refView.xs[c], comparing, 'xh', `data-col="${c}"`)));
    html.push('</tr></thead>');
  }
  html.push('<tbody>');
  for (let r = 0; r < view.rows; r++) {
    html.push(`<tr${delta ? ' class="delta"' : ''}>`);
    if (isTable) html.push(axisHead(item.y, axes.ys[r], view.ys[r], refView.ys[r], comparing, 'yh', `data-row="${r}"`));
    for (let c = 0; c < view.cols; c++) {
      const changed = !Object.is(view.raw[r][c], refView.raw[r][c]);
      const tip = changed ? ` title="${esc(diffTip(comparing, A[r][c], B[r][c], fmt, signedFmt(A[r][c] - B[r][c], d)))}"` : '';
      const text = delta ? (changed ? signedFmt(delta.cells[r][c], d) : '') : fmt(shown[r][c]);
      const bg = background(r, c);
      html.push(`<td data-r="${r}" data-c="${c}"${changed ? ' class="chg"' : ''}${bg ? ` style="background-color:${bg}"` : ''}${tip}>${text}</td>`);
    }
    html.push('</tr>');
  }
  html.push('</tbody>');
  table.innerHTML = html.join('');
  table.classList.toggle('single', view.rows * view.cols === 1);
  // Keep the focused cell clear of the sticky axis headers when it scrolls into view.
  const wrap = $('gridWrap');
  wrap.style.scrollPaddingLeft = `${table.querySelector('th.yh')?.offsetWidth ?? 0}px`;
  wrap.style.scrollPaddingTop = `${table.tHead?.offsetHeight ?? 0}px`;
  paintSelection(app);
}

export function paintSelection(app, scroll = true) {
  const { state } = app;
  const table = $('grid');
  for (const td of table.querySelectorAll('td.sel, td.focus')) td.classList.remove('sel', 'focus');
  if (!state.sel || !state.view) return;
  const s = normSel(state.sel);
  const rows = table.tBodies[0]?.rows ?? [];
  for (let r = s.r0; r <= s.r1; r++) {
    for (let c = s.c0; c <= s.c1; c++) rows[r]?.querySelector(`td[data-c="${c}"]`)?.classList.add('sel');
  }
  const focus = rows[state.sel.r1]?.querySelector(`td[data-c="${state.sel.c1}"]`);
  focus?.classList.add('focus');
  if (scroll) focus?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function attachGrid(app) {
  const { state } = app;
  const table = $('grid'), sink = $('keysink');
  let dragging = false;
  const cellOf = el => {
    const td = el?.closest?.('td[data-r]');
    return td ? { r: Number(td.dataset.r), c: Number(td.dataset.c) } : null;
  };
  const last = () => ({ r: state.view.rows - 1, c: state.view.cols - 1 });

  table.addEventListener('pointerdown', e => {
    if (!state.view || e.button > 0) return;
    const th = e.target.closest('th');
    if (th) {
      const l = last();
      if (th.dataset.all) app.setSel({ r0: 0, c0: 0, r1: l.r, c1: l.c });
      else if (th.dataset.col) { const c = Number(th.dataset.col); app.setSel({ r0: 0, c0: c, r1: l.r, c1: c }); }
      else if (th.dataset.row) { const r = Number(th.dataset.row); app.setSel({ r0: r, c0: 0, r1: r, c1: l.c }); }
      if (e.pointerType !== 'touch') {
        e.preventDefault();
        app.focusGrid();
      }
      return;
    }
    const cell = cellOf(e.target);
    if (!cell) return;
    if (e.shiftKey && state.sel) app.setSel({ ...state.sel, r1: cell.r, c1: cell.c });
    else app.setSel({ r0: cell.r, c0: cell.c, r1: cell.r, c1: cell.c });
    if (e.pointerType === 'touch') return;      // touch scrolls the grid; editing goes through the toolbar
    dragging = true;
    e.preventDefault();
    app.focusGrid();
  });
  document.addEventListener('pointermove', e => {
    if (!dragging) return;
    const cell = cellOf(document.elementFromPoint(e.clientX, e.clientY));
    if (cell && (cell.r !== state.sel.r1 || cell.c !== state.sel.c1)) app.setSel({ ...state.sel, r1: cell.r, c1: cell.c });
  });
  document.addEventListener('pointerup', () => { dragging = false; });

  sink.addEventListener('keydown', e => {
    if (!state.view || !state.sel) return;
    const mod = e.metaKey || e.ctrlKey;
    const s = state.sel, l = last();
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (move && !mod) {
      const r = Math.min(l.r, Math.max(0, s.r1 + move[0])), c = Math.min(l.c, Math.max(0, s.c1 + move[1]));
      app.setSel(e.shiftKey ? { ...s, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c });
    } else if (mod && e.key.toLowerCase() === 'a') {
      app.setSel({ r0: 0, c0: 0, r1: l.r, c1: l.c });
    } else if (!mod && (e.key === '+' || e.key === '=')) {
      app.step(1);
    } else if (!mod && e.key === '-') {
      app.step(-1);
    } else if (!mod && /^[0-9.,]$/.test(e.key)) {
      app.beginEntry(e.key);
    } else if (!mod && (e.key === 'Enter' || e.key === 'F2')) {
      app.beginEntry('');
    } else {
      return;                                    // let ⌘C / ⌘V / ⌘Z reach their handlers
    }
    e.preventDefault();
  });
  sink.addEventListener('copy', e => {
    if (!state.view || !state.sel) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', app.selectionTsv());
    app.status('Copied the selection.');
  });
  sink.addEventListener('paste', e => {
    if (!state.view || !state.sel) return;
    e.preventDefault();
    let block;
    try {
      block = parseTsv(e.clipboardData.getData('text/plain'));
    } catch (err) {
      app.status(`Paste: ${err.message}`, 'warn');
      return;
    }
    app.paste(block);
  });
  sink.addEventListener('cut', e => e.preventDefault());
  sink.addEventListener('input', () => app.focusGrid());
}
