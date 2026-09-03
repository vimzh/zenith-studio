/**
 * Times the two chat calls of the animation pipeline under different settings.
 *
 * Planning and judging are structured single-turn calls, and at the chat
 * route's defaults each took about a minute — most of it reasoning about a
 * four-line JSON answer. This runs the same plan and the same judge strip at
 * each setting so the choice in `PLANNER_CHAT` and `JUDGE_CHAT` is measured
 * rather than guessed, and prints the plans so quality can be read, not
 * assumed.
 *
 *   bun run scripts/animate-speed.ts <bench-dir> [variant ...]
 *
 * `bench-dir` is an `animate-bench` output directory (its `plan.json` names the
 * subject, motion, facing and effects; its `strip-4x.png` and `frames.json`
 * feed the judge). Variants are `default`, `low`, `minimal`, `mini` (gpt-5-mini
 * at low), or `model=<name>`. This spends money: one chat call per variant per
 * stage, no images.
 */

import { TRANSPARENT, createGrid, type Grid } from "@zenith/core";
import { encodeIndexedPng } from "../src/lib/export";
import { judgeFrames, planPoses, type ChatOptions, type PosePlan } from "../src/lib/webmcp/api";

const [dir, ...variants] = Bun.argv.slice(2);
if (dir === undefined) {
  console.error("usage: bun run scripts/animate-speed.ts <bench-dir> [default|low|minimal|mini|model=<name> ...]");
  process.exit(1);
}
const wanted = variants.length === 0 ? ["default", "low", "minimal"] : variants;

const saved = (await Bun.file(`${dir}/plan.json`).json()) as {
  subject: string;
  motion: string;
  facing?: string;
  effects?: string;
  frames: number;
  plan: PosePlan;
};
const frames = (await Bun.file(`${dir}/frames.json`).json()) as { palette: string[]; frames: number[][] };

function options(variant: string): ChatOptions {
  if (variant === "default") return {};
  if (variant === "low") return { reasoning: "low", verbosity: "low" };
  if (variant === "minimal") return { reasoning: "minimal", verbosity: "low" };
  if (variant === "mini") return { model: "gpt-5-mini", reasoning: "low", verbosity: "low" };
  if (variant.startsWith("model=")) return { model: variant.slice("model=".length), reasoning: "low", verbosity: "low" };
  throw new Error(`Unknown variant '${variant}'.`);
}

// The planner's preview and the judge's strip, rebuilt from the saved frames.
const size = Math.sqrt(frames.frames[0]!.length);
const grids: Grid[] = frames.frames.map((cells) => {
  const grid = createGrid(size, size, TRANSPARENT);
  grid.cells.set(cells);
  return grid;
});
const source = encodeIndexedPng(grids[0]!, frames.palette, { scale: Math.max(1, Math.floor(512 / size)) });
const strip = createGrid(size * grids.length + 2 * (grids.length - 1), size, TRANSPARENT);
grids.forEach((grid, index) => {
  const left = index * (size + 2);
  for (let y = 0; y < size; y += 1) strip.cells.set(grid.cells.subarray(y * size, (y + 1) * size), y * strip.width + left);
});
const stripPng = encodeIndexedPng(strip, frames.palette, { scale: Math.max(1, Math.min(4, Math.floor(2048 / strip.width))) });

const results: Record<string, { planSeconds: number; judgeSeconds: number; plan: PosePlan; verdicts: unknown }> = {};
for (const variant of wanted) {
  const chat = options(variant);
  let t = performance.now();
  const plan = await planPoses({ subject: saved.subject, motion: saved.motion, frames: saved.frames, facing: saved.facing, effects: saved.effects, source, chat });
  const planSeconds = (performance.now() - t) / 1000;
  console.log(`\n== ${variant}: planned in ${planSeconds.toFixed(1)}s; source read as: ${plan.source}`);
  for (const [index, entry] of plan.frames.entries()) console.log(`  ${String(index + 1)}. [${entry.contact}, ${String(entry.ms)}ms] ${entry.pose}${entry.effect === undefined ? "" : ` | effect: ${entry.effect}`}`);

  t = performance.now();
  const verdicts = await judgeFrames({ strip: stripPng, plan: saved.plan.frames, effects: saved.effects, chat });
  const judgeSeconds = (performance.now() - t) / 1000;
  console.log(`   judged in ${judgeSeconds.toFixed(1)}s: ${verdicts.map((verdict) => `${String(verdict.frame)}:${verdict.ok ? "ok" : `REJECTED (${verdict.problems.join(" ")})`}`).join("  ")}`);
  results[variant] = { planSeconds, judgeSeconds, plan, verdicts };
}
await Bun.write(`${dir}/speed.json`, JSON.stringify(results, null, 2));
console.log(`\nwrote ${dir}/speed.json`);
