// Edit toolbar: value entry, step, percent, interpolate, smooth, revert and copy.
import { $, h } from './dom.js';
import { defaultStep } from '../table.js';

const fmtStep = v => String(Number(v.toPrecision(6)));

function group(label, ...kids) {
  return h('div', { class: 'tgroup', role: 'group', 'aria-label': label || 'Other actions' },
    label ? h('span', { class: 'tgroup-label', 'aria-hidden': 'true' }, label) : null, ...kids);
}

function btn(text, title, onclick, disabled = false) {
  return h('button', { type: 'button', class: 'btn', title, onclick, disabled }, text);
}

export function renderToolbar(app) {
  const { state } = app;
  const bar = $('toolbar');
  const { item, view } = state;
  if (!item || !view) {
    bar.hidden = true;
    bar.replaceChildren();
    return;
  }
  bar.hidden = false;
  const viewOnly = Boolean(state.image.referenceName) && state.cmpView !== 'a';   // B and Δ views are read-only
  const locked = item.readOnly || item.disabled || viewOnly;
  const refName = state.image.referenceName || 'the loaded file';
  bar.replaceChildren(
    group('Value',
      h('input', {
        id: 'valIn', class: 'num', type: 'text', inputmode: 'decimal', autocomplete: 'off',
        placeholder: state.rawMode ? 'raw' : (item.z.units || 'value'), 'aria-label': 'Value for the selected cells', disabled: locked,
      }),
      btn('Set', 'Set the selected cells to this value (Enter)', () => app.applyValue(), locked)),
    group('Step',
      btn('−', 'Step the selection down (−)', () => app.step(-1), locked),
      h('input', { id: 'stepIn', class: 'num small', type: 'text', inputmode: 'decimal', value: fmtStep(defaultStep(item, state.rawMode)), 'aria-label': 'Step size', disabled: locked }),
      btn('+', 'Step the selection up (+)', () => app.step(1), locked)),
    group('Scale',
      h('input', { id: 'pctIn', class: 'num small', type: 'text', inputmode: 'decimal', value: '2', 'aria-label': 'Percent', disabled: locked }),
      h('span', { class: 'unit' }, '%'),
      btn('Apply', 'Multiply the selection by (1 + percent / 100)', () => app.scale(), locked)),
    group('Shape',
      btn('Interp ↔', 'Interpolate each row between its first and last selected cell', () => app.interpolate('h'), locked),
      btn('Interp ↕', 'Interpolate each column between its first and last selected cell', () => app.interpolate('v'), locked),
      btn('Interp ◰', 'Interpolate from the four corners of the selection', () => app.interpolate('bilinear'), locked),
      btn('Smooth', 'Average each cell with its neighbours inside the selection', () => app.smooth(), locked)),
    group('',
      btn('Revert', `Set the selection back to ${refName}`, () => app.revert(), locked),
      btn('Copy', 'Copy the selection as tab-separated values', () => app.copy())));
  const valIn = $('valIn');
  valIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      app.applyValue();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      valIn.value = '';
      app.focusGrid();
    }
  });
}
