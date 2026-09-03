import { inflateSync } from "node:zlib";
import type { RasterImage } from "../src/lib/pixelize";

/**
 * PNG decoding outside a browser.
 *
 * `decodeBase64Png` uses `createImageBitmap`, which is the one step of the
 * generation pipeline that needs a DOM — everything after it is pure TypeScript
 * over byte arrays by design. This stands in for exactly that step so a pack
 * can be generated from a script, and it is tested against the product's own
 * encoder at the size a model actually returns.
 */

/**
 * Minimal PNG decode: 8-bit RGB or RGBA, non-interlaced.
 *
 * Every byte here mirrors what the browser gets from `createImageBitmap`, so
 * the pixeliser downstream sees the same raster it would in the app. Anything
 * outside that narrow shape throws rather than guessing — a silently
 * misdecoded image would produce plausible, wrong art.
 */
export function decodePng(bytes: Uint8Array): RasterImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) throw new Error("Not a PNG.");

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const start = offset + 8;
    if (type === "IHDR") {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      const depth = bytes[start + 8];
      colorType = bytes[start + 9]!;
      if (depth !== 8) throw new Error(`Only 8-bit PNGs are supported; this is ${String(depth)}-bit.`);
      if (bytes[start + 12] !== 0) throw new Error("Interlaced PNGs are not supported.");
      if (colorType !== 2 && colorType !== 6) throw new Error(`Unsupported PNG colour type ${String(colorType)}.`);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }
    offset = start + length + 4;
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((part) => Buffer.from(part)))));
  const out = new Uint8ClampedArray(width * height * 4);
  const line = new Uint8Array(stride);
  const previous = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const source = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? line[i - channels]! : 0;
      const up = previous[i]!;
      const upLeft = i >= channels ? previous[i - channels]! : 0;
      const value = source[i]!;
      // The five PNG filters, byte for byte from the spec.
      line[i] =
        filter === 0 ? value
        : filter === 1 ? (value + left) & 0xff
        : filter === 2 ? (value + up) & 0xff
        : filter === 3 ? (value + ((left + up) >> 1)) & 0xff
        : (() => {
            const p = left + up - upLeft;
            const dl = Math.abs(p - left);
            const du = Math.abs(p - up);
            const dul = Math.abs(p - upLeft);
            return (value + (dl <= du && dl <= dul ? left : du <= dul ? up : upLeft)) & 0xff;
          })();
    }
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 4;
      const from = x * channels;
      out[to] = line[from]!;
      out[to + 1] = line[from + 1]!;
      out[to + 2] = line[from + 2]!;
      out[to + 3] = channels === 4 ? line[from + 3]! : 255;
    }
    previous.set(line);
  }

  return { width, height, data: out };
}
