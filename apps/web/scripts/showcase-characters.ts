/**
 * Generates a set of characters for the animation showcase, concurrently.
 *
 * The same decisions `generate_asset` makes — `kind: sprite` for a transparent
 * background, `cells` so the prompt bounds feature count against the grid —
 * then the product's own framing and pixelisation. Each character is written
 * in the shape `animate-bench.ts` reads (`{ name, palette, grid }`) beside a 4x
 * preview, so the animations can be run straight from it.
 *
 *   bun run scripts/showcase-characters.ts <characters.json> <out-dir>
 *
 * `characters.json` is `[{ slug, name, prompt, size? }]`. This spends money:
 * one image generation per character.
 */

import { encodeGrid } from "@zenith/core";
import { encodeIndexedPng } from "../src/lib/export";
import { frameToCanvas, pixelize } from "../src/lib/pixelize";
import { decodePng } from "./png-decode";

interface Character {
  readonly slug: string;
  readonly name: string;
  readonly prompt: string;
  readonly size?: number;
}

const [listPath, outDir] = Bun.argv.slice(2);
if (listPath === undefined || outDir === undefined) {
  console.error("usage: bun run scripts/showcase-characters.ts <characters.json> <out-dir>");
  process.exit(1);
}
const API = process.env["ZENITH_API"] ?? "http://localhost:3002";
const characters = (await Bun.file(listPath).json()) as Character[];

async function generate(character: Character): Promise<void> {
  const size = character.size ?? 128;
  const started = performance.now();
  const response = await fetch(`${API}/v1/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: character.prompt, kind: "sprite", cells: size }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `${String(response.status)} from /v1/generate`);
  }
  const { image } = (await response.json()) as { image: string };
  const raster = decodePng(Uint8Array.from(Buffer.from(image, "base64")));
  const framed = frameToCanvas(raster, size, size);
  const result = pixelize(framed?.image ?? raster, { targetWidth: size, maxColors: 16 });
  if (result.palette.length === 0) throw new Error("the generated image had no opaque pixels");
  const seconds = (performance.now() - started) / 1000;

  const dir = `${outDir}/${character.slug}`;
  await Bun.write(`${dir}/source.png`, Uint8Array.from(Buffer.from(image, "base64")));
  await Bun.write(`${dir}/character.json`, JSON.stringify({ name: character.name, palette: result.palette, grid: encodeGrid(result.grid), prompt: character.prompt, seconds }));
  await Bun.write(`${dir}/character-4x.png`, encodeIndexedPng(result.grid, result.palette, { scale: 4 }));
  console.log(`  ok  ${character.slug}: ${String(size)}px, ${String(result.palette.length)} colours, ${seconds.toFixed(1)}s`);
}

const outcomes = await Promise.allSettled(characters.map(generate));
outcomes.forEach((outcome, index) => {
  if (outcome.status === "rejected") console.log(`  FAIL ${characters[index]!.slug}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
});
if (outcomes.some((outcome) => outcome.status === "rejected")) process.exit(1);
