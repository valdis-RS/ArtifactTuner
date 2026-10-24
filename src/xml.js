// Minimal XML parser for XDF files. Produces {tag, attrs, children, text}
// nodes; text is the element's own text, concatenated and untrimmed.

export class XmlError extends Error {
  constructor(message, line, col) {
    super(`${message} (line ${line}, column ${col})`);
    this.line = line;
    this.col = col;
  }
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (m, e) => {
    if (e[0] !== '#') return NAMED[e] ?? m;
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

const NAME = /[A-Za-z_][\w.:-]*/y;
const ATTR = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const TAG_END = /\s*(\/?)>/y;

function position(src, at) {
  let line = 1, last = -1;
  for (let i = src.indexOf('\n'); i !== -1 && i < at; i = src.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return [line, at - last];
}

export function parseXml(src) {
  const fail = (msg, at) => {
    const [line, col] = position(src, at);
    throw new XmlError(msg, line, col);
  };
  const root = { tag: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const textEnd = lt === -1 ? src.length : lt;
    if (textEnd > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, textEnd));
    if (lt === -1) break;
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      if (e === -1) fail('Unclosed comment', lt);
      i = e + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      if (e === -1) fail('Unclosed CDATA section', lt);
      stack[stack.length - 1].text += src.slice(lt + 9, e);
      i = e + 3;
    } else if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const e = src.indexOf('>', lt + 2);
      if (e === -1) fail('Unclosed declaration', lt);
      i = e + 1;
    } else if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt + 2);
      if (e === -1) fail('Unclosed end tag', lt);
      const name = src.slice(lt + 2, e).trim();
      const open = stack[stack.length - 1];
      if (stack.length === 1) fail(`Unexpected </${name}>`, lt);
      if (open.tag !== name) fail(`Expected </${open.tag}> but found </${name}>`, lt);
      stack.pop();
      i = e + 1;
    } else {
      NAME.lastIndex = lt + 1;
      const nm = NAME.exec(src);
      if (!nm) fail('Malformed tag', lt);
      const el = { tag: nm[0], attrs: {}, children: [], text: '' };
      let pos = NAME.lastIndex;
      for (;;) {
        TAG_END.lastIndex = pos;
        const end = TAG_END.exec(src);
        if (end) {
          pos = TAG_END.lastIndex;
          stack[stack.length - 1].children.push(el);
          if (!end[1]) stack.push(el);
          break;
        }
        ATTR.lastIndex = pos;
        const at = ATTR.exec(src);
        if (!at) fail(`Malformed attribute in <${el.tag}>`, pos);
        el.attrs[at[1]] = decodeEntities(at[2] ?? at[3]);
        pos = ATTR.lastIndex;
      }
      i = pos;
    }
  }
  if (stack.length > 1) fail(`Unclosed <${stack[stack.length - 1].tag}>`, src.length);
  const doc = root.children[0];
  if (!doc) fail('No root element', 0);
  return doc;
}

export const child = (el, tag) => el.children.find(c => c.tag === tag) ?? null;
export const childrenOf = (el, tag) => el.children.filter(c => c.tag === tag);

export function textOf(el, tag, fallback = '') {
  const c = child(el, tag);
  return c ? c.text.trim() : fallback;
}
