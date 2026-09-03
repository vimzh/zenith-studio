/**
 * Runs the text-animation pipeline outside the browser, against the live API.
 *
 * A scratch tool for judging motion quality by eye, which nothing automated can
 * do. Everything after the model call is the product's own code — `planPoses`,
 * `deriveAnimationSheet`, `judgeFrames`, the sheet layout, cutting and
 * registration, palette growth and the pixeliser — so a cycle judged here is
 * the cycle the tool would have produced. The one browser-only step, PNG
 * decoding, is stood in for by `decodePng`.
 *
 *   bun run scripts/animate-bench.ts <asset.json> "<motion>" <frames> <out-dir>
 *
 * Environment: SUBJECT and FACING describe the sprite to the planner; EFFECTS
 * asks for effects; VERIFY=0 skips the judge and repair; REUSE=1 reuses an
 * existing `plan.json` and `sheet-N-output.png` instead of buying them again,
 * so the free half of the pipeline can be iterated on a sheet that exists.
 *
 * `asset.json` is either `{ palette, frames: [encodedGrid, ...] }` (the first
 * frame is the source) or `{ palette, grid }`. Writes the composed input
 * sheets, the raw model output, the plan, the judge's verdicts, a 4x strip of
 * the resulting frames and a GIF with the planner's holds.
 *
 * This spends money: one or two chat calls and one image generation per sheet.
 */

import { TRANSPARENT, createGrid, decodeGrid, type Grid } from "@zenith/core";
import {
  cellOrigin,
  composeSheet,
  encodeGif,
  paletteUsage,
  planSheets,
  seatEffectColours,
  registerToBaseline,
  sourceBaseline,
  splitSheet,
} from "../src/lib/animation";
import { encodeIndexedPng } from "../src/lib/export";
import { clearBackground, pixelize } from "../src/lib/pixelize";
import { deriveAnimationSheets, judgeFrames, planPoses, type FrameVerdict, type GenerateResponse, type PlannedPose, type PosePlan } from "../src/lib/webmcp/api";
import { conformToPalette } from "../src/lib/webmcp/tools/generation";
import { decodePng } from "./png-decode";

const [assetPath, motion, framesArg, outDir] = Bun.argv.slice(2);
if (assetPath === undefined || motion === undefined || framesArg === undefined || outDir === undefined) {
  console.error('usage: bun run scripts/animate-bench.ts <asset.json> "<motion>" <frames> <out-dir>');
  process.exit(1);
}
const frames = Number.parseInt(framesArg, 10);

interface AssetFile {
  readonly name?: string;
  readonly palette: string[];
  readonly frames?: string[];
  readonly grid?: string;
}

const asset = (await Bun.file(assetPath).json()) as AssetFile;
const encoded = asset.frames?.[0] ?? asset.grid;
if (encoded === undefined) throw new Error("The asset file has neither frames nor a grid.");
let source = decodeGrid(encoded);
const palette = asset.palette;
const facing = process.env["FACING"];
const subject = process.env["SUBJECT"] ?? asset.name ?? "character";
const effects = process.env["EFFECTS"];
const verify = process.env["VERIFY"] !== "0";
const reuse = process.env["REUSE"] === "1";
const quality = process.env["QUALITY"] as "low" | "medium" | "high" | undefined;

const layouts = planSheets(source.width, source.height, frames);
console.log(`${String(source.width)}x${String(source.height)} source, ${String(frames)} frames -> ${layouts.map((l) => `${String(l.columns)}x${String(l.rows)}@${String(l.scale)} (${String(l.width)}x${String(l.height)})`).join(" + ")}${effects === undefined ? "" : `; effects: ${effects}`}`);

const previewScale = Math.max(1, Math.floor(512 / Math.max(source.width, source.height)));
const savedPlan = Bun.file(`${outDir}/plan.json`);
const started = performance.now();
const plan: PosePlan = reuse && (await savedPlan.exists())
  ? ((await savedPlan.json()) as { plan: PosePlan }).plan
  : await planPoses({ subject, motion, frames, facing, effects, source: encodeIndexedPng(source, palette, { scale: previewScale }) });
