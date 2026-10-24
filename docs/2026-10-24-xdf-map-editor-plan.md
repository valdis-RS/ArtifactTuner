# XDF Map Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-file browser map viewer/editor driven by a TunerPro XDF and an ECU BIN, with EMS2000 calibration-checksum correction, published as a claude.ai Artifact and usable as a local HTML file.

**Architecture:** Pure-JS engine modules (ES modules in `src/`) are tested with `node --test` against the real XDF/BIN files and the existing Python `checksum.py`. Plain-DOM UI modules sit on top. `build.js` is a ~60-line bundler that wraps each module in its own scope and inlines everything into `dist/xdf-editor.html` (Artifact) and `dist/xdf-editor-local.html` (local file).

**Tech Stack:** Node 26 (`node:test`, no npm dependencies), Python 3 (fixtures and cross-checks only), vanilla JS / CSS / canvas 2D, Google Fonts (Barlow, Barlow Semi Condensed, JetBrains Mono) with system fallbacks.

**Spec:** `docs/2026-10-24-xdf-map-editor-design.md` (read it before starting any task).

## Global Constraints

- Paths: the repository is `/Users/valdiskikusts/MSV70/ArtifactTuner` (remote `origin` = https://github.com/valdis-RS/ArtifactTuner.git, **public**). File paths in this plan are relative to it. The real ECU files live in the folder above it, `/Users/valdiskikusts/MSV70` (the env variable `ARTIFACT_TUNER_DATA` overrides that). Nothing outside the repository is changed; Task 12 adds a git-ignored `.claude/launch.json` for the browser preview.
- Real BIN/XDF files and `Mini/mapswitch/checksum.py` are read-only inputs. Tests write temporary files only under `os.tmpdir()`.
- Git: before Task 1, create the branch `feat/xdf-map-editor` from `main` (`git switch -c feat/xdf-map-editor`). Every task ends with the full suite (`npm test`) and one commit of exactly that task's files; every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push and do not open a PR; that happens only when the user asks.
- Public repository: never commit a BIN, XDF, ORI or any data decoded from them. `.gitignore` already blocks `*.bin`, `*.xdf`, `*.ori`, `tests/fixtures/*.json`, `dist/` and `.claude/`; still read `git status --short` before every commit.
- No npm dependencies. No external scripts in the page; the only external resource is the Google Fonts stylesheet.
- Module syntax the bundler supports, and nothing else: `import { a, b as c } from './x.js';` on one line, and `export function|async function|class|const|let NAME` at the start of a line. Top-level names may repeat across modules (each module gets its own scope).
- Byte order comes from `mmedtypeflags` only; absent flags = 0 = MSB-first unsigned. The header `DEFAULTS` line is never used for byte order or signedness. Flags: `0x01` signed, `0x02` LSB-first, `0x04` column-major, `0x10000` IEEE float32; any other bit makes the item unsupported.
- `CATEGORYMEM category="N"` refers to `CATEGORY index="N-1"`.
- The EMS2K plugin corrects the `cal` CRC only. Boot and prog are verify-only. Edited bytes inside a non-correctable checksum range make the output `_CHECKSUM-NOT-FIXED`. Never write code that corrects boot or prog checksums.
- Saved names: `<base>_edit.bin` / `<base>_edit.zip`, or `<base>_edit_CHECKSUM-NOT-FIXED.bin` / `.zip`, where `<base>` is the loaded BIN name without its extension.
- Artifact page: title "XDF Map Editor"; capabilities `{downloads: true}` only. No `alert`, `confirm` or `prompt`. No `<a download>` in Artifact mode (only in local mode).
- Colours only through `:root` tokens with dark variants; body side padding `max(16px, env(safe-area-inset-left|right, 0px))`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `package.json` | ES-module package, `npm test`, `npm run build` | 1 |
| `tests/helpers.js` | Paths to the real files, read helpers, temp files, `pyVerify` | 1, 8 |
| `src/xml.js` | Minimal XML parser | 1 |
| `src/math.js` | Equation compiler and raw↔physical converter | 2 |
| `src/codec.js` | Cell offsets, raw ranges, read/encode raw values | 3 |
| `src/xdf.js` | XDF → model, bounds check | 4 |
| `src/table.js` | Item-level decode and write planning | 5 |
| `tests/fixtures/make_fixtures.py` | Independent Python decode of two EMS2K tables, run by the test into a temp folder | 5 |
| `src/image.js` | Original / working / reference images, undo/redo | 6 |
| `src/ops.js` | Grid edit operations, TSV | 7 |
| `src/checksums/ems2k.js`, `src/checksums/index.js` | EMS2K CRC plugin, plugin registry | 8 |
| `src/zip.js` | Store-only zip writer | 9 |
| `src/save.js` | Checksum policy, self-check, names, change log | 10 |
| `build.js`, `src/index.html`, `src/style.css`, `src/ui/dom.js` | Bundler, page template, all CSS, DOM helpers | 11 |
| `src/ui/status.js`, `src/ui/demo.js`, `src/ui/sidebar.js`, `src/ui/app.js` | Status/banners/checks, example data, map list, app wiring | 12 |
| `src/ui/grid.js`, `src/ui/toolbar.js` | Grid, selection, keyboard, clipboard, edit toolbar | 13 |
| `src/ui/surface3d.js`, `src/ui/graph2d.js` | 3D surface and 2D curve | 14 |
| `dist/xdf-editor.html`, `dist/xdf-editor-local.html` | Build outputs (git-ignored); the first is published | 12–15 |
| `README.md` | What the tool is, how to use, test and build it | 15 |

Real files used by tests (all under `/Users/valdiskikusts/MSV70`):

- `Mini/EMS2K_111441901203EHC3.xdf` — 466 tables, 105 constants
- `Mini/TB62572_EMS2K_111441901203EHC3_fullread_EKII.bin` — all three CRCs OK (boot C6D1, prog 6DFC, cal FB17)
- `Mini/TB62572_EMS2K_111441901203EHC3_fullread_EKIInonews.bin` — prog CRC mismatch (calc 0263, stored 5233)
- `Mini/TB62572_EMS2K_111441901203EHC3_fullread_EKII_mapswitch.bin` — all three CRCs OK (prog C9C8, cal AF10)
- `Mini/mapswitch/checksum.py` — reference CRC implementation
- `BMW_Siemens_MSV70_9PPL921S_128K.xdf` — 2183 tables, 6086 constants, 9 items with equation `0.000000 * X`
- `S7581295.bin` — 125 904 bytes (the XDF region says 0x20000)

EMS2K checksum layout on EKII: boot stored 0x3ED4, range 0x0000–0x3D8F; prog stored 0x10010, 6 ranges from 0x10978 to 0x5FFFF; cal stored 0x77FE0, ranges 0x70094–0x77FDF and 0x78000–0x7EF03. Every EMS2K XDF item lies within 0x701AC–0x7EEC1.

---

### Task 1: Scaffold and XML parser

**Files:**
- Create: `package.json`
- Create: `tests/helpers.js`
- Create: `src/xml.js`
- Test: `tests/xml.test.js`

**Interfaces:**
- Produces: `parseXml(src: string) → Node` where `Node = {tag: string, attrs: {[name]: string}, children: Node[], text: string}` (text = concatenated, untrimmed direct text). `child(el, tag) → Node|null`, `childrenOf(el, tag) → Node[]`, `textOf(el, tag, fallback='') → string` (trimmed). `decodeEntities(s) → string`. `class XmlError extends Error {line, col}`.
- Produces (tests): `P` (paths), `APP` (repository folder), `ROOT` (folder with the real ECU files), `readText(path)`, `readBin(path) → Uint8Array`, `tmpFile(name, bytes) → path`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "artifact-tuner",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\"",
    "build": "node build.js"
  }
}
```

- [ ] **Step 2: Create `tests/helpers.js`**

```js
// Shared test helpers: paths to the real XDF/BIN files and temp-file writing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP = path.resolve(here, '..');                                     // the repository
export const ROOT = process.env.ARTIFACT_TUNER_DATA ?? path.resolve(APP, '..');   // holds Mini/ and the MSV70 files

export const P = {
  ems2kXdf: path.join(ROOT, 'Mini', 'EMS2K_111441901203EHC3.xdf'),
  ekii: path.join(ROOT, 'Mini', 'TB62572_EMS2K_111441901203EHC3_fullread_EKII.bin'),
  nonews: path.join(ROOT, 'Mini', 'TB62572_EMS2K_111441901203EHC3_fullread_EKIInonews.bin'),
  mapswitch: path.join(ROOT, 'Mini', 'TB62572_EMS2K_111441901203EHC3_fullread_EKII_mapswitch.bin'),
  checksumPy: path.join(ROOT, 'Mini', 'mapswitch', 'checksum.py'),
  msv70Xdf: path.join(ROOT, 'BMW_Siemens_MSV70_9PPL921S_128K.xdf'),
  msv70Bin: path.join(ROOT, 'S7581295.bin'),
};

for (const [name, p] of Object.entries(P)) {
  if (!fs.existsSync(p)) {
    throw new Error(`Test file "${name}" not found at ${p}. The tests need the private ECU files; ` +
      'set ARTIFACT_TUNER_DATA to the folder that holds Mini/ and the MSV70 files.');
  }
}

export const readText = p => fs.readFileSync(p, 'utf8');
export const readBin = p => new Uint8Array(fs.readFileSync(p));

export function tmpFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-tuner-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}
```

- [ ] **Step 3: Write the failing test `tests/xml.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, child, childrenOf, textOf, decodeEntities, XmlError } from '../src/xml.js';
import { P, readText } from './helpers.js';

test('elements, attributes, text and self-closing tags', () => {
  const doc = parseXml(`<?xml version="1.0"?>\n<!-- c -->\n<a x="1" y='two'><b>hi</b><c z="3"/><b>there</b></a>`);
  assert.equal(doc.tag, 'a');
  assert.deepEqual(doc.attrs, { x: '1', y: 'two' });
  assert.equal(childrenOf(doc, 'b').length, 2);
  assert.equal(textOf(doc, 'b'), 'hi');
  assert.equal(child(doc, 'c').attrs.z, '3');
  assert.equal(child(doc, 'c').children.length, 0);
  assert.equal(child(doc, 'missing'), null);
  assert.equal(textOf(doc, 'missing', 'dflt'), 'dflt');
});

test('entities in text and attributes', () => {
  const doc = parseXml('<a t="x &gt; y &amp; &quot;q&quot;">line1&#013;&#010;line2 &#x41;&lt;</a>');
  assert.equal(doc.attrs.t, 'x > y & "q"');
  assert.equal(doc.text, 'line1\r\nline2 A<');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
});

test('a ">" inside an attribute value does not end the tag', () => {
  const doc = parseXml('<a d="1 > 0"><b/></a>');
  assert.equal(doc.attrs.d, '1 > 0');
  assert.equal(doc.children.length, 1);
});

test('mismatched end tag reports line and column', () => {
  assert.throws(() => parseXml('<a>\n  <b></a>'), err => err instanceof XmlError && err.line === 2 && err.col === 6);
});

test('unclosed elements and malformed attributes are errors', () => {
  assert.throws(() => parseXml('<a><b></b>'), /Unclosed <a>/);
  assert.throws(() => parseXml('<a x=1></a>'), /Malformed attribute/);
  assert.throws(() => parseXml('just text'), /No root element/);
});

