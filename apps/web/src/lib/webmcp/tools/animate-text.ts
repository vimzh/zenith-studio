import { DEFAULT_FRAME_DURATION_MS, TRANSPARENT, createGrid, gridsEqual, type Grid } from "@zenith/core";
import { encodeIndexedPng } from "@/lib/export";
import { session } from "@/lib/editor";
import { directionFromName } from "@/lib/directions";
import { conformToPalette } from "./generation";
import { clearBackground, pixelizeAsync } from "@/lib/pixelize";
import {
  checkAnimationCoherence,
  composeSheet,
  paletteUsage,
  planSheets,
  registerToBaseline,
  seatEffectColours,
  sourceBaseline,
  splitSheet,
  type PaletteFold,
} from "@/lib/animation";
import { readBoolean, readInteger, readOptionalString, readString } from "../args";
import {
  deriveAnimationSheets,
  judgeFrames,
  MAX_ANIMATION_DESCRIPTION_LENGTH,
  MAX_EFFECTS_LENGTH,
  MAX_POSE_LENGTH,
  planPoses,
  type FrameVerdict,
  type PlannedPose,
} from "../api";
import { decodeBase64Png } from "../raster";
import { ToolError, type ToolDefinition } from "../types";
import { assertEditTarget, captureEditTarget, requireActiveAsset, toToolError } from "./active";
import { FACING } from "./directions";

/**
 * Drawn animation — the cycles `animate_procedural` cannot express.
 *
 * The procedural presets transform one frame: bob, sway, pulse, flicker, blink,
 * scroll. Every one of them moves or recolours the *same* drawing, which covers
 * an idle bob and covers nothing else. A jab, a kick, a sword swing and a jump
 * all need frames that were never drawn, and no rearrangement of a single
 * sprite produces them.
 *
 * Five decisions carry the quality:
 *
 * 1. **The poses are planned first, from the image.** One cheap vision call
 *    reads the rest pose — stance, facing, what each hand holds — and breaks
 *    the motion into frames the way an animator keys it: anticipation, extreme,
 *    follow-through, recovery, each with a hold in milliseconds. Planned from a
 *    name alone, a warrior's blade was swung low before an overhead wind-up
 *    because nothing said where the blade rested.
 *
 * 2. **All frames are drawn as one sprite sheet beside the source.** The
 *    previous pipeline bought one image per frame, and N independent renders
 *    cannot share a camera: measured on a five-frame sword swing, the body
 *    changed size, the feet wandered up and down the canvas, and a pose ran off
 *    the edge, while every mechanical check passed. With the reference in
 *    cell 1 at the exact scale every other cell must match, consistency is
 *    the easiest thing for the model to do instead of the hardest thing to ask
 *    for. It is also one paid call for the whole cycle rather than N.
 *
 * 3. **Grounded frames are registered to the source's ground line.** The
 *    drift a sheet still shows comes by the row, and it is corrected.
 *
 * 4. **Effects earn palette slots.** An air-cut arc or a purple trail needs
 *    colours the asset may not have; when effects are asked for, colours far
 *    from every palette entry are given the free slots, most-used first, so
 *    the trail is purple rather than the nearest red. A full palette — the
 *    usual case for a generated character — makes room by folding its closest
 *    near-duplicate pair into one colour, an invisible change at pixel scale.
 *
 * 5. **A vision judge checks the strip and one repair sheet redraws what
 *    failed.** Identity, scale, facing and pose are what a sheet promises and
 *    what no mechanical check can see; the judge sees them, and its objections
 *    become the repair instruction.
 */

const MAX_FRAMES = 12;
/**
 * Vertical drift a grounded frame may show before it is treated as intentional,
 * as a share of the cell. Generous downward — a grounded frame floating above
 * the floor is never right, and a whole row drawn 14% high has been measured —
 * and strict upward, because a blade trailing below the feet can be the pose.
 */
const BASELINE_TOLERANCE = { down: 0.2, up: 0.08 } as const;
/** Longest side of the PNG the planner and judge see; large enough to read a pose, small enough to send. */
const PREVIEW_PX = 512;
const JUDGE_STRIP_PX = 2048;

interface DrawnFrame {
  readonly pose: PlannedPose;
  /** As pixelised, indexed against `extracted`; conformed to the asset's palette once that is decided. */
  readonly raw: Grid;
  readonly extracted: readonly string[];
}

