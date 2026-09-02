"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSessionSelector, type EditorSession } from "@/lib/editor";
import { TOOL_GROUPS, jumpForTool, toolRunnerState } from "@/lib/webmcp";
import { commandPaletteCopy } from "@/data/command-palette";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

const selectAssets = (session: EditorSession) => session.list();
const selectActiveId = (session: EditorSession) => session.activeId;

/**
 * Ctrl/Cmd+K over assets and tools.
 *
 * Assets navigate. Tools jump to the Agent Console with that tool preselected
 * rather than executing — see `jumpForTool` for why running from here would be
 * the wrong affordance.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const assets = useSessionSelector(selectAssets);
  const activeId = useSessionSelector(selectActiveId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onSelectAsset = useCallback(
    (id: string) => {
      setOpen(false);
      // The route owns which asset is open; navigating is enough, and
      // `AssetEditor` pushes it into the session on mount.
      router.push(`/asset/${id}`);
    },
    [router],
  );

  const onSelectTool = useCallback(
    (name: string) => {
      const jump = jumpForTool(pathname, activeId, assets[0]?.id ?? null);
      if (!jump.reachable) return;
      setOpen(false);
      toolRunnerState.select(name, { focus: true });
      if (jump.route !== null) router.push(jump.route);
    },
    [activeId, assets, pathname, router],
  );

  // With no assets there is no editor to reach, so the tools are genuinely
  // unavailable rather than merely disabled — they are absent.
  const toolsReachable = assets.length > 0;

  return (
    <CommandDialog
      description={commandPaletteCopy.description}
      onOpenChange={setOpen}
      open={open}
      title={commandPaletteCopy.title}
    >
      <CommandInput autoFocus placeholder={commandPaletteCopy.placeholder} />
      <CommandList>
        <CommandEmpty>{commandPaletteCopy.empty}</CommandEmpty>

        {assets.length === 0 ? null : (
          <CommandGroup heading={commandPaletteCopy.groups.assets}>
            {assets.map((asset) => (
              <CommandItem
                key={asset.id}
                onSelect={() => onSelectAsset(asset.id)}
                value={`${asset.name} ${asset.type} ${asset.id}`}
              >
                <span>{asset.name}</span>
                <span className="font-mono text-[0.7rem] text-muted-foreground">
                  {asset.type} · {asset.width}×{asset.height}
                </span>
                {asset.id === activeId ? (
                  <CommandShortcut>{commandPaletteCopy.openHint}</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!toolsReachable
          ? null
          : TOOL_GROUPS.map((group) => (
              <CommandGroup heading={group.group} key={group.group}>
                {group.tools.map((tool) => (
                  <CommandItem
                    key={tool.name}
                    onSelect={() => onSelectTool(tool.name)}
                    value={`${tool.name} ${group.group}`}
                  >
                    <span className="font-mono text-[0.8rem]">{tool.name}</span>
                    {tool.readOnly === true ? (
                      <span className="font-mono text-[0.65rem] text-muted-foreground">read-only</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
      </CommandList>
    </CommandDialog>
  );
}
