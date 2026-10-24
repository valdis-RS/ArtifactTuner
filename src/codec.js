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
