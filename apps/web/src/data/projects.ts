/** Copy for the project library and the project screen behind it. */
export const projectsContent = {
  library: {
    title: "Projects",
    allAssets: "All assets",
    settings: "Settings",
    create: "New project",
    namePlaceholder: "Moss Hollow",
    resolutionLabel: "Resolution",
    /**
     * One game is one resolution, so it is chosen once, here.
     *
     * 16 for icon-scale work, 32 for the common sprite size everything defaults
     * to, 48 and 64 where a character needs the room, 128 and 256 for the
     * detailed end. 256 is the ceiling the document model already enforces on
     * `resize_canvas`, so nothing here can ask for a canvas the rest of the
     * product refuses.
     *
     * The large sizes cost the agent, not the editor: `read_canvas` sends one
     * character per pixel, so a 256x256 frame is 65,536 of them — roughly 21k
     * tokens against 330 for a 32x32. Reading a whole 256 canvas repeatedly is
     * the expensive habit; `read_region` and `read_frames_diff` exist for it.
     *
     * Every asset type in the project starts at the chosen size; the style
     * panel can still tune one type afterwards.
     */
    resolutions: [16, 32, 48, 64, 128, 256],
    confirm: "Create",
    cancel: "Cancel",
    empty:
      "No projects yet. A project is one game — its style profile keeps everything inside it consistent.",
    loose: {
      title: "Not in a project",
      description:
        "These work exactly as before. Drag one into a folder from inside a project to adopt it.",
    },
  },
  project: {
    back: "Projects",
    style: "Style",
    export: "Export",
    newAsset: "New asset",
    loading: "Loading…",
    empty: "Nothing in this project yet. Add an asset from the explorer on the left.",
    missing: "is not in this library.",
  },
} as const;
