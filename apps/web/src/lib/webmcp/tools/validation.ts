import { checkSeamlessTiling, describeSeamMismatch, type SeamReport } from "@zenith/core";
import type { ToolDefinition } from "../types";
import { requireActiveAsset, toToolError } from "./active";

/**
 * Validation — how the agent checks its own work.
 *
 * The check returns coordinates, never a bare boolean, because that is what
 * closes the loop: fail, fix exactly those pixels, re-check, pass. A tool that
 * says "not seamless" and stops leaves the agent guessing, and guessing at
 * pixel positions is how it wastes turns.
 */

function describeSide(label: string, report: SeamReport, axis: "leftRight" | "topBottom"): string {
  if (report.pass) {
    return `${label}: PASS (${String(report.checked)} checked)`;
  }
  const lines = report.mismatches.map((mismatch) => `    ${describeSeamMismatch(mismatch, axis)}`);
  return `${label}: FAIL — ${String(report.mismatches.length)} of ${String(report.checked)} mismatch\n${lines.join("\n")}`;
}

export const checkSeamlessTilingTool: ToolDefinition = {
  scope: "tile",
  name: "check_seamless_tiling",
  description:
    "Check whether the currently open asset repeats without a visible seam, and report the exact coordinates of every mismatch. The test is not whether opposite edges are identical — almost no hand-drawn tile passes that. A seam pairing is acceptable when the same pairing of colours already occurs somewhere inside the tile: mortar beside stone at the seam is invisible if mortar sits beside stone throughout, and glaring if it appears nowhere else. Each failure names both pixels, so fix those coordinates with set_pixels and call this again to confirm. The verdict is graded — seamless, minor, or seam — because a handful of mismatches is normal on a busy 16-colour tile while a real seam fails most of an edge; the thresholds come from measuring textures that tile by construction against ones that visibly do not. Note that a good score means little on a noisy or dithered texture: noise tiles trivially, so seam quality and whether the art reads as pixel art are close to independent questions. Coordinates are asset-local: (0,0) is the top-left pixel, x increases right, y increases down.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { name, store } = requireActiveAsset();
    let report;
    try {
      report = checkSeamlessTiling(store.readComposite());
    } catch (error) {
      throw toToolError(error);
    }

    const sides = [
      describeSide("  left/right edge", report.leftRight, "leftRight"),
      describeSide("  top/bottom edge", report.topBottom, "topBottom"),
    ].join("\n");

    if (report.verdict === "seamless") {
      return `'${name}' tiles seamlessly.\n${sides}`;
    }
    const total = report.leftRight.mismatches.length + report.topBottom.mismatches.length;
    const share = `${(report.severity * 100).toFixed(0)}% of seam positions`;

    if (report.verdict === "minor") {
      return (
        `'${name}' tiles with minor discontinuities — ${String(total)} mismatching position(s), ${share}.\n${sides}\n` +
        `This is usable. Bigger, blockier features tile worse because the wrap is likelier to cut one, so this is ` +
        `often the cost of art that reads clearly rather than a defect. Inspect before rewriting.`
      );
    }

    return `'${name}' does NOT tile seamlessly — ${String(total)} mismatching position(s), ${share}.\n${sides}\nFix those pixels with set_pixels or write_region, then call check_seamless_tiling again.`;
  },
};
