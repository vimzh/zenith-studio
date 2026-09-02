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
     * These are the sizes the pipeline and the presets already work in: 16 for
     * icon-scale work, 32 for the common sprite size everything defaults to,
     * 48 and 64 where a character needs the room. Every asset type in the
     * project starts at the chosen size; the style panel can still tune one
     * type afterwards.
     */
    resolutions: [16, 32, 48, 64],
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
