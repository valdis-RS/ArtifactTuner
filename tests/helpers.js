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
