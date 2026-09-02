"use client";

import { CircleCheck, CircleSlash, TriangleAlert } from "lucide-react";
import { useModelContextSurface, useRegistrationSummary, type ModelContextSurface } from "@/lib/webmcp";
import { agentConsoleCopy } from "@/data/agent";
import { cn } from "@/lib/utils";

const { status } = agentConsoleCopy;

function surfaceLabel(surface: ModelContextSurface): string | null {
  if (surface === "document") return status.surfaceDocument;
  if (surface === "navigator") return status.surfaceNavigator;
  return null;
}

/**
 * Whether an agent can reach this page, stated plainly.
 *
 * Worth its own indicator because the answer is genuinely uncertain in the
 * field: WebMCP is behind a flag, moved between two objects one Chrome version
 * ago, and can be refused outright by a permissions policy. Someone opening this
 * page needs to know which of those they are looking at — and that the console
 * below works regardless.
 */
export function WebMCPStatusBadge() {
  const summary = useRegistrationSummary();
  const surface = useModelContextSurface();

  const connected = summary.supported && summary.registered === summary.total && summary.total > 0;
  const refused = summary.supported && summary.error !== null;

  const label = refused
    ? status.refusedLabel
    : connected
      ? status.connectedLabel
      : summary.supported
        ? status.partialLabel
        : status.unavailableLabel;

  const Icon = connected ? CircleCheck : refused ? TriangleAlert : CircleSlash;
  const detail = surfaceLabel(surface);

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs",
          connected
            ? "border-green/50 bg-green/10 text-emerald-700 dark:text-green"
            : refused
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-muted/40 text-muted-foreground"
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        <span className="font-medium">{label}</span>
        {summary.total > 0 ? (
          <span className="ml-auto font-mono text-[0.7rem] tabular-nums">
            {summary.registered}/{summary.total} {status.toolCountSuffix}
          </span>
        ) : null}
      </div>
      {connected && detail !== null ? (
        <p className="px-0.5 font-mono text-[0.7rem] text-muted-foreground">{detail}</p>
      ) : null}
      {!summary.supported ? (
        <p className="px-0.5 text-[0.7rem] leading-snug text-muted-foreground">{status.unavailableHint}</p>
      ) : null}
      {refused ? (
        <p className="px-0.5 text-[0.7rem] leading-snug text-destructive">{summary.error?.message}</p>
      ) : null}
    </div>
  );
}
