/**
 * The tool-call transcript.
 *
 * Every call is recorded here regardless of who made it — a WebMCP agent or a
 * human clicking Run in the Agent Console. That is the point: the transcript is
 * what makes the collaboration legible, and a transcript that only showed one
 * caller would misrepresent what happened to the canvas.
 *
 * A module singleton for the same reason the session is: tool handlers run
 * outside the React tree.
 */

export type ToolCallSource = "agent" | "console";

export type ToolCallStatus = "ok" | "error";

export interface ToolCallRecord {
  readonly id: string;
  readonly tool: string;
  readonly source: ToolCallSource;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: ToolCallStatus;
  readonly result: string;
  readonly durationMs: number;
  readonly at: number;
}

/** Enough to review a session, bounded so a long demo cannot grow without limit. */
const MAX_RECORDS = 200;

class Transcript {
  #records: ToolCallRecord[] = [];
  readonly #listeners = new Set<() => void>();
  #sequence = 0;
  #revision = 0;

  get revision(): number {
    return this.#revision;
  }

  /** Newest first — the console reads top-down. */
  list(): readonly ToolCallRecord[] {
    return this.#records;
  }

  record(entry: Omit<ToolCallRecord, "id" | "at">): ToolCallRecord {
    this.#sequence += 1;
    const record: ToolCallRecord = {
      ...entry,
      id: `call_${String(this.#sequence)}`,
      at: Date.now(),
    };
    this.#records = [record, ...this.#records].slice(0, MAX_RECORDS);
    this.#bump();
    return record;
  }

  clear(): void {
    if (this.#records.length === 0) return;
    this.#records = [];
    this.#bump();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #bump(): void {
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }
}

export const transcript = new Transcript();
