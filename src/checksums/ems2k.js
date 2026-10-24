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
