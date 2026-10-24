// Map list: XDF categories, search, the "modified only" filter and per-item
// markers (● modified against the reference, ⚠ read-only or disabled).
import { $, h, hex } from './dom.js';
import { itemSpans } from '../xdf.js';

const MAX_SHOWN = 500;

export function itemMatches(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.title.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q)) return true;
  const m = /^(?:0x)?([0-9a-f]{3,})$/.exec(q);
  if (!m) return false;
  const want = parseInt(m[1], 16);
  return itemSpans(item).some(([s, e]) => want >= s && want < e);
}

export function isModified(item, image) {
  if (!image || item.disabled) return false;
  const [s, e] = itemSpans(item)[0];
  return image.differsInRange(s, e);
}

function itemRow(app, item) {
  const { state } = app;
  const mod = isModified(item, state.image);
  const warn = item.readOnly || item.disabled;
  const shape = item.kind === 'constant' ? 'value' : item.z.rows > 1 ? `${item.z.rows}×${item.z.cols}` : String(item.z.cols);
  const tip = [hex(item.z.offset, 5), item.disabled ? `Disabled: ${item.disabledReason}` : '', item.readOnly ? `Read-only: ${item.reason}` : '']
    .filter(Boolean).join(' · ');
  const current = state.item === item;
  return h('li', {},
    h('button', {
      type: 'button',
      title: tip,
      class: 'item' + (current ? ' current' : '') + (item.disabled ? ' disabled' : ''),
      'aria-current': current ? 'true' : false,
      onclick: () => app.select(item),
    },
    h('span', { class: 'mark' + (warn && !mod ? ' warn' : ''), 'aria-hidden': 'true' }, mod ? '●' : warn ? '⚠' : ''),
    h('span', { class: 'item-title' }, item.title, mod ? h('span', { class: 'sr' }, ' (modified)') : null),
    h('span', { class: 'item-meta' }, shape)));
}

export function renderTree(app) {
  const { state } = app;
  const tree = $('tree');
  tree.replaceChildren();
  if (!state.model) {
    tree.append(h('p', { class: 'empty' }, 'Open an XDF to list its maps.'));
    return;
  }
  const names = new Map(state.model.categories.map(c => [c.id, c.name]));
  const groups = new Map();
  for (const item of state.model.items) {
    if (!itemMatches(item, state.query)) continue;
    if (state.modOnly && !isModified(item, state.image)) continue;
    for (const id of item.categoryIds.length ? item.categoryIds : [-1]) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(item);
    }
  }
  if (!groups.size) {
    tree.append(h('p', { class: 'empty' }, state.modOnly ? 'No modified maps yet.' : 'No maps match the search.'));
    return;
  }
  const filtering = Boolean(state.query.trim()) || state.modOnly;
  let shown = 0;
  const ids = [...groups.keys()].sort((a, b) => (a < 0) - (b < 0) || a - b);
  for (const id of ids) {
    const items = groups.get(id), key = String(id);
    const open = filtering || state.open.has(key);
    const head = h('button', {
      type: 'button',
      class: 'cat',
      'aria-expanded': String(open),
      onclick: () => {
        if (state.open.has(key)) state.open.delete(key);
        else state.open.add(key);
        renderTree(app);
      },
    }, h('span', { class: 'cat-name', text: names.get(id) ?? 'Uncategorised' }), h('span', { class: 'count', text: String(items.length) }));
    const section = h('section', { class: 'group' }, head);
    if (open) {
      const list = h('ul', { class: 'items' });
      for (const item of items) {
        if (shown >= MAX_SHOWN) break;
        shown++;
        list.append(itemRow(app, item));
      }
      section.append(list);
    }
    tree.append(section);
  }
  if (shown >= MAX_SHOWN) tree.append(h('p', { class: 'note' }, `Showing the first ${MAX_SHOWN} matches. Narrow the search to see the rest.`));
}
