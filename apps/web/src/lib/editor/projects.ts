import { BUILTIN_PALETTES, createStyleProfile, expectedSize, type StyleProfile } from "@zenith/core";
import { assetStorage } from "./storage";

/**
 * Projects and folders — one game per project.
 *
 * The tree is separate from `EditorSession` on purpose. The session owns assets
 * and their documents; this owns where an asset *sits*. Keeping them apart is
 * what lets `projectId` stay optional: an asset with no project is not broken,
 * it is simply loose, and every existing asset in every existing browser is
 * exactly that. Phase 14's exit criteria require it and this honours it
 * literally rather than by migration.
 */

// StyleProfile lives in @zenith/core, alongside `checkStyleConsistency` which
// enforces it. Keeping the contract next to its checker is what stops the two
// drifting; a second definition here would be a second thing to keep in sync.
export interface Project {
  readonly id: string;
  readonly name: string;
  readonly style: StyleProfile;
  readonly order: number;
}

export interface Folder {
  readonly id: string;
  readonly projectId: string;
  /** null means the project root. */
  readonly parentId: string | null;
  readonly name: string;
  readonly order: number;
}

/** Where an asset sits. Both optional — a loose asset has neither. */
export interface AssetPlacement {
  readonly projectId: string | null;
  readonly folderId: string | null;
}

/**
 * The style a project starts from.
 *
 * A project always has a contract, even before anyone edits one — modelling
 * "no style yet" as a state would put a null check in front of every generation
 * and every conformance run. PICO-8 because it is sixteen colours, which is the
 * indexed-grid budget exactly, and it reads well at 32x32.
 */
export function defaultStyle(): StyleProfile {
  const palette = BUILTIN_PALETTES["pico-8"];
  if (palette === undefined) throw new Error("The pico-8 builtin palette is missing.");
  return createStyleProfile(palette);
}

export interface TreeNode {
  readonly folder: Folder;
  readonly children: readonly TreeNode[];
  readonly assetIds: readonly string[];
}

let projectCounter = 0;
let folderCounter = 0;

function nextProjectId(): string {
  projectCounter += 1;
  return `project_${String(projectCounter).padStart(3, "0")}`;
}

function nextFolderId(): string {
  folderCounter += 1;
  return `folder_${String(folderCounter).padStart(3, "0")}`;
}

/** Test seam: ids increment per process, which a fixture cannot predict. */
export function resetProjectIds(): void {
  projectCounter = 0;
  folderCounter = 0;
}

export class ProjectLibrary {
  readonly #projects = new Map<string, Project>();
  readonly #folders = new Map<string, Folder>();
  /** assetId -> placement. Absent means loose. */
  readonly #placements = new Map<string, AssetPlacement>();
  readonly #listeners = new Set<() => void>();

  #revision = 0;
  #order = 0;
  #activeProjectId: string | null = null;
  #activeFolderId: string | null = null;

  get revision(): number {
    return this.#revision;
  }

  get activeProjectId(): string | null {
    return this.#activeProjectId;
  }

  /**
   * The folder the human is looking at, or null for the project root.
   *
   * Page state, not stored state, and it lives here for the same reason
   * `activeProjectId` does: `create_asset` runs outside React and needs to know
   * where "here" is. Without it a new asset always landed at the project root
   * while the human had a folder open, and nothing said why.
   */
  get activeFolderId(): string | null {
    return this.#activeFolderId;
  }

  /** Selects a folder in the open project, or the project root with null. */
  openFolder(id: string | null): boolean {
    if (id === null) {
      this.#activeFolderId = null;
      this.#bump();
      return true;
    }
    const folder = this.#folders.get(id);
    if (folder === undefined || folder.projectId !== this.#activeProjectId) return false;
    this.#activeFolderId = id;
    this.#bump();
    return true;
  }

  #bump(): void {
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // ---------------------------------------------------------------- projects

  listProjects(): readonly Project[] {
    return [...this.#projects.values()].sort((a, b) => a.order - b.order);
  }

  getProject(id: string): Project | undefined {
    return this.#projects.get(id);
  }

  createProject(name: string, style: Partial<StyleProfile> = {}): string {
    const id = nextProjectId();
    this.#order += 1;
    this.#projects.set(id, {
      id,
      name: name.trim() === "" ? `Project ${String(this.#order)}` : name.trim(),
      style: { ...defaultStyle(), ...style },
      order: this.#order,
    });
    this.#activeProjectId = id;
    this.#bump();
    return id;
  }

