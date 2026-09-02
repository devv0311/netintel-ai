import type { AnalyticsError, AnalyticsErrorCode, AnalyticsStage } from "./types";

/**
 * The one error type the analytics service throws internally, mirroring
 * src/lib/graph/errors.ts. The service catches it and turns it into the
 * `error` field of a `failed` AnalyticsResult. `message` is always
 * user-safe — no stack traces, no filesystem paths, no secrets.
 */
export class AnalyticsServiceError extends Error {
  readonly code: AnalyticsErrorCode;
  readonly stage: AnalyticsStage;
  readonly issues: string[] | undefined;

  constructor(code: AnalyticsErrorCode, stage: AnalyticsStage, message: string, issues?: string[]) {
    super(message);
    this.name = "AnalyticsServiceError";
    this.code = code;
    this.stage = stage;
    this.issues = issues && issues.length > 0 ? issues.slice(0, 25) : undefined;
  }

  toAnalyticsError(): AnalyticsError {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

/** Turns an unknown thrown value into a generic, safe INTERNAL_ERROR. */
export function toInternalError(stage: AnalyticsStage): AnalyticsError {
  return {
    code: "INTERNAL_ERROR",
    stage,
    message: "An internal error occurred during analytics synthesis. Nothing was persisted for this run.",
  };
}
