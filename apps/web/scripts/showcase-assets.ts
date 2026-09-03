/**
 * Copies the showcase's portraits and share-speed GIFs into `public/` for the
 * landing page's gallery.
 *
 * Portraits are recompressed with `compressIndexedPng` — the 4x previews are
 * stored-block PNGs of about a megabyte each and deflate to a few tens of
 * kilobytes. GIFs are already LZW-compressed and copied as they are. The
 * share-speed GIF is the one that plays well unattended: half speed with a
 * rest beat on the idle pose between repeats.
 *
 *   bun run scripts/showcase-assets.ts <showcase-dir> <public-dir>
 */

import { compressIndexedPng } from "../src/lib/export";

const [dir, out] = Bun.argv.slice(2);
if (dir === undefined || out === undefined) {
  console.error("usage: bun run scripts/showcase-assets.ts <showcase-dir> <public-dir>");
  process.exit(1);
}

const characters = (await Bun.file(`${dir}/characters.json`).json()) as { slug: string }[];
let files = 0;
let bytes = 0;
for (const { slug } of characters) {
  const portrait = await compressIndexedPng(await Bun.file(`${dir}/${slug}/character-4x.png`).bytes());
  await Bun.write(`${out}/${slug}.png`, portrait);
  files += 1;
  bytes += portrait.length;
  for await (const path of new Bun.Glob("*/cycle-share.gif").scan({ cwd: `${dir}/${slug}` })) {
    const animation = path.split("/")[0]!;
    const gif = await Bun.file(`${dir}/${slug}/${path}`).bytes();
    await Bun.write(`${out}/${slug}-${animation}.gif`, gif);
    files += 1;
    bytes += gif.length;
  }
}
console.log(`wrote ${String(files)} files, ${(bytes / 1024).toFixed(0)} KB, to ${out}`);
