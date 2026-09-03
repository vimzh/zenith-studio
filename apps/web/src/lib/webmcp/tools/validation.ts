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
    "Check the open tile/texture for seam colour pairings absent from its interior, not identical opposite edges. Returns seamless/minor/seam and exact mismatch pixels; fix with set_pixels then recheck. Noise/dither can pass without readable art. Asset-local (0,0) top-left, x right, y down.",
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
