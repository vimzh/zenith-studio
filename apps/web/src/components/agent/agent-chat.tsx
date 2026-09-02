"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleStop, SendHorizontal } from "lucide-react";
import type { Region } from "@zenith/core";
import { conversation, useConversation, useScopeContext, useScopeStatus } from "@/lib/webmcp";
import { agentConsoleCopy } from "@/data/agent";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatBubble } from "./chat-bubble";

const { chat } = agentConsoleCopy;

export function AgentChat({ selection }: { selection: Region | null }) {
  const { messages, status: conversationStatus, error } = useConversation();
  const context = useScopeContext();
  const status = useScopeStatus();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const running = conversationStatus === "running";
  const disabled = context.assetId === null;

  // Says which of the three reasons the surface is quiet. Reporting a route
  // disagreement as "no asset is open" is the one message that is definitely
  // wrong, and it is the one that cost a debugging session.
  const unavailableReason =
    status === "diverged" ? chat.diverged : status === "missing" ? chat.missing : chat.unavailable;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const onSend = useCallback(() => {
    if (draft.trim().length === 0 || running || disabled) return;
    const text = draft;
    setDraft("");
    void conversation.send(text, context, selection);
  }, [context, disabled, draft, running, selection]);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-border">
      <header className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <h3 className="text-xs font-medium">{chat.heading}</h3>
        {running ? (
          <span className="font-mono text-[0.65rem] text-muted-foreground">{chat.thinkingLabel}</span>
        ) : null}
        <Button
          className="ml-auto"
          disabled={messages.length === 0 || running}
          onClick={() => conversation.clear()}
          size="xs"
          variant="ghost"
        >
          {chat.clearLabel}
        </Button>
      </header>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-6 text-center">
          <p className="text-xs font-medium">{chat.emptyTitle}</p>
          <p className="text-[0.7rem] leading-snug text-muted-foreground">
            {disabled ? unavailableReason : chat.emptyBody}
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto py-1">
          {messages.map((message, index) => (
            <ChatBubble key={`${message.role}-${String(index)}`} message={message} />
          ))}
          <div ref={endRef} />
        </ul>
      )}

      {error === null ? null : (
        <p className="border-t border-border px-2.5 py-1 text-[0.7rem] leading-snug text-destructive">{error}</p>
      )}

      <div className="flex items-end gap-1.5 border-t border-border px-2.5 py-2">
        <label className="sr-only" htmlFor="agent-chat-input">
          {chat.heading}
        </label>
        <Textarea
          className="max-h-28 min-h-8 flex-1 resize-none rounded-sm px-2 py-1 text-xs leading-snug"
          disabled={disabled}
          id="agent-chat-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. Chat convention, and the
            // messages here are short.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={disabled ? unavailableReason : chat.placeholder}
          value={draft}
        />
        {running ? (
          <Button
            className="size-8 shrink-0 rounded-sm"
            onClick={() => conversation.stop()}
            size="icon"
            variant="outline"
          >
            <CircleStop />
            <span className="sr-only">{chat.stopLabel}</span>
          </Button>
        ) : (
          <Button
            className="size-8 shrink-0 rounded-sm"
            disabled={disabled || draft.trim().length === 0}
            onClick={onSend}
            size="icon"
          >
            <SendHorizontal />
            <span className="sr-only">{chat.sendLabel}</span>
          </Button>
        )}
      </div>
    </section>
  );
}
