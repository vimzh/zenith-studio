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
