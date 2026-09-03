import { scopeApplies, type ScopeContext } from "../scope";
import type { ToolDefinition } from "../types";
import {
  createAsset,
  deleteAsset,
  describeAsset,
  duplicateAsset,
  listAssets,
  openAsset,
  renameAsset,
  setAssetType,
} from "./context";
import {
  bucketFill,
  fillRegion,
  replaceColor,
  setPixels,
  writeRegion,
} from "./editing";
import { redo, undo } from "./history";
import {
  checkReadabilityTool,
  findColorRegionsTool,
  getColorAt,
  getPalette,
  readCanvas,
  readRegion,
} from "./perception";
import { checkSeamlessTilingTool } from "./validation";
import {
  exportAnimation,
  exportForEngineTool,
  exportPaletteTool,
  exportPng,
  exportProject,
  listExports,
  readExport,
  releaseExport,
} from "./export";
import { createToolJobTools } from "./jobs";
import {
  createFolder,
  deleteFolder,
  deleteProject,
  flushStorage,
  getStorageStatus,
  importProject,
  listProjectContents,
  moveAsset,
  renameFolder,
  renameProject,
  undoDelete,
} from "./project-io";
import {
  checkGridAlignment,
  deriveVariant,
  drawFromPrompt,
  extractPalette,
  generateAsset,
  generateVariationSet,
  pixelizeCanvas,
  reduceColors,
  removeBackground,
} from "./generation";
import { focusViewport, getViewport } from "./viewport";
import {
  addStyleReference,
  checkStyleConsistencyTool,
  conformToStyleTool,
  createProject,
  getStyleProfile,
  listProjects,
  openProject,
  setStyleProfile,
} from "./projects";
import {
  addFrame,
  deleteFrame,
  getSilhouette,
  listFrames,
  readFrame,
  reorderFrames,
  selectFrame,
  setFrameDuration,
} from "./frames";
import {
  animateProceduralTool,
  checkAnimationCoherenceTool,
  interpolateFramesTool,
  readAnimationSummaryTool,
  readFramesDiffTool,
} from "./animation";
import {
  clearRegion,
  cropToContent,
  ditherRegion,
  drawLine,
  drawRect,
  mirrorTool,
  resizeCanvasTool,
  rotateGridTool,
  shiftTool,
} from "./transform";
import {
  deriveDirectionByMirror,
  generateDirectionSet,
  getDirections,
  rotateCharacter,
  selectDirection,
} from "./directions";
import { animateWithText } from "./animate-text";
import {
  buildCharacterTool,
  estimateSkeletonTool,
  generateTilesetTool,
  importImageTool,
  setPaletteTool,
} from "./authoring";
import {
  assembleMapTool,
  extendMapTool,
  generateIsometricTile,
  generateTexture,
} from "./worlds";
import { inpaintRegion } from "./inpaint";
import { animateWithSkeletonTool } from "./skeleton";

/**
 * The tool surface.
 *
 * Phase 03 fixed its own set at fourteen, and deliberately not fifteen.
 *
 * An agent that can read a grid, write a grid, fill, recolour, verify, undo and
 * export can complete the whole demo loop. Everything past that saves tokens,
 * and tokens are not the constraint at 32x32 — so `read_region`, `get_color_at`,
 * `clear_region` (fill_region with index -1) and `set_palette` wait for the
 * phases that need them.
 *
 * Phase 04 adds the two viewport tools, which are that phase's own "tools
 * introduced" rather than growth of the phase 03 set.
 */

export type ToolGroup =
  | "Projects"
  | "Context"
  | "Viewport"
  | "Perception"
  | "Editing"
  | "Frames"
  | "Animation"
  | "Directions"
  | "History"
  | "Generation"
  | "Authoring"
  | "Worlds"
  | "Validation"
  | "Export";

export interface GroupedTools {
  readonly group: ToolGroup;
  readonly tools: readonly ToolDefinition[];
}

const { startToolJob, getToolJob } = createToolJobTools(findTool);

export const TOOL_GROUPS: readonly GroupedTools[] = [
  {
    group: "Projects",
    tools: [
      listProjects,
      createProject,
      deleteProject,
      renameFolder,
      deleteFolder,
      undoDelete,
      openProject,
      listProjectContents,
      createFolder,
      moveAsset,
      renameProject,
      importProject,
      getStorageStatus,
      flushStorage,
      getStyleProfile,
      setStyleProfile,
      addStyleReference,
      checkStyleConsistencyTool,
      conformToStyleTool,
    ],
  },
  {
    group: "Context",
    tools: [
      listAssets,
      createAsset,
      openAsset,
      renameAsset,
      setAssetType,
      duplicateAsset,
      deleteAsset,
      describeAsset,
      startToolJob,
      getToolJob,
    ],
  },
  { group: "Viewport", tools: [getViewport, focusViewport] },
  {
    group: "Perception",
    tools: [
      readCanvas,
      readRegion,
      getPalette,
      getColorAt,
      findColorRegionsTool,
      checkReadabilityTool,
    ],
  },
  {
    group: "Editing",
    tools: [
      writeRegion,
      setPixels,
      fillRegion,
      bucketFill,
      replaceColor,
      clearRegion,
      shiftTool,
      mirrorTool,
      drawLine,
      drawRect,
      ditherRegion,
      rotateGridTool,
      resizeCanvasTool,
      cropToContent,
    ],
  },
  {
    group: "Frames",
    tools: [
      listFrames,
      addFrame,
      selectFrame,
      deleteFrame,
      reorderFrames,
      setFrameDuration,
      readFrame,
      getSilhouette,
    ],
  },
  {
    group: "Animation",
    tools: [
      readFramesDiffTool,
      readAnimationSummaryTool,
      checkAnimationCoherenceTool,
      animateProceduralTool,
      interpolateFramesTool,
      animateWithText,
      animateWithSkeletonTool,
    ],
  },
  {
    group: "Directions",
    tools: [
      getDirections,
      selectDirection,
      deriveDirectionByMirror,
      rotateCharacter,
      generateDirectionSet,
    ],
  },
  { group: "History", tools: [undo, redo] },
  {
    group: "Generation",
    tools: [
      generateAsset,
      drawFromPrompt,
      deriveVariant,
      generateVariationSet,
      inpaintRegion,
      pixelizeCanvas,
      importImageTool,
      buildCharacterTool,
      generateTilesetTool,
      reduceColors,
      removeBackground,
      extractPalette,
      checkGridAlignment,
    ],
  },
  {
    group: "Authoring",
    tools: [setPaletteTool, estimateSkeletonTool],
  },
  {
    group: "Worlds",
    tools: [
      generateTexture,
      generateIsometricTile,
      assembleMapTool,
      extendMapTool,
    ],
  },
  { group: "Validation", tools: [checkSeamlessTilingTool] },
  {
    group: "Export",
    tools: [
      exportPng,
      exportAnimation,
      exportForEngineTool,
      exportPaletteTool,
      exportProject,
      listExports,
      readExport,
      releaseExport,
    ],
  },
];

export const TOOLS: readonly ToolDefinition[] = TOOL_GROUPS.flatMap(
  (entry) => entry.tools,
);

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function findTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

export function groupOf(name: string): ToolGroup | undefined {
  return TOOL_GROUPS.find((entry) =>
    entry.tools.some((tool) => tool.name === name),
  )?.group;
}

/** The tools an agent should see for the current view. Order is stable. */
export function toolsForContext(
  context: ScopeContext,
): readonly ToolDefinition[] {
  return TOOLS.filter((tool) => scopeApplies(tool.scope ?? "editor", context));
}