  renameProject(id: string, name: string): boolean {
    const project = this.#projects.get(id);
    if (project === undefined || name.trim() === "") return false;
    this.#projects.set(id, { ...project, name: name.trim() });
    this.#bump();
    return true;
  }

  setStyle(id: string, style: Partial<StyleProfile>): boolean {
    const project = this.#projects.get(id);
    if (project === undefined) return false;
    this.#projects.set(id, { ...project, style: { ...project.style, ...style } });
    this.#bump();
    return true;
  }

  /** null explicitly clears project context when the route opens a loose asset. */
  openProject(id: string | null): boolean {
    if (id !== null && !this.#projects.has(id)) return false;
    this.#activeProjectId = id;
    // A folder id from the project being left would place new assets into
    // another project's tree, which `place` refuses — leaving them loose.
    this.#activeFolderId = null;
    this.#bump();
    return true;
  }

  /**
   * Removes a project and everything structural inside it.
   *
   * Assets are *unplaced*, never deleted — they return to the loose pool and
   * stay in the library. Deleting a project should not be able to destroy hours
   * of drawing, and "the folder is gone so the art is gone" is exactly the kind
   * of silent loss this codebase keeps finding.
   */
  deleteProject(id: string): number {
    if (!this.#projects.delete(id)) return 0;

    for (const [folderId, folder] of [...this.#folders]) {
      if (folder.projectId === id) {
        this.#folders.delete(folderId);
        if (this.#activeFolderId === folderId) this.#activeFolderId = null;
      }
    }
    let unplaced = 0;
    for (const [assetId, placement] of [...this.#placements]) {
      if (placement.projectId === id) {
        this.#placements.delete(assetId);
        unplaced += 1;
      }
    }
    if (this.#activeProjectId === id) {
      this.#activeProjectId = this.listProjects()[0]?.id ?? null;
    }
    this.#bump();
    return unplaced;
  }

  // ----------------------------------------------------------------- folders

  listFolders(projectId: string): readonly Folder[] {
    return [...this.#folders.values()]
      .filter((folder) => folder.projectId === projectId)
      .sort((a, b) => a.order - b.order);
  }

  getFolder(id: string): Folder | undefined {
    return this.#folders.get(id);
  }

  createFolder(projectId: string, name: string, parentId: string | null = null): string | null {
    if (!this.#projects.has(projectId)) return null;
    if (parentId !== null) {
      const parent = this.#folders.get(parentId);
      if (parent === undefined || parent.projectId !== projectId) return null;
    }

    const id = nextFolderId();
    this.#order += 1;
    this.#folders.set(id, {
      id,
      projectId,
      parentId,
      name: name.trim() === "" ? "New folder" : name.trim(),
      order: this.#order,
    });
    this.#bump();
    return id;
  }

  renameFolder(id: string, name: string): boolean {
    const folder = this.#folders.get(id);
    if (folder === undefined || name.trim() === "") return false;
    this.#folders.set(id, { ...folder, name: name.trim() });
    this.#bump();
    return true;
  }

  /** Every folder below `id`, itself included. */
  #descendants(id: string): Set<string> {
    const found = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of this.#folders.values()) {
        if (folder.parentId !== null && found.has(folder.parentId) && !found.has(folder.id)) {
          found.add(folder.id);
          grew = true;
        }
      }
    }
    return found;
  }

  /**
   * Reparents a folder, refusing to put one inside itself.
   *
   * A drag-and-drop tree makes that cycle one careless drop away, and the
   * result is not an error but a subtree that vanishes from the root walk while
   * still holding assets — invisible and unreachable. Refusing is the whole
   * point of the method.
   */
  moveFolder(id: string, parentId: string | null): boolean {
    const folder = this.#folders.get(id);
    if (folder === undefined) return false;
    if (parentId === id) return false;

    if (parentId !== null) {
      const parent = this.#folders.get(parentId);
      if (parent === undefined || parent.projectId !== folder.projectId) return false;
      if (this.#descendants(id).has(parentId)) return false;
    }

    this.#folders.set(id, { ...folder, parentId });
    this.#bump();
    return true;
  }

  /**
   * Deletes a folder, refusing while anything is inside it.
   *
   * A recursive delete would need an undo entry per asset, and the session's
   * undo holds one deletion. Refusing with a count is honest; silently taking
   * the contents with it is the failure this codebase has already had twice.
   */
  deleteFolder(id: string): { ok: boolean; assets: number; folders: number } {
    const folder = this.#folders.get(id);
    if (folder === undefined) return { ok: false, assets: 0, folders: 0 };

    const childFolders = [...this.#folders.values()].filter((each) => each.parentId === id).length;
    const childAssets = [...this.#placements.values()].filter((each) => each.folderId === id).length;
    if (childFolders > 0 || childAssets > 0) {
      return { ok: false, assets: childAssets, folders: childFolders };
    }

    this.#folders.delete(id);
    if (this.#activeFolderId === id) this.#activeFolderId = null;
    this.#bump();
    return { ok: true, assets: 0, folders: 0 };
  }

  // -------------------------------------------------------------- placements

  placementOf(assetId: string): AssetPlacement {
    return this.#placements.get(assetId) ?? { projectId: null, folderId: null };
  }

  /** Assets sitting directly in a folder, or at a project's root when null. */
  assetsIn(projectId: string, folderId: string | null): readonly string[] {
    const found: string[] = [];
    for (const [assetId, placement] of this.#placements) {
      if (placement.projectId === projectId && placement.folderId === folderId) found.push(assetId);
    }
    return found;
  }

  /** Every asset anywhere in a project, at any depth. */
  assetsInProject(projectId: string): readonly string[] {
    const found: string[] = [];
    for (const [assetId, placement] of this.#placements) {
      if (placement.projectId === projectId) found.push(assetId);
    }
    return found;
  }

  place(assetId: string, projectId: string, folderId: string | null = null): boolean {
    if (!this.#projects.has(projectId)) return false;
    if (folderId !== null) {
      const folder = this.#folders.get(folderId);
      if (folder === undefined || folder.projectId !== projectId) return false;
    }
    const previous = this.#placements.get(assetId)?.projectId ?? null;
    if (previous !== projectId) this.#removeStyleReference(assetId, previous);
    this.#placements.set(assetId, { projectId, folderId });
    this.#bump();
    return true;
  }

  /**
   * Puts a new asset exactly where an existing one sits — project *and* folder.
   *
   * Every derived asset should land beside its source: eight rotation
   * directions, a variation set, a tileset sheet. `place(id, projectId)` alone
   * is not that. Its `folderId` defaults to null, so a chest sitting in
   * `Props/Chests` produced variations at the project root — visible, but not
   * where the human was working, and the tree they were reading no longer
   * described the set.
   *
   * Falls back to the project root rather than leaving the asset loose. A
   * missing folder is nearly impossible here (the placement was read from a
   * sibling moments earlier) and a loose by-product is the worse failure: it
   * disappears from the project screen entirely, with nothing reporting it.
   */
  inherit(sourceId: string, assetId: string): boolean {
    const { projectId, folderId } = this.placementOf(sourceId);
    if (projectId === null) return false;
    return this.place(assetId, projectId, folderId) || this.place(assetId, projectId);
  }

  /** Returns an asset to the loose pool without touching the asset itself. */
  unplace(assetId: string): boolean {
    const previous = this.#placements.get(assetId)?.projectId ?? null;
    if (!this.#placements.delete(assetId)) return false;
    this.#removeStyleReference(assetId, previous);
    this.#bump();
    return true;
  }

  /** Membership and references change before one notification, for UI and tools alike. */
  #removeStyleReference(assetId: string, projectId: string | null): void {
    const project = projectId === null ? undefined : this.#projects.get(projectId);
    if (project === undefined || !project.style.references.includes(assetId)) return;
    this.#projects.set(project.id, {
      ...project,
      style: { ...project.style, references: project.style.references.filter(id => id !== assetId) },
    });
  }

  /** Builds the folder tree for a project, roots first. */
  tree(projectId: string): readonly TreeNode[] {
    const folders = this.listFolders(projectId);
    const build = (parentId: string | null): TreeNode[] =>
      folders
        .filter((folder) => folder.parentId === parentId)
        .map((folder) => ({
          folder,
          children: build(folder.id),
          assetIds: this.assetsIn(projectId, folder.id),
        }));
    return build(null);
  }

  // ------------------------------------------------------------- persistence

  /** Everything needed to rebuild this library, for IndexedDB. */
  snapshot(): {
    projects: readonly Project[];
    folders: readonly Folder[];
    placements: readonly (AssetPlacement & { assetId: string })[];
  } {
    return {
      projects: this.listProjects(),
      folders: [...this.#folders.values()],
      placements: [...this.#placements].map(([assetId, placement]) => ({ assetId, ...placement })),
    };
  }

  restore(snapshot: {
    projects?: readonly Project[];
    folders?: readonly Folder[];
    placements?: readonly (AssetPlacement & { assetId: string })[];
  }): void {
    this.#projects.clear();
    this.#folders.clear();
    this.#placements.clear();
    this.#order = 0;

    for (const project of snapshot.projects ?? []) {
      this.#projects.set(project.id, { ...project, style: { ...defaultStyle(), ...project.style } });
      this.#order = Math.max(this.#order, project.order);
      // Ids are handed out per process; restoring must not reissue one.
      const numeric = Number.parseInt(project.id.replace(/\D/g, ""), 10);
      if (Number.isInteger(numeric)) projectCounter = Math.max(projectCounter, numeric);
    }
    for (const folder of snapshot.folders ?? []) {
      this.#folders.set(folder.id, folder);
      this.#order = Math.max(this.#order, folder.order);
      const numeric = Number.parseInt(folder.id.replace(/\D/g, ""), 10);
      if (Number.isInteger(numeric)) folderCounter = Math.max(folderCounter, numeric);
    }
    for (const placement of snapshot.placements ?? []) {
      const { assetId, ...rest } = placement;
      this.#placements.set(assetId, rest);
    }
    this.#activeProjectId = this.listProjects()[0]?.id ?? null;
    this.#activeFolderId = null;
    this.#bump();
  }
}

export const projects = new ProjectLibrary();

/**
 * The canvas size the open project expects for a type, or null when loose.
 *
 * One game is one resolution, so a new asset inside a project should not have
 * to be told what size to be. Without this, choosing 64x64 for a project and
 * then adding an asset to it produced a 32x32 canvas — and since generation
 * draws at the canvas's own size, everything after that was 32x32 too.
 */
export function activeCanvasSize(assetType: string): number | null {
  const id = projects.activeProjectId;
  const project = id === null ? undefined : projects.getProject(id);
  return project === undefined ? null : expectedSize(project.style, assetType);
}

/**
 * Reads the tree from storage once, and keeps it written thereafter.
 *
 * Guarded by the in-flight promise rather than a boolean, for the same reason
 * `session.hydrate` is: React Strict Mode double-invokes effects, and a guard
 * set before an await lets the second call see an empty library and overwrite
 * the stored tree with nothing.
 */
let hydrating: Promise<void> | null = null;

export function hydrateProjects(): Promise<void> {
  if (hydrating !== null) return hydrating;

  hydrating = (async () => {
    // Open the database here rather than assuming someone else has. `loadTree`
    // returns null when the connection is not up yet, which is indistinguishable
    // from "no tree stored" — so losing the race read as an empty library and
    // the explorer said no project was open while one sat in IndexedDB.
    if (!(await assetStorage.open())) return;

    const stored = await assetStorage.loadTree();
    if (stored !== null && stored !== undefined && typeof stored === "object") {
      projects.restore(stored as Parameters<ProjectLibrary["restore"]>[0]);
    }
    // Subscribed after the restore, so replaying the stored tree does not
    // immediately write it back.
    projects.subscribe(() => {
      void assetStorage.saveTree(projects.snapshot());
    });
  })();

  return hydrating;
}