/** The pose line the image model receives: the pose, its effect, and after a rejection, why. */
function poseLine(pose: PlannedPose, rejection?: readonly string[]): string {
  let line = pose.effect === undefined ? pose.pose : `${pose.pose} Effect: ${pose.effect}`;
  if (rejection !== undefined && rejection.length > 0) {
    const note = ` The previous attempt was rejected: ${rejection.join(" ")} Draw this frame correctly.`;
    // The note is ours, so it may be cut to fit; the pose is the plan and may not.
    const room = MAX_POSE_LENGTH - line.length;
    if (room > 40) line += note.length <= room ? note : `${note.slice(0, room - 1)}…`;
  }
  return line;
}

/** Source and frames side by side with a gap, for the judge. */
function judgeStrip(source: Grid, frames: readonly Grid[], palette: readonly string[]): Uint8Array {
  const gap = 2;
  const strip = createGrid(source.width * (frames.length + 1) + gap * frames.length, source.height, TRANSPARENT);
  [source, ...frames].forEach((grid, index) => {
    const left = index * (source.width + gap);
    for (let y = 0; y < source.height; y += 1) {
      strip.cells.set(grid.cells.subarray(y * source.width, (y + 1) * source.width), y * strip.width + left);
    }
  });
  const scale = Math.max(1, Math.min(4, Math.floor(JUDGE_STRIP_PX / strip.width)));
  return encodeIndexedPng(strip, palette, { scale });
}

