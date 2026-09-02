"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Copy, FilePlus2, FolderPlus, Folder as FolderIcon, FolderOpen, Pencil, Trash2 } from "lucide-react";
import {
  activeCanvasSize,
  deleteAsset,
  hydrateProjects,
  projects,
  session,
  undoDeleteAsset,
  useSessionSelector,
  type Folder,
  type TreeNode,
} from "@/lib/editor";
import { assetRouteId } from "@/lib/webmcp";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProjectSelector } from "./use-projects";

/**
 * The project tree, as a code editor's file explorer.
 *
 * Folders are where an asset sits, not what it is: dragging one between folders
 * changes a placement record and never touches the document. That is why a
 * failed drop is harmless and why deleting a project cannot destroy artwork.
 *
 * A folder's whole block is its drop target, header and contents alike, and it
 * stops the event rather than letting it reach the root. Without that stop both
 * handlers run and the parent's is last, so every drop into a folder silently
 * landed at the project root instead — the drag appeared to work and quietly
 * did the wrong thing. Empty space below the tree is the root target, which is
 * how an asset gets back out of a folder.
 */

const selectAssets = (current: typeof session) => current.list();
const selectDeleted = (current: typeof session) => current.lastDeleted;

interface DropTarget {
  readonly projectId: string;
  readonly folderId: string | null;
}

