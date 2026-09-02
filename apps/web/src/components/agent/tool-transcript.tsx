"use client";

import { CircleCheck, CircleX } from "lucide-react";
import { transcript, useTranscript, type ToolCallRecord } from "@/lib/webmcp";
import { agentConsoleCopy } from "@/data/agent";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const { transcript: copy } = agentConsoleCopy;

function formatArgs(args: Readonly<Record<string, unknown>>): string {
  const json = JSON.stringify(args);
  return json === "{}" ? "" : json;
}

function ToolCallEntry({ record }: { record: ToolCallRecord }) {
  const ok = record.status === "ok";
  const Icon = ok ? CircleCheck : CircleX;

  return (
    <li className="border-b border-border/60 px-2.5 py-2 last:border-b-0">
      <div className="flex items-baseline gap-1.5">
        <Icon
          className={cn("size-3.5 shrink-0 translate-y-0.5", ok ? "text-emerald-700 dark:text-green" : "text-destructive")}
          aria-hidden="true"
        />
        <span className="font-mono text-xs font-medium">{record.tool}</span>
        <span className="rounded-sm bg-muted px-1 font-mono text-[0.65rem] text-muted-foreground">
          {record.source === "agent" ? copy.agentSource : copy.consoleSource}
        </span>
        <span className="ml-auto font-mono text-[0.65rem] tabular-nums text-muted-foreground">
          {record.durationMs.toFixed(1)}ms
        </span>
      </div>

      {formatArgs(record.args) === "" ? null : (
        <p className="mt-1 truncate font-mono text-[0.7rem] text-muted-foreground" title={formatArgs(record.args)}>
          {formatArgs(record.args)}
        </p>
      )}

      {/*
        The result is monospace and preformatted because `read_canvas` returns an
        indexed grid: in a proportional face the columns do not line up and the
        sprite is unreadable.
      */}
      <pre
        className={cn(
          "mt-1 max-h-56 overflow-auto rounded-sm bg-muted/50 px-1.5 py-1 font-mono text-[0.7rem] leading-[1.15] whitespace-pre",
          ok ? "text-foreground" : "text-destructive"
        )}
      >
        {record.result}
      </pre>
    </li>
  );
}

export function ToolTranscript() {
  const records = useTranscript();

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <h3 className="text-xs font-medium">{copy.heading}</h3>
        <span className="font-mono text-[0.7rem] tabular-nums text-muted-foreground">{records.length}</span>
        <Button
          className="ml-auto"
          size="xs"
          variant="ghost"
          onClick={() => transcript.clear()}
          disabled={records.length === 0}
        >
          {copy.clearLabel}
        </Button>
      </header>

      {records.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
          <p className="text-xs font-medium">{copy.emptyTitle}</p>
          <p className="text-[0.7rem] leading-snug text-muted-foreground">{copy.emptyBody}</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {records.map((record) => (
            <ToolCallEntry key={record.id} record={record} />
          ))}
        </ul>
      )}
    </section>
  );
}