/** Every colour the frames used, most pixels first, so a colour family's main shade is seated before its fringe. */
function rankedColours(frames: readonly DrawnFrame[]): string[] {
  const counts = new Map<string, number>();
  for (const { raw, extracted } of frames) {
    for (const cell of raw.cells) {
      if (cell === TRANSPARENT) continue;
      const hex = extracted[cell];
      if (hex !== undefined) counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}

export const animateWithText: ToolDefinition = {
  name: "animate_with_text",
  scope: "editor",
  network: true,
  description:
    "Draw an animation from a description — a jab, a kick, a sword swing, a jump, a run cycle — onto the open asset, optionally with effects such as an air-cut arc, a purple magic trail behind a blade, sparkles or dust. The selected frame is the rest pose the motion starts from and returns to, and the new frames are appended after the existing ones with the holds the planner timed (60-400ms each). HOW IT WORKS: one cheap vision call reads the source sprite and plans the poses like an animator (anticipation, key extreme, follow-through, recovery, per-frame timing and effect placement); every frame is then drawn as ONE sprite sheet beside the source, so all frames share its scale, camera, outline weight and ground line; grounded frames are snapped back onto the source's ground line; effect colours the palette lacks are given its free slots; then a vision judge checks each frame for identity, scale, facing, pose and clipping and one repair sheet redraws the frames it rejects (verify: false skips the judge and the repair). Expect a coherent cycle of the same character; review contact and anatomy by eye. SLOW AND PAID: one image per sheet, about two minutes, all sheets of a cycle bought concurrently, plus a repair sheet when the judge rejects a frame; a sheet holds 3-5 frames beside a 128px sprite and up to 15 beside a 32px one. Prefer animate_procedural for bob, sway, pulse, flicker, blink or scroll and animate_with_skeleton for a plain walk or run — both are instant and free. For a locomotion cycle where the standing source pose does not belong in the loop, remove that frame with delete_frame afterwards.",
  inputSchema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        maxLength: MAX_ANIMATION_DESCRIPTION_LENGTH,
        description: "The motion, e.g. 'a quick jab with the lead hand', 'a roundhouse kick', 'an overhead sword slash', 'a run cycle'.",
      },
      frames: {
        type: "integer",
        minimum: 2,
        maximum: MAX_FRAMES,
        description: "Frames to draw after the source frame. Defaults to 4. Four to six read as an action; more than a sheet holds costs a second image.",
      },
      effects: {
        type: "string",
        maxLength: MAX_EFFECTS_LENGTH,
        description: "Optional effects to draw into the frames, e.g. 'a white air-cut arc at the moment of the slash', 'a purple magic trail following the blade', 'sparkles around the potion'. Omitted means no effects of any kind.",
      },
      verify: {
        type: "boolean",
        description: "Run the vision judge and redraw rejected frames once. Defaults to true; false is faster and cheaper but unchecked.",
      },
    },
    required: ["description"],
  },
  example: { description: "a heavy overhead sword slash", frames: 4, effects: "a white air-cut arc at the moment of the slash" },
  execute: async (args) => {
    const { id, name } = requireActiveAsset();
    const store = session.get(id);
    if (store === undefined) throw new ToolError(`No asset '${id}' is open.`);
    const target = captureEditTarget({ id, store });

    const description = readString(args, "description");
    const frames = args["frames"] === undefined ? 4 : readInteger(args, "frames", 2, MAX_FRAMES);
    const effectsRaw = readOptionalString(args, "effects")?.trim();
    const effects = effectsRaw === undefined || effectsRaw.length === 0 ? undefined : effectsRaw;
    if (effects !== undefined && effects.length > MAX_EFFECTS_LENGTH) {
      throw new ToolError(`Effects must be ${String(MAX_EFFECTS_LENGTH)} characters or fewer; received ${String(effects.length)}.`);
    }
    const verify = readBoolean(args, "verify", true);

    // Laid out before anything is bought: an asset too large for any sheet
    // should fail here, for free, rather than after a plan has been paid for.
    try {
      planSheets(store.width, store.height, frames);
    } catch (error) {
      throw toToolError(error);
    }

    // The selected frame is the reference every frame is drawn beside, so the
    // cycle stays one subject rather than drifting a little with each frame.
    const base = store.readComposite();
    const palette = store.palette.colors.map((colour) => colour.hex);
    const direction = directionFromName(name);
    const previewScale = Math.max(1, Math.floor(PREVIEW_PX / Math.max(store.width, store.height)));
    const plan = await planPoses({
      subject: name,
      motion: description,
      frames,
      facing: direction === undefined ? undefined : FACING[direction],
      effects,
      source: encodeIndexedPng(base, palette, { scale: previewScale }),
    });
    assertEditTarget(target);

    const slots: (DrawnFrame | undefined)[] = Array.from({ length: frames }, () => undefined);
    const failures: string[] = [];
    const notes: string[] = [];
    /** Frames whose cell came back empty; a rejection in all but name, redrawn with the judge's. */
    const blank = new Set<number>();
    let sheets = 0;

    /** Draws the given frames onto as many sheets as they need, filling `slots`. */
    /** Draws the given frames onto as many sheets as they need, bought concurrently, filling `slots`. */
    const draw = async (entries: readonly { index: number; line: string; pose: PlannedPose }[], maxColors: number): Promise<void> => {
      const batches: { layout: ReturnType<typeof planSheets>[number]; batch: typeof entries }[] = [];
      let offset = 0;
      for (const layout of planSheets(store.width, store.height, entries.length)) {
        const batch = entries.slice(offset, offset + layout.capacity);
        offset += batch.length;
        if (batch.length === 0) break;
        batches.push({ layout, batch });
      }
      const label = (batch: typeof entries): string => `frame(s) ${batch.map((entry) => String(entry.index + 1)).join(", ")}`;

      assertEditTarget(target);
      sheets += batches.length;
      let outcomes;
      try {
        // One batch, one hold on the paid slot: a cycle too long for one sheet
        // waits once for its sheets rather than once per sheet.
        outcomes = await deriveAnimationSheets(
          batches.map(({ layout, batch }) => ({
            sheet: encodeIndexedPng(composeSheet(base, layout), palette, { scale: layout.scale }),
            motion: description,
            columns: layout.columns,
            rows: layout.rows,
            poses: batch.map((entry) => entry.line),
            effects,
          })),
        );
      } catch (error) {
        // Refused before anything was bought — the guard, or a request that failed validation.
        failures.push(`${label(entries)}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      assertEditTarget(target);

      for (const [position, { layout, batch }] of batches.entries()) {
        const outcome = outcomes[position];
        if (outcome === undefined || outcome.status === "rejected") {
          // One failed sheet should not throw away the frames bought beside it.
          const reason = outcome?.reason;
          failures.push(`${label(batch)}: ${reason instanceof Error ? reason.message : String(reason ?? "no result")}`);
          continue;
        }
        try {
          const raster = clearBackground(await decodeBase64Png(outcome.value.image));
          // Cell 0 is the reference; the model's copy of it is discarded in
          // favour of the exact source pixels the human already has.
          const cells = splitSheet(raster, layout).slice(1, 1 + batch.length);
          const baseline = sourceBaseline(base, layout.scale);
          const cellHeight = layout.cellHeight * layout.scale;
          const tolerance = {
            down: Math.round(cellHeight * BASELINE_TOLERANCE.down),
            up: Math.round(cellHeight * BASELINE_TOLERANCE.up),
          };
          const registered =
            baseline === null
              ? { cells, shifts: cells.map(() => 0) }
              : registerToBaseline(cells, baseline, batch.map((entry) => entry.pose.contact), tolerance);
          const moved = registered.shifts
            .map((shift, at) => (shift === 0 ? null : `${String((batch[at] as { index: number }).index + 1)} ${shift > 0 ? "down" : "up"} ${String(Math.round(Math.abs(shift) / layout.scale))}px`))
            .filter((entry): entry is string => entry !== null);
          if (moved.length > 0) notes.push(`Moved back onto the source's ground line: frame ${moved.join(", frame ")}.`);

          for (const [at, cell] of registered.cells.entries()) {
            const entry = batch[at] as { index: number; pose: PlannedPose };
            const result = await pixelizeAsync(cell, { targetWidth: store.width, targetHeight: store.height, maxColors });
            if (result.palette.length === 0) {
              blank.add(entry.index);
              continue;
            }
            blank.delete(entry.index);
            slots[entry.index] = { pose: entry.pose, raw: result.grid, extracted: result.palette };
          }
        } catch (error) {
          failures.push(`${label(batch)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };

    // Effects are the only reason to let the quantiser keep colours the
    // palette lacks; without them every colour is conformed to what exists.
    const maxColors = effects === undefined ? palette.length : 16;
    await draw(plan.frames.map((pose, index) => ({ index, line: poseLine(pose), pose })), maxColors);

    // The palette is decided once, from the first pass, so every frame — and
    // any repair — indexes the same colours. Only free slots are spent; an
    // entry the asset already uses is never repurposed under an existing frame.
    let colours: readonly string[] = palette;
    let added: readonly string[] = [];
    let folds: PaletteFold[] = [];
    const drawnNow = slots.filter((slot): slot is DrawnFrame => slot !== undefined);
    if (effects !== undefined && drawnNow.length > 0) {
      const existing = Array.from({ length: store.frameCount }, (_, frame) => store.readComposite(frame));
      const seating = seatEffectColours(palette, rankedColours(drawnNow), paletteUsage(existing, palette.length));
      colours = seating.colors;
      added = seating.added;
      folds = seating.folds;
      if (folds.length > 0) {
        notes.push(
          `Folded ${folds.map((fold) => `${palette[fold.from] ?? "?"} into ${palette[fold.to] ?? "?"}`).join(" and ")} (near-identical) to make room for the effect colours.`,
        );
      }
      if (seating.unmatched.length > 0) {
        notes.push(`No palette room for ${seating.unmatched.join(", ")}; they were matched to the nearest existing colours.`);
      }
    }
    const conformed = (): (Grid | undefined)[] =>
      slots.map((slot) => (slot === undefined ? undefined : conformToPalette(slot.raw, slot.extracted, colours)));

    let verdicts: FrameVerdict[] = [];
    let repaired: number[] = [];
    if (verify && drawnNow.length > 0) {
      const judge = async (): Promise<FrameVerdict[]> => {
        const present = slots.map((slot, index) => ({ slot, index })).filter((entry): entry is { slot: DrawnFrame; index: number } => entry.slot !== undefined);
        const grids = conformed();
        const found = await judgeFrames({
          strip: judgeStrip(base, present.map(({ index }) => grids[index] as Grid), colours),
          plan: present.map(({ slot }) => slot.pose),
          effects,
        });
        // Verdicts come back in strip order; map them onto plan positions.
        return found.map((verdict, position) => ({ ...verdict, frame: (present[position] as { index: number }).index + 1 }));
      };
      verdicts = await judge();
      assertEditTarget(target);
      // A blank cell is a rejection the judge never saw; it joins the repair.
      const rejected: FrameVerdict[] = [
        ...verdicts.filter((verdict) => !verdict.ok),
        ...[...blank].sort((a, b) => a - b).map((index) => ({ frame: index + 1, ok: false, problems: ["The previous attempt left this frame's cell empty."] })),
      ].sort((a, b) => a.frame - b.frame);
      if (rejected.length > 0) {
        repaired = rejected.map((verdict) => verdict.frame);
        await draw(
          rejected.map((verdict) => {
            const pose = plan.frames[verdict.frame - 1] as PlannedPose;
            return { index: verdict.frame - 1, line: poseLine(pose, verdict.problems), pose };
          }),
          maxColors,
        );
        // The second pass sees the whole strip for context but only rules on
        // the frames that were redrawn. A judge is a model: asked twice about
        // an unchanged frame it can answer differently, and a frame that
        // passed once and was never touched has not become wrong.
        const second = await judge();
        const first = new Map(verdicts.map((verdict) => [verdict.frame, verdict]));
        verdicts = second.map((verdict) => (repaired.includes(verdict.frame) ? verdict : (first.get(verdict.frame) ?? verdict)));
      }
    }

    assertEditTarget(target);
    for (const index of [...blank].sort((a, b) => a - b)) failures.push(`frame ${String(index + 1)}: the model left its cell empty`);
    const grids = conformed();
    const drawn = slots
      .map((slot, index) => (slot === undefined ? null : { pose: slot.pose, grid: grids[index] as Grid }))
      .filter((entry): entry is { pose: PlannedPose; grid: Grid } => entry !== null);
    if (drawn.length === 0) {
      throw toToolError(new Error(`No frames could be drawn. ${failures.join("; ")}`));
    }

    // One transaction, so the whole cycle — palette folds and growth included —
    // is a single undo for the human rather than one entry per frame.
    const before = store.frameCount;
    const snapshot = store.snapshot();
    const layerCounts = snapshot.frames.map((frame) => frame.layers.length);
    // The loop needs a beat on the rest pose or the action restarts the moment
    // it lands. Only a source frame still at the default hold is retimed; one
    // the human timed keeps its timing.
    const sourceHold = snapshot.frames[target.frame]?.durationMs ?? DEFAULT_FRAME_DURATION_MS;
    const retimeSource = sourceHold === DEFAULT_FRAME_DURATION_MS && plan.restMs !== sourceHold;
    store.transaction(`animate: ${description}`, () => {
      if (retimeSource) store.setFrameDuration(target.frame, plan.restMs);
      for (const fold of folds) {
        layerCounts.forEach((layers, frame) => {
          for (let layer = 0; layer < layers; layer += 1) store.replaceColor(fold.from, fold.to, { frame, layer });
        });
      }
      if (added.length > 0 || folds.length > 0) store.setPalette(colours);
      for (const { grid, pose } of drawn) {
        const index = store.addFrame();
        store.writeRegion(0, 0, grid, { frame: index });
        store.setFrameDuration(index, pose.ms);
      }
    });

    const cycle = [base, ...drawn.map(({ grid }) => grid)];
    const repeats = cycle
      .map((grid, index) => (index > 0 && gridsEqual(grid, cycle[index - 1] as Grid) ? index : -1))
      .filter((index) => index > 0)
      .map((index) => `Frame ${String(before + index - 1)} repeats the frame before it; the model held a pose.`);
    const warnings = [
      ...repeats,
      ...checkAnimationCoherence(cycle, { paletteSize: colours.length, checkBounds: true }).map(({ message }) => message),
    ];
    const last = before + drawn.length - 1;
    const stillRejected = verdicts.filter((verdict) => !verdict.ok);
    const check = !verify
      ? "The vision check was skipped (verify: false)."
      : drawnNow.length === 0
        ? ""
        : repaired.length === 0
          ? `Vision check: all ${String(drawn.length)} frames match the plan and keep the source's identity, scale and facing.`
          : `Vision check rejected frame(s) ${repaired.map(String).join(", ")} and one repair sheet redrew them; ` +
            (stillRejected.length === 0
              ? "the second check passed every frame."
              : `the second check still flags ${stillRejected.map((verdict) => `frame ${String(verdict.frame)} (${verdict.problems.join(" ")})`).join("; ")} — inspect and redraw or edit those by hand.`);
    return (
      `Drew ${String(drawn.length)} frames of '${description}' onto '${name}' from ${String(sheets)} sprite-sheet generation(s), ` +
      `appended as frames ${String(before)}-${String(last)}. The selected source frame ${String(target.frame)} is the rest pose the cycle ` +
      `leaves and returns to${plan.source.length > 0 ? `; the planner read it as: ${plan.source}` : ""}. ` +
      `Frames: ${drawn.map((entry, index) => `${String(index + 1)}. [${String(entry.pose.ms)}ms] ${entry.pose.pose}${entry.pose.effect === undefined ? "" : ` (effect: ${entry.pose.effect})`}`).join(" ")} ` +
      `${retimeSource ? `Source frame ${String(target.frame)} now holds ${String(plan.restMs)}ms between repeats so the loop has a beat (it had the default ${String(DEFAULT_FRAME_DURATION_MS)}ms; undo restores it). ` : `Source frame ${String(target.frame)} keeps its ${String(sourceHold)}ms hold. `}` +
      `${added.length > 0 ? `Added ${added.join(", ")} to the palette for the effects (now ${String(colours.length)} colours). ` : ""}` +
      `${check} ${notes.join(" ")}${failures.length === 0 ? "" : ` ${String(failures.length)} problem(s): ${failures.join("; ")}.`} ` +
      `${warnings.length > 0 ? `Review needed (frame numbers relative to the source): ${warnings.join(" ")} ` : ""}` +
      `Play it back to judge timing, foot contact and anatomy; automatic checks cannot see those. Holds are game timing; for a GIF that loops in a chat, export_animation with speed 0.5 slows the clock without retiming the asset.`
    );
  },
};
