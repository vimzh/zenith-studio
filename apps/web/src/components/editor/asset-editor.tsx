"use client";

import { useEffect } from "react";
import Link from "next/link";
import { session, useSessionSelector } from "@/lib/editor";
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
  const hydrated = useSessionSelector((current) => current.hydrated);
  const store = session.get(id);
  // A palette swap or resize replaces the store object rather than mutating it,
  // since size and palette are document invariants. Keying on the generation
  // remounts the editor so nothing keeps reading the discarded store.
  const generation = useSessionSelector((current) => current.generationOf(id));

  // Hydrate here too, not only in the library. A deep link opens this route
  // directly, and without this the asset is on disk but never loaded — the page
  // reports "not in this session" for an asset that exists.
  useEffect(() => {
    void session.hydrate().then(() => {
      session.open(id);
    });
  }, [id]);

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (asset === undefined || store === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="font-mono text-xs text-muted-foreground">
          No asset <span className="text-foreground">{id}</span> in this session.
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
