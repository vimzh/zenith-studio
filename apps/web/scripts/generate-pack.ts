/**
 * Generates a pack of characters and writes an importable library bundle.
 *
 * A scratch tool, not product code, and it exists because of two constraints
 * that meet awkwardly. Assets live in IndexedDB in a browser, so a pack
 * generated anywhere else can only arrive as a file; and the client serialises
 * paid image calls on purpose, so parallelism has to come from outside it.
 *
 * Everything after the model call is the product's own code — `frameToCanvas`
 * and `pixelize` are pure TypeScript over byte arrays precisely so they can run
 * here, and the bundle is the shape `importLibrary` already reads. The one
 * thing missing outside a browser is PNG decoding, which `decodeBase64Png` does
 * with `createImageBitmap`; the decoder below stands in for exactly that.
 *
 *   bun run scripts/generate-pack.ts <characters.json> <out.json> [concurrency]
 */

import { createDocument, serializeDocument } from "@zenith/core";
import { frameToCanvas, pixelize } from "../src/lib/pixelize";
import { decodePng } from "./png-decode";

interface Character {
  readonly size: number;
  readonly name: string;
  readonly prompt: string;
}

const API = process.env["ZENITH_API"] ?? "http://localhost:3002";

async function generate(character: Character): Promise<{ name: string; type: "character"; document: unknown }> {
  const response = await fetch(`${API}/v1/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `kind: sprite` for the transparent background, and `cells` so the prompt
    // bounds feature count against the grid this lands on — the same two
    // decisions `generate_asset` makes.
    body: JSON.stringify({ prompt: character.prompt, kind: "sprite", cells: character.size }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `${String(response.status)} from /v1/generate`);
  }

  const { image } = (await response.json()) as { image: string };
  const raster = decodePng(Uint8Array.from(Buffer.from(image, "base64")));
  const framed = frameToCanvas(raster, character.size, character.size);
  const result = pixelize(framed?.image ?? raster, { targetWidth: character.size, maxColors: 16 });
  if (result.palette.length === 0) throw new Error("the generated image had no opaque pixels");

  const document = createDocument({
    name: character.name,
    width: character.size,
    height: character.size,
    palette: [...result.palette],
  });
  document.frames[0]!.layers[0]!.grid.cells.set(result.grid.cells);

  return { name: character.name, type: "character", document: serializeDocument(document) };
}

/** Runs `work` over the list with at most `limit` in flight. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array<R | null>(items.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item === undefined) return;
        try {
          results[index] = await work(item);
          console.log(`  ok    ${String(index + 1).padStart(2)}/${String(items.length)}  ${(item as Character).name}`);
        } catch (error) {
          console.log(`  FAIL  ${String(index + 1).padStart(2)}/${String(items.length)}  ${(item as Character).name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }),
  );
  return results;
}

const [source, out, concurrency = "8"] = process.argv.slice(2);
if (source === undefined || out === undefined) {
  console.error("usage: bun run scripts/generate-pack.ts <characters.json> <out.json> [concurrency]");
  process.exit(1);
}

const characters = JSON.parse(await Bun.file(source).text()) as Character[];
console.log(`Generating ${String(characters.length)} characters, ${concurrency} at a time, via ${API}`);
const started = Date.now();
const assets = (await pool(characters, Number(concurrency), generate)).filter((asset) => asset !== null);

await Bun.write(
  out,
  JSON.stringify({ format: "zenith.library", version: 1, exportedAt: new Date().toISOString(), assets }, null, 2),
);
console.log(
  `\n${String(assets.length)}/${String(characters.length)} in ${String(Math.round((Date.now() - started) / 1000))}s → ${out}`,
);
