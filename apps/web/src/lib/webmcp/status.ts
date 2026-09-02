/**
 * Registration status, aggregated across the tool surface.
 *
 * `useWebMCP` reports supported/registered/error per tool. The availability
 * indicator needs one honest answer for all of them — including the case where
 * the API exists but registration was refused, which is what a disabled `tools`
 * permissions policy looks like.
 */

export interface ToolRegistrationState {
  readonly supported: boolean;
  readonly registered: boolean;
  readonly error: Error | null;
}

export interface RegistrationSummary {
  readonly supported: boolean;
  readonly registered: number;
  readonly total: number;
  readonly error: Error | null;
}

class RegistrationStatus {
  readonly #states = new Map<string, ToolRegistrationState>();
  readonly #listeners = new Set<() => void>();
  #summary: RegistrationSummary = { supported: false, registered: 0, total: 0, error: null };

  get summary(): RegistrationSummary {
    return this.#summary;
  }

  set(name: string, state: ToolRegistrationState): void {
    const previous = this.#states.get(name);
    if (
      previous !== undefined &&
      previous.supported === state.supported &&
      previous.registered === state.registered &&
      previous.error === state.error
    ) {
      return;
    }
    this.#states.set(name, state);
    this.#recompute();
  }

  clear(name: string): void {
    if (this.#states.delete(name)) this.#recompute();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #recompute(): void {
    let registered = 0;
    let supported = false;
    let error: Error | null = null;
    for (const state of this.#states.values()) {
      if (state.registered) registered += 1;
      if (state.supported) supported = true;
      if (state.error !== null && error === null) error = state.error;
    }
    // A fresh object each time is what makes `useSyncExternalStore` notice.
    this.#summary = { supported, registered, total: this.#states.size, error };
    for (const listener of this.#listeners) listener();
  }
}

export const registrationStatus = new RegistrationStatus();