export function ProjectExplorer() {
  const router = useRouter();
  // The route parameter is an asset id on /asset/[id] and a project id on
  // /project/[id]. Parsing the path says which, so a project id can never be
  // mistaken for the open asset.
  const openAssetId = assetRouteId(usePathname());

  const assets = useSessionSelector(selectAssets);
  const deleted = useSessionSelector(selectDeleted);
  const tree = useProjectSelector(
    useCallback((library) => {
      const projectId = library.activeProjectId;
      if (projectId === null) return null;
      return {
        projectId,
        name: library.getProject(projectId)?.name ?? "Project",
        nodes: library.tree(projectId),
        rootAssets: library.assetsIn(projectId, null),
        projects: library.listProjects(),
        selectedFolderId: library.activeFolderId,
      };
    }, [])
  );

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState<DropTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [folderNotice, setFolderNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<
    { readonly kind: "asset" | "project" | "folder"; readonly id: string } | null
  >(null);

  useEffect(() => {
    void hydrateProjects();
  }, []);

  /**
   * Reveal the open asset's folder when the route changes to a new asset.
   *
   * Adjusting state during render rather than in an effect: this is a response
   * to a changed prop, not a side effect, and React documents this pattern for
   * exactly that. An effect here would render once with the folder collapsed
   * and again with it open, which is the cascading render the lint rule names.
   *
   * Keyed on the previous id so it fires once per navigation. Deriving the set
   * instead would be simpler and wrong — the user could never collapse a folder
   * containing the asset they are editing, because it would reopen immediately.
   */
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  if (openAssetId !== null && openAssetId !== revealedFor) {
    setRevealedFor(openAssetId);
    const { folderId } = projects.placementOf(openAssetId);
    if (folderId !== null) {
      setExpanded((current) => {
        const next = new Set(current);
        // Every ancestor, not just the immediate folder, or a nested asset
        // stays hidden behind a collapsed parent.
        let walk: Folder | undefined = projects.getFolder(folderId);
        while (walk !== undefined) {
          next.add(walk.id);
          walk = walk.parentId === null ? undefined : projects.getFolder(walk.parentId);
        }
        return next;
      });
    }
  }

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const onDrop = useCallback(
    (target: DropTarget) => {
      setOver(null);
      const assetId = dragging;
      setDragging(null);
      if (assetId === null) return;
      projects.place(assetId, target.projectId, target.folderId);
      // Reveal where it landed. A drop into a collapsed folder is otherwise
      // indistinguishable from a drop that did nothing.
      if (target.folderId !== null) {
        setExpanded((current) => new Set(current).add(target.folderId as string));
      }
    },
    [dragging]
  );

  const addFolder = useCallback((parentId: string | null) => {
    const projectId = projects.activeProjectId;
    if (projectId === null) return;
    const id = projects.createFolder(projectId, "New folder", parentId);
    if (id === null) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (parentId !== null) next.add(parentId);
      return next;
    });
    // Straight into the name field. A folder that cannot be renamed after
    // creation is a folder called "New folder" forever, which is what shipped.
    setRenaming({ kind: "folder", id });
  }, []);

  /**
   * Deleting is undoable, so it does not ask first — it reports.
   *
   * A confirm step in a 248px sidebar row costs two clicks on every deletion to
   * protect against a mis-click that the undo bar below already fixes. What it
   * must not do is leave the route pointing at art that no longer exists: this
   * is the `session.close` hazard named in AGENTS.md, reached from the library
   * rather than from a tool. Only the asset actually on screen moves the route,
   * and it moves to the project rather than to some other asset.
   */
  /**
   * Removing a folder, which the model refuses while anything is inside it.
   *
   * The refusal is the feature — a recursive delete would need an undo entry
   * per asset and the session holds one — so the count it returns is reported
   * rather than swallowed. Silently doing nothing would look like a broken
   * button, which is how this looked before it existed at all.
   */
  const removeFolder = useCallback((id: string, folderName: string) => {
    const outcome = projects.deleteFolder(id);
    if (outcome.ok) {
      setFolderNotice(null);
      return;
    }
    const inside = [
      outcome.assets > 0 ? `${String(outcome.assets)} asset${outcome.assets === 1 ? "" : "s"}` : null,
      outcome.folders > 0 ? `${String(outcome.folders)} folder${outcome.folders === 1 ? "" : "s"}` : null,
    ].filter((part): part is string => part !== null);
    setFolderNotice(`${folderName} still holds ${inside.join(" and ")}. Move or delete them first.`);
  }, []);

  /**
   * A copy, beside the original, for working a variation without risking it.
   *
   * `session.duplicate` existed and could only be reached from the flat library
   * screen, which is not where anyone is when they want a second chest. The
   * copy inherits the source's folder, opens, and goes straight into its name
   * field — the name is the whole point of making one.
   */
  const copyAsset = useCallback(
    (id: string) => {
      const copyId = session.duplicate(id);
      if (copyId === null) return;
      projects.inherit(id, copyId);
      setRenaming({ kind: "asset", id: copyId });
      router.push(`/asset/${copyId}`);
    },
    [router]
  );

  const removeAsset = useCallback(
    (id: string, projectId: string) => {
      deleteAsset(id);
      if (id === openAssetId) router.push(`/project/${projectId}`);
    },
    [openAssetId, router]
  );

  const createAsset = useCallback(
    (target: DropTarget, name: string) => {
      // A new asset is the project's resolution: one game is one size.
      const size = activeCanvasSize("tile");
      const id = session.create({
        name: name.trim() === "" ? "Untitled" : name.trim(),
        ...(size === null ? {} : { width: size, height: size }),
      });
      projects.place(id, target.projectId, target.folderId);
      setAdding(null);
      setDraft("");
      router.push(`/asset/${id}`);
    },
    [router]
  );

  if (tree === null) {
    return (
      <p className="px-3 py-4 font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
        No project open. Pick one from the library to see its files here.
      </p>
    );
  }

  const nameOf = (id: string): string =>
    assets.find((asset) => asset.id === id)?.name ?? id;

  const renderAsset = (id: string, depth: number) => {
    const name = nameOf(id);
    const isRenaming = renaming?.kind === "asset" && renaming.id === id;

    return (
      <div className="flex items-center gap-0.5 pr-1" key={id}>
        {isRenaming ? (
          <div className="min-w-0 flex-1" style={{ paddingLeft: `${String(depth * 12 + 20)}px` }}>
            <RenameField
              label={`Rename ${name}`}
              name={name}
              onCancel={() => setRenaming(null)}
              onCommit={(next) => {
                session.rename(id, next);
                setRenaming(null);
              }}
            />
          </div>
        ) : (
          <button
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-0.5 pr-2 text-left font-mono text-[0.72rem] transition-colors",
              "hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              id === openAssetId ? "bg-accent text-foreground" : "text-muted-foreground",
              dragging === id && "opacity-40"
            )}
            draggable
            onClick={() => router.push(`/asset/${id}`)}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", id);
              setDragging(id);
            }}
            style={{ paddingLeft: `${String(depth * 12 + 20)}px` }}
            type="button"
          >
            <span className="truncate">{name}</span>
          </button>
        )}
        {isRenaming ? null : (
          <>
            <IconAction
              icon={Copy}
              label={`Duplicate ${name}`}
              onClick={() => copyAsset(id)}
            />
            <IconAction
              icon={Pencil}
              label={`Rename ${name}`}
              onClick={() => setRenaming({ kind: "asset", id })}
            />
            <IconAction
              icon={Trash2}
              label={`Delete ${name}`}
              onClick={() => removeAsset(id, tree.projectId)}
            />
          </>
        )}
      </div>
    );
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isOpen = expanded.has(node.folder.id);
    const key = `folder:${node.folder.id}`;
    if (renaming?.kind === "folder" && renaming.id === node.folder.id) {
      return (
        <div
          className="flex items-center gap-1 pr-1"
          key={node.folder.id}
          style={{ paddingLeft: `${String(depth * 12 + 4)}px` }}
        >
          <RenameField
            label={`Rename ${node.folder.name}`}
            name={node.folder.name}
            onCancel={() => setRenaming(null)}
            onCommit={(next) => {
              projects.renameFolder(node.folder.id, next);
              setRenaming(null);
            }}
          />
        </div>
      );
    }
    return (
      <div
        className={cn("rounded-sm", over === key && "bg-accent/40 ring-1 ring-inset ring-ring")}
        key={node.folder.id}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setOver((current) => (current === key ? null : current));
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setOver(key);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDrop({ projectId: tree.projectId, folderId: node.folder.id });
        }}
      >
        <div
          className={cn(
            "flex items-center gap-1 rounded-sm pr-1 transition-colors",
            tree.selectedFolderId === node.folder.id && "bg-accent/60"
          )}
          style={{ paddingLeft: `${String(depth * 12 + 4)}px` }}
        >
          <button
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.folder.name}`}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left text-[0.72rem] hover:text-foreground"
            onClick={() => {
              // One click does both: it opens the folder and makes it where new
              // assets land. A separate "select" affordance would be a second
              // thing to discover for a tree that has one obvious gesture.
              toggle(node.folder.id);
              projects.openFolder(node.folder.id);
            }}
            type="button"
          >
            {isOpen ? (
              <ChevronDown aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
            ) : (
              <ChevronRight aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
            )}
            {isOpen ? (
              <FolderOpen aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
            ) : (
              <FolderIcon aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
            )}
            <span className="truncate font-mono">{node.folder.name}</span>
          </button>

          <IconAction
            icon={Pencil}
            label={`Rename ${node.folder.name}`}
            onClick={() => setRenaming({ kind: "folder", id: node.folder.id })}
          />
          <IconAction
            icon={FilePlus2}
            label={`New asset in ${node.folder.name}`}
            onClick={() => {
              setExpanded((current) => new Set(current).add(node.folder.id));
              setAdding({ projectId: tree.projectId, folderId: node.folder.id });
            }}
          />
          <IconAction
            icon={FolderPlus}
            label={`New folder in ${node.folder.name}`}
            onClick={() => addFolder(node.folder.id)}
          />
          <IconAction
            icon={Trash2}
            label={`Delete ${node.folder.name}`}
            onClick={() => removeFolder(node.folder.id, node.folder.name)}
          />
        </div>

        {isOpen ? (
          <>
            {node.children.map((child) => renderNode(child, depth + 1))}
            {node.assetIds.map((id) => renderAsset(id, depth + 1))}
            {adding?.folderId === node.folder.id ? (
              <NameField
                depth={depth + 1}
                onCancel={() => setAdding(null)}
                onCommit={(name) => createAsset(adding, name)}
                setValue={setDraft}
                value={draft}
              />
            ) : null}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {renaming?.kind === "project" && renaming.id === tree.projectId ? (
          <RenameField
            label={`Rename ${tree.name}`}
            name={tree.name}
            onCancel={() => setRenaming(null)}
            onCommit={(next) => {
              projects.renameProject(tree.projectId, next);
              setRenaming(null);
            }}
          />
        ) : (
          <Select
            onValueChange={(projectId) => {
              projects.openProject(projectId);
              router.push(`/project/${projectId}`);
            }}
            value={tree.projectId}
          >
            <SelectTrigger aria-label="Switch project" className="h-7 min-w-0 flex-1 rounded-sm border-0 bg-transparent px-1 font-mono text-[0.7rem] uppercase tracking-wider">
              <SelectValue>{tree.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {tree.projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconAction
            icon={Pencil}
            label={`Rename ${tree.name}`}
            onClick={() => setRenaming({ kind: "project", id: tree.projectId })}
          />
          <IconAction
            icon={FilePlus2}
            label="New asset at project root"
            onClick={() => setAdding({ projectId: tree.projectId, folderId: null })}
          />
          <IconAction
            icon={FolderPlus}
            label="New folder at project root"
            onClick={() => addFolder(null)}
          />
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto py-1",
          over === "root" && "bg-accent/40 ring-1 ring-inset ring-ring"
        )}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setOver((current) => (current === "root" ? null : current));
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver("root");
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDrop({ projectId: tree.projectId, folderId: null });
        }}
        // Empty space is the project root: clicking it puts new assets back at
        // the top level. Only a click on the container itself counts, so this
        // cannot steal a click meant for a row.
        onClick={(event) => {
          if (event.target === event.currentTarget) projects.openFolder(null);
        }}
      >
        {tree.nodes.map((node) => renderNode(node, 0))}
        {tree.rootAssets.map((id) => renderAsset(id, 0))}
        {adding?.folderId === null ? (
          <NameField
            depth={0}
            onCancel={() => setAdding(null)}
            onCommit={(name) => createAsset(adding, name)}
            setValue={setDraft}
            value={draft}
          />
        ) : null}

        {tree.nodes.length === 0 && tree.rootAssets.length === 0 ? (
          <p className="px-3 py-3 font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
            Empty project. Add a folder or an asset above.
          </p>
        ) : null}
      </div>

      {folderNotice === null ? null : (
        <p className="border-t border-border px-2 py-1.5 font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
          {folderNotice}
        </p>
      )}

      {deleted === null ? null : (
        <div className="flex items-center gap-2 border-t border-border px-2 py-1.5 font-mono text-[0.7rem] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">Deleted {deleted.name}</span>
          <Button
            className="h-5 rounded-sm px-1.5 text-[0.7rem]"
            onClick={() => undoDeleteAsset()}
            size="sm"
            type="button"
            variant="outline"
          >
            Undo
          </Button>
        </div>
      )}
    </div>
  );
}

/** Compact rename field shared by the project header and asset rows. */
function RenameField({
  label,
  name,
  onCancel,
  onCommit,
}: {
  label: string;
  name: string;
  onCancel: () => void;
  onCommit: (name: string) => void;
}) {
  return (
    <Input
      aria-label={label}
      autoFocus
      className="h-6 min-w-0 flex-1 rounded-sm font-mono text-[0.72rem]"
      defaultValue={name}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next === "") onCancel();
        else onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") onCancel();
      }}
    />
  );
}

function IconAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FolderPlus;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
      onClick={onClick}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      <Icon aria-hidden className="size-3" strokeWidth={1.5} />
    </Button>
  );
}

/** Inline name entry, committed on Enter and abandoned on Escape or blur. */
function NameField({
  depth,
  onCancel,
  onCommit,
  setValue,
  value,
}: {
  depth: number;
  onCancel: () => void;
  onCommit: (name: string) => void;
  setValue: (value: string) => void;
  value: string;
}) {
  return (
    <div style={{ paddingLeft: `${String(depth * 12 + 20)}px` }}>
      <Input
        aria-label="New asset name"
        autoFocus
        className="h-6 rounded-sm font-mono text-[0.72rem]"
        onBlur={onCancel}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit(value);
          if (event.key === "Escape") onCancel();
        }}
        placeholder="name…"
        value={value}
      />
    </div>
  );
}
