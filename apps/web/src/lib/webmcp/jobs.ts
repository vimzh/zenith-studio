/** Session-local paid jobs: prompt returns, durable-in-tab results, and no automatic retries. */
import { session } from "@/lib/editor/session";
import { assetNavigation, assetRouteId } from "./navigation";
import { runTool } from "./run";
import { scopeApplies } from "./scope";
import { ToolError, type ToolArgs, type ToolDefinition } from "./types";

const MAX_JOBS = 50;

interface JobContext {
  readonly pathname: string | null;
  readonly visible_asset_id: string | null;
  readonly active_asset_id: string | null;
  readonly requested_asset_id: string | null;
}

export interface ToolJob {
  readonly job_id: string;
  readonly request_id: string;
  readonly tool: string;
  readonly status: "running" | "succeeded" | "failed";
  readonly started_at: number;
  readonly finished_at: number | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly started_context: JobContext;
  readonly context: JobContext;
}

interface JobRecord {
  readonly fingerprint: string;
  job: ToolJob;
}

function context(): JobContext {
  const pathname = typeof window === "undefined" ? null : window.location.pathname;
  return {
    pathname,
    visible_asset_id: pathname === null ? session.activeId : assetRouteId(pathname),
    active_asset_id: session.activeId,
    requested_asset_id: assetNavigation.peek(),
  };
}

/** Copy JSON arguments before execution; object key order does not change request identity. */
function snapshotArgs(args: ToolArgs): { args: ToolArgs; fingerprint: string } {
  try {
    const serialized = JSON.stringify(args, (_key, value: unknown) => {
      if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" || (typeof value === "number" && !Number.isFinite(value))) {
        throw new Error("non-JSON value");
      }
      return value;
    });
    const copied = JSON.parse(serialized) as ToolArgs;
    const fingerprint = JSON.stringify(copied, (_key, value: unknown) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      const record = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
    });
    return { args: copied, fingerprint };
  } catch {
    throw new ToolError("Job arguments must contain only valid JSON values, without cycles.");
  }
}

export class ToolJobs {
  // Never evict request IDs: eviction would let an old retry buy the same job again.
  readonly #requests = new Map<string, JobRecord>();

  start(definition: ToolDefinition, args: ToolArgs, requestId: string): ToolJob {
    if (requestId.trim().length === 0 || requestId.length > 128) {
      throw new ToolError("request_id must be a non-empty string of at most 128 characters. Reuse it only for the same tool and arguments.");
    }
    const snapshot = snapshotArgs(args);
    const existing = this.#requests.get(requestId);
    if (existing !== undefined) {
      if (existing.job.tool !== definition.name || existing.fingerprint !== snapshot.fingerprint) {
        throw new ToolError(`request_id '${requestId}' already belongs to ${existing.job.job_id} with different tool or arguments. Use a new request_id only for a new operation.`);
      }
      return this.get(existing.job.job_id);
    }
    if (definition.network !== true || definition.name === "start_tool_job") {
      throw new ToolError(`'${definition.name}' is not an eligible paid tool. Call deterministic tools directly; job controls cannot start jobs.`);
    }
    const current = context();
    const store = current.visible_asset_id === null ? undefined : session.get(current.visible_asset_id);
    const scope = {
      assetId: store === undefined ? null : current.visible_asset_id,
      assetType: session.list().find((asset) => asset.id === current.visible_asset_id)?.type ?? null,
      frameCount: store?.frameCount ?? 0,
    };
    if (!scopeApplies(definition.scope ?? "editor", scope)) {
      throw new ToolError(`'${definition.name}' is not available in the current view. Open an asset of the appropriate type before starting it.`);
    }
    const running = [...this.#requests.values()].find((entry) => entry.job.status === "running");
    if (running !== undefined) {
      throw new ToolError(`Job ${running.job.job_id} (${running.job.tool}) is still running. Poll get_tool_job instead of starting another paid operation.`);
    }
    if (this.#requests.size >= MAX_JOBS) {
      throw new ToolError(`This page has reached its ${String(MAX_JOBS)}-job history limit. Save completed results and reload before starting new jobs; reloading loses job tracking and request_id protection.`);
    }
    const job: ToolJob = {
      job_id: `job_${crypto.randomUUID()}`,
      request_id: requestId,
      tool: definition.name,
      status: "running",
      started_at: Date.now(),
      finished_at: null,
      result: null,
      error: null,
      started_context: current,
      context: current,
    };
    const record: JobRecord = { job, fingerprint: snapshot.fingerprint };
    this.#requests.set(requestId, record);
    // runTool executes synchronously up to the handler's first await: it captures
    // the target immediately, and its normal route guards and transcript remain authoritative.
    void runTool(definition, snapshot.args, "agent").then(
      (outcome) => { record.job = { ...job, status: outcome.ok ? "succeeded" : "failed", finished_at: Date.now(), result: outcome.ok ? outcome.text : null, error: outcome.ok ? null : outcome.text, context: context() }; },
      (error: unknown) => { record.job = { ...job, status: "failed", finished_at: Date.now(), error: error instanceof Error ? error.message : String(error), context: context() }; },
    );
    return this.get(job.job_id);
  }

  get(jobId: string): ToolJob {
    const record = [...this.#requests.values()].find((entry) => entry.job.job_id === jobId);
    if (record === undefined) {
      throw new ToolError(`Unknown job '${jobId}'. Job IDs exist only in the page session that started them; reloads lose tracking and do not cancel paid requests.`);
    }
    return { ...record.job, started_context: { ...record.job.started_context }, context: context() };
  }
}
