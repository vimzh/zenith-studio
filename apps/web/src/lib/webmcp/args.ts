/**
 * Argument readers for tool handlers.
 *
 * Arguments arrive from a language model, so every one is validated and every
 * rejection says what was wrong *and* what to send instead. A message like
 * "invalid input" costs the agent a turn; "x must be an integer 0-31" costs it
 * nothing.
 */

import { ToolError, type ToolArgs } from "./types";

function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `${typeof value} (${JSON.stringify(value) ?? "?"})`;
}

export function readString(args: ToolArgs, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolError(`'${key}' must be a non-empty string, received ${describe(value)}.`);
  }
  return value;
}

export function readOptionalString(args: ToolArgs, key: string): string | undefined {
  return args[key] === undefined ? undefined : readString(args, key);
}

export function readInteger(args: ToolArgs, key: string, min?: number, max?: number): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ToolError(
      `'${key}' must be an integer, received ${describe(value)}. Pixel coordinates and sizes are always whole numbers.`,
    );
  }
  if (min !== undefined && value < min) {
    throw new ToolError(`'${key}' is ${String(value)}, below the minimum of ${String(min)}.`);
  }
  if (max !== undefined && value > max) {
    throw new ToolError(`'${key}' is ${String(value)}, above the maximum of ${String(max)}.`);
  }
  return value;
}

export function readOptionalInteger(
  args: ToolArgs,
  key: string,
  min?: number,
  max?: number,
): number | undefined {
  return args[key] === undefined ? undefined : readInteger(args, key, min, max);
}

export function readBoolean(args: ToolArgs, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new ToolError(`'${key}' must be true or false, received ${describe(value)}.`);
  }
  return value;
}

export function readEnum<T extends string>(
  args: ToolArgs,
  key: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  const value = args[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ToolError(
      `'${key}' must be one of ${allowed.map((item) => `'${item}'`).join(", ")}, received ${describe(value)}.`,
    );
  }
  return value as T;
}

export function readArray(args: ToolArgs, key: string): readonly unknown[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolError(`'${key}' must be a non-empty array, received ${describe(value)}.`);
  }
  return value;
}

export function readRecordAt(items: readonly unknown[], index: number, label: string): ToolArgs {
  const value = items[index];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError(`${label}[${String(index)}] must be an object, received ${describe(value)}.`);
  }
  return value as ToolArgs;
}
