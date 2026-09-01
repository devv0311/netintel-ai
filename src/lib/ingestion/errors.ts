import type { IngestionError, IngestionErrorCode, IngestionStage } from "./types";

/**
 * The one error type the ingestion service throws internally. The
 * service catches it and turns it into the `error` field of a `failed`
 * IngestionResult. Its `message` is always user-safe — no stack traces,
 * no filesystem paths, no secrets — because it is shown directly in the
 * UI and returned over the wire.
 */
export class IngestionServiceError extends Error {
  readonly code: IngestionErrorCode;
  readonly stage: IngestionStage;
  readonly issues: string[] | undefined;

  constructor(
    code: IngestionErrorCode,
    stage: IngestionStage,
    message: string,
    issues?: string[],
  ) {
    super(message);
    this.name = "IngestionServiceError";
    this.code = code;
    this.stage = stage;
    this.issues = issues && issues.length > 0 ? issues.slice(0, 25) : undefined;
  }

  toIngestionError(): IngestionError {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

/**
 * Turns an unknown thrown value into a generic, safe INTERNAL_ERROR.
 * The real error is expected to have been logged server-side already.
 */
export function toInternalError(stage: IngestionStage): IngestionError {
  return {
    code: "INTERNAL_ERROR",
    stage,
    message: "An internal error occurred during ingestion. Nothing was persisted for this run.",
  };
}

/** User-safe rendering of Zod issues (path + message only, no values). */
export function summarizeZodIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}
