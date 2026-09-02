import { TRANSPARENT, type Cell, type Grid } from "@zenith/core";

/**
 * Animated GIF encoding.
 *
 * GIF is itself an indexed format with a global colour table, which is exactly
 * what a Zenith document already is — so encoding is a direct write with no
 * quantisation step and no colour loss. Every other export format in this app
 * has to flatten indices to RGB first; this one does not.
 *
 * Written by hand rather than pulled from a dependency: the format is small and
 * fully specified, our input is already in its native shape, and a GIF encoder
 * that assumes RGBA input would undo the very thing that makes this cheap.
 *
 * Spec: GIF89a, https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 */

/** GIF colour tables are a power of two, minimum 2 entries. */
function tableSize(colours: number): { entries: number; bits: number } {
  let bits = 1;
  while (1 << bits < Math.max(2, colours)) {
    bits += 1;
  }
  return { entries: 1 << bits, bits };
}

class ByteWriter {
  #bytes: number[] = [];

  byte(value: number): void {
    this.#bytes.push(value & 0xff);
  }

  short(value: number): void {
    this.#bytes.push(value & 0xff, (value >> 8) & 0xff);
  }

  ascii(text: string): void {
    for (const character of text) {
      this.#bytes.push(character.charCodeAt(0));
    }
  }

  bytes(values: readonly number[]): void {
    for (const value of values) {
      this.#bytes.push(value & 0xff);
    }
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

/**
 * GIF's variable-width LZW.
 *
 * Codes grow from `minimumCodeSize + 1` bits and reset when the table fills, so
 * the packing is bit-level and little-endian within each byte. Output is
 * written in sub-blocks of at most 255 bytes, each prefixed by its length.
 */
function lzwCompress(indices: Uint8Array, minimumCodeSize: number): number[] {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;

  let codeSize = minimumCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = new Map<string, number>();

  const output: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;

  const emit = (code: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  const resetDictionary = (): void => {
    dictionary = new Map<string, number>();
    nextCode = endCode + 1;
    codeSize = minimumCodeSize + 1;
  };

  emit(clearCode);
  resetDictionary();

  let previous = String(indices[0] ?? 0);

  for (let i = 1; i < indices.length; i += 1) {
    const next = String(indices[i]);
    const combined = `${previous},${next}`;

    if (dictionary.has(combined)) {
      previous = combined;
      continue;
    }

    emit(codeFor(previous, dictionary, clearCode));
    dictionary.set(combined, nextCode);
    nextCode += 1;

    if (nextCode > (1 << codeSize) && codeSize < 12) {
      codeSize += 1;
    } else if (nextCode > 0xfff) {
      // Table is full: tell the decoder to reset, or the two sides diverge.
      emit(clearCode);
      resetDictionary();
    }

    previous = next;
  }

  emit(codeFor(previous, dictionary, clearCode));
  emit(endCode);

  if (bitCount > 0) {
    output.push(bitBuffer & 0xff);
  }

  return output;
}

/** Single characters are their own code; longer sequences come from the dictionary. */
function codeFor(sequence: string, dictionary: Map<string, number>, clearCode: number): number {
  const direct = dictionary.get(sequence);
  if (direct !== undefined) {
    return direct;
  }
  const value = Number(sequence);
  return Number.isNaN(value) ? clearCode : value;
}

function writeSubBlocks(writer: ByteWriter, data: readonly number[]): void {
  for (let offset = 0; offset < data.length; offset += 255) {
    const chunk = data.slice(offset, offset + 255);
    writer.byte(chunk.length);
    writer.bytes(chunk);
  }
  writer.byte(0);
}

export interface GifOptions {
  /** Milliseconds per frame. GIF stores hundredths, so this rounds. */
  readonly delayMs?: number | readonly number[];
  /** 0 loops forever, which is what a sprite cycle wants. */
  readonly loops?: number;
  /** Nearest-neighbour upscale, so the result is legible at a glance. */
  readonly scale?: number;
}

export function encodeGif(
  frames: readonly Grid[],
  palette: readonly string[],
  options: GifOptions = {}
): Uint8Array {
  if (frames.length === 0) {
    throw new Error("An animated GIF needs at least one frame.");
  }

  const first = frames[0] as Grid;
  for (const frame of frames) {
    if (frame.width !== first.width || frame.height !== first.height) {
      throw new Error("Every frame must share the document's dimensions.");
    }
  }

  const scale = Math.max(1, Math.trunc(options.scale ?? 1));
  const width = first.width * scale;
  const height = first.height * scale;

  // One extra slot for transparency, which GIF expresses as a palette index
  // rather than an alpha channel.
  const transparentIndex = palette.length;
  const { entries, bits } = tableSize(palette.length + 1);

  const writer = new ByteWriter();
  writer.ascii("GIF89a");
  writer.short(width);
  writer.short(height);
  writer.byte(0x80 | (bits - 1)); // global table present, colour resolution, table size
  writer.byte(transparentIndex);
  writer.byte(0);

  for (let index = 0; index < entries; index += 1) {
    const hex = palette[index];
    if (hex === undefined) {
      writer.bytes([0, 0, 0]);
    } else {
      const value = Number.parseInt(hex.slice(1), 16);
      writer.bytes([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
    }
  }

  // Netscape extension — the only way to express looping in GIF.
  writer.ascii("!");
  writer.byte(0xff);
  writer.byte(11);
  writer.ascii("NETSCAPE2.0");
  writer.byte(3);
  writer.byte(1);
  writer.short(options.loops ?? 0);
  writer.byte(0);

  const minimumCodeSize = Math.max(2, bits);

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex] as Grid;
    const configuredDelay = Array.isArray(options.delayMs) ? options.delayMs[frameIndex] : options.delayMs;
    const delay = Math.max(1, Math.round((configuredDelay ?? 100) / 10));
    writer.ascii("!");
    writer.byte(0xf9);
    writer.byte(4);
    // Disposal 2 (restore to background) plus the transparency flag: without
    // clearing, a transparent pixel shows whatever the previous frame drew.
    writer.byte(0x08 | 0x01);
    writer.short(delay);
    writer.byte(transparentIndex);
    writer.byte(0);

    writer.ascii(",");
    writer.short(0);
    writer.short(0);
    writer.short(width);
    writer.short(height);
    writer.byte(0);

    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.floor(y / scale);
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.floor(x / scale);
        const cell = (frame.cells[sourceY * frame.width + sourceX] ?? TRANSPARENT) as Cell;
        pixels[y * width + x] = cell === TRANSPARENT ? transparentIndex : cell;
      }
    }

    writer.byte(minimumCodeSize);
    writeSubBlocks(writer, lzwCompress(pixels, minimumCodeSize));
  }

  writer.ascii(";");
  return writer.toUint8Array();
}
