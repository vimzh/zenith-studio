// Render the actual browser-generated indexed grids without smoothing or redrawing.
import { createGrid, decodeGrid } from "../../packages/core/src/index";
import { encodeIndexedPng } from "../../apps/web/src/lib/export/png";
import { mirrorGrid } from "../../apps/web/src/lib/directions/model";
import { encodeGif } from "../../apps/web/src/lib/animation/gif";
import south from "../../apps/web/src/lib/webmcp/fixtures/qa-merchant.json";
import east from "../../apps/web/src/lib/webmcp/fixtures/qa-merchant-east.json";

for (const [name, asset] of [["south", south], ["east", east]] as const) {
  for (const scale of [1, 4]) {
    await Bun.write(`${import.meta.dir}/${name}-${scale}x.png`, encodeIndexedPng(decodeGrid(asset.grid), asset.palette, { scale }));
  }
}

for await (const file of new Bun.Glob("*.json").scan(import.meta.dir)) {
  const asset = await Bun.file(`${import.meta.dir}/${file}`).json();
  await Bun.write(`${import.meta.dir}/${file.replace(/\.json$/, "-4x.png")}`, encodeIndexedPng(decodeGrid(asset.grid), asset.palette, { scale: 4 }));
}

const north = await Bun.file(`${import.meta.dir}/north.json`).json();
const northeast = await Bun.file(`${import.meta.dir}/north-east.json`).json();
const southeast = await Bun.file(`${import.meta.dir}/south-east.json`).json();
// Same five model outputs and three exact mirrors used by the completed in-app set.
const directions = [
  decodeGrid(north.grid), decodeGrid(northeast.grid), decodeGrid(east.grid), decodeGrid(southeast.grid),
  decodeGrid(south.grid), mirrorGrid(decodeGrid(southeast.grid)), mirrorGrid(decodeGrid(east.grid)), mirrorGrid(decodeGrid(northeast.grid)),
];
const sheet = createGrid(128 * 4, 128 * 2);
for (const [index, grid] of directions.entries()) {
  const x = (index % 4) * 128;
  const y = Math.floor(index / 4) * 128;
  for (let row = 0; row < 128; row++) sheet.cells.set(grid.cells.subarray(row * 128, (row + 1) * 128), (y + row) * sheet.width + x);
}
await Bun.write(`${import.meta.dir}/eight-directions.png`, encodeIndexedPng(sheet, south.palette, { scale: 2 }));
await Bun.write(`${import.meta.dir}/rotation.gif`, encodeGif(directions, south.palette, { scale: 4, delayMs: 125 }));
