import type { ExtractionError, ExtractionErrorCode, ExtractionStage } from "./types";

/**
 * The one error type the extraction service throws internally, mirroring
 * src/lib/ingestion/errors.ts. The service catches it and turns it into
 * the `error` field of a `failed` ExtractionResult. `message` is always
 * user-safe — no stack traces, no filesystem paths, no secrets.
 */
export class ExtractionServiceError extends Error {
  readonly code: ExtractionErrorCode;
  readonly stage: ExtractionStage;
  readonly issues: string[] | undefined;

  constructor(
    code: ExtractionErrorCode,
    stage: ExtractionStage,
    message: string,
    issues?: string[],
  ) {
    super(message);
    this.name = "ExtractionServiceError";
    this.code = code;
    this.stage = stage;
    this.issues = issues && issues.length > 0 ? issues.slice(0, 25) : undefined;
  }

  toExtractionError(): ExtractionError {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

/** Turns an unknown thrown value into a generic, safe INTERNAL_ERROR. */
export function toInternalError(stage: ExtractionStage): ExtractionError {
  return {
    code: "INTERNAL_ERROR",
    stage,
    message: "An internal error occurred during extraction. Nothing was persisted for this run.",
  };
}
