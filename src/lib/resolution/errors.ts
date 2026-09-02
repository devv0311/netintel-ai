import type { ResolutionError, ResolutionErrorCode, ResolutionStage } from "./types";

/**
 * The one error type the resolution service throws internally, mirroring
 * src/lib/extraction/errors.ts. The service catches it and turns it into
 * the `error` field of a `failed` ResolutionResult. `message` is always
 * user-safe — no stack traces, no filesystem paths, no secrets.
 */
export class ResolutionServiceError extends Error {
  readonly code: ResolutionErrorCode;
  readonly stage: ResolutionStage;
  readonly issues: string[] | undefined;

  constructor(
    code: ResolutionErrorCode,
    stage: ResolutionStage,
    message: string,
    issues?: string[],
  ) {
    super(message);
    this.name = "ResolutionServiceError";
    this.code = code;
    this.stage = stage;
    this.issues = issues && issues.length > 0 ? issues.slice(0, 25) : undefined;
  }

  toResolutionError(): ResolutionError {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

/** Turns an unknown thrown value into a generic, safe INTERNAL_ERROR. */
export function toInternalError(stage: ResolutionStage): ResolutionError {
  return {
    code: "INTERNAL_ERROR",
    stage,
    message: "An internal error occurred during resolution. Nothing was persisted for this run.",
  };
}
