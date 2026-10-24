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
