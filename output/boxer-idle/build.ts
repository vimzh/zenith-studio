// Convert the generated four-cell sheet through Zenith's pixeliser and export a 4fps loop.
import assert from "node:assert/strict";
import { createGrid, encodeGrid } from "../../packages/core/src/index";
import { decodePng } from "../../apps/web/scripts/png-decode";
import { pixelize } from "../../apps/web/src/lib/pixelize/pipeline";
import { encodeIndexedPng } from "../../apps/web/src/lib/export/png";
import { encodeGif } from "../../apps/web/src/lib/animation/gif";

const input = Bun.argv[2];
assert(input, "Pass the generated square PNG path.");
const source = await Bun.file(input).bytes();
const raster = decodePng(source);
assert.equal(raster.width, 1254, "This extraction layout is measured against the saved source.");
assert.equal(raster.height, 1254);
// The model's row gap is at y=578–610, not the mathematical halfway line.
// Separate there; align both rows' planted boots to y=625 without normalising
// individual poses (which would erase the hop). Add identical transparent padding.
const aligned = { width: 1408, height: 1408, data: new Uint8ClampedArray(1408 * 1408 * 4) };
for (let frame = 0; frame < 4; frame++) {
  const column = frame % 2;
  const row = Math.floor(frame / 2);
  const fromY = row === 0 ? 0 : 595;
  const endY = row === 0 ? 595 : 1254;
  for (let y = fromY; y < endY; y++) {
    const toY = row * 704 + y - row * 631 + 48;
    const from = (y * 1254 + column * 627) * 4;
    const to = (toY * 1408 + column * 704 + 38) * 4;
    aligned.data.set(raster.data.subarray(from, from + 627 * 4), to);
  }
}
const { grid: sheet, palette } = pixelize(aligned, { targetWidth: 256, targetHeight: 256, maxColors: 16 });
const frames = Array.from({ length: 4 }, (_, frame) => {
  const grid = createGrid(128, 128);
  const x = (frame % 2) * 128;
  const y = Math.floor(frame / 2) * 128;
  for (let row = 0; row < 128; row++) {
    grid.cells.set(sheet.cells.subarray((y + row) * 256 + x, (y + row) * 256 + x + 128), row * 128);
  }
  assert(grid.cells.some(cell => cell >= 0), `Frame ${frame} is empty.`);
  for (let edge = 0; edge < 128; edge++) {
    assert.equal(grid.cells[edge], -1, `Frame ${frame} touches its top edge.`);
    assert.equal(grid.cells[127 * 128 + edge], -1, `Frame ${frame} touches its bottom edge.`);
    assert.equal(grid.cells[edge * 128], -1, `Frame ${frame} touches its left edge.`);
    assert.equal(grid.cells[edge * 128 + 127], -1, `Frame ${frame} touches its right edge.`);
  }
  return grid;
});
assert.equal(new Set(frames.map(encodeGrid)).size, 4, "Expected four distinct poses.");
await Bun.write(`${import.meta.dir}/source.png`, source);
await Bun.write(`${import.meta.dir}/boxer-idle.json`, JSON.stringify({ name: "Boxer — idle hop", palette, frames: frames.map(encodeGrid), durationMs: 250 }));
await Bun.write(`${import.meta.dir}/boxer-idle-sheet.png`, encodeIndexedPng(sheet, palette, { scale: 2 }));
await Bun.write(`${import.meta.dir}/boxer-idle.gif`, encodeGif(frames, palette, { scale: 4, delayMs: 250 }));
console.log(`Exported four distinct 128×128 frames, ${palette.length} colours, 250ms per frame (4fps, 1 second loop); all canvas edges transparent.`);
