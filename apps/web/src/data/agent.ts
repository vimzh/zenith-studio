/** Copy for the Agent Console (phase 03). */

export const agentConsoleCopy = {
  title: "Agent",
  subtitle: "Tool calls land on the canvas beside you.",
  status: {
    connectedLabel: "WebMCP connected",
    partialLabel: "WebMCP partially registered",
    unavailableLabel: "WebMCP unavailable",
    refusedLabel: "Registration refused",
    surfaceDocument: "document.modelContext",
    surfaceNavigator: "navigator.modelContext",
    unavailableHint:
      "Enable chrome://flags/#enable-webmcp-testing in Chrome 149+, or open this page in the ChatGPT in-app browser. Every tool below still runs from here.",
    toolCountSuffix: "tools registered",
  },
  runner: {
    heading: "Run a tool",
    hint: "The same handlers an agent calls. Works with no WebMCP client present.",
    toolLabel: "Tool",
    argumentsLabel: "Arguments (JSON)",
    runLabel: "Run",
    runningLabel: "Running…",
    invalidJson: "Arguments must be a JSON object.",
    readOnlyBadge: "read-only",
  },
  transcript: {
    heading: "Transcript",
    clearLabel: "Clear",
    emptyTitle: "No tool calls yet",
    emptyBody: "Run a tool below, or connect an agent and ask it to read the canvas.",
    agentSource: "agent",
    consoleSource: "console",
  },
  chat: {
    heading: "Chat",
    placeholder: "Ask for a change, or a check…",
    sendLabel: "Send",
    stopLabel: "Stop",
    clearLabel: "Clear",
    emptyTitle: "Talk to the canvas",
    emptyBody:
      "Ask for an edit and it happens here, on the same pixels you are working on. Select a region first to talk about just that part.",
    unavailable: "No asset is open, so there is nothing to edit yet.",
    diverged:
      "The editor and the tool layer disagree about which asset is open, so tools are paused rather than risk editing something you are not looking at. Reopening the asset from the library fixes it.",
    missing: "This asset is no longer in the session. Open one from the library.",
    thinkingLabel: "Working…",
    selectionLabel: "selection attached",
    youLabel: "You",
    assistantLabel: "Assistant",
  },
} as const;

/** Costs shown before completing a character's existing direction family. */
export const directionPanelCopy = {
  complete: (set: string) => `${set} is complete.`,
  mirrored: (mirrors: number, models: number) => `${String(mirrors)} free by mirroring, ${String(models)} need a model.`,
  missing: (missing: number, calls: number) => `${String(missing)} directions are missing. Nothing can be mirrored yet; ${String(calls)} model calls would complete the set.`,
};

export const timelineCopy = { mixedFps: "Mixed" } as const;

/** The asset panel's text-animation section. */
export const animationPanelCopy = {
  title: "Text animation",
  descriptionLabel: "Animation description",
  descriptionPlaceholder: "A quick jab, an overhead slash, a jump…",
  effectsLabel: "Animation effects",
  effectsPlaceholder: "Effects, optional: purple trail behind the blade, air-cut arc…",
  framesLabel: "Animation frame count",
  generateLabel: "Generate frames",
  hint: "One image buys the whole cycle beside the source frame; a vision check redraws frames that drift. Results appear in the timeline below the canvas.",
} as const;

export const skeletonPanelCopy = {
  title: "Skeleton",
  estimateLabel: "Estimate from silhouette",
  reestimateLabel: "Re-estimate from this frame",
  hideLabel: "Hide skeleton",
  typeLabel: "Character type",
  types: [
    { value: "bipedal", label: "bipedal" },
    { value: "bipedal-chibi", label: "chibi" },
    { value: "quadrupedal", label: "quadruped" },
  ],
  facingLabel: "Facing",
  facings: [
    { value: "east", label: "faces east" },
    { value: "west", label: "faces west" },
  ],
  templateLabel: "Pose template",
  templatePlaceholder: "Pose…",
  buildCycleLabel: (template: string) => `Build ${template} cycle — local`,
  framesLabel: "Skeleton animation frame count",
  bakeLabel: "Create posed frame — local",
  resetLabel: "Reset pose",
  hint: "Drag a joint on the canvas: the sprite follows live, limbs turn as one piece, and the pose snaps to art pixels. Create posed frame adds the result as a new editable frame; a template pose or cycle turns this character's own limbs by the template's angles.",
  quadrupedHint: "Stock cycles are bipedal. Pose a quadruped by dragging its joints, then create the frame.",
} as const;
