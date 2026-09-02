import { AssetLibrary } from "@/components/editor/asset-library";
import { ProjectGrid } from "@/components/editor/project-grid";

/**
 * The library.
 *
 * Projects by default. The flat asset view is still the thing a prompt
 * generates into, so `?prompt=` keeps working exactly as before rather than
 * becoming a second flow to maintain.
 *
 * `?view=assets` opens that same screen with no prompt. Without it the flat
 * view — which is where importing a library bundle, exporting one, duplicating
 * an asset and undoing a deletion live — could only be reached by generating
 * something, so four capabilities had no path from anywhere in the product.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string; type?: string; view?: string }>;
}) {
  const { prompt, type, view } = await searchParams;
  if (prompt !== undefined && prompt.trim() !== "") {
    return <AssetLibrary initialPrompt={prompt} initialType={type} />;
  }
  if (view === "assets") {
    return <AssetLibrary />;
  }
  return <ProjectGrid />;
}
