"use client";

import { Wrench } from "lucide-react";
import type { ChatMessage } from "@/lib/webmcp";
import { agentConsoleCopy } from "@/data/agent";
import { cn } from "@/lib/utils";

const { chat } = agentConsoleCopy;

/**
 * One turn in the chat, as a bubble.
 *
 * Three speakers share this column and they must not read as one stream. The
 * human's own text is filled and sits right; the model's is a hairline card on
 * the left; a tool call is neither — it is machine output, so it stays a full
 * width monospace line with no bubble at all. That last distinction is the one
 * that matters: watching the agent read, edit and re-check is most of what
 * makes the collaboration legible, and a tool line dressed as speech hides it.
 *
 * Bubbles stay inside the design language — 4px radius, 1px borders, no
 * shadows or tails. This panel is 280px wide at its narrowest and decoration
 * costs pixels the text needs.
 */

function ToolLine({ text, failed = false }: { text: string; failed?: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-1.5 font-mono text-[0.7rem] leading-snug",
        failed ? "text-destructive" : "text-muted-foreground"
      )}
    >
      <Wrench aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
    </div>
  );
}

export function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    const text = message.content ?? "";
    return (
      <li className="px-2.5 py-0.5">
        <ToolLine failed={text.startsWith("Error:")} text={text} />
      </li>
    );
  }

  if (message.role === "assistant") {
    const calls = message.tool_calls ?? [];
    const said = message.content ?? "";

    return (
      <li className="flex flex-col items-start gap-1 px-2.5 py-1">
        {said === "" ? null : (
          <p className="max-w-[92%] rounded-[4px] border border-border bg-card px-2 py-1 text-xs leading-relaxed whitespace-pre-wrap">
            {said}
          </p>
        )}
        {calls.map((call) => (
          <ToolLine key={call.id} text={`→ ${call.function.name}`} />
        ))}
      </li>
    );
  }

  // The user's own message, with any attached selection collapsed: they can see
  // their selection on the canvas and do not need it echoed back as characters.
  const [first, ...rest] = (message.content ?? "").split("\n\n");
  const hasSelection = rest.length > 0 && first?.startsWith("The user has selected") === true;
  const body = hasSelection ? rest[rest.length - 1] : message.content;

  return (
    <li className="flex flex-col items-end gap-0.5 px-2.5 py-1">
      <p className="max-w-[92%] rounded-[4px] bg-accent px-2 py-1 text-xs leading-relaxed whitespace-pre-wrap text-accent-foreground">
        {body}
      </p>
      {hasSelection ? (
        <p className="font-mono text-[0.65rem] text-muted-foreground">{chat.selectionLabel}</p>
      ) : null}
    </li>
  );
}
