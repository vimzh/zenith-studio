/**
 * The chat conversation.
 *
 * A module singleton, like the transcript and the session, and for the same
 * reason: the agent pane unmounts when the layout narrows into a drawer or the
 * route changes, and losing a conversation mid-edit because a panel closed would
 * be indefensible.
 *
 * The system prompt is rebuilt on every send rather than pinned at the start.
 * The canvas is being edited by two parties while the conversation runs, so a
 * prompt describing the asset as it was ten turns ago is worse than none.
 */

import { session } from "@/lib/editor";
import { selectionContext } from "@/lib/editor";
import type { Region } from "@zenith/core";
import { runChat, type ChatMessage } from "./chat";
import { chatTools } from "./chat-tools";
import type { ScopeContext } from "./scope";

export type ConversationStatus = "idle" | "running" | "error";

export interface ConversationState {
  readonly messages: readonly ChatMessage[];
  readonly status: ConversationStatus;
  readonly error: string | null;
}

const EMPTY: ConversationState = Object.freeze({
  messages: [],
  status: "idle",
  error: null,
});

/**
 * What the model needs to know before it reads anything.
 *
 * States the format, the coordinate origin and the palette up front because
 * every positional tool depends on all three, and a model that has to infer the
 * origin from a tool description gets it wrong in the direction that is hardest
 * to notice — vertically flipped edits look plausible.
 */
export function buildSystemPrompt(): string {
  const store = session.active;
  const id = session.activeId;
  if (store === null || id === null) {
    return "You are a pixel-art assistant. No asset is currently open, so you cannot edit anything yet.";
  }

  const summary = session.list().find((asset) => asset.id === id);
  const palette = store.palette.colors
    .map((colour, index) => `${index.toString(16).toUpperCase()}=${colour.hex}`)
    .join("  ");

  return [
    "You are a pixel-art assistant working on the same canvas as a human, live. Your edits appear on their screen immediately and share their undo stack.",
    "",
    `Open asset: '${summary?.name ?? store.name}' (${summary?.type ?? "asset"}), ${String(store.width)}x${String(store.height)} pixels, ${String(store.frameCount)} frame(s), frame ${String(store.activeFrame)} selected.`,
    `Palette (${String(store.palette.colors.length)} colours): ${palette}  .=transparent`,
    "",
    "Artwork is an indexed character grid: one character per pixel, '0'-'9' and 'A'-'F' for palette indices, '.' for transparent. Coordinates are asset-local: (0,0) is the top-left pixel, x increases right, y increases down.",
    "",
    "Working rules:",
    "- Call read_canvas before editing something you have not seen. Do not guess what is there.",
    "- Asked to create a new whole subject or replace the existing artwork — 'make a bush', 'draw a health potion', 'replace this with a stone wall' — call draw_from_prompt. Do not use it for orientation changes or local edits to an existing subject. Never hand-draw a whole subject pixel by pixel: it burns your entire turn budget and the result is a shapeless blob. Hand-drawing is for changes you can name in a few words.",
    "- To change an existing character's facing or camera view, use rotate_character, or derive_direction_by_mirror for a valid left/right mirror pair; use generate_direction_set for several directions. Do not substitute draw_from_prompt or inpaint_region for rotation. If character tools are unavailable because the asset has the wrong type, ask the human to confirm changing it to character; call set_asset_type only when the human explicitly confirms the classification. Never infer or silently change type from the art prompt.",
    "- For those, prefer the smallest tool that does the job: fill_region or bucket_fill for a solid area, write_region for a block (every row must be exactly the same width), set_pixels for a handful of pixels.",
    "- When you do draw by hand, draw the way pixel art is drawn. Block the silhouette first in one colour and check it reads, then add at most two more tones from the same hue family — base, shadow, highlight — with the light coming from the upper left. Keep regions flat, connected and several pixels across; no lone pixels, no checkerboard speckle, no gradients. A 32x32 subject is five or six shapes, not forty: at this size a thing is drawn as the idea of itself, not as a picture of it.",
    "- After a change the user asked to be correct — a seamless tile, a coherent loop — run the matching check tool and fix what it reports.",
    "- Call read_canvas after every art edit before reporting the result. Do not claim visual success from a tool's success message alone; state what you verified and any remaining uncertainty. Keep inpaint_region bounded to the requested local repair; a recolour request is not permission to redraw the whole subject.",
    "- When the human explicitly asks to generate variations, be creatively ambitious in concept and conservative about identity: preserve silhouette, perspective, scale, pixel cadence, lighting logic, and game readability while varying material, biome, rarity, age, damage, culture, ornament, or magic. Invent concise, visually distinct concepts and pass them to generate_variation_set; avoid near-duplicates.",
    "- Use draw_from_prompt only for a new whole subject or an explicit whole-canvas replacement, generate_variation_set for a family, derive_variant for one directed variation, and inpaint_region for a requested local repair. These and rotation generation are slow paid model calls — tens of seconds per image: never call them to brainstorm, never call one twice for the same request, and never call them unless the human explicitly asked to create or change the art. Say what you are about to generate before you call one, so the wait is not silent.",
    "- Only palette indices listed above exist. Anything else is rejected.",
    "- Be brief. The human is watching the canvas, not reading an essay.",
  ].join("\n");
}

class Conversation {
  #state: ConversationState = EMPTY;
  readonly #listeners = new Set<() => void>();
  #controller: AbortController | null = null;

  get state(): ConversationState {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  clear(): void {
    this.#controller?.abort();
    this.#controller = null;
    this.#set(EMPTY);
  }

  stop(): void {
    this.#controller?.abort();
  }

  /**
   * Sends a message and runs the loop to completion.
   *
   * The selection, when there is one, is folded into the user's message rather
   * than the system prompt — it belongs to this turn, and leaving it in history
   * would have the model reasoning about a region the user has since moved on
   * from.
   */
  async send(
    text: string,
    context: ScopeContext,
    selection: Region | null,
  ): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0 || this.#state.status === "running") return;

    const assetId = session.activeId;
    const selected =
      assetId === null ? null : selectionContext(assetId, selection);
    const content =
      selected === null
        ? trimmed
        : `${selected.summary}\n\nSelected pixels:\n${selected.encoded}\n\n${trimmed}`;

    const user: ChatMessage = { role: "user", content };
    this.#set({
      messages: [...this.#state.messages, user],
      status: "running",
      error: null,
    });

    const controller = new AbortController();
    this.#controller = controller;

    try {
      const history: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt() },
        ...this.#state.messages,
      ];
      const result = await runChat(history, {
        tools: () => {
          if (context.assetId === null) return [];
          const active = session.list().find((asset) => asset.id === session.activeId);
          return chatTools({
            assetId: active?.id ?? null,
            assetType: active?.type ?? null,
            frameCount: active?.frameCount ?? 0,
          });
        },
        signal: controller.signal,
        onMessage: (message) => {
          this.#set({
            ...this.#state,
            messages: [...this.#state.messages, message],
          });
        },
      });

      this.#set({
        ...this.#state,
        status: "idle",
        error: result.exhausted
          ? "The assistant stopped after reaching its turn limit. Ask it to continue if the work is unfinished."
          : null,
      });
    } catch (error) {
      this.#set({
        ...this.#state,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#controller = null;
    }
  }

  #set(next: ConversationState): void {
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}

export const conversation = new Conversation();
