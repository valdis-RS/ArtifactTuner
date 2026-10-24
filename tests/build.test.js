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
