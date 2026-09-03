/**
 * Rewrites every showcase animation's GIFs from its saved frames, free.
 *
 * The first showcase GIFs were written at a flat 120ms per frame, ignoring the
 * holds the planner chose, so a five-frame jab looped every 600ms and read as
 * frantic in a chat. This writes two GIFs per animation from `frames.json`:
 *
 * - `cycle.gif` — the planner's holds, with a rest beat on the source frame
 *   between repeats. This is the animation as a game would time it, plus the
 *   pause a game gets for free by returning to idle.
 * - `cycle-share.gif` — every hold doubled and a longer rest, for messaging
 *   apps and anywhere a loop plays unattended. Same frames, slower clock.
 *
 *   bun run scripts/showcase-regif.ts <showcase-dir>
 */

import { TRANSPARENT, createGrid, type Grid } from "@zenith/core";
import { encodeGif } from "../src/lib/animation";

const [dir] = Bun.argv.slice(2);
if (dir === undefined) {
  console.error("usage: bun run scripts/showcase-regif.ts <showcase-dir>");
  process.exit(1);
}

/** The rest pose holds this long between repeats of the action. */
const REST_MS = 600;
const SHARE_SPEED = 0.5;
const SHARE_REST_MS = 900;

let count = 0;
for await (const path of new Bun.Glob("*/*/frames.json").scan({ cwd: dir })) {
  const base = `${dir}/${path.slice(0, -"/frames.json".length)}`;
  const saved = (await Bun.file(`${base}/frames.json`).json()) as { palette: string[]; frames: number[][]; durations: number[] };
  const size = Math.sqrt(saved.frames[0]!.length);
  const frames: Grid[] = saved.frames.map((cells) => {
    const grid = createGrid(size, size, TRANSPARENT);
    grid.cells.set(cells);
    return grid;
  });
  const holds = saved.durations.slice(1);
  const game = [REST_MS, ...holds];
  const share = [SHARE_REST_MS, ...holds.map((ms) => Math.round(ms / SHARE_SPEED))];
  await Bun.write(`${base}/cycle.gif`, encodeGif(frames, saved.palette, { scale: 4, delayMs: game }));
  await Bun.write(`${base}/cycle-share.gif`, encodeGif(frames, saved.palette, { scale: 4, delayMs: share }));
  await Bun.write(`${base}/frames.json`, JSON.stringify({ ...saved, gifDelays: { cycle: game, share } }));
  count += 1;
  console.log(`${path.slice(0, -"/frames.json".length)}: loop ${String(game.reduce((a, b) => a + b, 0))}ms, share ${String(share.reduce((a, b) => a + b, 0))}ms`);
}
console.log(`rewrote ${String(count)} animations`);
