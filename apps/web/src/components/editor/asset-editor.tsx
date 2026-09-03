"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { session, useSessionSelector } from "@/lib/editor";
import { activateAssetRoute } from "@/lib/editor/activate-asset-route";
import { EditorWorkspace } from "./editor-workspace";

/**
 * The editor route for one asset.
 *
 * Hydrates before deciding the asset is missing: this route is deep-linkable,
 * so it is reached directly as often as it is reached from the library, and the
 * two must not disagree about whether an asset exists.
 *
 * The route is the source of truth for which asset is open, and it must push
 * that into the session: the WebMCP tool layer resolves `session.active`, while
 * this component renders `session.get(id)`. If those diverge the agent edits a
 * different asset than the human is looking at — which is silent, and exactly
 * the failure this product cannot afford.
 */

export function AssetEditor({ id }: { id: string }) {
  const asset = useSessionSelector((current) =>
    current.list().find((entry) => entry.id === id)
  );
  const [activation, setActivation] = useState<{ id: string; error: string | null } | null>(null);
  const store = session.get(id);
  // Resizing replaces the immutable-size store. Keying on the generation
  // remounts the editor so nothing keeps reading the discarded store.
  const generation = useSessionSelector((current) => current.generationOf(id));

  // A deep link needs both documents and placements. Ignore obsolete callbacks
  // so finishing hydration cannot reopen the asset whose route was just left.
  useEffect(() => {
    let cancelled = false;
    void activateAssetRoute(id, () => !cancelled).then(
      () => { if (!cancelled) setActivation({ id, error: null }); },
      error => { if (!cancelled) setActivation({ id, error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { cancelled = true; };
  }, [id]);

  if (activation?.id !== id) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (activation.error !== null || asset === undefined || store === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="font-mono text-xs text-muted-foreground" role={activation.error === null ? undefined : "alert"}>
          {activation.error ?? <>No asset <span className="text-foreground">{id}</span> in this session.</>}
        </p>
        <Link
          className="rounded-sm border border-border px-3 py-1.5 text-sm hover:border-foreground/30"
          href="/home"
        >
          Back to assets
        </Link>
      </div>
    );
  }

  return (
    <EditorWorkspace
      assetId={id}
      key={`${id}:${String(generation)}`}
      name={asset.name}
      store={store}
      type={asset.type}
    />
  );
}
