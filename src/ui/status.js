// Footer status line, banners, the in-page confirm bar and the checksum pills.
import { $, h, hex } from './dom.js';

export function setStatus(msg, kind = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.dataset.kind = kind;
}

export function showBanner(text, kind = 'warn') {
  const el = $('banner');
  el.replaceChildren(
    h('span', { text }),
    h('button', { type: 'button', class: 'link', onclick: () => { el.hidden = true; } }, 'Dismiss'));
  el.dataset.kind = kind;
  el.hidden = false;
}

export function hideBanner() {
  $('banner').hidden = true;
}

export function askConfirm(text, okLabel) {
  const el = $('confirm');
  return new Promise(resolve => {
    const done = v => {
      el.hidden = true;
      resolve(v);
    };
    el.replaceChildren(
      h('span', { text }),
      h('button', { type: 'button', class: 'btn danger', onclick: () => done(true) }, okLabel),
      h('button', { type: 'button', class: 'btn', onclick: () => done(false) }, 'Cancel'));
    el.hidden = false;
    el.querySelector('button').focus();
  });
}

export function renderChecks(state) {
  const el = $('checks');
  el.replaceChildren();
  if (!state.image) return;
  if (state.demo) {
    el.append(h('span', { class: 'pill neutral' }, 'Example data'));
    return;
  }
  const { plugin, reasons } = state.pick;
  if (!plugin) {
    el.append(h('span', { class: 'pill bad', title: reasons.map(r => `${r.name}: ${r.reason}`).join('\n') }, 'No checksum plugin'));
    return;
  }
  for (const [name, r] of Object.entries(state.verified)) {
    const note = state.plan.fixed.includes(name) ? 'fixed on save' : state.plan.notFixed.includes(name) ? 'NOT fixed' : '';
    const tip = `${name}: calculated ${hex(r.calc, 4)}, stored ${hex(r.stored, 4)} in the loaded file` + (note ? ` (${note})` : '');
    el.append(h('span', { class: `pill ${r.ok && note !== 'NOT fixed' ? 'ok' : 'bad'}`, title: tip },
      `${name} ${r.ok ? '✓' : '✗'}`, note ? h('small', {}, ` · ${note}`) : null));
  }
}
