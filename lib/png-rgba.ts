import { inflateSync } from "node:zlib";

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Decodes a non-interlaced 8-bit RGBA PNG. Other PNG kinds return null. */
export function decodePngRgba(bytes: Uint8Array): Raster | null {
  if (bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bit = 0;
  let color = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) return null;
    if (type === "IHDR") {
      width = readUint32(bytes, start);
      height = readUint32(bytes, start + 4);
      bit = bytes[start + 8];
      color = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, end));
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  if (bit !== 8 || color !== 6 || interlace !== 0 || width < 1 || height < 1) return null;
  const packed = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of idat) {
    packed.set(part, cursor);
    cursor += part.length;
  }
  const inflated = inflateSync(packed);
  const stride = width * 4;
  const data = new Uint8ClampedArray(width * height * 4);
  let source = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source];
    source += 1;
    const row = inflated.subarray(source, source + stride);
    source += stride;
    const out = new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? out[i - 4] : 0;
      const up = prev[i];
      const ul = i >= 4 ? prev[i - 4] : 0;
      const raw = row[i];
      if (filter === 0) out[i] = raw;
      else if (filter === 1) out[i] = (raw + left) & 255;
      else if (filter === 2) out[i] = (raw + up) & 255;
      else if (filter === 3) out[i] = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) out[i] = (raw + paeth(left, up, ul)) & 255;
      else return null;
    }
    data.set(out, y * stride);
    prev = out;
  }
  return { width, height, data };
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function paeth(left: number, up: number, ul: number): number {
  const estimate = left + up - ul;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - ul);
  if (dl <= du && dl <= dul) return left;
  if (du <= dul) return up;
  return ul;
}
