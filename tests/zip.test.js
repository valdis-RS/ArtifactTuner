import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
    "assert z.getinfo('a_edit.bin').compress_type == zipfile.ZIP_STORED",
    "assert z.getinfo('a_edit.bin').flag_bits & 0x800",
    "assert z.namelist() == ['a_edit.bin', 'changes.txt'], z.namelist()",
    "assert z.read('a_edit.bin') == open(sys.argv[2], 'rb').read()",
    "assert z.read('changes.txt').decode() == 'hello \\u00e4nd bye\\n'",
    "assert z.getinfo('a_edit.bin').date_time == (2026, 10, 24, 15, 30, 10), z.getinfo('a_edit.bin').date_time",
    "print('ok')",
  ].join('\n');
  assert.equal(execFileSync('python3', ['-c', py, zp, ref], { encoding: 'utf8' }).trim(), 'ok');
});

test('unzip extracts a non-ASCII entry name with a regular file mode', () => {
  const name = 'Ünïcödé_日本語_edit.bin';
  const zp = tmpFile('n.zip', zip([{ name, bytes: Uint8Array.from([1, 2, 3, 250]) }]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-tuner-unzip-'));
  execFileSync('unzip', ['-q', zp, '-d', dir]);
  const out = path.join(dir, name);
  assert.deepEqual([...fs.readFileSync(out)], [1, 2, 3, 250]);
  assert.equal(fs.statSync(out).mode & 0o777, 0o644);
});
