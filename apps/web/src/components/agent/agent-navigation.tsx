"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { assetNavigation, routeForRequestedAsset, useRequestedAsset } from "@/lib/webmcp";
import { routeForRequestedProject } from "@/lib/webmcp/navigation";
import { useRequestedProject } from "@/lib/webmcp/use-webmcp";

/**
 * Follows the agent when it opens a different asset.
 *
 * This is what makes `open_asset`'s claim that an asset "is now the target of
 * every editing tool" true for the human as well as for the tool layer. Without
 * it the agent edits off-screen.
 */
export function AgentNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const requested = useRequestedAsset();
  const requestedProject = useRequestedProject();

  useEffect(() => {
    if (requested === null && requestedProject === null) return;
    const route = requestedProject === null
      ? routeForRequestedAsset(pathname, requested)
      : routeForRequestedProject(pathname, requestedProject);
    // Cleared either way: a request that cannot move the view is still spent,
    // and leaving it pending would fire it at the next unrelated navigation.
    assetNavigation.clear();
    if (route !== null) router.push(route);
  }, [requested, requestedProject, pathname, router]);

  return null;
}
