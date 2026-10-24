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
