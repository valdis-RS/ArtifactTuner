import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bundle, build } from '../build.js';
import { tmpFile } from './helpers.js';

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
  fs.writeFileSync(path.join(dir, 'f.js'), "import { nope } from './a.js';\n");
  assert.throws(() => bundle(dir, ['a.js', 'f.js']), /a\.js does not export nope/);
  fs.writeFileSync(path.join(dir, 'g.js'), 'export let n = 1;\n');
  assert.throws(() => bundle(dir, ['g.js']), /unsupported export/);
});

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
