/**
 * Which tool the Agent Console's runner has selected, and its argument text.
 *
 * Held outside React because two things drive it: the runner's own select, and
 * the command palette jumping to a tool. Keeping it in the component would mean
 * the palette pushing state down through an effect, which is both a lint
 * violation and the wrong shape — this is shared state, so it lives in a store.
 *
 * It also outlives the console, which remounts whenever the route changes. The
 * selection surviving that is the correct behaviour, not an accident.
 */

import { findTool, TOOLS } from "./tools";

export type AgentPanel = "chat" | "activity" | "tools";

export interface ToolRunnerSnapshot {
  readonly name: string;
  readonly args: string;
  /** Bumped only when a caller asks for focus, so the runner knows to take it. */
  readonly focusRequest: number;
  /**
   * Which panel of the console is showing.
   *
   * Here rather than in the component because two things drive it: the user
   * clicking a tab, and the command palette jumping to a tool. Deriving it from
   * `focusRequest` in an effect meant setting state from an effect, which is
   * both a lint error and the wrong shape — revealing the runner is part of the
   * jump, not a consequence to be observed afterwards.
   */
  readonly panel: AgentPanel;
}

function exampleArgsFor(name: string): string {
  return JSON.stringify(findTool(name)?.example ?? {}, null, 2);
}

class ToolRunnerState {
  #snapshot: ToolRunnerSnapshot;
  readonly #listeners = new Set<() => void>();

  constructor(initial: string) {
    this.#snapshot = { name: initial, args: exampleArgsFor(initial), focusRequest: 0, panel: "chat" };
  }

  /** A stable reference between changes, which `useSyncExternalStore` requires. */
  get snapshot(): ToolRunnerSnapshot {
    return this.#snapshot;
  }

  /**
   * Selects a tool and resets the arguments to its example.
   *
   * Asking for focus also reveals the tools panel, in the same change: a jump
   * that focused an argument field on a hidden panel would focus nothing, since
   * an inactive tab panel is not mounted.
   */
  select(name: string, options: { focus?: boolean } = {}): void {
    if (findTool(name) === undefined) return;
    const focusing = options.focus === true;
    const focusRequest = this.#snapshot.focusRequest + (focusing ? 1 : 0);
    if (name === this.#snapshot.name && focusRequest === this.#snapshot.focusRequest) return;
    this.#snapshot = {
      name,
      args: exampleArgsFor(name),
      focusRequest,
      panel: focusing ? "tools" : this.#snapshot.panel,
    };
    this.#notify();
  }

  /** The user switching panels by hand. */
  setPanel(panel: AgentPanel): void {
    if (panel === this.#snapshot.panel) return;
    this.#snapshot = { ...this.#snapshot, panel };
    this.#notify();
  }

  setArgs(args: string): void {
    if (args === this.#snapshot.args) return;
    this.#snapshot = { ...this.#snapshot, args };
    this.#notify();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

export const toolRunnerState = new ToolRunnerState((TOOLS[0] as { name: string }).name);