const planned = performance.now() - started;
console.log(`planned ${String(plan.frames.length)} poses in ${(planned / 1000).toFixed(1)}s; source read as: ${plan.source}`);
for (const [index, entry] of plan.frames.entries()) console.log(`  ${String(index + 1)}. [${entry.contact}, ${String(entry.ms)}ms] ${entry.pose}${entry.effect === undefined ? "" : ` | effect: ${entry.effect}`}`);
await Bun.write(`${outDir}/plan.json`, JSON.stringify({ subject, motion, facing, effects, frames, plan, planSeconds: planned / 1000 }, null, 2));

interface Drawn { readonly pose: PlannedPose; readonly raw: Grid; readonly extracted: readonly string[] }
const slots: (Drawn | undefined)[] = Array.from({ length: frames }, () => undefined);
const blank = new Set<number>();
const timings: number[] = [];
let sheetCount = 0;

function poseLine(pose: PlannedPose, rejection?: readonly string[]): string {
  let line = pose.effect === undefined ? pose.pose : `${pose.pose} Effect: ${pose.effect}`;
  if (rejection !== undefined && rejection.length > 0) line += ` The previous attempt was rejected: ${rejection.join(" ")} Draw this frame correctly.`;
  return line.slice(0, 600);
}

async function draw(entries: readonly { index: number; line: string; pose: PlannedPose }[], maxColors: number): Promise<void> {
  // The same shape as the tool: every sheet of this pass is bought as one
  // concurrent batch, so two sheets take about as long as one.
  const batches: { layout: ReturnType<typeof planSheets>[number]; batch: typeof entries; number: number; png: Uint8Array; saved: ReturnType<typeof Bun.file> }[] = [];
  let offset = 0;
  for (const layout of planSheets(source.width, source.height, entries.length)) {
    const batch = entries.slice(offset, offset + layout.capacity);
    offset += batch.length;
    if (batch.length === 0) break;
    sheetCount += 1;
    const png = encodeIndexedPng(composeSheet(source, layout), palette, { scale: layout.scale });
    await Bun.write(`${outDir}/sheet-${String(sheetCount)}-input.png`, png);
    batches.push({ layout, batch, number: sheetCount, png, saved: Bun.file(`${outDir}/sheet-${String(sheetCount)}-output.png`) });
  }
  const outputs = new Map<number, Uint8Array>();
  const toBuy = [];
  for (const entry of batches) {
    if (reuse && (await entry.saved.exists())) {
      outputs.set(entry.number, await entry.saved.bytes());
      console.log(`sheet ${String(entry.number)} reused from disk`);
    } else {
      toBuy.push(entry);
    }
  }
  if (toBuy.length > 0) {
    const t0 = performance.now();
    const results: PromiseSettledResult<GenerateResponse>[] = await deriveAnimationSheets(
      toBuy.map(({ layout, batch, png }) => ({ sheet: png, motion, columns: layout.columns, rows: layout.rows, poses: batch.map((entry) => entry.line), effects, quality })),
    );
    const seconds = (performance.now() - t0) / 1000;
    timings.push(seconds);
    console.log(`${String(toBuy.length)} sheet(s) generated concurrently in ${seconds.toFixed(1)}s`);
    for (const [position, result] of results.entries()) {
      const entry = toBuy[position]!;
      if (result.status === "rejected") {
        console.log(`  sheet ${String(entry.number)} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        continue;
      }
      const bytes = Uint8Array.from(Buffer.from(result.value.image, "base64"));
      await Bun.write(entry.saved, bytes);
      outputs.set(entry.number, bytes);
    }
  }

  for (const { layout, batch, number } of batches) {
    const bytes = outputs.get(number);
    if (bytes === undefined) continue;
    const raster = clearBackground(decodePng(bytes));
    const cells = splitSheet(raster, layout).slice(1, 1 + batch.length);
    const baseline = sourceBaseline(source, layout.scale);
    const cellHeight = layout.cellHeight * layout.scale;
    const tolerance = { down: Math.round(cellHeight * 0.2), up: Math.round(cellHeight * 0.08) };
    const registered = baseline === null ? { cells, shifts: cells.map(() => 0) } : registerToBaseline(cells, baseline, batch.map((entry) => entry.pose.contact), tolerance);
    console.log(`  baseline ${String(baseline)}px, tolerance down ${String(tolerance.down)}px / up ${String(tolerance.up)}px, shifts ${registered.shifts.join(", ")}`);

    for (const [position, cell] of registered.cells.entries()) {
      const entry = batch[position]!;
      const result = pixelize(cell, { targetWidth: source.width, targetHeight: source.height, maxColors });
      if (result.palette.length === 0) {
        console.log(`  frame ${String(entry.index + 1)}: empty cell`);
        blank.add(entry.index);
        continue;
      }
      blank.delete(entry.index);
      slots[entry.index] = { pose: entry.pose, raw: result.grid, extracted: result.palette };
    }
  }
}

const maxColors = effects === undefined ? palette.length : 16;
await draw(plan.frames.map((pose, index) => ({ index, line: poseLine(pose), pose })), maxColors);

let colours: readonly string[] = palette;
if (effects !== undefined) {
  const counts = new Map<string, number>();
  for (const slot of slots) {
    if (slot === undefined) continue;
    for (const cell of slot.raw.cells) {
      if (cell === TRANSPARENT) continue;
      const hex = slot.extracted[cell];
      if (hex !== undefined) counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const seating = seatEffectColours(palette, ranked, paletteUsage([source], palette.length));
  if (seating.folds.length > 0) {
    const folded = createGrid(source.width, source.height, TRANSPARENT);
    folded.cells.set(source.cells);
    for (const fold of seating.folds) for (let i = 0; i < folded.cells.length; i += 1) if (folded.cells[i] === fold.from) folded.cells[i] = fold.to;
    source = folded;
    console.log(`palette: folded ${seating.folds.map((fold) => `${palette[fold.from]} into ${palette[fold.to]} (${fold.distance.toFixed(3)})`).join(", ")}`);
  }
  colours = seating.colors;
  console.log(`palette: added ${seating.added.join(", ") || "nothing"}; unmatched ${seating.unmatched.join(", ") || "none"}`);
}
const conformed = (): (Grid | undefined)[] => slots.map((slot) => (slot === undefined ? undefined : conformToPalette(slot.raw, slot.extracted, colours)));

function strip(grids: readonly Grid[], gap: number, scale: number): Uint8Array {
  const out = createGrid(source.width * grids.length + gap * (grids.length - 1), source.height, TRANSPARENT);
  grids.forEach((grid, index) => {
    const left = index * (source.width + gap);
    for (let y = 0; y < source.height; y += 1) out.cells.set(grid.cells.subarray(y * source.width, (y + 1) * source.width), y * out.width + left);
  });
  return encodeIndexedPng(out, colours, { scale });
}

const verdictsLog: { pass: number; verdicts: FrameVerdict[] }[] = [];
if (verify) {
  const judge = async (): Promise<FrameVerdict[]> => {
    const present = slots.map((slot, index) => ({ slot, index })).filter((entry): entry is { slot: Drawn; index: number } => entry.slot !== undefined);
    const grids = conformed();
    const t0 = performance.now();
    const found = await judgeFrames({ strip: strip([source, ...present.map(({ index }) => grids[index] as Grid)], 2, Math.max(1, Math.min(4, Math.floor(2048 / (source.width * (present.length + 1)))))), plan: present.map(({ slot }) => slot.pose), effects });
    console.log(`judged in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    return found.map((verdict, position) => ({ ...verdict, frame: present[position]!.index + 1 }));
  };
  let verdicts = await judge();
  verdictsLog.push({ pass: 1, verdicts });
  for (const verdict of verdicts) console.log(`  frame ${String(verdict.frame)}: ${verdict.ok ? "ok" : `REJECTED — ${verdict.problems.join(" ")}`}`);
  const rejected: FrameVerdict[] = [
    ...verdicts.filter((verdict) => !verdict.ok),
    ...[...blank].sort((a, b) => a - b).map((index) => ({ frame: index + 1, ok: false, problems: ["The previous attempt left this frame's cell empty."] })),
  ].sort((a, b) => a.frame - b.frame);
  if (rejected.length > 0) {
    await draw(rejected.map((verdict) => ({ index: verdict.frame - 1, line: poseLine(plan.frames[verdict.frame - 1]!, verdict.problems), pose: plan.frames[verdict.frame - 1]! })), maxColors);
    const repairedFrames = new Set(rejected.map((verdict) => verdict.frame));
    const first = new Map(verdicts.map((verdict) => [verdict.frame, verdict]));
    verdicts = (await judge()).map((verdict) => (repairedFrames.has(verdict.frame) ? verdict : (first.get(verdict.frame) ?? verdict)));
    verdictsLog.push({ pass: 2, verdicts });
    for (const verdict of verdicts) console.log(`  after repair, frame ${String(verdict.frame)}: ${verdict.ok ? "ok" : `still rejected — ${verdict.problems.join(" ")}`}`);
  }
  await Bun.write(`${outDir}/judge.json`, JSON.stringify(verdictsLog, null, 2));
}

const grids = conformed();
const drawn = slots.map((slot, index) => (slot === undefined ? null : { pose: slot.pose, grid: grids[index] as Grid })).filter((entry): entry is { pose: PlannedPose; grid: Grid } => entry !== null);
const cycle = [source, ...drawn.map(({ grid }) => grid)];
await Bun.write(`${outDir}/strip-4x.png`, strip(cycle, 2, 4));
// Two GIFs: the planner's holds with its rest beat on frame 0 (game timing), and
// the same frames at half speed with a longer rest for a loop that plays
// unattended in a chat.
const holds = drawn.map(({ pose }) => pose.ms);
const gameDelays = [plan.restMs, ...holds];
const shareDelays = [Math.round(plan.restMs * 1.5), ...holds.map((ms) => ms * 2)];
await Bun.write(`${outDir}/cycle.gif`, encodeGif(cycle, colours, { scale: 4, delayMs: gameDelays }));
await Bun.write(`${outDir}/cycle-share.gif`, encodeGif(cycle, colours, { scale: 4, delayMs: shareDelays }));
await Bun.write(`${outDir}/frames.json`, JSON.stringify({ palette: colours, frames: cycle.map((grid) => Array.from(grid.cells)), durations: [plan.restMs, ...holds], gifDelays: { cycle: gameDelays, share: shareDelays } }));
await Bun.write(`${outDir}/timing.json`, JSON.stringify({ planSeconds: planned / 1000, sheetSeconds: timings, sheets: sheetCount, layouts: layouts.map((l) => ({ columns: l.columns, rows: l.rows, scale: l.scale, width: l.width, height: l.height })) }, null, 2));

// Bottom opaque row per frame: the quickest read on whether the ground line held.
const bottoms = cycle.map((grid) => {
  for (let y = grid.height - 1; y >= 0; y -= 1) for (let x = 0; x < grid.width; x += 1) if (grid.cells[y * grid.width + x] !== TRANSPARENT) return y;
  return -1;
});
console.log(`wrote ${String(drawn.length)} frames to ${outDir}; holds ${drawn.map(({ pose }) => String(pose.ms)).join(", ")}ms; bottom rows ${bottoms.join(", ")}; sheets ${String(sheetCount)}; sheet seconds ${timings.map((t) => t.toFixed(0)).join(", ")}`);
void cellOrigin;
