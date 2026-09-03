import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, gridFromRows } from "@zenith/core";
import { packSpritesheet } from "@/lib/spritesheet";
import { toAse, toGpl, toHexList, toPaintNetTxt, toPal, toStripIndices } from "./palette";
import { encodeIndexedPng } from "./png";
import { exportForEngine } from "./engines";

const PALETTE = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];

/** PNG bytes as latin-1 text, for locating chunk names. */
function asText(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
}

describe("palette formats", () => {
  test("GPL carries the header GIMP and Aseprite expect", () => {
    const gpl = toGpl(PALETTE, "Game Boy");
    expect(gpl.startsWith("GIMP Palette\n")).toBe(true);
    expect(gpl).toContain("Name: Game Boy");
    expect(gpl).toContain(" 15  56  15\t#0f380f");
  });

  test("JASC PAL declares its count and uses CRLF", () => {
    const lines = toPal(PALETTE).split("\r\n");
    expect(lines[0]).toBe("JASC-PAL");
    expect(lines[1]).toBe("0100");
    expect(lines[2]).toBe("4");
    expect(lines[3]).toBe("15 56 15");
  });

  test("hex list is bare lowercase hex without the hash", () => {
    expect(toHexList(PALETTE)).toBe("0f380f\n306230\n8bac0f\n9bbc0f\n");
  });

  test("Paint.NET entries carry an opaque alpha prefix", () => {
    const txt = toPaintNetTxt(PALETTE);
    expect(txt).toContain("FF0F380F");
    expect(txt.startsWith(";")).toBe(true);
  });

  test("ASE is big-endian binary beginning with the ASEF magic", () => {
    const ase = toAse(PALETTE);
    expect(Array.from(ase.slice(0, 4))).toEqual([0x41, 0x53, 0x45, 0x46]);
    expect(Array.from(ase.slice(8, 12))).toEqual([0, 0, 0, 4]);
  });

  test("strip indices run 0..n-1 so the PNG encoder can draw them", () => {
    expect(Array.from(toStripIndices(PALETTE))).toEqual([0, 1, 2, 3]);
  });

  test("every format rejects an empty palette", () => {
    for (const encode of [toGpl, toPal, toHexList, toPaintNetTxt, toAse, toStripIndices]) {
      expect(() => encode([])).toThrow(/at least one colour/);
    }
  });

  test("every format rejects a malformed colour", () => {
    for (const encode of [toGpl, toPal, toHexList, toPaintNetTxt, toAse]) {
      expect(() => encode(["red"])).toThrow(/not a #rrggbb colour/);
    }
  });
});

describe("indexed PNG", () => {
  const grid = () => gridFromRows(["0123", "3210", "0.2.", "1.3."]);

  test("writes the PNG signature", () => {
    const png = encodeIndexedPng(grid(), PALETTE);
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test("declares colour type 3 - indexed, not RGB", () => {
    // The whole point: the file stays indexed, so a shader can swap palettes.
    const png = encodeIndexedPng(grid(), PALETTE);
    const ihdr = asText(png).indexOf("IHDR");
    expect(png[ihdr + 12]).toBe(8); // bit depth
    expect(png[ihdr + 13]).toBe(3); // colour type: indexed
  });

  test("includes PLTE and tRNS chunks and ends with IEND", () => {
    const png = encodeIndexedPng(grid(), PALETTE);
    const text = asText(png);
    expect(text).toContain("PLTE");
    expect(text).toContain("tRNS");
    // IEND is the final chunk: name, then its 4-byte CRC.
    expect(text.slice(-8, -4)).toBe("IEND");
  });

  test("declares the scaled dimensions", () => {
    const png = encodeIndexedPng(grid(), PALETTE, { scale: 4 });
    const ihdr = asText(png).indexOf("IHDR");
    const width = ((png[ihdr + 6] as number) << 8) | (png[ihdr + 7] as number);
    const height = ((png[ihdr + 10] as number) << 8) | (png[ihdr + 11] as number);
    expect(width).toBe(16);
    expect(height).toBe(16);
  });

  test("reserves a palette slot for transparency past the real colours", () => {
    const png = encodeIndexedPng(grid(), PALETTE);
    const trns = asText(png).indexOf("tRNS") + 4;
    expect(Array.from(png.slice(trns, trns + 5))).toEqual([255, 255, 255, 255, 0]);
  });

  test("is deterministic", () => {
    const first = Array.from(encodeIndexedPng(grid(), PALETTE));
    for (let n = 0; n < 3; n += 1) {
      expect(Array.from(encodeIndexedPng(grid(), PALETTE))).toEqual(first);
    }
  });

  test("handles a fully transparent grid", () => {
    const png = encodeIndexedPng(createGrid(4, 4, TRANSPARENT), PALETTE);
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(asText(png).slice(-8, -4)).toBe("IEND");
  });

  test("rejects a fractional or zero scale rather than resampling", () => {
    expect(() => encodeIndexedPng(grid(), PALETTE, { scale: 0 })).toThrow(/positive integer/);
  });

  test("rejects an empty palette and one over 256", () => {
    expect(() => encodeIndexedPng(grid(), [])).toThrow(/at least one palette colour/);
    const huge = Array.from({ length: 257 }, () => "#000000");
    expect(() => encodeIndexedPng(grid(), huge)).toThrow(/at most 256/);
  });
});

describe("engine bundles", () => {
  const atlas = () =>
    packSpritesheet(
      [
        { name: "walk0", grid: gridFromRows(["01", "23"]), tag: "walk", durationMs: 100 },
        { name: "walk1", grid: gridFromRows(["10", "32"]), tag: "walk", durationMs: 100 },
      ],
      { columns: 2 }
    ).atlas;

  test("Godot turns filtering and mipmaps off - the classic blur cause", () => {
    const bundle = exportForEngine("godot", { name: "hero", atlas: atlas() });
    const importFile = bundle.files.find((file) => file.path.endsWith(".import"));
    expect(importFile?.contents).toContain("mipmaps/generate=false");
    expect(importFile?.contents).toContain("compress/mode=0");
  });

  test("Unity sets Point filtering, no compression, and pre-slices the sheet", () => {
    const bundle = exportForEngine("unity", { name: "hero", atlas: atlas(), pixelsPerUnit: 16 });
    const meta = bundle.files[0]?.contents as string;
    expect(meta).toContain("filterMode: 0");
    expect(meta).toContain("textureCompression: 0");
    expect(meta).toContain("spritePixelsToUnits: 16");
    expect(meta).toContain("name: walk0");
  });

  test("Unity flips y, because its texture origin is bottom-left", () => {
    // The atlas is top-left; getting this wrong slices the wrong rows silently.
    const bundle = exportForEngine("unity", { name: "hero", atlas: atlas() });
    expect(bundle.files[0]?.contents).toContain("y: 0");
  });

  test("Phaser emits a loadable atlas and warns about pixelArt", () => {
    const bundle = exportForEngine("phaser", { name: "hero", atlas: atlas() });
    const json = bundle.files.find((file) => file.path.endsWith(".json"));
    expect(() => JSON.parse(json?.contents as string)).not.toThrow();
    const snippet = bundle.files.find((file) => file.path.endsWith(".js"));
    expect(snippet?.contents).toContain("this.load.atlas");
    expect(snippet?.contents).toContain("pixelArt: true");
  });

  test("Phaser generates an animation per tag", () => {
    const bundle = exportForEngine("phaser", { name: "hero", atlas: atlas() });
    const snippet = bundle.files.find((file) => file.path.endsWith(".js"));
    expect(snippet?.contents).toContain("key: 'walk'");
    expect(snippet?.contents).toContain("frameRate: 10");
  });

  test("new spritesheet animations export at 4 fps", () => {
    const generated = packSpritesheet([
      { name: "idle0", grid: gridFromRows(["0"]), tag: "idle" },
      { name: "idle1", grid: gridFromRows(["1"]), tag: "idle" },
    ]).atlas;
    const bundle = exportForEngine("phaser", { name: "hero", atlas: generated });
    expect(bundle.files.find((file) => file.path.endsWith(".js"))?.contents).toContain("frameRate: 4");
  });

  test("LOVE applies nearest filtering, without which it blurs everything", () => {
    const bundle = exportForEngine("love", { name: "hero", atlas: atlas() });
    expect(bundle.files[0]?.contents).toContain("setFilter('nearest', 'nearest')");
    expect(bundle.files[0]?.contents).toContain("newQuad");
  });

  test("every bundle carries instructions and newline-terminated files", () => {
    for (const engine of ["godot", "unity", "phaser", "love"] as const) {
      const bundle = exportForEngine(engine, { name: "hero", atlas: atlas() });
      expect(bundle.files.length).toBeGreaterThan(0);
      expect(bundle.instructions.length).toBeGreaterThan(20);
      for (const file of bundle.files) {
        expect(file.contents.endsWith("\n")).toBe(true);
      }
    }
  });

  test("rejects an empty name", () => {
    expect(() => exportForEngine("godot", { name: "  ", atlas: atlas() })).toThrow(/non-empty name/);
  });

  test("is deterministic", () => {
    const first = JSON.stringify(exportForEngine("godot", { name: "hero", atlas: atlas() }));
    for (let n = 0; n < 3; n += 1) {
      expect(JSON.stringify(exportForEngine("godot", { name: "hero", atlas: atlas() }))).toBe(first);
    }
  });
});