test('real XDFs parse with the expected item counts', () => {
  for (const [file, tables, consts] of [[P.ems2kXdf, 466, 105], [P.msv70Xdf, 2183, 6086]]) {
    const t0 = performance.now();
    const doc = parseXml(readText(file));
    const ms = performance.now() - t0;
    assert.equal(doc.tag, 'XDFFORMAT');
    assert.equal(childrenOf(doc, 'XDFTABLE').length, tables);
    assert.equal(childrenOf(doc, 'XDFCONSTANT').length, consts);
    assert.ok(ms < 3000, `${file} took ${Math.round(ms)} ms`);
  }
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/xml.test.js`
Expected: FAIL — `Cannot find module .../src/xml.js`.

- [ ] **Step 5: Implement `src/xml.js`**

```js
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/xml.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 7: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add package.json tests/helpers.js src/xml.js tests/xml.test.js
git status --short
git commit -m "Add XML parser and test scaffold" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 2: Equations and the raw↔physical converter

**Files:**
- Create: `src/math.js`
- Test: `tests/math.test.js`

**Interfaces:**
- Produces: `class MathError extends Error`. `compile(expr: string) → (x: number) => number` (supports `+ - * / ^ ( )`, unary minus/plus, numbers incl. exponents, `X`/`x`; anything else throws `MathError`). `converter(expr, lo, hi, isFloat) → {f, linear: boolean, step: number, toRaw: ((y: number) => {raw: number, clamped: boolean}) | null}`. `toRaw` is `null` when the equation can't be inverted (zero slope, non-monotonic, or non-linear float). `toRaw` throws `MathError` for a non-finite input. Integer raws are rounded to the nearest integer and clamped to `[lo, hi]`; float raws are clamped but not rounded.

- [ ] **Step 1: Write the failing test `tests/math.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, converter, MathError } from '../src/math.js';

const FLT_MAX = 3.4028234663852886e38;

test('compiles the equation forms used by real XDFs', () => {
  const cases = [
    ['X', 7, 7],
    ['X*0.75-48', 100, 27],
    ['(X-128)*0.375', 136, 3],
    ['X*0.375-23.625', 63, 0],
    ['X/32768', 16384, 0.5],
    ['0.750000 * X+ -48.000000', 100, 27],
    ['1.000000 * X+ -32768.000000', 32769, 1],
    ['X/256*0.75-48', 25600, 27],
    ['2^3+X', 1, 9],
    ['-X+10', 4, 6],
    ['x * 2', 3, 6],
    ['1e2*X', 2, 200],
  ];
  for (const [eq, x, y] of cases) assert.equal(compile(eq)(x), y, eq);
});

test('rejects unsupported syntax', () => {
  for (const eq of ['ABS(X)', 'X*', '(X+1', 'X Y', '']) assert.throws(() => compile(eq), MathError, eq);
});

test('linear converter inverts exactly over the full 8-bit range', () => {
  const c = converter('X*0.375-23.625', 0, 255, false);
  assert.equal(c.linear, true);
  assert.equal(c.step, 0.375);
  for (let r = 0; r <= 255; r++) assert.deepEqual(c.toRaw(c.f(r)), { raw: r, clamped: false });
});

test('linear converter rounds to the nearest raw step and clamps', () => {
  const c = converter('X*0.375-23.625', 0, 255, false);
  assert.deepEqual(c.toRaw(20), { raw: 116, clamped: false });   // (20 + 23.625) / 0.375 = 116.33
  assert.deepEqual(c.toRaw(1000), { raw: 255, clamped: true });
  assert.deepEqual(c.toRaw(-100), { raw: 0, clamped: true });
  assert.throws(() => c.toRaw(NaN), MathError);
});

test('offset equation over a 16-bit range', () => {
  const c = converter('1.000000 * X+ -32768.000000', 0, 65535, false);
  assert.deepEqual(c.toRaw(-32768), { raw: 0, clamped: false });
  assert.deepEqual(c.toRaw(32767), { raw: 65535, clamped: false });
});

test('non-linear monotonic equation picks the nearest raw value', () => {
  const c = converter('X*X', 0, 255, false);
  assert.equal(c.linear, false);
  assert.deepEqual(c.toRaw(100), { raw: 10, clamped: false });
  assert.deepEqual(c.toRaw(101), { raw: 10, clamped: false });
  assert.deepEqual(c.toRaw(c.f(200)), { raw: 200, clamped: false });
  assert.deepEqual(c.toRaw(1e9), { raw: 255, clamped: true });
});

test('non-monotonic and flat equations cannot be written', () => {
  assert.equal(converter('(X-128)*(X-128)', 0, 255, false).toRaw, null);
  assert.equal(converter('0.000000 * X', 0, 65535, false).toRaw, null);
});

test('float elements are not rounded', () => {
  const c = converter('X*2', -FLT_MAX, FLT_MAX, true);
  assert.deepEqual(c.toRaw(3), { raw: 1.5, clamped: false });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/math.test.js`
Expected: FAIL — `Cannot find module .../src/math.js`.

- [ ] **Step 3: Implement `src/math.js`**

```js
// XDF MATH equations: compile "X*0.75-48" style expressions to functions of
// X, and build the raw <-> physical converter used to read and write cells.

export class MathError extends Error {}

const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([Xx])|([-+*/^()]))/y;

function tokenize(expr) {
  const out = [];
  let pos = 0;
  while (pos < expr.length) {
    if (/^\s*$/.test(expr.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(expr);
    if (!m) throw new MathError(`Unsupported text "${expr.slice(pos).trim()}" in "${expr}"`);
    out.push(m[1] !== undefined ? { num: parseFloat(m[1]) } : m[2] ? { x: true } : { op: m[3] });
    pos = TOKEN.lastIndex;
  }
  return out;
}

export function compile(expr) {
  const toks = tokenize(expr);
  let i = 0;
  const isOp = (t, ops) => Boolean(t && t.op && ops.includes(t.op));

  function primary() {
    const t = toks[i++];
    if (!t) throw new MathError(`Unexpected end of "${expr}"`);
    if (t.num !== undefined) return () => t.num;
    if (t.x) return x => x;
    if (t.op === '(') {
      const e = sum();
      if (!isOp(toks[i++], ')')) throw new MathError(`Missing ")" in "${expr}"`);
      return e;
    }
    throw new MathError(`Unexpected "${t.op}" in "${expr}"`);
  }
  function power() {
    const base = primary();
    if (!isOp(toks[i], '^')) return base;
    i++;
    const exp = unary();
    return x => base(x) ** exp(x);
  }
  function unary() {
    if (isOp(toks[i], '-')) { i++; const u = unary(); return x => -u(x); }
    if (isOp(toks[i], '+')) { i++; return unary(); }
    return power();
  }
  function product() {
    let left = unary();
    while (isOp(toks[i], '*/')) {
      const op = toks[i++].op, a = left, b = unary();
      left = op === '*' ? x => a(x) * b(x) : x => a(x) / b(x);
    }
    return left;
  }
  function sum() {
    let left = product();
    while (isOp(toks[i], '+-')) {
      const op = toks[i++].op, a = left, b = product();
      left = op === '+' ? x => a(x) + b(x) : x => a(x) - b(x);
    }
    return left;
  }

  const f = sum();
  if (i < toks.length) throw new MathError(`Unexpected "${toks[i].op ?? toks[i].num ?? 'X'}" in "${expr}"`);
  return f;
}

const SPAN = 1048576;                                   // 2^20: keeps the slope estimate exact for decimal factors
const FLOAT_PROBES = [-1e6, -1, 1, 3, 1e6];

function isLinear(f, a, b, probes) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return false;
  return probes.every(p => {
    const y = f(p);
    return Math.abs(y - (a * p + b)) <= 1e-9 * Math.max(1, Math.abs(y), Math.abs(a * p));
  });
}

// 1 = increasing, -1 = decreasing, 0 = neither (or flat somewhere).
function monotonic(f, lo, hi) {
  const exhaustive = hi - lo <= 65535;
  const n = exhaustive ? hi - lo : 4096;
  let dir = 0, prev = f(lo);
  for (let k = 1; k <= n; k++) {
    const y = f(exhaustive ? lo + k : lo + Math.round(((hi - lo) * k) / n));
    if (!Number.isFinite(y)) return 0;
    const d = Math.sign(y - prev);
    if (d === 0) return 0;
    if (dir === 0) dir = d;
    else if (d !== dir) return 0;
    prev = y;
  }
  return dir;
}

function nearestRaw(f, lo, hi, dir, y) {
  let a = lo, b = hi;
  while (a < b) {
    const m = Math.floor((a + b) / 2);
    if (dir * f(m) < dir * y) a = m + 1;
    else b = m;
  }
  if (a > lo && Math.abs(f(a - 1) - y) <= Math.abs(f(a) - y)) return a - 1;
  return a;
}

export function converter(expr, lo, hi, isFloat) {
  const f = compile(expr);
  const conv = { f, linear: false, step: 0, toRaw: null };
  const check = y => {
    if (typeof y !== 'number' || !Number.isFinite(y)) throw new MathError(`"${y}" is not a number`);
    return y;
  };
  const b = f(0);
  const a = (f(SPAN) - b) / SPAN;
  const probes = isFloat ? FLOAT_PROBES : [lo, hi, Math.round((lo + hi) / 2), lo + 1];
  if (isLinear(f, a, b, probes)) {
    conv.linear = true;
    conv.step = Math.abs(a);
    conv.toRaw = y => {
      const exact = (check(y) - b) / a;
      const r = isFloat ? exact : Math.round(exact);
      const v = Math.min(hi, Math.max(lo, r));
      return { raw: v === 0 ? 0 : v, clamped: v !== r };
    };
  } else if (!isFloat) {
    const dir = monotonic(f, lo, hi);
    if (dir !== 0) {
      const mid = Math.round((lo + hi) / 2);
      const ylo = Math.min(f(lo), f(hi)), yhi = Math.max(f(lo), f(hi));
      conv.step = Math.abs(f(Math.min(hi, mid + 1)) - f(mid));
      conv.toRaw = y => {
        check(y);
        return { raw: nearestRaw(f, lo, hi, dir, y), clamped: y < ylo || y > yhi };
      };
    }
  }
  return conv;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/math.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add src/math.js tests/math.test.js
git status --short
git commit -m "Add XDF equation compiler and raw/physical converter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 3: Byte codec

**Files:**
- Create: `src/codec.js`
- Test: `tests/codec.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: an **Elem** shape used by every later task: `{offset, bits: 8|16|32, signed, lsbFirst, float, colMajor, rows, cols, majorStride, minorStride, ...}` (strides in bits, 0 = packed; `offset` is the file offset after `BASEOFFSET`). Functions: `FLT_MAX`, `cellOffset(e, r, c) → number`, `elemSpan(e) → [start, endExclusive]`, `rawRange(e) → [lo, hi]`, `readRaw(img: Uint8Array, e, r, c) → number`, `encodeRaw(e, raw) → Uint8Array` (length `bits/8`).

- [ ] **Step 1: Write the failing test `tests/codec.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { cellOffset, elemSpan, rawRange, readRaw, encodeRaw, FLT_MAX } from '../src/codec.js';

const E = o => ({ offset: 0, bits: 8, signed: false, lsbFirst: true, float: false, colMajor: false,
  rows: 1, cols: 1, majorStride: 0, minorStride: 0, ...o });

test('16-bit little- and big-endian, signed and unsigned', () => {
  const img = Uint8Array.from([0x12, 0x34, 0xff, 0xfe]);
  assert.equal(readRaw(img, E({ bits: 16 }), 0, 0), 0x3412);
  assert.equal(readRaw(img, E({ bits: 16, lsbFirst: false }), 0, 0), 0x1234);
  assert.equal(readRaw(img, E({ bits: 16, offset: 2, signed: true }), 0, 0), -257);
  assert.equal(readRaw(img, E({ bits: 16, offset: 2, signed: true, lsbFirst: false }), 0, 0), -2);
});

test('32-bit integers and floats', () => {
  const img = new Uint8Array(8);
  const dv = new DataView(img.buffer);
  dv.setUint32(0, 0xdeadbeef, false);
  dv.setFloat32(4, 1.5, true);
  assert.equal(readRaw(img, E({ bits: 32, lsbFirst: false }), 0, 0), 0xdeadbeef);
  assert.equal(readRaw(img, E({ bits: 32, offset: 4, float: true }), 0, 0), 1.5);
});

test('row-major, column-major and strided cell offsets', () => {
  assert.equal(cellOffset(E({ offset: 100, bits: 16, rows: 3, cols: 4 }), 2, 1), 100 + (2 * 4 + 1) * 2);
  assert.equal(cellOffset(E({ offset: 100, bits: 16, rows: 3, cols: 4, colMajor: true }), 2, 1), 100 + (1 * 3 + 2) * 2);
  assert.equal(cellOffset(E({ bits: 8, rows: 2, cols: 3, minorStride: 16 }), 1, 2), 10);
  assert.equal(cellOffset(E({ bits: 8, rows: 2, cols: 3, majorStride: 64 }), 1, 2), 10);
  assert.deepEqual(elemSpan(E({ offset: 10, bits: 16, rows: 2, cols: 3 })), [10, 22]);
});

test('raw ranges', () => {
  assert.deepEqual(rawRange(E({ bits: 8 })), [0, 255]);
  assert.deepEqual(rawRange(E({ bits: 16, signed: true })), [-32768, 32767]);
  assert.deepEqual(rawRange(E({ bits: 32 })), [0, 4294967295]);
  assert.deepEqual(rawRange(E({ bits: 32, float: true })), [-FLT_MAX, FLT_MAX]);
});

test('encodeRaw is the inverse of readRaw', () => {
  const elems = [E({ bits: 8, signed: true }), E({ bits: 16 }), E({ bits: 16, lsbFirst: false, signed: true }),
    E({ bits: 32, lsbFirst: false }), E({ bits: 32, signed: true }), E({ bits: 32, float: true })];
  for (const e of elems) {
    const [lo, hi] = rawRange(e);
    const values = e.float ? [-2.5, 0, 1024.25] : e.signed ? [lo, -1, 0, 1, hi] : [lo, 1, hi];
    for (const v of values) assert.equal(readRaw(encodeRaw(e, v), e, 0, 0), v, `${JSON.stringify(e)} ${v}`);
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/codec.test.js`
Expected: FAIL — `Cannot find module .../src/codec.js`.

- [ ] **Step 3: Implement `src/codec.js`**

```js
// Byte-level access to XDF elements: cell offsets, raw value ranges, and
// reading/encoding raw values with the element's own size, sign and order.

export const FLT_MAX = 3.4028234663852886e38;

export function cellOffset(e, r, c) {
  const size = e.bits >> 3;
  const minor = e.minorStride ? e.minorStride >> 3 : size;
  const major = e.majorStride ? e.majorStride >> 3 : minor * (e.colMajor ? e.rows : e.cols);
  return e.colMajor ? e.offset + c * major + r * minor : e.offset + r * major + c * minor;
}

export function elemSpan(e) {
  return [cellOffset(e, 0, 0), cellOffset(e, e.rows - 1, e.cols - 1) + (e.bits >> 3)];
}

export function rawRange(e) {
  if (e.float) return [-FLT_MAX, FLT_MAX];
  return e.signed ? [-(2 ** (e.bits - 1)), 2 ** (e.bits - 1) - 1] : [0, 2 ** e.bits - 1];
}

export function readRaw(img, e, r, c) {
  const o = cellOffset(e, r, c);
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const le = e.lsbFirst;
  if (e.float) return dv.getFloat32(o, le);
  if (e.bits === 8) return e.signed ? dv.getInt8(o) : dv.getUint8(o);
  if (e.bits === 16) return e.signed ? dv.getInt16(o, le) : dv.getUint16(o, le);
  return e.signed ? dv.getInt32(o, le) : dv.getUint32(o, le);
}

export function encodeRaw(e, raw) {
  const out = new Uint8Array(e.bits >> 3);
  const dv = new DataView(out.buffer);
  const le = e.lsbFirst;
  if (e.float) dv.setFloat32(0, raw, le);
  else if (e.bits === 8) dv.setUint8(0, raw & 0xff);
  else if (e.bits === 16) dv.setUint16(0, raw & 0xffff, le);
  else dv.setUint32(0, raw >>> 0, le);
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/codec.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add src/codec.js tests/codec.test.js
git status --short
git commit -m "Add byte codec for XDF elements" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 4: XDF model

**Files:**
- Create: `src/xdf.js`
- Test: `tests/xdf.test.js`

**Interfaces:**
- Consumes: `parseXml, child, childrenOf, textOf` (Task 1); `converter, MathError` (Task 2); `rawRange, elemSpan` (Task 3).
- Produces: `parseXdf(text) → Model`, `checkBounds(model, binLength) → {sizeMismatch: boolean, disabled: number}` (sets `item.disabled` / `item.disabledReason` on every item), `itemSpans(item) → [start, end][]` (z first, then embedded axes).
  - `Model = {title, description, baseOffset, subtract, regionSize, categories: [{id, name}], items: Item[], report: {tables, constants, readOnly, skipped: [{title, reason}], ignored: {[tag]: count}}}`
  - `Item = {key: 't0'|'c1'…, uid, kind: 'table'|'constant', title, desc, categoryIds: number[], z: Elem, x: Axis|null, y: Axis|null, readOnly, reason, disabled, disabledReason}`
  - `Elem` = Task 3 shape plus `{conv, equation, units, decimals}` (`conv` from `converter`).
  - `Axis = {kind: 'embedded', count, units, elem: Elem} | {kind: 'labels', count, units, labels: string[]} | {kind: 'index', count, units}`. Constants have `x = y = null`.

- [ ] **Step 1: Write the failing test `tests/xdf.test.js`**

```js
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/xdf.test.js`
Expected: FAIL — `Cannot find module .../src/xdf.js`.

- [ ] **Step 3: Implement `src/xdf.js`**

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/xdf.test.js`
Expected: PASS, 9 tests. The round-trip test may take a few seconds.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add src/xdf.js tests/xdf.test.js
git status --short
git commit -m "Parse XDF files into the editor model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 5: Item decode and write planning

**Files:**
- Create: `tests/fixtures/make_fixtures.py`
- Create: `src/table.js`
- Test: `tests/table.test.js`

**Interfaces:**
- Consumes: `readRaw, encodeRaw, cellOffset, rawRange` (Task 3); `Item`, `Axis` (Task 4).
- Produces:
  - `axisValues(axis, img) → (number|string)[]` (labels → strings, index → 0..n-1, embedded → physical numbers; `null` axis → `[]`).
  - `readItem(item, img) → View` where `View = {rows, cols, raw: number[][], phys: number[][], xs, ys}`.
  - `planWrites(item, img, cells: [{r, c, value}], {raw = false} = {}) → {patches: [{off, before, after}], clamped: [{r, c, value, stored}]}`. Patches are per byte, sorted by offset, only bytes that change. Throws for read-only or disabled items. In raw mode values are rounded (unless float) and clamped to `rawRange`.
  - `defaultStep(item, raw = false) → number` (raw: 1; float: `10^-decimals`; else `conv.step`).
  - `formatValue(v, decimals) → string`, `formatAxis(axis, v) → string`.

- [ ] **Step 1: Create `tests/fixtures/make_fixtures.py`**

```python
"""Independent decode of two EMS2K tables straight from the XDF text and the
BIN bytes (regex + struct + eval of the equation; no code shared with the JS
engine). The test runs this into a temp folder: decoded ECU data is never
committed to the repository.

Usage: python3 tests/fixtures/make_fixtures.py OUT.json
"""
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('ARTIFACT_TUNER_DATA') or os.path.abspath(os.path.join(HERE, '..', '..', '..'))
XDF = os.path.join(ROOT, 'Mini', 'EMS2K_111441901203EHC3.xdf')
BIN = os.path.join(ROOT, 'Mini', 'TB62572_EMS2K_111441901203EHC3_fullread_EKII.bin')
TABLES = [0x75EF2, 0x7C69A]


def attr(block, name, default=None):
    m = re.search(name + r'="([^"]+)"', block)
    return m.group(1) if m else default


def element(block):
    ed = re.search(r'<EMBEDDEDDATA[^>]*/>', block).group(0)
    flags = int(attr(ed, 'mmedtypeflags', '0'), 16)
    bits = int(attr(ed, 'mmedelementsizebits', '8'))
    code = {8: 'B', 16: 'H', 32: 'I'}[bits]
    if flags & 1:
        code = code.lower()
    fmt = ('<' if flags & 2 else '>') + code
    eq = re.search(r'equation="([^"]+)"', block).group(1)
    return int(attr(ed, 'mmedaddress'), 16), bits // 8, fmt, eq


def decode(img, addr, size, fmt, eq, n):
    return [eval(eq, {}, {'X': struct.unpack_from(fmt, img, addr + i * size)[0]}) for i in range(n)]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    xdf = open(XDF, encoding='utf-8').read()
    img = open(BIN, 'rb').read()
    out = {}
    for t in re.findall(r'<XDFTABLE.*?</XDFTABLE>', xdf, re.S):
        axes = {m.group(1): m.group(0) for m in re.finditer(r'<XDFAXIS id="(\w)".*?</XDFAXIS>', t, re.S)}
        za, zs, zf, zeq = element(axes['z'])
        if za not in TABLES:
            continue
        rows = int(attr(axes['z'], 'mmedrowcount'))
        cols = int(attr(axes['z'], 'mmedcolcount'))
        flat = decode(img, za, zs, zf, zeq, rows * cols)
        xa, xs, xf, xeq = element(axes['x'])
        ya, ys, yf, yeq = element(axes['y'])
        out[hex(za)] = {
            'title': re.search(r'<title>(.*?)</title>', t).group(1),
            'x': decode(img, xa, xs, xf, xeq, cols),
            'y': decode(img, ya, ys, yf, yeq, rows),
            'z': [flat[r * cols:(r + 1) * cols] for r in range(rows)],
        }
    assert sorted(out) == sorted(hex(a) for a in TABLES), list(out)
    with open(sys.argv[1], 'w') as f:
        json.dump(out, f, indent=1)
    print('wrote', len(out), 'tables')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Run the script once by hand**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && python3 tests/fixtures/make_fixtures.py "$(mktemp -d)/ems2k_tables.json"`
Expected: `wrote 2 tables`. Nothing is written inside the repository.

- [ ] **Step 3: Write the failing test `tests/table.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseXdf } from '../src/xdf.js';
import { readItem, planWrites, defaultStep, formatValue, formatAxis, axisValues } from '../src/table.js';
import { P, APP, ROOT, readText, readBin, tmpFile } from './helpers.js';

const ems = parseXdf(readText(P.ems2kXdf));
const ekii = readBin(P.ekii);
const fxPath = tmpFile('ems2k_tables.json', '');
execFileSync('python3', [path.join(APP, 'tests', 'fixtures', 'make_fixtures.py'), fxPath],
  { env: { ...process.env, ARTIFACT_TUNER_DATA: ROOT } });
const fx = JSON.parse(readText(fxPath));
const itemAt = off => ems.items.find(i => i.z.offset === off);

test('decoded tables match the independent Python read', () => {
  for (const off of [0x75ef2, 0x7c69a]) {
    const want = fx['0x' + off.toString(16)];
    const got = readItem(itemAt(off), ekii);
    assert.equal(itemAt(off).title, want.title);
    assert.deepEqual(got.phys, want.z);
    assert.deepEqual(got.xs, want.x);
    assert.deepEqual(got.ys, want.y);
    assert.equal(got.raw.length, got.rows);
  }
});

test('physical write rounds to the raw step and reports clamping', () => {
  const ign = itemAt(0x75ef2);
  const img = ekii.slice();
  const { patches, clamped } = planWrites(ign, img, [{ r: 0, c: 0, value: 20 }, { r: 0, c: 1, value: 1000 }]);
  const expect = [[0x75ef2, 116], [0x75ef3, 255]].filter(([o, v]) => img[o] !== v);
  assert.deepEqual(patches.map(p => [p.off, p.after]), expect);
  for (const p of patches) assert.equal(p.before, ekii[p.off]);
  assert.deepEqual(clamped, [{ r: 0, c: 1, value: 1000, stored: 72 }]);
});

test('16-bit little-endian write puts the low byte first', () => {
  const ve = itemAt(0x7c69a);
  const { patches } = planWrites(ve, new Uint8Array(ekii.length), [{ r: 1, c: 2, value: 0.75 }]);   // raw 0x6000
  const off = 0x7c69a + (1 * 12 + 2) * 2;
  assert.deepEqual(patches, [{ off: off + 1, before: 0, after: 0x60 }]);
});

test('raw mode writes raw values and clamps to the type range', () => {
  const ign = itemAt(0x75ef2);
  const { patches, clamped } = planWrites(ign, new Uint8Array(ekii.length), [{ r: 0, c: 0, value: 300 }], { raw: true });
  assert.deepEqual(patches, [{ off: 0x75ef2, before: 0, after: 255 }]);
  assert.deepEqual(clamped, [{ r: 0, c: 0, value: 300, stored: 255 }]);
});

test('writing the current value produces no patches', () => {
  const ign = itemAt(0x75ef2);
  const v = readItem(ign, ekii).phys[3][4];
  assert.deepEqual(planWrites(ign, ekii, [{ r: 3, c: 4, value: v }]).patches, []);
});

test('read-only and disabled items refuse writes', () => {
  const ign = itemAt(0x75ef2);
  assert.throws(() => planWrites({ ...ign, readOnly: true, reason: 'x' }, ekii, []), /read-only/);
  assert.throws(() => planWrites({ ...ign, disabled: true, disabledReason: 'y' }, ekii, []), /disabled/);
});

test('steps, axes and formatting', () => {
  const ign = itemAt(0x75ef2);
  assert.equal(defaultStep(ign), 0.375);
  assert.equal(defaultStep(ign, true), 1);
  assert.deepEqual(axisValues({ kind: 'index', count: 3 }, ekii), [0, 1, 2]);
  assert.deepEqual(axisValues(null, ekii), []);
  assert.equal(formatValue(1.5, 2), '1.50');
  assert.equal(formatAxis({ kind: 'labels' }, 'lo'), 'lo');
  assert.equal(formatAxis({ kind: 'index' }, 4), '4');
  assert.equal(formatAxis(ign.y, 3200), '3200');
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/table.test.js`
Expected: FAIL — `Cannot find module .../src/table.js`.

- [ ] **Step 5: Implement `src/table.js`**

```js
// Item-level reading and writing: decode a whole table with its axes, and
// turn physical (or raw) cell values into byte patches.
import { readRaw, encodeRaw, cellOffset, rawRange } from './codec.js';

export function axisValues(axis, img) {
  if (!axis) return [];
  if (axis.kind === 'labels') return axis.labels.slice();
  if (axis.kind === 'index') return Array.from({ length: axis.count }, (_, i) => i);
  return Array.from({ length: axis.count }, (_, i) => axis.elem.conv.f(readRaw(img, axis.elem, 0, i)));
}

export function readItem(item, img) {
  const z = item.z;
  const raw = [], phys = [];
  for (let r = 0; r < z.rows; r++) {
    const rr = [], pr = [];
    for (let c = 0; c < z.cols; c++) {
      const v = readRaw(img, z, r, c);
      rr.push(v);
      pr.push(z.conv.f(v));
    }
    raw.push(rr);
    phys.push(pr);
  }
  return { rows: z.rows, cols: z.cols, raw, phys, xs: axisValues(item.x, img), ys: axisValues(item.y, img) };
}

function rawResult(z, lo, hi, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`"${value}" is not a number`);
  const v = z.float ? value : Math.round(value);
  const k = Math.min(hi, Math.max(lo, v));
  return { raw: k === 0 ? 0 : k, clamped: k !== v };
}

export function planWrites(item, img, cells, { raw = false } = {}) {
  if (item.readOnly) throw new Error(`${item.title} is read-only: ${item.reason}`);
  if (item.disabled) throw new Error(`${item.title} is disabled: ${item.disabledReason}`);
  const z = item.z;
  const [lo, hi] = rawRange(z);
  const bytes = new Map();                  // offset -> new byte; a later write to the same cell wins
  const clamped = [];
  for (const { r, c, value } of cells) {
    const res = raw ? rawResult(z, lo, hi, value) : z.conv.toRaw(value);
    if (res.clamped) clamped.push({ r, c, value, stored: raw ? res.raw : z.conv.f(res.raw) });
    const off = cellOffset(z, r, c);
    encodeRaw(z, res.raw).forEach((b, k) => bytes.set(off + k, b));
  }
  const patches = [];
  for (const [off, after] of [...bytes].sort((p, q) => p[0] - q[0])) {
    if (img[off] !== after) patches.push({ off, before: img[off], after });
  }
  return { patches, clamped };
}

export function defaultStep(item, raw = false) {
  if (raw) return 1;
  if (item.z.float) return 10 ** -item.z.decimals;
  return item.z.conv.step;
}

export function formatValue(v, decimals) {
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return String(v);
  return v.toFixed(decimals);
}

export function formatAxis(axis, v) {
  if (!axis || axis.kind !== 'embedded') return String(v);
  return formatValue(v, axis.elem.decimals);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/table.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 7: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add tests/fixtures/make_fixtures.py src/table.js tests/table.test.js
git status --short
git commit -m "Decode items and plan cell writes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 6: BIN image and undo/redo

**Files:**
- Create: `src/image.js`
- Test: `tests/image.test.js`

**Interfaces:**
- Produces: `class BinImage` with `constructor(bytes: Uint8Array, name: string)` and fields `name`, `original` (copy, never written), `working` (copy, edited), `reference` (= `original` unless a compare BIN is set), `referenceName` (`''` when comparing to the original), `undoStack: [{label, patches}]`, `redoStack`, `changed: Set<offset>` (offsets where `working !== original`), `unsaved: boolean`.
  Methods: `apply(label, patches) → boolean` (false and no history entry when `patches` is empty), `undo() → group|null`, `redo() → group|null`, `editedOffsets() → number[]` (sorted), `setReference(bytes, name)` (throws on a size mismatch), `clearReference()`, `differsInRange(start, endExclusive) → boolean` (working vs reference), `markSaved()`.
  A patch is `{off, before, after}` as produced by `planWrites` (Task 5).

- [ ] **Step 1: Write the failing test `tests/image.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BinImage } from '../src/image.js';

test('apply, undo and redo', () => {
  const im = new BinImage(Uint8Array.from([1, 2, 3, 4]), 'a.bin');
  assert.equal(im.apply('none', []), false);
  assert.equal(im.undoStack.length, 0);
  assert.equal(im.apply('set', [{ off: 1, before: 2, after: 9 }, { off: 3, before: 4, after: 8 }]), true);
  assert.deepEqual([...im.working], [1, 9, 3, 8]);
  assert.deepEqual(im.editedOffsets(), [1, 3]);
  assert.equal(im.undo().label, 'set');
  assert.deepEqual([...im.working], [1, 2, 3, 4]);
  assert.deepEqual(im.editedOffsets(), []);
  assert.equal(im.redo().label, 'set');
  assert.deepEqual([...im.working], [1, 9, 3, 8]);
  assert.equal(im.redo(), null);
  assert.equal(new BinImage(new Uint8Array(1), 'b').undo(), null);
});

test('a new edit clears redo', () => {
  const im = new BinImage(new Uint8Array(4), 'a');
  im.apply('a', [{ off: 0, before: 0, after: 1 }]);
  im.undo();
  im.apply('b', [{ off: 1, before: 0, after: 1 }]);
  assert.equal(im.redo(), null);
  assert.deepEqual(im.undoStack.map(g => g.label), ['b']);
});

test('editing a byte back to its original value is not an edit', () => {
  const im = new BinImage(Uint8Array.from([5]), 'a');
  im.apply('up', [{ off: 0, before: 5, after: 6 }]);
  im.apply('back', [{ off: 0, before: 6, after: 5 }]);
  assert.deepEqual(im.editedOffsets(), []);
});

test('the original is a private copy and never changes', () => {
  const src = Uint8Array.from([1, 2]);
  const im = new BinImage(src, 'a');
  src[0] = 99;
  im.apply('x', [{ off: 1, before: 2, after: 7 }]);
  assert.deepEqual([...im.original], [1, 2]);
  assert.deepEqual([...im.working], [1, 7]);
});

test('reference compare and size check', () => {
  const im = new BinImage(Uint8Array.from([1, 2, 3]), 'a');
  assert.equal(im.differsInRange(0, 3), false);
  im.setReference(Uint8Array.from([1, 0, 3]), 'stock.bin');
  assert.equal(im.referenceName, 'stock.bin');
  assert.equal(im.differsInRange(0, 1), false);
  assert.equal(im.differsInRange(1, 2), true);
  assert.throws(() => im.setReference(new Uint8Array(2), 'x'), /2 bytes but the loaded BIN is 3 bytes/);
  im.clearReference();
  assert.equal(im.referenceName, '');
  assert.equal(im.differsInRange(0, 3), false);
});

test('unsaved tracking', () => {
  const im = new BinImage(new Uint8Array(2), 'a');
  assert.equal(im.unsaved, false);
  im.apply('x', [{ off: 0, before: 0, after: 1 }]);
  assert.equal(im.unsaved, true);
  im.markSaved();
  assert.equal(im.unsaved, false);
  im.undo();
  assert.equal(im.unsaved, true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/image.test.js`
Expected: FAIL — `Cannot find module .../src/image.js`.

- [ ] **Step 3: Implement `src/image.js`**

```js
// The loaded BIN: an untouched original, the working copy being edited, the
// reference used for compare highlighting, and undo/redo as byte patches.

export class BinImage {
  constructor(bytes, name) {
    this.name = name;
    this.original = Uint8Array.from(bytes);
    this.working = Uint8Array.from(bytes);
    this.reference = this.original;
    this.referenceName = '';
    this.undoStack = [];
    this.redoStack = [];
    this.changed = new Set();
    this.unsaved = false;
  }

  apply(label, patches) {
    if (!patches.length) return false;
    this.#write(patches, 'after');
    this.undoStack.push({ label, patches });
    this.redoStack.length = 0;
    return true;
  }

  undo() {
    const group = this.undoStack.pop();
    if (!group) return null;
    this.#write(group.patches, 'before');
    this.redoStack.push(group);
    return group;
  }

  redo() {
    const group = this.redoStack.pop();
    if (!group) return null;
    this.#write(group.patches, 'after');
    this.undoStack.push(group);
    return group;
  }

  #write(patches, side) {
    for (const p of patches) {
      this.working[p.off] = p[side];
      if (this.working[p.off] === this.original[p.off]) this.changed.delete(p.off);
      else this.changed.add(p.off);
    }
    this.unsaved = true;
  }

  editedOffsets() {
    return [...this.changed].sort((a, b) => a - b);
  }

  setReference(bytes, name) {
    if (bytes.length !== this.original.length) {
      throw new Error(`The compare file is ${bytes.length} bytes but the loaded BIN is ${this.original.length} bytes`);
    }
    this.reference = Uint8Array.from(bytes);
    this.referenceName = name;
  }

  clearReference() {
    this.reference = this.original;
    this.referenceName = '';
  }

  differsInRange(start, end) {
    for (let i = start; i < end; i++) if (this.working[i] !== this.reference[i]) return true;
    return false;
  }

  markSaved() {
    this.unsaved = false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/image.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add src/image.js tests/image.test.js
git status --short
git commit -m "Add BIN image with undo/redo and compare reference" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 7: Grid edit operations

**Files:**
- Create: `src/ops.js`
- Test: `tests/ops.test.js`

**Interfaces:**
- Produces: a **Sel** shape `{r0, c0, r1, c1}` (anchor = r0/c0, focus = r1/c1; not necessarily ordered). Every `op*` returns `[{r, c, value}]` for `planWrites` (Task 5), in row-major order over the normalised selection, and never touches bytes.
  `normSel(sel) → Sel` (ordered), `opSet(grid, sel, v)`, `opAdd(grid, sel, d)`, `opScale(grid, sel, pct)` (× (1 + pct/100)), `opRevert(refGrid, sel)`, `opInterpolate(grid, sel, mode: 'h'|'v'|'bilinear', xs = null, ys = null)` (uses axis values when they are finite numbers and strictly monotonic, else positions), `opSmooth(grid, sel)` (3×3 mean with neighbours limited to the selection), `toTsv(grid, sel, fmt) → string`, `parseTsv(text) → number[][]` (accepts `2,5` as 2.5; throws `"x" is not a number` / `Nothing to paste`), `opPaste(grid, sel, block)` (from the selection's top-left, clipped to the grid; a 1×1 block fills the whole selection).

- [ ] **Step 1: Write the failing test `tests/ops.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normSel, opSet, opAdd, opScale, opRevert, opInterpolate, opSmooth, toTsv, parseTsv, opPaste } from '../src/ops.js';

const G = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
const val = cells => cells.map(c => c.value);

test('set, add, scale and revert cover the normalised selection', () => {
  const sel = { r0: 1, c0: 2, r1: 0, c1: 1 };                     // dragged up and to the left
  assert.deepEqual(normSel(sel), { r0: 0, c0: 1, r1: 1, c1: 2 });
  assert.deepEqual(opSet(G, sel, 0).map(c => [c.r, c.c]), [[0, 1], [0, 2], [1, 1], [1, 2]]);
  assert.deepEqual(val(opAdd(G, sel, 1)), [3, 4, 6, 7]);
  assert.deepEqual(val(opScale(G, sel, 50)), [3, 4.5, 7.5, 9]);
  assert.deepEqual(val(opRevert([[0, 0, 0], [0, 0, 0], [0, 0, 0]], sel)), [0, 0, 0, 0]);
});

test('horizontal interpolation by position and by axis value', () => {
  const g = [[0, 99, 10], [0, 0, 0]];
  const row = { r0: 0, c0: 0, r1: 0, c1: 2 };
  assert.deepEqual(val(opInterpolate(g, row, 'h')), [0, 5, 10]);
  assert.deepEqual(val(opInterpolate(g, row, 'h', [1000, 1500, 3000])), [0, 2.5, 10]);
  assert.deepEqual(val(opInterpolate(g, row, 'h', ['a', 'b', 'c'])), [0, 5, 10]);
  assert.deepEqual(val(opInterpolate(g, row, 'h', [1, 1, 2])), [0, 5, 10]);   // not strictly monotonic
});

test('vertical and bilinear interpolation', () => {
  const g = [[0, 0, 10], [0, 0, 0], [20, 0, 30]];
  assert.deepEqual(val(opInterpolate(g, { r0: 0, c0: 0, r1: 2, c1: 0 }, 'v')), [0, 10, 20]);
  assert.deepEqual(val(opInterpolate(g, { r0: 0, c0: 0, r1: 2, c1: 2 }, 'bilinear')), [0, 5, 10, 10, 15, 20, 20, 25, 30]);
  assert.deepEqual(val(opInterpolate(g, { r0: 0, c0: 0, r1: 0, c1: 2 }, 'bilinear')), [0, 5, 10]);  // one row falls back to 'h'
});

test('smooth averages within the selection only', () => {
  assert.deepEqual(val(opSmooth(G, { r0: 0, c0: 0, r1: 1, c1: 1 })), [3, 3, 3, 3]);
  const all = opSmooth(G, { r0: 0, c0: 0, r1: 2, c1: 2 });
  assert.equal(all[4].value, 5);
  assert.equal(all[0].value, 3);
});

test('TSV copy and parse', () => {
  assert.equal(toTsv(G, { r0: 0, c0: 1, r1: 1, c1: 2 }, v => v.toFixed(1)), '2.0\t3.0\n5.0\t6.0');
  assert.deepEqual(parseTsv('1\t2,5\r\n-3\t4e1\n'), [[1, 2.5], [-3, 40]]);
  assert.throws(() => parseTsv('1\tx'), /"x" is not a number/);
  assert.throws(() => parseTsv('  \n'), /Nothing to paste/);
});

test('paste is clipped to the table; a single value fills the selection', () => {
  const p = opPaste(G, { r0: 2, c0: 1, r1: 2, c1: 1 }, [[10, 11, 12], [13, 14, 15]]);
  assert.deepEqual(p, [{ r: 2, c: 1, value: 10 }, { r: 2, c: 2, value: 11 }]);
  assert.deepEqual(val(opPaste(G, { r0: 0, c0: 0, r1: 1, c1: 0 }, [[7]])), [7, 7]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/ops.test.js`
Expected: FAIL — `Cannot find module .../src/ops.js`.

- [ ] **Step 3: Implement `src/ops.js`**

```js
// Edit operations on a decoded grid of values. Each returns the cells to
// write as [{r, c, value}]; nothing here touches bytes.

export function normSel(s) {
  return { r0: Math.min(s.r0, s.r1), c0: Math.min(s.c0, s.c1), r1: Math.max(s.r0, s.r1), c1: Math.max(s.c0, s.c1) };
}

function each(sel, fn) {
  const s = normSel(sel), out = [];
  for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) out.push({ r, c, value: fn(r, c, s) });
  return out;
}

export const opSet = (grid, sel, v) => each(sel, () => v);
export const opAdd = (grid, sel, d) => each(sel, (r, c) => grid[r][c] + d);
export const opScale = (grid, sel, pct) => each(sel, (r, c) => grid[r][c] * (1 + pct / 100));
export const opRevert = (refGrid, sel) => each(sel, (r, c) => refGrid[r][c]);

function strictlyMonotonic(a) {
  if (a.length < 2) return true;
  const d = Math.sign(a[1] - a[0]);
  if (!d) return false;
  for (let i = 1; i < a.length; i++) if (Math.sign(a[i] - a[i - 1]) !== d) return false;
  return true;
}

const usable = axis => Array.isArray(axis) && axis.every(v => typeof v === 'number' && Number.isFinite(v)) && strictlyMonotonic(axis);

function fraction(pos, i, i0, i1) {
  if (i1 === i0) return 0;
  return pos ? (pos[i] - pos[i0]) / (pos[i1] - pos[i0]) : (i - i0) / (i1 - i0);
}

const lerp = (a, b, t) => a + (b - a) * t;

export function opInterpolate(grid, sel, mode, xs = null, ys = null) {
  const px = usable(xs) ? xs : null, py = usable(ys) ? ys : null;
  const s = normSel(sel);
  let m = mode;
  if (m === 'bilinear' && (s.r0 === s.r1 || s.c0 === s.c1)) m = s.r0 === s.r1 ? 'h' : 'v';
  return each(s, (r, c) => {
    const tx = fraction(px, c, s.c0, s.c1), ty = fraction(py, r, s.r0, s.r1);
    if (m === 'h') return lerp(grid[r][s.c0], grid[r][s.c1], tx);
    if (m === 'v') return lerp(grid[s.r0][c], grid[s.r1][c], ty);
    return lerp(lerp(grid[s.r0][s.c0], grid[s.r0][s.c1], tx), lerp(grid[s.r1][s.c0], grid[s.r1][s.c1], tx), ty);
  });
}

export function opSmooth(grid, sel) {
  return each(sel, (r, c, s) => {
    let sum = 0, n = 0;
    for (let rr = Math.max(s.r0, r - 1); rr <= Math.min(s.r1, r + 1); rr++) {
      for (let cc = Math.max(s.c0, c - 1); cc <= Math.min(s.c1, c + 1); cc++) {
        sum += grid[rr][cc];
        n++;
      }
    }
    return sum / n;
  });
}

export function toTsv(grid, sel, fmt = v => String(v)) {
  const s = normSel(sel), lines = [];
  for (let r = s.r0; r <= s.r1; r++) {
    const row = [];
    for (let c = s.c0; c <= s.c1; c++) row.push(fmt(grid[r][c]));
    lines.push(row.join('\t'));
  }
  return lines.join('\n');
}

export function parseTsv(text) {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!body.trim()) throw new Error('Nothing to paste');
  return body.split('\n').map(line => line.split('\t').map(cell => {
    let t = cell.trim();
    if (/^[-+]?\d+,\d+$/.test(t)) t = t.replace(',', '.');
    const v = Number(t);
    if (t === '' || !Number.isFinite(v)) throw new Error(`"${cell}" is not a number`);
    return v;
  }));
}

export function opPaste(grid, sel, block) {
  const s = normSel(sel);
  if (block.length === 1 && block[0].length === 1) return each(s, () => block[0][0]);
  const rows = grid.length, cols = grid[0].length, out = [];
  block.forEach((line, i) => line.forEach((value, j) => {
    const r = s.r0 + i, c = s.c0 + j;
    if (r < rows && c < cols) out.push({ r, c, value });
  }));
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/ops.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add src/ops.js tests/ops.test.js
git status --short
git commit -m "Add grid edit operations and TSV copy/paste" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 8: EMS2K checksum plugin

**Files:**
- Modify: `tests/helpers.js` (add `pyVerify`)
- Create: `src/checksums/ems2k.js`
- Create: `src/checksums/index.js`
- Test: `tests/checksums.test.js`

**Interfaces:**
- Produces a **plugin** shape: `{id, name, fixable: string[], detect(img) → {ok, reason}, verify(img) → {[region]: {calc, stored, ok}}, coverage(img) → {[region]: [start, endInclusive][]}, storedAt(img, region) → [off, off+1], fix(img, region)}`. `fix` throws for a region not in `fixable`. For EMS2K the regions are `boot`, `prog`, `cal`, and `fixable = ['cal']`.
- `pickPlugin(img) → {plugin: Plugin|null, reasons: [{name, reason}]}`; `PLUGINS`.
- Exports from `ems2k.js`: `ems2k`, `arcTable()`, `crc16(img, seed, ranges)`, `regions(img)`.
- Test helper: `pyVerify(file) → {boot, prog, cal: {calc, stored, ok}}` from `python3 Mini/mapswitch/checksum.py verify`.

- [ ] **Step 1: Add `pyVerify` to `tests/helpers.js`**

Add this import below the existing imports:

```js
import { execFileSync } from 'node:child_process';
```

Append at the end of the file:

```js
// Runs Mini/mapswitch/checksum.py verify FILE and returns {boot, prog, cal: {calc, stored, ok}}.
export function pyVerify(file) {
  let out;
  try {
    out = execFileSync('python3', [P.checksumPy, 'verify', file], { encoding: 'utf8' });
  } catch (err) {
    out = err.stdout ?? '';                 // exit status 1 means a mismatch, not a failure to run
  }
  const res = {};
  for (const m of out.matchAll(/: (\w+)\s+calc ([0-9A-F]{4}) stored ([0-9A-F]{4})/g)) {
    res[m[1]] = { calc: parseInt(m[2], 16), stored: parseInt(m[3], 16), ok: m[2] === m[3] };
  }
  return res;
}
```

- [ ] **Step 2: Write the failing test `tests/checksums.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ems2k } from '../src/checksums/ems2k.js';
import { pickPlugin } from '../src/checksums/index.js';
import { P, readBin, tmpFile, pyVerify } from './helpers.js';

test('verify matches checksum.py on all three EMS2K reads', () => {
  for (const f of [P.ekii, P.nonews, P.mapswitch]) assert.deepEqual(ems2k.verify(readBin(f)), pyVerify(f), f);
  assert.deepEqual(ems2k.verify(readBin(P.nonews)).prog, { calc: 0x0263, stored: 0x5233, ok: false });
  assert.deepEqual(ems2k.verify(readBin(P.ekii)).cal, { calc: 0xfb17, stored: 0xfb17, ok: true });
});

test('detect accepts the EMS2K reads and explains rejections', () => {
  for (const f of [P.ekii, P.nonews, P.mapswitch]) assert.deepEqual(ems2k.detect(readBin(f)), { ok: true, reason: '' });
  assert.match(ems2k.detect(readBin(P.msv70Bin)).reason, /not a 512 KB/);
  const badCal = readBin(P.ekii);
  badCal[0x75ef2] ^= 1;
  assert.match(ems2k.detect(badCal).reason, /does not match/);
  const noTable = readBin(P.ekii);
  noTable[0x11234] ^= 1;
  assert.match(ems2k.detect(noTable).reason, /no CRC-16\/ARC table/);
  const badHeader = readBin(P.ekii);
  badHeader[0x77fe2] = 0;                                         // zero cal ranges
  assert.match(ems2k.detect(badHeader).reason, /calibration checksum header/);
});

test('pickPlugin', () => {
  assert.equal(pickPlugin(readBin(P.ekii)).plugin, ems2k);
  const none = pickPlugin(readBin(P.msv70Bin));
  assert.equal(none.plugin, null);
  assert.equal(none.reasons.length, 1);
  assert.match(none.reasons[0].reason, /not a 512 KB/);
});

test('fix(cal) after an edit satisfies checksum.py', () => {
  const img = readBin(P.ekii);
  img[0x75ef2] = (img[0x75ef2] + 1) & 0xff;
  ems2k.fix(img, 'cal');
  const v = pyVerify(tmpFile('fixed.bin', img));
  assert.deepEqual([v.boot.ok, v.prog.ok, v.cal.ok], [true, true, true]);
  assert.throws(() => ems2k.fix(img, 'prog'), /never corrected/);
  assert.throws(() => ems2k.fix(img, 'boot'), /never corrected/);
});

test('coverage and storedAt', () => {
  const img = readBin(P.ekii);
  const cov = ems2k.coverage(img);
  assert.deepEqual(cov.cal, [[0x70094, 0x77fdf], [0x78000, 0x7ef03]]);
  assert.deepEqual(cov.boot, [[0x0, 0x3d8f]]);
  assert.equal(cov.prog.length, 6);
  assert.deepEqual(ems2k.storedAt(img, 'cal'), [0x77fe0, 0x77fe1]);
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/checksums.test.js`
Expected: FAIL — `Cannot find module .../src/checksums/ems2k.js`.

- [ ] **Step 4: Implement `src/checksums/ems2k.js`**

```js
// Siemens EMS2000 (Mini) flash checksums: three CRC-16/ARC sums whose seeds
// and ranges are read from the image itself. Port of Mini/mapswitch/checksum.py.
// Only the calibration sum is ever corrected (design spec, section 4).

const SIZE = 0x80000;
const CRC_TABLE = 0x11232;
const CAL_LO = 0x70000, CAL_HI = 0x7ffff;

export function arcTable() {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    t[i] = c;
  }
  return t;
}

const ARC = arcTable();

function w(img, i) {
  if (i < 0 || i + 1 >= img.length) throw new RangeError(`read past the end at 0x${i.toString(16)}`);
  return img[i] | (img[i + 1] << 8);
}

// Far pointer (offset word, segment word) -> file offset.
function far(img, i) {
  const a = w(img, i + 2) * 0x10000 + w(img, i);
  return a >= 0x80000 ? a - 0x80000 : a;
}

export function crc16(img, seed, ranges) {
  let acc = seed;
  for (const [s, e] of ranges) for (let a = s; a <= e; a++) acc = (acc >>> 8) ^ ARC[(acc ^ img[a]) & 0xff];
  return acc;
}

export function regions(img) {
  const list = (base, n) => Array.from({ length: n }, (_, k) => [far(img, base + 8 * k), far(img, base + 4 + 8 * k)]);
  return {
    boot: { at: 0x3ed4, seed: w(img, 0x3fe6), ranges: [[far(img, 0x3ed8), far(img, 0x3edc)]] },
    prog: { at: 0x10010, seed: w(img, far(img, 0x10b9c)), ranges: list(0x10014, w(img, 0x10012)) },
    cal: { at: 0x77fe0, seed: w(img, far(img, 0x10bbc)), ranges: list(0x77fe4, img[0x77fe2]) },
  };
}

const inRanges = (ranges, o) => ranges.some(([s, e]) => o >= s && o <= e);

function sane(r, lo, hi, max) {
  return r.ranges.length >= 1 && r.ranges.length <= max &&
    r.ranges.every(([s, e]) => s >= lo && s <= e && e <= hi) &&
    !inRanges(r.ranges, r.at) && !inRanges(r.ranges, r.at + 1);
}

export const ems2k = {
  id: 'ems2k',
  name: 'Siemens EMS2000 (3 × CRC-16/ARC)',
  fixable: ['cal'],

  detect(img) {
    if (img.length !== SIZE) return { ok: false, reason: `not a 512 KB EMS2000 image (${img.length} bytes)` };
    for (let i = 0; i < 256; i++) {
      if (w(img, CRC_TABLE + 2 * i) !== ARC[i]) return { ok: false, reason: 'no CRC-16/ARC table at 0x11232' };
    }
    let rg;
    try {
      rg = regions(img);
    } catch {
      return { ok: false, reason: 'the checksum header points outside the file' };
    }
    if (!sane(rg.cal, CAL_LO, CAL_HI, 16)) return { ok: false, reason: 'calibration checksum header not recognised' };
    if (!sane(rg.prog, 0, SIZE - 1, 32) || !sane(rg.boot, 0, SIZE - 1, 1)) {
      return { ok: false, reason: 'program/boot checksum header not recognised' };
    }
    if (crc16(img, rg.cal.seed, rg.cal.ranges) !== w(img, rg.cal.at)) {
      return { ok: false, reason: 'the calibration checksum does not match in the loaded file' };
    }
    return { ok: true, reason: '' };
  },

  verify(img) {
    const out = {};
    for (const [name, r] of Object.entries(regions(img))) {
      const calc = crc16(img, r.seed, r.ranges), stored = w(img, r.at);
      out[name] = { calc, stored, ok: calc === stored };
    }
    return out;
  },

  coverage(img) {
    return Object.fromEntries(Object.entries(regions(img)).map(([name, r]) => [name, r.ranges]));
  },

  storedAt(img, region) {
    const at = regions(img)[region].at;
    return [at, at + 1];
  },

  fix(img, region) {
    if (!this.fixable.includes(region)) throw new Error(`The ${region} checksum is never corrected by this tool`);
    const r = regions(img)[region];
    const v = crc16(img, r.seed, r.ranges);
    img[r.at] = v & 0xff;
    img[r.at + 1] = v >> 8;
  },
};
```

- [ ] **Step 5: Implement `src/checksums/index.js`**

```js
// Checksum plugin registry. A plugin is {id, name, fixable, detect, verify,
// coverage, storedAt, fix}; see checksums/ems2k.js for the reference one.
import { ems2k } from './ems2k.js';

export const PLUGINS = [ems2k];

export function pickPlugin(img) {
  const reasons = [];
  for (const plugin of PLUGINS) {
    const d = plugin.detect(img);
    if (d.ok) return { plugin, reasons };
    reasons.push({ name: plugin.name, reason: d.reason });
  }
  return { plugin: null, reasons };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/checksums.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 7: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add tests/helpers.js src/checksums/ems2k.js src/checksums/index.js tests/checksums.test.js
git status --short
git commit -m "Add EMS2000 checksum plugin (calibration CRC only)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 9: Zip writer

**Files:**
- Create: `src/zip.js`
- Test: `tests/zip.test.js`

**Interfaces:**
- Produces: `crc32(bytes) → number` (unsigned), `zip(files: [{name: string, bytes: Uint8Array}], when = new Date()) → Uint8Array` (store-only, UTF-8 names).

- [ ] **Step 1: Write the failing test `tests/zip.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { crc32, zip } from '../src/zip.js';
import { P, readBin, tmpFile } from './helpers.js';

test('crc32 check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('python zipfile reads the archive back byte for byte', () => {
  const bin = readBin(P.ekii);
  const txt = new TextEncoder().encode('hello änd bye\n');
  const z = zip([{ name: 'a_edit.bin', bytes: bin }, { name: 'changes.txt', bytes: txt }], new Date(2026, 9, 24, 15, 30, 10));
  const zp = tmpFile('t.zip', z);
  const ref = tmpFile('ref.bin', bin);
  const py = [
    'import sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    'assert z.testzip() is None',
    "assert z.namelist() == ['a_edit.bin', 'changes.txt'], z.namelist()",
    "assert z.read('a_edit.bin') == open(sys.argv[2], 'rb').read()",
    "assert z.read('changes.txt').decode() == 'hello \\u00e4nd bye\\n'",
    "assert z.getinfo('a_edit.bin').date_time == (2026, 10, 24, 15, 30, 10), z.getinfo('a_edit.bin').date_time",
    "print('ok')",
  ].join('\n');
  assert.equal(execFileSync('python3', ['-c', py, zp, ref], { encoding: 'utf8' }).trim(), 'ok');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/zip.test.js`
Expected: FAIL — `Cannot find module .../src/zip.js`.

- [ ] **Step 3: Implement `src/zip.js`**

```js
// Store-only ZIP writer (no compression). Saving from the Artifact goes
// through the downloads capability, which accepts .zip but not .bin.

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zip(files, when = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosTime(when);
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.bytes), size = f.bytes.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);              // version needed
    lh.setUint16(6, 0x0800, true);          // UTF-8 names
    lh.setUint16(8, 0, true);               // stored
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);              // version made by
    ch.setUint16(6, 20, true);              // version needed
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);         // extra, comment, disk and attributes stay 0
    locals.push(new Uint8Array(lh.buffer), name, f.bytes);
    centrals.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = centrals.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of parts) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/zip.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add src/zip.js tests/zip.test.js
git status --short
git commit -m "Add store-only zip writer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 10: Save — checksum policy, self-check, names and change log

**Files:**
- Create: `src/save.js`
- Test: `tests/save.test.js`

**Interfaces:**
- Consumes: `BinImage` (Task 6), `Model`/`itemSpans` (Task 4), `readItem` (Task 5), plugin + `pickPlugin` (Task 8).
- Produces:
  - `class SaveError extends Error`.
  - `planChecksums(image, pick) → {plugin, fixed: string[], notFixed: string[], edited: number[]}` — which regions the current edits touch, split into correctable and not. Empty lists when there is no plugin or no edit.
  - `prepareSave(image, model, pick, when = new Date()) → SaveResult` where `SaveResult = {out: Uint8Array, plugin, fixed, notFixed, notCorrected: boolean, before, after, binName, zipName, changeLog: string}`. `before`/`after` are `plugin.verify` results (null without a plugin). Throws `SaveError` when a corrected region does not verify, or when any byte other than the edits and the corrected CRC bytes differs from the original.
  - `changedItems(image, model, against = image.original) → [{item, cells, lo, hi}]`.

- [ ] **Step 1: Write the failing test `tests/save.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BinImage } from '../src/image.js';
import { parseXdf } from '../src/xdf.js';
import { readItem, planWrites } from '../src/table.js';
import { pickPlugin } from '../src/checksums/index.js';
import { prepareSave, planChecksums, changedItems, SaveError } from '../src/save.js';
import { P, readText, readBin, tmpFile, pyVerify } from './helpers.js';

const ems = parseXdf(readText(P.ems2kXdf));
const ign = ems.items.find(i => i.title === 'Ignition - base advance');

function editedImage(file, name) {
  const im = new BinImage(readBin(file), name);
  const cells = [{ r: 0, c: 0, value: 33 }, { r: 5, c: 5, value: 11.25 }, { r: 15, c: 11, value: -7.5 }];
  im.apply('ign', planWrites(ign, im.working, cells).patches);
  assert.ok(im.editedOffsets().length > 0, 'the test edit changed nothing');
  return im;
}

test('EKII: a calibration edit is corrected and checksum.py agrees', () => {
  const im = editedImage(P.ekii, 'TB62572_EKII.bin');
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.deepEqual([res.fixed, res.notFixed, res.notCorrected], [['cal'], [], false]);
  assert.equal(res.binName, 'TB62572_EKII_edit.bin');
  assert.equal(res.zipName, 'TB62572_EKII_edit.zip');
  const py = pyVerify(tmpFile(res.binName, res.out));
  assert.deepEqual([py.boot.ok, py.prog.ok, py.cal.ok], [true, true, true]);
  const allowed = new Set([...im.editedOffsets(), 0x77fe0, 0x77fe1]);
  for (let i = 0; i < res.out.length; i++) {
    if (res.out[i] !== im.original[i] && !allowed.has(i)) assert.fail(`byte 0x${i.toString(16)} changed`);
  }
  assert.match(res.changeLog, /Ignition - base advance @0x75EF2: \d+ cells?, change /);
  assert.match(res.changeLog, /corrected: cal/);
  assert.equal(im.working[0x77fe0], im.original[0x77fe0], 'the working image is not modified by saving');
});

test('a program-area edit is never corrected and is marked in the name', () => {
  const im = editedImage(P.ekii, 'EKII.bin');
  im.apply('prog byte', [{ off: 0x20000, before: im.working[0x20000], after: im.working[0x20000] ^ 0xff }]);
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.deepEqual([res.fixed, res.notFixed, res.notCorrected], [['cal'], ['prog'], true]);
  assert.equal(res.binName, 'EKII_edit_CHECKSUM-NOT-FIXED.bin');
  assert.deepEqual([res.out[0x10010], res.out[0x10011]], [im.original[0x10010], im.original[0x10011]]);
  assert.equal(res.after.prog.ok, false);
  assert.match(res.changeLog, /NOT corrected: prog/);
  assert.match(res.changeLog, /Bytes changed outside XDF items: 1/);
});

test('EKIInonews: cal is corrected, the loaded prog mismatch is left exactly as it was', () => {
  const im = editedImage(P.nonews, 'nonews.bin');
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.deepEqual(res.fixed, ['cal']);
  assert.deepEqual(res.before.prog, { calc: 0x0263, stored: 0x5233, ok: false });
  assert.deepEqual(res.after.prog, { calc: 0x0263, stored: 0x5233, ok: false });
  assert.deepEqual([...res.out.subarray(0x10010, 0x10012)], [...im.original.subarray(0x10010, 0x10012)]);
});

test('unknown ECU: saved as-is and marked not fixed', () => {
  const msv = parseXdf(readText(P.msv70Xdf));
  const t = msv.items.find(i => i.kind === 'table' && !i.readOnly && i.z.rows > 1);
  const im = new BinImage(readBin(P.msv70Bin), 'S7581295.bin');
  const raw0 = readItem(t, im.working).raw[0][0];
  im.apply('x', planWrites(t, im.working, [{ r: 0, c: 0, value: raw0 ^ 1 }], { raw: true }).patches);
  const res = prepareSave(im, msv, pickPlugin(im.original));
  assert.equal(res.plugin, null);
  assert.equal(res.notCorrected, true);
  assert.equal(res.binName, 'S7581295_edit_CHECKSUM-NOT-FIXED.bin');
  assert.deepEqual(res.out, im.working);
  assert.match(res.changeLog, /no checksum plugin/);
});

test('no edits: identical bytes, plain name', () => {
  const im = new BinImage(readBin(P.ekii), 'EKII.bin');
  const res = prepareSave(im, ems, pickPlugin(im.original));
  assert.deepEqual([res.fixed, res.notCorrected, res.binName], [[], false, 'EKII_edit.bin']);
  assert.deepEqual(res.out, im.original);
  assert.match(res.changeLog, /Changed items: 0/);
});

test('the self-check aborts on unexpected bytes or a failed correction', () => {
  const im = editedImage(P.ekii, 'EKII.bin');
  const real = pickPlugin(im.original).plugin;
  const rogue = { ...real, fix(img, region) { real.fix(img, region); img[0x70000] ^= 1; } };
  assert.throws(() => prepareSave(im, ems, { plugin: rogue, reasons: [] }), SaveError);
  const lazy = { ...real, fix() {} };
  assert.throws(() => prepareSave(im, ems, { plugin: lazy, reasons: [] }), /did not verify/);
});

test('planChecksums and changedItems', () => {
  const im = editedImage(P.ekii, 'EKII.bin');
  const p = planChecksums(im, pickPlugin(im.original));
  assert.deepEqual([p.fixed, p.notFixed], [['cal'], []]);
  const ch = changedItems(im, ems);
  assert.deepEqual(ch.map(c => c.item.title), ['Ignition - base advance']);
  assert.ok(ch[0].cells >= 1 && ch[0].cells <= 3);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/save.test.js`
Expected: FAIL — `Cannot find module .../src/save.js`.

- [ ] **Step 3: Implement `src/save.js`**

```js
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
    if (res.notFixed.length) L.push(`  NOT corrected: ${res.notFixed.join(', ')} (edits fall in a region this tool never corrects)`);
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/save.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add src/save.js tests/save.test.js
git status --short
git commit -m "Add save: checksum policy, self-check and change log" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 11: Bundler, page template, styles and DOM helpers

**Files:**
- Create: `build.js`
- Create: `src/index.html`
- Create: `src/style.css`
- Create: `src/ui/dom.js`
- Test: `tests/build.test.js`

**Interfaces:**
- Produces (build): `bundle(srcDir, order: string[]) → string` (one IIFE; each module in its own scope; `import { a, b as c } from './x.js'` becomes `const { a, b: c } = __mods["x.js"];`; throws on an import of a module not in `order` or later in `order`, on any other `import`/`export` form, and if the output contains `</script`). `ORDER: string[]`. `build() → {artifact, local, bytes}` writes `dist/xdf-editor.html` and `dist/xdf-editor-local.html`. `node build.js` runs `build()`.
- Produces (page): element ids used by the UI tasks: `menuBtn, xdfInput, binInput, cmpInput, cmpChip, checks, undoBtn, redoBtn, logBtn, saveBtn, banner, confirm, side, search, modOnly, tree, scrim, main, report, itemHead, toolbar, gridWrap, grid, graphWrap, graph, graphHint, status, keysink`. The `.work` element wraps `gridWrap` and `graphWrap` and takes the class `with-graph` when the graph shows.
- Produces (dom.js): `$(id)`, `h(tag, attrs, ...kids)` (attrs: `class`, `text`, `on<event>` listeners, `false/null/undefined` skipped, `true` → empty attribute), `hex(n, width)`, `esc(s)`, `debounce(fn, ms)`, `prefs.get(key, fallback)` / `prefs.set(key, value)` (localStorage, try/catch), `token(name)`, `rgb('#rrggbb') → [r, g, b]`, `css([r, g, b], a = 1)`, `rampRgb(t, kind = 'heat') → [r, g, b]` (three-stop ramp from `--<kind>-lo|mid|hi`), `resetTheme()` (clears the ramp cache), `setupCanvas(canvas) → {g, width, height}` (HiDPI-sized, cleared).

- [ ] **Step 1: Write the failing test `tests/build.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundle } from '../build.js';

test('bundles modules with scoped names, aliases and dependency checks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const secret = 1;\nexport const A = 40 + secret;\nexport function twice(x) { return 2 * x; }\n');
  fs.writeFileSync(path.join(dir, 'sub', 'b.js'), "import { A, twice as dbl } from '../a.js';\nconst secret = 2;\nexport class B { get v() { return dbl(A) + secret; } }\n");
  fs.writeFileSync(path.join(dir, 'c.js'), "import { B } from './sub/b.js';\nglobalThis.__bundleResult = new B().v;\n");
  new Function(bundle(dir, ['a.js', 'sub/b.js', 'c.js']))();
  assert.equal(globalThis.__bundleResult, 84);
  delete globalThis.__bundleResult;
  assert.throws(() => bundle(dir, ['sub/b.js', 'a.js', 'c.js']), /comes later/);
  assert.throws(() => bundle(dir, ['sub/b.js', 'c.js']), /not in the bundle/);
  fs.writeFileSync(path.join(dir, 'd.js'), 'export default 1;\n');
  assert.throws(() => bundle(dir, ['d.js']), /unsupported export/);
  fs.writeFileSync(path.join(dir, 'e.js'), "const s = '</script>';\n");
  assert.throws(() => bundle(dir, ['e.js']), /<\/script/);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/build.test.js`
Expected: FAIL — `Cannot find module .../build.js`.

- [ ] **Step 3: Implement `build.js`**

```js
// Bundles src/ into one HTML page. Each module is wrapped in its own scope;
// `import { a, b as c } from './x.js'` becomes a destructure of that
// module's exports. Only that import form and `export function|class|const|let`
// are supported.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ORDER = [
  'xml.js', 'math.js', 'codec.js', 'xdf.js', 'table.js', 'image.js', 'ops.js',
  'checksums/ems2k.js', 'checksums/index.js', 'zip.js', 'save.js',
  'ui/dom.js', 'ui/status.js', 'ui/demo.js', 'ui/sidebar.js',
  'ui/app.js',
];

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const EXPORT = /^export\s+((?:async\s+)?function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;

export function bundle(srcDir, order) {
  const known = new Set(order);
  const parts = [];
  for (const id of order) {
    let code = fs.readFileSync(path.join(srcDir, id), 'utf8');
    const names = [];
    code = code.replace(IMPORT, (_, list, spec) => {
      const dep = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
      if (!known.has(dep)) throw new Error(`${id}: imports ${spec}, which is not in the bundle`);
      if (order.indexOf(dep) > order.indexOf(id)) throw new Error(`${id}: imports ${dep}, which comes later in the bundle order`);
      const binds = list.split(',').map(s => s.trim()).filter(Boolean).map(s => {
        const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
        if (!m) throw new Error(`${id}: cannot bundle the import "${s}"`);
        return m[2] ? `${m[1]}: ${m[2]}` : m[1];
      });
      return `const { ${binds.join(', ')} } = __mods[${JSON.stringify(dep)}];`;
    });
    code = code.replace(EXPORT, (_, kind, name) => {
      names.push(name);
      return `${kind} ${name}`;
    });
    const left = /^\s*(import|export)\b.*$/m.exec(code);
    if (left) throw new Error(`${id}: unsupported ${left[1]} statement: ${left[0].trim()}`);
    parts.push(`__mods[${JSON.stringify(id)}] = (() => {\n${code}\nreturn { ${names.join(', ')} };\n})();`);
  }
  const js = `(() => {\n'use strict';\nconst __mods = {};\n${parts.join('\n')}\n})();\n`;
  if (js.includes('</script')) throw new Error('The bundle contains "</script", which would end the inline script early');
  return js;
}

export function build() {
  const src = path.join(HERE, 'src');
  const js = bundle(src, ORDER);
  const css = fs.readFileSync(path.join(src, 'style.css'), 'utf8');
  const page = fs.readFileSync(path.join(src, 'index.html'), 'utf8')
    .replace('/*STYLE*/', () => css)
    .replace('/*SCRIPT*/', () => js);
  const dist = path.join(HERE, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const artifact = path.join(dist, 'xdf-editor.html');
  const local = path.join(dist, 'xdf-editor-local.html');
  fs.writeFileSync(artifact, page);
  fs.writeFileSync(local, '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n' +
    page + '\n</body>\n</html>\n');
  return { artifact, local, bytes: page.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build();
  console.log(`wrote ${path.relative(HERE, r.artifact)} and ${path.relative(HERE, r.local)} (${Math.round(r.bytes / 1024)} KB)`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/build.test.js`
Expected: PASS, 1 test. (`npm run build` cannot run yet: the UI modules arrive in Task 12.)

- [ ] **Step 5: Create `src/index.html`** (the published page body; the Artifact platform adds doctype/head, the local build wraps it)

```html
<title>XDF Map Editor</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
/*STYLE*/
</style>
<div class="app" id="app">
  <header class="bar">
    <button type="button" id="menuBtn" class="btn ghost narrow-only" aria-controls="side" aria-expanded="false">Maps</button>
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span>XDF Map Editor</div>
    <div class="files">
      <label class="btn" for="xdfInput">Open XDF</label>
      <input type="file" id="xdfInput" accept=".xdf,.xml" hidden>
      <label class="btn" for="binInput">Open BIN</label>
      <input type="file" id="binInput" hidden>
      <label class="btn ghost" for="cmpInput" title="Load another BIN of the same size to compare against">Compare BIN</label>
      <input type="file" id="cmpInput" hidden>
      <span id="cmpChip" class="chip" hidden></span>
    </div>
    <div id="checks" class="checks" aria-label="Checksums"></div>
    <div class="actions">
      <button type="button" id="undoBtn" class="btn ghost" title="Undo (⌘Z)" disabled>Undo</button>
      <button type="button" id="redoBtn" class="btn ghost" title="Redo (⇧⌘Z)" disabled>Redo</button>
      <button type="button" id="logBtn" class="btn ghost" title="Save a text list of everything changed" disabled>Change log</button>
      <button type="button" id="saveBtn" class="btn primary" title="Save the edited BIN (⌘S)" disabled>Save BIN</button>
    </div>
  </header>
  <div id="banner" class="banner" role="alert" hidden></div>
  <div id="confirm" class="confirm" hidden></div>
  <div class="body">
    <aside id="side" class="side" aria-label="Maps">
      <input type="search" id="search" placeholder="Search name, text or 0x address" aria-label="Search maps" autocomplete="off">
      <label class="check"><input type="checkbox" id="modOnly"> Modified only</label>
      <nav id="tree" class="tree" aria-label="Map list"></nav>
    </aside>
    <div id="scrim" class="scrim" hidden></div>
    <main id="main" class="main">
      <section id="report" class="report" aria-label="Load report" hidden></section>
      <div id="itemHead" class="item-head"></div>
      <div id="toolbar" class="toolbar" hidden></div>
      <div class="work">
        <div id="gridWrap" class="grid-wrap" hidden><table id="grid" class="grid"></table></div>
        <figure id="graphWrap" class="graph-wrap" hidden>
          <canvas id="graph" aria-label="Graph of the selected map"></canvas>
          <figcaption id="graphHint" class="hint"></figcaption>
        </figure>
      </div>
      <p class="keys narrow-hide">Keys: arrows move · shift extends · type a number or Enter to set · + / − step · ⌘C / ⌘V copy and paste · ⌘Z undo</p>
    </main>
  </div>
  <footer id="status" class="status" role="status" aria-live="polite"></footer>
  <textarea id="keysink" class="keysink" aria-label="Map cell keyboard input" autocomplete="off" spellcheck="false"></textarea>
</div>
<script>
/*SCRIPT*/
</script>
```

- [ ] **Step 6: Create `src/style.css`**

```css
/* Layout: calibration bench. Instrument bar on top, map rail on the left,
   grid and graph side by side on wide screens and stacked on narrow ones. */
:root {
  --bg: #e9edf1;
  --surface: #ffffff;
  --surface-2: #f3f5f8;
  --line: #d3d9e0;
  --cell-line: #e3e7ec;
  --fg: #17212b;
  --muted: #5a6774;
  --accent: #b9650a;
  --accent-fg: #ffffff;
  --sel: rgb(185 101 10 / 0.26);
  --ok: #1e7a4c;
  --bad: #c0352a;
  --warn: #8f5d00;
  --heat-lo: #d6e5f3;
  --heat-mid: #f2ecd6;
  --heat-hi: #f2c2b2;
  --plot-lo: #4a86c5;
  --plot-mid: #e3c25e;
  --plot-hi: #cf5a40;
  --font-ui: "Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif;
  --font-body: "Barlow", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-data: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0e1318;
    --surface: #151b22;
    --surface-2: #1b232b;
    --line: #2a3540;
    --cell-line: #222c35;
    --fg: #e2e8ee;
    --muted: #8d9aa8;
    --accent: #efa13a;
    --accent-fg: #1b1205;
    --sel: rgb(239 161 58 / 0.28);
    --ok: #4cc28a;
    --bad: #f0675b;
    --warn: #e6b14f;
    --heat-lo: #172d43;
    --heat-mid: #2b2e29;
    --heat-hi: #57291f;
    --plot-lo: #3f7fc0;
    --plot-mid: #c9a849;
    --plot-hi: #d4573f;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0e1318;
  --surface: #151b22;
  --surface-2: #1b232b;
  --line: #2a3540;
  --cell-line: #222c35;
  --fg: #e2e8ee;
  --muted: #8d9aa8;
  --accent: #efa13a;
  --accent-fg: #1b1205;
  --sel: rgb(239 161 58 / 0.28);
  --ok: #4cc28a;
  --bad: #f0675b;
  --warn: #e6b14f;
  --heat-lo: #172d43;
  --heat-mid: #2b2e29;
  --heat-hi: #57291f;
  --plot-lo: #3f7fc0;
  --plot-mid: #c9a849;
  --plot-hi: #d4573f;
  color-scheme: dark;
}

*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.45 var(--font-body);
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  padding-block: 0;
}
button, input, textarea { font: inherit; color: inherit; }
code { font-family: var(--font-data); font-size: 0.92em; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
body.dropping .app { outline: 2px dashed var(--accent); outline-offset: -6px; }

.app { height: 100%; display: flex; flex-direction: column; min-width: 0; }

/* Top bar */
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding-block: 10px; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 8px; margin-right: auto; font: 700 18px/1 var(--font-ui); letter-spacing: 0.02em; }
.brand-mark { position: relative; width: 16px; height: 16px; border: 2px solid var(--accent); border-radius: 50%; }
.brand-mark::after { content: ""; position: absolute; left: 50%; top: 50%; width: 7px; height: 2px; background: var(--accent); transform-origin: 0 50%; transform: rotate(-40deg); }
.files, .actions, .checks { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.btn { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); font: 600 14px/1 var(--font-ui); letter-spacing: 0.02em; white-space: nowrap; cursor: pointer; }
.btn:hover:not(:disabled) { border-color: var(--muted); }
.btn:disabled { opacity: 0.45; cursor: default; }
.btn.ghost { background: transparent; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.danger { border-color: var(--bad); color: var(--bad); }
.link { padding: 0; border: 0; background: none; color: var(--accent); font: 600 13px var(--font-ui); text-decoration: underline; cursor: pointer; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2); font: 500 13px var(--font-ui); }
.chip button { padding: 0 6px; border: 0; background: none; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }
.pill { padding: 3px 9px; border: 1px solid currentColor; border-radius: 999px; background: color-mix(in srgb, currentColor 10%, transparent); font: 600 12px/1.2 var(--font-data); white-space: nowrap; }
.pill small { font-weight: 400; }
.pill.ok { color: var(--ok); }
.pill.bad { color: var(--bad); }
.pill.neutral { color: var(--muted); }

.banner, .confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-top: 10px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.banner span, .confirm span { flex: 1 1 280px; min-width: 0; }
.banner[data-kind="info"] { border-color: var(--accent); }
.banner[data-kind="error"] { border-color: var(--bad); color: var(--bad); font-weight: 600; }
.confirm { border-color: var(--warn); }

/* Body: map rail + main */
.body { flex: 1; min-height: 0; display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; padding-block: 12px; }
.side { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.side input[type="search"] { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.check { display: flex; align-items: center; gap: 6px; color: var(--muted); font: 500 14px var(--font-ui); }
.tree { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.group + .group { border-top: 1px solid var(--cell-line); }
.cat { width: 100%; display: flex; gap: 8px; padding: 8px 10px; border: 0; background: none; text-align: left; font: 600 14px var(--font-ui); cursor: pointer; }
.cat::before { content: "▸"; color: var(--muted); }
.cat[aria-expanded="true"]::before { content: "▾"; }
.cat-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.count { color: var(--muted); font: 500 12px var(--font-data); }
.items { margin: 0; padding: 0 0 6px; list-style: none; }
.item { width: 100%; display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; gap: 6px; align-items: baseline; padding: 5px 10px 5px 14px; border: 0; background: none; text-align: left; font-size: 13px; cursor: pointer; }
.item:hover { background: var(--surface-2); }
.item.current { background: var(--sel); }
.item.disabled { color: var(--muted); }
.item-title { overflow-wrap: anywhere; }
.item-meta { color: var(--muted); font: 11px var(--font-data); }
.mark { color: var(--accent); font-size: 10px; }
.mark.warn { color: var(--warn); }
.empty, .note { margin: 0; padding: 10px; color: var(--muted); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.main { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow: auto; }
.report { display: flex; align-items: flex-start; gap: 12px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); font-size: 13px; }
.report-body { flex: 1; min-width: 0; }
.report p { margin: 0 0 4px; }
.report ul { max-height: 160px; margin: 4px 0; padding-left: 18px; overflow: auto; }
.warn-text { color: var(--warn); font-weight: 600; }
.item-head h2 { margin: 0; font: 700 22px/1.15 var(--font-ui); letter-spacing: 0.01em; text-wrap: balance; overflow-wrap: anywhere; }
.head-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
.meta { margin: 4px 0 0; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.desc { max-width: 75ch; margin: 6px 0 0; font-size: 13.5px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.seg button { padding: 5px 12px; border: 0; background: var(--surface); color: var(--muted); font: 600 13px var(--font-ui); cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }

/* Toolbar */
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.tgroup { display: flex; align-items: center; gap: 4px; }
.tgroup-label { margin-right: 4px; color: var(--muted); font: 600 11px var(--font-ui); letter-spacing: 0.08em; text-transform: uppercase; }
.toolbar .btn { min-height: 30px; padding: 0 10px; }
.num { width: 92px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); font: 13px var(--font-data); text-align: right; }
.num.small { width: 66px; }
.unit { color: var(--muted); font-size: 13px; }

/* Grid and graph */
.work { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
@media (min-width: 1200px) { .work.with-graph { grid-template-columns: minmax(0, 1fr) minmax(340px, 38%); } }
.grid-wrap { min-width: 0; max-height: 70vh; overflow: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.grid { border-collapse: separate; border-spacing: 0; font: 12.5px/1 var(--font-data); font-variant-numeric: tabular-nums; }
.grid th, .grid td { padding: 6px 8px; border-right: 1px solid var(--cell-line); border-bottom: 1px solid var(--cell-line); text-align: right; white-space: nowrap; }
.grid thead th { position: sticky; top: 0; z-index: 2; background: var(--surface-2); color: var(--muted); font: 600 12.5px var(--font-ui); cursor: pointer; }
.grid th.yh { position: sticky; left: 0; z-index: 1; background: var(--surface-2); color: var(--muted); font: 600 12.5px var(--font-ui); cursor: pointer; }
.grid th.corner { left: 0; z-index: 3; max-width: 9em; overflow: hidden; text-overflow: ellipsis; text-align: left; font-weight: 500; }
.grid td { color: var(--fg); cursor: cell; user-select: none; -webkit-user-select: none; }
.grid td.chg { box-shadow: inset 0 0 0 2px var(--accent); }
.grid td.sel { background-image: linear-gradient(var(--sel), var(--sel)); }
.grid td.focus { outline: 2px solid var(--fg); outline-offset: -2px; }
.grid.single td { min-width: 160px; padding: 14px 20px; font-size: 22px; }
.graph-wrap { min-width: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.graph-wrap canvas { display: block; width: 100%; height: 340px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.graph-wrap canvas[data-mode="surface"] { touch-action: none; cursor: grab; }
.graph-wrap canvas.dragging { cursor: grabbing; }
@media (min-width: 1200px) { .graph-wrap canvas { height: min(460px, 60vh); } }
.hint, .keys { margin: 0; color: var(--muted); font-size: 12px; }

.status { min-height: 36px; padding-block: 8px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.status[data-kind="ok"] { color: var(--ok); }
.status[data-kind="warn"] { color: var(--warn); }
.status[data-kind="error"] { color: var(--bad); font-weight: 600; }
.keysink { position: fixed; left: 0; bottom: 0; width: 1px; height: 1px; padding: 0; border: 0; opacity: 0; resize: none; pointer-events: none; }
.scrim { display: none; }
.narrow-only { display: none; }

@media (max-width: 759px) {
  .app { height: auto; min-height: 100%; }
  .narrow-only { display: inline-flex; }
  .narrow-hide { display: none; }
  .brand { flex: 1 1 auto; margin-right: 0; }
  .body { display: block; }
  .side {
    position: fixed; z-index: 30; inset: 0 auto 0 0; width: min(330px, 88vw);
    padding: calc(12px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
    background: var(--bg); border-right: 1px solid var(--line);
    transform: translateX(-105%); transition: transform 0.2s ease;
  }
  .side.open { transform: none; }
  .scrim:not([hidden]) { display: block; position: fixed; inset: 0; z-index: 25; background: rgb(0 0 0 / 0.35); }
  .main { overflow: visible; }
  .grid-wrap { max-height: 62vh; }
}
@media (prefers-reduced-motion: reduce) { .side { transition: none; } }
```

- [ ] **Step 7: Create `src/ui/dom.js`**

```js
// Small DOM helpers shared by the UI modules.

export const $ = id => document.getElementById(id);

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

export const hex = (n, width = 0) => '0x' + n.toString(16).toUpperCase().padStart(width, '0');

export const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('artifact-tuner.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('artifact-tuner.' + key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable (private window, blocked site data); preferences are optional.
    }
  },
};

export const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function rgb(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

export const css = ([r, g, b], a = 1) => `rgb(${r} ${g} ${b} / ${a})`;

const ramps = new Map();

export function resetTheme() {
  ramps.clear();
}

// Colour for t in [0, 1] on the three-stop ramp --<kind>-lo / -mid / -hi.
export function rampRgb(t, kind = 'heat') {
  if (!ramps.has(kind)) ramps.set(kind, ['lo', 'mid', 'hi'].map(s => rgb(token(`--${kind}-${s}`))));
  const [a, b, c] = ramps.get(kind);
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const [p, q, k] = u < 0.5 ? [a, b, u * 2] : [b, c, (u - 0.5) * 2];
  return p.map((v, i) => Math.round(v + (q[i] - v) * k));
}

export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  return { g, width, height };
}
```

- [ ] **Step 8: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add build.js src/index.html src/style.css src/ui/dom.js tests/build.test.js
git status --short
git commit -m "Add bundler, page template, styles and DOM helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 12: App shell — loading, map list, checksums, saving

**Files:**
- Create: `src/ui/status.js`, `src/ui/demo.js`, `src/ui/sidebar.js`, `src/ui/app.js`
- Create: `.claude/launch.json` (git-ignored)
- Test: `tests/ui-pure.test.js`
- Modify: `tests/build.test.js` (add the real-build test)

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces:
  - `status.js`: `setStatus(msg, kind = 'info')` (`kind`: `info|ok|warn|error`), `showBanner(text, kind = 'warn')`, `hideBanner()`, `askConfirm(text, okLabel) → Promise<boolean>` (in-page, never `confirm()`), `renderChecks(state)`.
  - `demo.js`: `demoFiles() → {xdfText, bin: Uint8Array(0x200), binName: 'example.bin'}` (synthetic, clearly labelled).
  - `sidebar.js`: `itemMatches(item, query) → boolean`, `isModified(item, image) → boolean`, `renderTree(app)`.
  - `app.js`: the **app** object passed to UI modules: `{state, select(item), edit(label, cells), refresh(), status(msg, kind)}` (Tasks 13–14 add more methods). **state**: `{model, xdfName, image, pick, verified, bounds, plan, item, view, refView, sel, rawMode, query, modOnly, open: Set<string>, demo}`. In this task `renderMain()` shows the item header only and `renderGraph()` hides the graph; Tasks 13 and 14 replace them.
  - Test hook `window.xdfedit = {app, load(xdfText, binBytes, binName), loadCompare(bytes, name), select(titleOrOffset) → boolean, prepareSave()}`.

- [ ] **Step 1: Write the failing test `tests/ui-pure.test.js`** (the DOM-free parts of the UI)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { demoFiles } from '../src/ui/demo.js';
import { itemMatches, isModified } from '../src/ui/sidebar.js';
import { parseXdf, checkBounds } from '../src/xdf.js';
import { readItem } from '../src/table.js';
import { BinImage } from '../src/image.js';
import { P, readText, readBin } from './helpers.js';

const ems = parseXdf(readText(P.ems2kXdf));
const ign = ems.items.find(i => i.title === 'Ignition - base advance');

test('example data parses and decodes to plausible values', () => {
  const d = demoFiles();
  const m = parseXdf(d.xdfText);
  assert.deepEqual(m.report.skipped, []);
  assert.deepEqual(m.items.map(i => i.title), ['Ignition advance (example)', 'Warm-up enrichment (example)', 'Rev limit (example)']);
  assert.deepEqual(checkBounds(m, d.bin.length), { sizeMismatch: false, disabled: 0 });
  const adv = readItem(m.items[0], d.bin);
  assert.deepEqual([adv.rows, adv.cols, adv.ys[0], adv.xs[11]], [16, 12, 800, 100]);
  for (const row of adv.phys) for (const v of row) assert.ok(v > -5 && v < 45, `advance ${v}`);
  const warm = readItem(m.items[1], d.bin);
  assert.equal(warm.xs[0], -30);
  assert.ok(warm.phys[0][0] > 1.5 && warm.phys[0][9] < 1.05);
  assert.equal(readItem(m.items[2], d.bin).phys[0][0], 6560);
  assert.equal(d.binName, 'example.bin');
});

test('search by title, description and hex address', () => {
  assert.equal(itemMatches(ign, ''), true);
  assert.equal(itemMatches(ign, 'BASE ADVANCE'), true);
  assert.equal(itemMatches(ign, 'knock-limited'), true);
  assert.equal(itemMatches(ign, '0x75F00'), true);          // inside the 192-byte table
  assert.equal(itemMatches(ign, '75ef2'), true);
  assert.equal(itemMatches(ign, '0x75FB2'), false);         // first byte after the table
  assert.equal(itemMatches(ign, 'lambda'), false);
});

test('isModified compares the data bytes with the reference', () => {
  const im = new BinImage(readBin(P.ekii), 'a.bin');
  assert.equal(isModified(ign, im), false);
  const off = 0x75ef2 + 10;
  im.apply('x', [{ off, before: im.working[off], after: im.working[off] ^ 1 }]);
  assert.equal(isModified(ign, im), true);
  assert.equal(isModified(ign, null), false);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/ui-pure.test.js`
Expected: FAIL — `Cannot find module .../src/ui/demo.js`.

- [ ] **Step 3: Create `src/ui/demo.js`**

```js
// Made-up example data so the page opens in a working state. Nothing here
// comes from a real ECU.

export function demoFiles() {
  const bin = new Uint8Array(0x200);
  const rpm = Array.from({ length: 16 }, (_, i) => 32 * (25 + 12 * i));     // 800 … 6560 rpm
  const load = [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 90, 100];              // %
  const coolant = [24, 40, 56, 72, 88, 104, 128, 152, 176, 200];               // raw; X*0.75-48 = °C
  rpm.forEach((v, i) => { bin[0x00 + i] = v / 32; });
  load.forEach((v, i) => { bin[0x10 + i] = v * 2; });
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 12; c++) {
      const advance = 8 + 30 * Math.sqrt(rpm[r] / 6560) - 18 * (load[c] / 100) ** 1.5;
      bin[0x20 + r * 12 + c] = Math.round((advance + 23.625) / 0.375);
    }
  }
  coolant.forEach((raw, i) => {
    bin[0xe0 + i] = raw;
    const t = raw * 0.75 - 48;
    const factor = Math.round((1 + 0.6 * Math.exp(-(t + 30) / 35)) * 32768);
    bin[0xea + 2 * i] = factor & 0xff;
    bin[0xeb + 2 * i] = factor >> 8;
  });
  bin[0x100] = 205;                                                           // 205 × 32 = 6560 rpm
  return { xdfText: XDF, bin, binName: 'example.bin' };
}

const XDF = `<XDFFORMAT version="1.70">
  <XDFHEADER>
    <deftitle>Example engine (made-up data)</deftitle>
    <description>Synthetic maps that show how the editor works. Open your own XDF and BIN to start.</description>
    <BASEOFFSET offset="0" subtract="0" />
    <DEFAULTS datasizeinbits="8" sigdigits="2" />
    <REGION type="0xFFFFFFFF" startaddress="0x0" size="0x200" />
    <CATEGORY index="0x0" name="Ignition" />
    <CATEGORY index="0x1" name="Fuel" />
    <CATEGORY index="0x2" name="Limits" />
  </XDFHEADER>
  <XDFTABLE uniqueid="0x1">
    <title>Ignition advance (example)</title>
    <description>Spark advance by engine speed and load. Made-up values.</description>
    <CATEGORYMEM index="0" category="1" />
    <XDFAXIS id="x"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x10" mmedelementsizebits="8" /><units>Load %</units><indexcount>12</indexcount><decimalpl>0</decimalpl><embedinfo type="1" /><MATH equation="X/2"><VAR id="X" /></MATH></XDFAXIS>
    <XDFAXIS id="y"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x0" mmedelementsizebits="8" /><units>rpm</units><indexcount>16</indexcount><decimalpl>0</decimalpl><embedinfo type="1" /><MATH equation="X*32"><VAR id="X" /></MATH></XDFAXIS>
    <XDFAXIS id="z"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x20" mmedelementsizebits="8" mmedrowcount="16" mmedcolcount="12" /><units>° BTDC</units><decimalpl>2</decimalpl><MATH equation="X*0.375-23.625"><VAR id="X" /></MATH></XDFAXIS>
  </XDFTABLE>
  <XDFTABLE uniqueid="0x2">
    <title>Warm-up enrichment (example)</title>
    <description>Fuel multiplier by coolant temperature. Made-up values.</description>
    <CATEGORYMEM index="0" category="2" />
    <XDFAXIS id="x"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0xE0" mmedelementsizebits="8" /><units>Coolant °C</units><indexcount>10</indexcount><decimalpl>0</decimalpl><embedinfo type="1" /><MATH equation="X*0.75-48"><VAR id="X" /></MATH></XDFAXIS>
    <XDFAXIS id="y"><indexcount>1</indexcount><LABEL index="0" value="-" /></XDFAXIS>
    <XDFAXIS id="z"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0xEA" mmedelementsizebits="16" mmedrowcount="1" mmedcolcount="10" /><units>factor</units><decimalpl>3</decimalpl><MATH equation="X/32768"><VAR id="X" /></MATH></XDFAXIS>
  </XDFTABLE>
  <XDFCONSTANT uniqueid="0x3">
    <title>Rev limit (example)</title>
    <description>Fuel-cut engine speed. Made-up value.</description>
    <CATEGORYMEM index="0" category="3" />
    <EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x100" mmedelementsizebits="8" />
    <units>rpm</units>
    <decimalpl>0</decimalpl>
    <MATH equation="X*32"><VAR id="X" /></MATH>
  </XDFCONSTANT>
</XDFFORMAT>`;
```

- [ ] **Step 4: Create `src/ui/status.js`**

```js
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
```

- [ ] **Step 5: Create `src/ui/sidebar.js`**

```js
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
```

- [ ] **Step 6: Run the pure UI test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/ui-pure.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 7: Create `src/ui/app.js`**

```js
// Application state and wiring: loading files, choosing items, editing,
// undo/redo, saving, and the window.xdfedit test hook.
import { parseXdf, checkBounds } from '../xdf.js';
import { BinImage } from '../image.js';
import { readItem, planWrites, formatValue } from '../table.js';
import { pickPlugin } from '../checksums/index.js';
import { prepareSave, planChecksums } from '../save.js';
import { zip } from '../zip.js';
import { $, h, hex, prefs, debounce, resetTheme } from './dom.js';
import { setStatus, showBanner, hideBanner, askConfirm, renderChecks } from './status.js';
import { renderTree } from './sidebar.js';
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
  el.replaceChildren(
    h('div', { class: 'head-row' },
      h('h2', { text: item.title }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Show values as' },
        h('button', { type: 'button', 'aria-pressed': String(!state.rawMode), onclick: () => setRaw(false) }, 'Physical'),
        h('button', { type: 'button', 'aria-pressed': String(state.rawMode), onclick: () => setRaw(true) }, 'Raw'))),
    h('p', { class: 'meta' }, h('code', { text: hex(z.offset, 5) }),
      ` · ${shape} · ${type}` + (z.units ? ` · ${z.units}` : '') + (z.equation !== 'X' ? ` · ${z.equation}` : '')),
    item.desc ? h('p', { class: 'desc', text: item.desc }) : null,
    item.disabled ? h('p', { class: 'warn-text', text: `Disabled: ${item.disabledReason}` })
      : item.readOnly ? h('p', { class: 'warn-text', text: `Read-only: ${item.reason}` }) : null);
}

function renderMain() {
  renderHead();
  $('gridWrap').hidden = true;
  $('toolbar').hidden = true;
}

function renderGraph() {
  $('graphWrap').hidden = true;
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
```

- [ ] **Step 8: Add the real-build test to `tests/build.test.js`**

Add these imports below the existing ones:

```js
import { execFileSync } from 'node:child_process';
import { build } from '../build.js';
import { tmpFile } from './helpers.js';
```

(`bundle` is already imported from `../build.js`; merge the two into `import { bundle, build } from '../build.js';`.)

Append:

```js
test('the real build writes both pages with a syntactically valid script', () => {
  const r = build();
  const page = fs.readFileSync(r.artifact, 'utf8');
  assert.ok(page.startsWith('<title>XDF Map Editor</title>'));
  assert.match(page, /<meta name="claude:viewport-fit-sides" content="cover">/);
  assert.doesNotMatch(page, /\/\*(STYLE|SCRIPT)\*\//);
  const js = page.slice(page.indexOf('<script>') + '<script>'.length, page.lastIndexOf('</script>'));
  assert.doesNotMatch(js, /^\s*(import|export)\b/m);
  execFileSync(process.execPath, ['--check', tmpFile('bundle.js', js)]);
  const local = fs.readFileSync(r.local, 'utf8');
  assert.ok(local.startsWith('<!doctype html>'));
  assert.ok(local.includes(page));
});
```

- [ ] **Step 9: Run the build and the full suite**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm run build && npm test`
Expected: `wrote dist/xdf-editor.html and dist/xdf-editor-local.html (… KB)`, then all tests pass.

- [ ] **Step 10: Add the preview server config `.claude/launch.json`** (git-ignored; serves the whole MSV70 folder on localhost so the page can fetch the real files)

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "artifact-tuner",
      "runtimeExecutable": "python3",
      "runtimeArgs": ["-m", "http.server", "8766", "--bind", "127.0.0.1", "--directory", "/Users/valdiskikusts/MSV70"],
      "port": 8766
    }
  ]
}
```

- [ ] **Step 11: Check the shell in the browser pane**

1. `preview_start` with `{name: "artifact-tuner"}`, then navigate to `http://127.0.0.1:8766/ArtifactTuner/dist/xdf-editor-local.html`.
2. `read_page`: the banner says "You are looking at made-up example data…", the header shows "Ignition advance (example)" and `0x00020 · 16 × 12 · unsigned 8-bit · ° BTDC · X*0.375-23.625`, the checks area shows "Example data", and Save BIN is disabled.
3. `javascript_tool`:

```js
const [x, b] = await Promise.all([
  fetch('/Mini/EMS2K_111441901203EHC3.xdf').then(r => r.text()),
  fetch('/Mini/TB62572_EMS2K_111441901203EHC3_fullread_EKII.bin').then(r => r.arrayBuffer()),
]);
await xdfedit.load(x, new Uint8Array(b), 'TB62572_EMS2K_111441901203EHC3_fullread_EKII.bin');
({ items: xdfedit.app.state.model.items.length, checks: document.getElementById('checks').innerText,
   status: document.getElementById('status').innerText, report: document.getElementById('report').innerText })
```

Expected: `items: 571`; checks contain `boot ✓`, `prog ✓`, `cal ✓`; status starts with `Ready: 571 items`; the report names the XDF title and `524,288 bytes. Checksums: Siemens EMS2000 (3 × CRC-16/ARC).`
4. Type `75ef2` into the search box (`find` "Search maps", then `computer` type). Expected: the tree shows the Ignition category with "Ignition - base advance". Click it. Expected header meta: `0x75EF2 · 16 × 12 · unsigned 8-bit · deg BTDC · X*0.375-23.625`.
5. `javascript_tool`: load the MSV70 pair the same way (`/BMW_Siemens_MSV70_9PPL921S_128K.xdf`, `/S7581295.bin`). Expected: the report says `The XDF describes 131,072 bytes but the BIN has 125,904.` and the checks area shows `No checksum plugin`.
6. `read_console_messages` with `onlyErrors: true`. Expected: none.

- [ ] **Step 12: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add src/ui/status.js src/ui/demo.js src/ui/sidebar.js src/ui/app.js tests/ui-pure.test.js tests/build.test.js
git status --short
git commit -m "Add app shell: loading, map list, checksum status and saving" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files (no `dist/`, no `.claude/`) before the commit.

---

### Task 13: Grid, selection, keyboard, clipboard and edit toolbar

**Files:**
- Create: `src/ui/grid.js`, `src/ui/toolbar.js`
- Modify: `src/ui/app.js` (imports, `renderMain`, edit actions, `wire`)
- Modify: `build.js` (`ORDER`)

**Interfaces:**
- Consumes: app object and state (Task 12); `normSel, opSet, opAdd, opScale, opInterpolate, opSmooth, opRevert, toTsv, parseTsv, opPaste` (Task 7); `formatValue, formatAxis, defaultStep` (Task 5); `$, h, esc, css, rampRgb` (Task 11).
- Produces:
  - `grid.js`: `renderGrid(app)`, `paintSelection(app, scroll = true)`, `attachGrid(app)` (call once from `wire`).
  - `toolbar.js`: `renderToolbar(app)`; inputs `valIn`, `stepIn`, `pctIn`.
  - New app methods used by grid/toolbar: `setSel(sel)`, `step(dir: 1|-1)`, `applyValue()`, `scale()`, `interpolate(mode)`, `smooth()`, `revert()`, `copy()`, `paste(block)`, `selectionTsv() → string`, `beginEntry(firstChar)`, `focusGrid()`.

- [ ] **Step 1: Create `src/ui/grid.js`**

```js
// The map grid: heat-coloured cells with compare outlines, mouse and
// keyboard selection, and copy/paste through the hidden key sink.
import { $, esc, css, rampRgb } from './dom.js';
import { formatValue, formatAxis } from '../table.js';
import { normSel, parseTsv } from '../ops.js';

const signedFmt = (v, d) => (v > 0 ? '+' : '') + formatValue(v, d);

export function renderGrid(app) {
  const { state } = app;
  const { item, view, refView } = state;
  const table = $('grid');
  if (!item || !view) {
    table.replaceChildren();
    return;
  }
  const grid = state.rawMode ? view.raw : view.phys;
  const ref = state.rawMode ? refView.raw : refView.phys;
  const d = state.rawMode ? 0 : item.z.decimals;
  let lo = Infinity, hi = -Infinity;
  for (const row of grid) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const isTable = item.kind === 'table';
  const html = [];
  if (isTable) {
    const corner = `${item.y.units || 'rows'} ↓  ${item.x.units || 'columns'} →`;
    html.push(`<thead><tr><th class="corner" data-all="1" title="${esc(corner)} (click to select all)">${esc(corner)}</th>`);
    view.xs.forEach((x, c) => html.push(`<th class="xh" data-col="${c}">${esc(formatAxis(item.x, x))}</th>`));
    html.push('</tr></thead>');
  }
  html.push('<tbody>');
  for (let r = 0; r < view.rows; r++) {
    html.push('<tr>');
    if (isTable) html.push(`<th class="yh" data-row="${r}">${esc(formatAxis(item.y, view.ys[r]))}</th>`);
    for (let c = 0; c < view.cols; c++) {
      const v = grid[r][c];
      const changed = view.raw[r][c] !== refView.raw[r][c];
      const tip = changed ? ` title="${esc(`ref ${formatValue(ref[r][c], d)} → ${formatValue(v, d)} (Δ ${signedFmt(v - ref[r][c], d)})`)}"` : '';
      html.push(`<td data-r="${r}" data-c="${c}"${changed ? ' class="chg"' : ''} style="background-color:${css(rampRgb((v - lo) / span))}"${tip}>${formatValue(v, d)}</td>`);
    }
    html.push('</tr>');
  }
  html.push('</tbody>');
  table.innerHTML = html.join('');
  table.classList.toggle('single', view.rows * view.cols === 1);
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
```

- [ ] **Step 2: Create `src/ui/toolbar.js`**

```js
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
  const locked = item.readOnly || item.disabled;
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
```

- [ ] **Step 3: Add the two modules to `ORDER` in `build.js`**

Replace:

```js
  'ui/dom.js', 'ui/status.js', 'ui/demo.js', 'ui/sidebar.js',
  'ui/app.js',
```

with:

```js
  'ui/dom.js', 'ui/status.js', 'ui/demo.js', 'ui/sidebar.js',
  'ui/grid.js', 'ui/toolbar.js',
  'ui/app.js',
```

- [ ] **Step 4: Update the imports in `src/ui/app.js`**

Replace `import { readItem, planWrites, formatValue } from '../table.js';` with:

```js
import { readItem, planWrites, formatValue, defaultStep } from '../table.js';
import { opSet, opAdd, opScale, opInterpolate, opSmooth, opRevert, opPaste, toTsv } from '../ops.js';
```

Replace `import { renderTree } from './sidebar.js';` with:

```js
import { renderTree } from './sidebar.js';
import { renderGrid, paintSelection, attachGrid } from './grid.js';
import { renderToolbar } from './toolbar.js';
```

- [ ] **Step 5: Replace `renderMain` in `src/ui/app.js`**

Replace the whole Task 12 function:

```js
function renderMain() {
  renderHead();
  $('gridWrap').hidden = true;
  $('toolbar').hidden = true;
}
```

with:

```js
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
```

- [ ] **Step 6: Add the edit actions to `src/ui/app.js`**

Insert this block directly above the line `// ---- saving ---...`:

```js
const gridNow = () => (state.rawMode ? state.view.raw : state.view.phys);

function parseNum(text) {
  let t = String(text ?? '').trim();
  if (/^[-+]?\d+,\d+$/.test(t)) t = t.replace(',', '.');
  const v = Number(t);
  return t !== '' && Number.isFinite(v) ? v : NaN;
}

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
  const v = parseNum($('valIn')?.value);
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
  const typed = parseNum($('stepIn')?.value);
  const size = typed > 0 ? typed : defaultStep(state.item, state.rawMode);
  edit(dir > 0 ? 'Step up' : 'Step down', opAdd(gridNow(), state.sel, dir * size));
}

function scale() {
  if (!ready()) return;
  const p = parseNum($('pctIn')?.value);
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
```

- [ ] **Step 7: Attach the grid in `wire()`**

In `src/ui/app.js`, replace `  document.addEventListener('keydown', onKey);` with:

```js
  document.addEventListener('keydown', onKey);
  attachGrid(app);
```

- [ ] **Step 8: Build and run the full suite**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 9: Check editing in the browser pane**

Use the preview from Task 12 (`preview_start` `{name: "artifact-tuner"}`; navigate to `http://127.0.0.1:8766/ArtifactTuner/dist/xdf-editor-local.html`, or reload it).

1. Example data: the grid shows 16 rows × 12 columns with heat colours; cells r4–6 × c3–6 are selected. Screenshot.
2. Load EKII + EMS2K XDF with the Task 12 `javascript_tool` snippet, then `xdfedit.select('Ignition - base advance')`.
3. Cross-check the first row against the independent Python decode: run in Bash `python3 tests/fixtures/make_fixtures.py "$TMPDIR/fx.json" && python3 -c "import json,os; print([f'{v:.2f}' for v in json.load(open(os.environ['TMPDIR']+'/fx.json'))['0x75ef2']['z'][0]])"`, and in the page `[...document.querySelectorAll('#grid tbody tr:first-child td')].map(td => td.textContent)`. Expected: identical lists.
4. Click the cell at row 2 / column 3, shift-click row 4 / column 5 (use `find` on `td[data-r="2"][data-c="3"]` or coordinates from a screenshot). Type `25` and press Enter. Expected: those 9 cells show `25.13` (25 rounds to raw 130 = 25.125), each outlined; the checks area shows `cal ✓ · fixed on save`; the tree item "Ignition - base advance" shows ●; the status says `Set: 9 cell(s) updated.`
5. Press ⌘Z (`computer` key `cmd+z`). Expected: the original values return, the outline disappears and Redo becomes enabled. Press `cmd+shift+z`. Expected: 25.13 again.
6. Paste through the key sink:

```js
const dt = new DataTransfer();
dt.setData('text/plain', '10\t11\n12\t13');
xdfedit.app.setSel({ r0: 0, c0: 0, r1: 0, c1: 0 });
xdfedit.app.focusGrid();
document.getElementById('keysink').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
[...document.querySelectorAll('#grid tbody tr')].slice(0, 2).map(tr => [...tr.querySelectorAll('td')].slice(0, 2).map(td => td.textContent))
```

Expected: `[["10.13","10.88"],["12.00","13.13"]]` (raw 90, 92, 95, 98).
7. Select row 3 (click its row header), click "Interp ↔", then "Smooth". Expected: status lines `Interpolate: 12 cell(s) updated.` / `Smooth: …` or `…: no change…`, no console errors.
8. Compare: run

```js
const b2 = new Uint8Array(xdfedit.app.state.image.original);
b2[0x75ef2 + 5] ^= 3;
xdfedit.loadCompare(b2, 'test-compare.bin');
document.querySelector('#grid td[data-r="0"][data-c="5"]').title
```

Expected: a tooltip starting `ref ` and containing `Δ`; the chip `vs test-compare.bin ×` appears in the top bar.
9. Raw toggle: click "Raw". Expected: integer cells, step box `1`.
10. `resize_window` preset `mobile`, reload, load the files again: the "Maps" button opens the list as a drawer, the grid scrolls inside its panel, the page body does not scroll sideways. Screenshot. Then `resize_window` `colorScheme: "dark"` and preset `desktop`; screenshot. Reset to light.
11. `read_console_messages` `onlyErrors: true`. Expected: none.

- [ ] **Step 10: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add src/ui/grid.js src/ui/toolbar.js src/ui/app.js build.js
git status --short
git commit -m "Add map grid, selection, clipboard and edit toolbar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 14: 3D surface and 2D curve graphs

**Files:**
- Create: `src/ui/surface3d.js`, `src/ui/graph2d.js`
- Modify: `src/ui/app.js` (imports, `renderGraph`, `wire`)
- Modify: `build.js` (`ORDER`)
- Test: `tests/ui-pure.test.js` (add `niceTicks`)

**Interfaces:**
- Consumes: `setupCanvas, token, rampRgb, css` (Task 11), `normSel` (Task 7), `formatValue, formatAxis` (Task 5).
- Produces:
  - `surface3d.js`: `DEFAULT_CAM = {yaw, pitch, zoom}`, `drawSurface(canvas, {grid, ref, sel, xs, ys, fmtX, fmtY, fmtZ, xLabel, yLabel, zLabel}, cam)`, `attachOrbit(canvas, cam, onChange(persist: boolean), enabled: () => boolean)`.
  - `graph2d.js`: `niceTicks(lo, hi, n = 5) → number[]` (first tick ≤ lo, last tick ≥ hi, at least 2), `drawCurve(canvas, {values, ref, xs, selIdx: [i0, i1]|null, fmtX, fmtY})`.

- [ ] **Step 1: Add the failing `niceTicks` test to `tests/ui-pure.test.js`**

Add the import:

```js
import { niceTicks } from '../src/ui/graph2d.js';
```

Append:

```js
test('niceTicks covers the range with round steps', () => {
  assert.deepEqual(niceTicks(0, 10), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(-23.6, 72), [-40, -20, 0, 20, 40, 60, 80]);
  assert.deepEqual(niceTicks(0, 1), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(niceTicks(5, 5), [5, 6]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/ui-pure.test.js`
Expected: FAIL — `Cannot find module .../src/ui/graph2d.js`.

- [ ] **Step 3: Create `src/ui/graph2d.js`**

```js
// 2D line graph for curves; compare values dashed, selected points marked.
import { setupCanvas, token } from './dom.js';

export function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * mag;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let k = 0; k < 50; k++) {
    const v = Number((start + k * step).toFixed(10));
    ticks.push(v);
    if (v >= hi) break;
  }
  if (ticks.length < 2) ticks.push(Number((ticks[0] + step).toFixed(10)));
  return ticks;
}

function strictlyMonotonic(a) {
  if (a.length < 2) return true;
  const d = Math.sign(a[1] - a[0]);
  if (!d) return false;
  for (let i = 1; i < a.length; i++) if (Math.sign(a[i] - a[i - 1]) !== d) return false;
  return true;
}

export function drawCurve(canvas, d) {
  const { g, width: w, height: h } = setupCanvas(canvas);
  if (w < 40 || h < 40) return;
  const { values, ref, xs, selIdx } = d;
  const n = values.length;
  const numeric = xs.length === n && xs.every(v => typeof v === 'number' && Number.isFinite(v)) && strictlyMonotonic(xs);
  const xv = numeric ? xs : values.map((_, i) => i);
  let x0 = Math.min(...xv), x1 = Math.max(...xv);
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const all = ref ? values.concat(ref) : values;
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const m = { l: 60, r: 16, t: 14, b: 38 };
  const X = v => m.l + ((v - x0) / (x1 - x0)) * (w - m.l - m.r);
  const Y = v => h - m.b - ((v - y0) / (y1 - y0)) * (h - m.t - m.b);
  const fg = token('--fg'), muted = token('--muted'), grid = token('--cell-line'), accent = token('--accent');

  g.font = '11px "JetBrains Mono", ui-monospace, Menlo, monospace';
  g.lineWidth = 1;
  g.strokeStyle = grid;
  g.fillStyle = muted;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const t of ticks) {
    g.beginPath();
    g.moveTo(m.l, Y(t));
    g.lineTo(w - m.r, Y(t));
    g.stroke();
    g.fillText(d.fmtY(t), m.l - 8, Y(t));
  }
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - m.l - m.r) / 58))));
  for (let i = 0; i < n; i += every) g.fillText(d.fmtX(xs[i] ?? i), X(xv[i]), h - m.b + 8);

  const path = (vals, dash, color, width) => {
    g.save();
    g.setLineDash(dash);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    vals.forEach((v, i) => (i ? g.lineTo(X(xv[i]), Y(v)) : g.moveTo(X(xv[i]), Y(v))));
    g.stroke();
    g.restore();
  };
  if (ref) path(ref, [5, 4], muted, 1.5);
  path(values, [], accent, 2);
  values.forEach((v, i) => {
    const on = selIdx && i >= selIdx[0] && i <= selIdx[1];
    g.beginPath();
    g.arc(X(xv[i]), Y(v), on ? 4.5 : 2.5, 0, Math.PI * 2);
    g.fillStyle = on ? accent : fg;
    g.fill();
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && node --test tests/ui-pure.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Create `src/ui/surface3d.js`**

```js
// Canvas 3D surface for maps: shaded quads drawn back to front, the
// selection marked on its vertices, compare values as a dashed wireframe.
import { setupCanvas, token, rampRgb, css } from './dom.js';
import { normSel } from '../ops.js';

export const DEFAULT_CAM = { yaw: -0.65, pitch: 0.62, zoom: 1 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
const LIGHT = unit([0.35, 0.45, 0.82]);

export function drawSurface(canvas, d, cam) {
  const { g, width: w, height: h } = setupCanvas(canvas);
  if (w < 40 || h < 40) return;
  const { grid, ref } = d;
  const rows = grid.length, cols = grid[0].length;
  let lo = Infinity, hi = -Infinity;
  for (const src of ref ? [grid, ref] : [grid]) {
    for (const row of src) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  const span = hi - lo || 1;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const scale = Math.min(w, h) * 0.34 * cam.zoom;
  const ox = w / 2, oy = h / 2 + scale * 0.12;
  // Model space: columns on x in [-1, 1], rows on y in [1, -1], value on z in [-0.6, 0.6].
  const xpos = c => (cols > 1 ? (c / (cols - 1)) * 2 - 1 : 0);
  const ypos = r => (rows > 1 ? 1 - (r / (rows - 1)) * 2 : 0);
  const model = (r, c, v) => [xpos(c), ypos(r), ((v - lo) / span - 0.5) * 1.2];
  // Orthographic view: yaw turns the floor, pitch tilts it towards the viewer.
  const project = ([x, y, z]) => {
    const X = x * cy - y * sy, Y = x * sy + y * cy;
    return { x: ox + X * scale, y: oy - (Y * sp + z * cp) * scale, depth: Y * cp - z * sp };
  };
  const M = grid.map((row, r) => row.map((v, c) => model(r, c, v)));
  const S = M.map(row => row.map(project));

  const quads = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const pts = [S[r][c], S[r][c + 1], S[r + 1][c + 1], S[r + 1][c]];
      quads.push({ r, c, pts, depth: (pts[0].depth + pts[1].depth + pts[2].depth + pts[3].depth) / 4 });
    }
  }
  quads.sort((a, b) => b.depth - a.depth);                // farthest first
  const edge = token('--cell-line'), accent = token('--accent'), muted = token('--muted'), fg = token('--fg');
  g.lineWidth = 0.6;
  g.lineJoin = 'round';
  for (const { r, c, pts } of quads) {
    const n = unit(cross(sub(M[r][c + 1], M[r][c]), sub(M[r + 1][c], M[r][c])));
    const lit = 0.7 + 0.3 * Math.abs(dot(n, LIGHT));
    const t = ((grid[r][c] + grid[r][c + 1] + grid[r + 1][c] + grid[r + 1][c + 1]) / 4 - lo) / span;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fillStyle = css(rampRgb(t, 'plot').map(v => Math.round(v * lit)));
    g.fill();
    g.strokeStyle = edge;
    g.stroke();
  }

  if (ref) {
    const R = ref.map((row, r) => row.map((v, c) => project(model(r, c, v))));
    const line = pts => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    };
    g.save();
    g.setLineDash([4, 3]);
    g.strokeStyle = muted;
    g.lineWidth = 1;
    R.forEach(line);
    for (let c = 0; c < cols; c++) line(R.map(row => row[c]));
    g.restore();
  }

  if (d.sel) {
    const s = normSel(d.sel);
    g.fillStyle = accent;
    for (let r = s.r0; r <= s.r1; r++) {
      for (let c = s.c0; c <= s.c1; c++) {
        const p = S[r]?.[c];
        if (!p) continue;
        g.beginPath();
        g.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // Axis end values just outside the floor, axis names further out, value range top-left.
  const at = (x, y) => project([x, y, -0.6]);
  const put = (p, text) => g.fillText(text, p.x, p.y);
  g.font = '11px "JetBrains Mono", ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = muted;
  put(at(xpos(0), -1.2), d.fmtX(d.xs[0]));
  put(at(xpos(cols - 1), -1.2), d.fmtX(d.xs[cols - 1]));
  put(at(-1.2, ypos(0)), d.fmtY(d.ys[0]));
  put(at(-1.2, ypos(rows - 1)), d.fmtY(d.ys[rows - 1]));
  g.fillStyle = fg;
  if (d.xLabel) put(at(0, -1.42), d.xLabel);
  if (d.yLabel) put(at(-1.42, 0), d.yLabel);
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillStyle = muted;
  g.fillText(`${d.zLabel ? d.zLabel + ': ' : ''}${d.fmtZ(lo)} … ${d.fmtZ(hi)}`, 10, 10);
}

export function attachOrbit(canvas, cam, onChange, enabled) {
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (!enabled()) return;
    drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    cam.yaw = drag.yaw + (e.clientX - drag.x) * 0.01;
    cam.pitch = Math.min(1.5, Math.max(0.05, drag.pitch + (e.clientY - drag.y) * 0.01));
    onChange(false);
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    canvas.classList.remove('dragging');
    onChange(true);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => {
    if (!enabled()) return;
    e.preventDefault();
    cam.zoom = Math.min(3, Math.max(0.4, cam.zoom * Math.exp(-e.deltaY * 0.001)));
    onChange(true);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    if (!enabled()) return;
    Object.assign(cam, DEFAULT_CAM);
    onChange(true);
  });
}
```

- [ ] **Step 6: Add the two modules to `ORDER` in `build.js`**

Replace:

```js
  'ui/grid.js', 'ui/toolbar.js',
```

with:

```js
  'ui/grid.js', 'ui/toolbar.js', 'ui/surface3d.js', 'ui/graph2d.js',
```

- [ ] **Step 7: Update the imports in `src/ui/app.js`**

Replace the table import line (from Task 13) `import { readItem, planWrites, formatValue, defaultStep } from '../table.js';` with:

```js
import { readItem, planWrites, formatValue, formatAxis, defaultStep } from '../table.js';
```

Replace `import { opSet, opAdd, opScale, opInterpolate, opSmooth, opRevert, opPaste, toTsv } from '../ops.js';` with:

```js
import { normSel, opSet, opAdd, opScale, opInterpolate, opSmooth, opRevert, opPaste, toTsv } from '../ops.js';
```

Replace `import { renderToolbar } from './toolbar.js';` with:

```js
import { renderToolbar } from './toolbar.js';
import { drawSurface, attachOrbit, DEFAULT_CAM } from './surface3d.js';
import { drawCurve } from './graph2d.js';
```

- [ ] **Step 8: Replace `renderGraph` in `src/ui/app.js`**

Replace the whole Task 12 function:

```js
function renderGraph() {
  $('graphWrap').hidden = true;
}
```

with:

```js
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
```

- [ ] **Step 9: Attach the orbit control and redraw on resize in `wire()`**

In `src/ui/app.js`, replace:

```js
  document.addEventListener('keydown', onKey);
  attachGrid(app);
```

with:

```js
  document.addEventListener('keydown', onKey);
  attachGrid(app);
  attachOrbit($('graph'), cam, persist => {
    renderGraph();
    if (persist) prefs.set('cam', cam);
  }, () => $('graph').dataset.mode === 'surface');
  new ResizeObserver(() => renderGraph()).observe($('graphWrap'));
```

- [ ] **Step 10: Build and run the full suite**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 11: Check the graphs in the browser pane**

1. Reload `http://127.0.0.1:8766/ArtifactTuner/dist/xdf-editor-local.html`. The example ignition map shows a shaded 3D surface next to the grid (≥ 1200 px wide) or below it, with `Load %` and `rpm` axis names, end values `8`/`100` and `800`/`6560`, the range label top-left, and accent dots on the selected cells. Screenshot.
2. Drag across the canvas (`left_click_drag`). Expected: the surface rotates; after reload the angle is kept.
3. Click "Warm-up enrichment (example)" in the list. Expected: a 2D line from about 1.60 down to about 1.01 over `-30 … 102` °C. Screenshot.
4. Load EKII + EMS2K XDF, select "Ignition - base advance", select cells and press `+` (via `computer` key `+` after clicking a cell). Expected: the surface redraws, a dashed wireframe shows the original values and the hint ends with `dashed: compare values`.
5. Select a curve from the EMS2K list (search `Curve 754E4`). Expected: 2D line, selected point larger.
6. Dark mode (`resize_window` `colorScheme: "dark"`): surface, grid and text stay readable. Screenshot, then switch back to light.
7. `read_console_messages` `onlyErrors: true`. Expected: none.

- [ ] **Step 12: Run the full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm test`
Expected: all tests pass.

```bash
git add src/ui/surface3d.js src/ui/graph2d.js src/ui/app.js build.js tests/ui-pure.test.js
git status --short
git commit -m "Add 3D surface and 2D curve graphs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` lists only this task's files before the commit.

---

### Task 15: README, final check, Artifact publish, push and PR

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the finished build (`dist/xdf-editor.html`, `dist/xdf-editor-local.html`).
- Produces: a published private claude.ai Artifact "XDF Map Editor", the pushed branch `feat/xdf-map-editor` and a PR into `main`.

- [ ] **Step 1: Create `README.md`**

````markdown
# ArtifactTuner — XDF Map Editor

View and edit ECU maps in your browser from a TunerPro **XDF** definition and a **BIN** read. One self-contained HTML page: no install, and your files never leave your computer.

## What it does

- Opens any TunerPro XDF: tables (maps and curves) and constants; 8/16/32-bit, signed/unsigned, little/big-endian, 32-bit float, strides, base offset; axes from data, labels or index. Unsupported items (linked axes, multi-variable equations, flags) are listed in a load report and skipped.
- Shows each map as a heat-coloured grid with its axes, plus a rotatable 3D surface (maps) or a line graph (curves). Physical or raw values.
- Edits: set, ± step, × %, interpolate (rows, columns, corners), smooth, revert, copy/paste with Excel or Numbers, undo/redo.
- Compares against the loaded file or another BIN of the same size: changed cells are outlined and the map list marks changed maps.
- Saves the edited BIN with a change log.

## Checksums

Checksum correction is per ECU, through plugins in `src/checksums/`.

- **Siemens EMS2000** (Mini): the calibration CRC is recomputed on save. Boot and program CRCs are only checked, never changed. If you edit bytes inside a boot or program checksum range, the file is saved with `_CHECKSUM-NOT-FIXED` in its name.
- **Any other ECU**: the file is saved unchanged apart from your edits, named `_CHECKSUM-NOT-FIXED`. Correct the checksum in WinOLS or your flashing tool before flashing.

Every save is checked again before it is offered: if the corrected checksum does not verify, or any byte other than your edits and the checksum changed, nothing is saved.

## Use it

- **In claude.ai**: open the published Artifact. Saving gives you a `.zip` with the `.bin` and `changes.txt` (the Artifact sandbox does not allow saving `.bin` files directly).
- **Locally**: `npm run build`, then open `dist/xdf-editor-local.html` in Safari or Chrome. Saving gives you the `.bin` directly.

Drop the XDF and the BIN anywhere on the page, or use Open XDF / Open BIN.

## Develop

Requires Node 20+ and Python 3. No npm dependencies.

```bash
npm test          # node --test
npm run build     # writes dist/
```

The tests run against private ECU files that are not in this repository. They are looked up in the folder above the repository, or in the folder named by `ARTIFACT_TUNER_DATA`. Never commit BIN or XDF files or data decoded from them.

Design and implementation notes: `docs/`.

## Disclaimer

Writing a modified calibration to an engine ECU can damage the engine. Verify every change with logging before you rely on it.
````

- [ ] **Step 2: Final build, full suite and commit**

Run: `cd /Users/valdiskikusts/MSV70/ArtifactTuner && npm run build && npm test`
Expected: build succeeds; all tests pass.

```bash
git add README.md
git status --short
git commit -m "Add README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Local save check in the browser pane**

Reload `http://127.0.0.1:8766/ArtifactTuner/dist/xdf-editor-local.html`, load EKII + EMS2K XDF, edit one ignition cell, then:

```js
const r = xdfedit.prepareSave();
({ name: r.binName, fixed: r.fixed, notCorrected: r.notCorrected, cal: r.after.cal })
```

Expected: `name: "TB62572_EMS2K_111441901203EHC3_fullread_EKII_edit.bin"`, `fixed: ["cal"]`, `notCorrected: false`, `cal.ok: true`. Click Save BIN. Expected status: `Saved TB62572_…_EKII_edit.bin with the cal checksum corrected.` (the browser-pane download itself is not inspected; the bytes are covered by `tests/save.test.js`).

- [ ] **Step 4: Publish the Artifact** (main session only: needs the Artifact tool)

Call the Artifact tool with `file_path: /Users/valdiskikusts/MSV70/ArtifactTuner/dist/xdf-editor.html`, `capabilities: {"downloads": true}`, `icon: "table"`, `description: "View and edit ECU maps from a TunerPro XDF and a BIN, with EMS2000 calibration checksum correction."`. Report the URL to the user, and say in one line what was exercised (load, edit, compare, graphs, local save) and what was not (the zip save prompt inside claude.ai, which needs the user's click).

- [ ] **Step 5: Push the branch and open a PR**

```bash
git push -u origin feat/xdf-map-editor
gh pr create --base main --head feat/xdf-map-editor --title "XDF map editor" --body "$(cat <<'EOF'
Browser map viewer/editor for TunerPro XDF + BIN files, built from docs/2026-10-24-xdf-map-editor-plan.md.

- General XDF engine (byte order from mmedtypeflags, linear and monotonic equations inverted for writing)
- Grid editing, compare, undo/redo, TSV copy/paste, 3D surface and 2D curve
- EMS2000 checksum plugin: calibration CRC corrected on save; boot/prog verify-only; self-check before every save
- Single-file build: dist/xdf-editor.html (Artifact, saves .zip) and dist/xdf-editor-local.html (saves .bin)

Tests run against private ECU files kept outside the repository (see README).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: the PR URL is printed. Then use the ccd_pr tools (`get_status`, `bind_pr` if needed) as the session instructions describe.

---

## Self-review notes

- Spec §1 scope → Tasks 1–15; out-of-scope items (axis editing, linked axes, multi-variable MATH, `XDFFLAG`, other checksum plugins, autosave) have no tasks and are reported as skipped/ignored by `parseXdf`.
- Spec §2 facts → Global Constraints and Task 4 tests (big-endian MSV70 axis, 1-based categories, read-only zero-slope items).
- Spec §4 checksum rules → Task 8 (plugin, `fixable: ['cal']`), Task 10 (policy, self-check, names, change log), Task 12 (pill, banner, zip vs bin delivery).
- Spec §5 UI → Tasks 11–14; §6 errors → Tasks 4, 6, 10, 12; §7 tests 1–7 → Tasks 1, 4, 5, 8, 9, 10; UI verification → Tasks 12–15.
- Spec §8 risks (file input, drag-drop and copy/paste inside the Artifact sandbox) → checked at the Task 15 publish; the local file is the fallback.
