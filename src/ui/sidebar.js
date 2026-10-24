// Map list: XDF categories, search, the "modified only" / "differences only"
// filter and per-item markers (● modified, Δ differs from the compare file,
// ⚠ read-only or disabled).
import { $, h, hex } from './dom.js';
import { itemSpans } from '../xdf.js';
import { diffItem } from '../table.js';

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

// {cells, axes} when the item's values or axes differ between the working
// image and the reference (the compare file, or the loaded original), else null.
export function itemDiff(item, image) {
  if (!image || item.disabled) return null;
  return diffItem(item, image.working, image.reference);
}

export const isModified = (item, image) => Boolean(itemDiff(item, image));

export function diffLabel({ cells, axes }) {
  const c = cells ? `${cells} cell${cells === 1 ? '' : 's'}` : '';
  return [c, axes ? 'axes' : ''].filter(Boolean).join(' + ');
}

function itemRow(app, item, diff) {
  const { state } = app;
  const comparing = Boolean(state.image?.referenceName);
  const warn = item.readOnly || item.disabled;
  const shape = item.kind === 'constant' ? 'value' : item.z.rows > 1 ? `${item.z.rows}×${item.z.cols}` : String(item.z.cols);
  const tip = [hex(item.z.offset, 5), item.disabled ? `Disabled: ${item.disabledReason}` : '', item.readOnly ? `Read-only: ${item.reason}` : '']
    .filter(Boolean).join(' · ');
  const current = state.item === item;
  const mark = diff ? (comparing ? 'Δ' : '●') : warn ? '⚠' : '';
  const note = !diff ? null : comparing ? ` (differs from ${state.image.referenceName})` : ' (modified)';
  return h('li', {},
    h('button', {
      type: 'button',
      title: tip,
      class: 'item' + (current ? ' current' : '') + (item.disabled ? ' disabled' : ''),
      'aria-current': current ? 'true' : false,
      onclick: () => app.select(item),
    },
    h('span', { class: 'mark' + (diff && comparing ? ' diff' : '') + (warn && !diff ? ' warn' : ''), 'aria-hidden': 'true' }, mark),
    h('span', { class: 'item-title' }, item.title, note ? h('span', { class: 'sr' }, note) : null),
    h('span', { class: 'item-meta' }, shape, diff && comparing ? h('span', { class: 'diff-note' }, ` · Δ ${diffLabel(diff)}`) : null)));
}

export function renderTree(app) {
  const { state } = app;
  const tree = $('tree');
  const compareName = state.image?.referenceName ?? '';
  $('modOnlyLabel').textContent = compareName ? 'Differences only' : 'Modified only';
  tree.replaceChildren();
  if (!state.model) {
    tree.append(h('p', { class: 'empty' }, 'Open an XDF to list its maps.'));
    return;
  }
  const names = new Map(state.model.categories.map(c => [c.id, c.name]));
  const groups = new Map();
  const diffs = new Map();
  for (const item of state.model.items) {
    if (!itemMatches(item, state.query)) continue;
    const diff = itemDiff(item, state.image);
    if (state.modOnly && !diff) continue;
    diffs.set(item, diff);
    for (const id of item.categoryIds.length ? item.categoryIds : [-1]) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(item);
    }
  }
  if (!groups.size) {
    const none = compareName ? `No tables differ from ${compareName}.` : 'No modified maps yet.';
    tree.append(h('p', { class: 'empty' }, state.modOnly ? none : 'No maps match the search.'));
    return;
  }
  const filtering = Boolean(state.query.trim()) || state.modOnly;
  let shown = 0;
  const ids = [...groups.keys()].sort((a, b) => (a < 0) - (b < 0) || a - b);
  for (const id of ids) {
    const items = groups.get(id), key = String(id);
    const open = filtering || state.open.has(key);
    const differing = compareName ? items.filter(item => diffs.get(item)).length : 0;
    const head = h('button', {
      type: 'button',
      class: 'cat',
      'aria-expanded': String(open),
      onclick: () => {
        if (state.open.has(key)) state.open.delete(key);
        else state.open.add(key);
        renderTree(app);
      },
    },
    h('span', { class: 'cat-name', text: names.get(id) ?? 'Uncategorised' }),
    differing ? h('span', { class: 'diff-count', text: `${differing} differ` }) : null,
    h('span', { class: 'count', text: String(items.length) }));
    const section = h('section', { class: 'group' }, head);
    if (open) {
      const list = h('ul', { class: 'items' });
      for (const item of items) {
        if (shown >= MAX_SHOWN) break;
        shown++;
        list.append(itemRow(app, item, diffs.get(item)));
      }
      section.append(list);
    }
    tree.append(section);
  }
  if (shown >= MAX_SHOWN) tree.append(h('p', { class: 'note' }, `Showing the first ${MAX_SHOWN} matches. Narrow the search to see the rest.`));
}
