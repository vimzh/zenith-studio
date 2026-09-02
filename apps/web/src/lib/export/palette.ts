/**
 * Palette file formats.
 *
 * Six formats, matching what Lospec offers, because that is what this
 * ecosystem's tools already read. A palette leaving Zenith should open in
 * whatever the artist already uses — Aseprite, GIMP, Paint.NET, Photoshop —
 * without a conversion step.
 */

export type PaletteFormat = "gpl" | "pal" | "hex" | "txt" | "ase" | "png-strip";

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function assertPalette(colors: readonly string[]): void {
  if (colors.length === 0) {
    throw new Error("A palette file needs at least one colour.");
  }
  for (const hex of colors) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
      throw new Error(`'${hex}' is not a #rrggbb colour.`);
    }
  }
}

/** GIMP palette — read by GIMP, Krita, Aseprite and Inkscape. */
export function toGpl(colors: readonly string[], name = "Zenith Studio"): string {
  assertPalette(colors);
  const lines = ["GIMP Palette", `Name: ${name}`, "Columns: 8", "#"];
  for (const hex of colors) {
    const [r, g, b] = channels(hex);
    // Columns are width-3 and space-separated; GIMP's parser is positional.
    lines.push(
      `${String(r).padStart(3, " ")} ${String(g).padStart(3, " ")} ${String(b).padStart(3, " ")}\t${hex}`
    );
  }
  return `${lines.join("\n")}\n`;
}

/** JASC PAL — Paint Shop Pro's format, and the one most engines' importers accept. */
export function toPal(colors: readonly string[]): string {
  assertPalette(colors);
  const lines = ["JASC-PAL", "0100", String(colors.length)];
  for (const hex of colors) {
    lines.push(channels(hex).join(" "));
  }
  // JASC-PAL is a DOS-era format and its parsers expect CRLF.
  return `${lines.join("\r\n")}\r\n`;
}

/** Plain hex list, one per line — the Lospec interchange format. */
export function toHexList(colors: readonly string[]): string {
  assertPalette(colors);
  return `${colors.map((hex) => hex.slice(1).toLowerCase()).join("\n")}\n`;
}

/** Paint.NET palette — hex with an alpha prefix, comments allowed. */
export function toPaintNetTxt(colors: readonly string[]): string {
  assertPalette(colors);
  const lines = ["; Zenith Studio palette", "; Paint.NET Palette File"];
  for (const hex of colors) {
    lines.push(`FF${hex.slice(1).toUpperCase()}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Adobe swatch exchange, the binary one.
 *
 * Big-endian throughout, colour names are UTF-16BE and null-terminated, and
 * each channel is a 32-bit float in 0–1 rather than a byte.
 */
export function toAse(colors: readonly string[], name = "Zenith"): Uint8Array {
  assertPalette(colors);

  const bytes: number[] = [];
  const u16 = (value: number) => bytes.push((value >> 8) & 0xff, value & 0xff);
  const u32 = (value: number) =>
    bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  const f32 = (value: number) => {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setFloat32(0, value, false);
    bytes.push(...new Uint8Array(buffer));
  };

  bytes.push(0x41, 0x53, 0x45, 0x46); // "ASEF"
  u16(1);
  u16(0);
  u32(colors.length);

  colors.forEach((hex, index) => {
    const label = `${name}-${String(index)}`;
    const nameLength = label.length + 1; // trailing null

    u16(0x0001); // colour entry
    u32(2 + nameLength * 2 + 4 + 12 + 2); // block length
    u16(nameLength);
    for (const character of label) {
      u16(character.charCodeAt(0));
    }
    u16(0); // null terminator

    bytes.push(0x52, 0x47, 0x42, 0x20); // "RGB "
    for (const channel of channels(hex)) {
      f32(channel / 255);
    }
    u16(0); // global colour
  });

  return Uint8Array.from(bytes);
}

/** Indices of a 1px-tall strip, for the PNG encoder. Universally importable. */
export function toStripIndices(colors: readonly string[]): Int8Array {
  assertPalette(colors);
  const cells = new Int8Array(colors.length);
  for (let i = 0; i < colors.length; i += 1) {
    cells[i] = i;
  }
  return cells;
}

export function paletteFilename(format: PaletteFormat, base = "palette"): string {
  const extension = format === "png-strip" ? "png" : format;
  return `${base}.${extension}`;
}
