import type { CorroborationError, CorroborationErrorCode, CorroborationStage } from "./types";

/**
 * The one error type the corroboration service throws internally,
 * mirroring src/lib/analytics/errors.ts. The service catches it and
 * turns it into the `error` field of a `failed` CorroborationResult.
 * `message` is always user-safe — no stack traces, no filesystem paths,
 * no secrets.
 */
export class CorroborationServiceError extends Error {
  readonly code: CorroborationErrorCode;
  readonly stage: CorroborationStage;
  readonly issues: string[] | undefined;

  constructor(code: CorroborationErrorCode, stage: CorroborationStage, message: string, issues?: string[]) {
    super(message);
    this.name = "CorroborationServiceError";
    this.code = code;
    this.stage = stage;
    this.issues = issues && issues.length > 0 ? issues.slice(0, 25) : undefined;
  }

  toCorroborationError(): CorroborationError {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

/** Turns an unknown thrown value into a generic, safe INTERNAL_ERROR. */
export function toInternalError(stage: CorroborationStage): CorroborationError {
  return {
    code: "INTERNAL_ERROR",
    stage,
    message: "An internal error occurred during corroboration synthesis. Nothing was persisted for this run.",
  };
}
