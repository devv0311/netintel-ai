import type { CopilotError, CopilotErrorCode, CopilotStage } from "./types";

/**
 * The one error type the Copilot service throws internally, mirroring
 * src/lib/corroboration/errors.ts. The service catches it and turns it
 * into the `error` field of a `failed` CopilotResult. `message` is
 * always user-safe — no stack traces, no filesystem paths, no secrets,
 * and never a raw model/provider error string.
 */
export class CopilotServiceError extends Error {
  readonly code: CopilotErrorCode;
  readonly stage: CopilotStage;
  readonly issues: string[] | undefined;

  constructor(code: CopilotErrorCode, stage: CopilotStage, message: string, issues?: string[]) {
    super(message);
    this.name = "CopilotServiceError";
    this.code = code;
    this.stage = stage;
    this.issues = issues && issues.length > 0 ? issues.slice(0, 25) : undefined;
  }

  toCopilotError(): CopilotError {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

/** Turns an unknown thrown value into a generic, safe INTERNAL_ERROR. */
export function toInternalError(stage: CopilotStage): CopilotError {
  return {
    code: "INTERNAL_ERROR",
    stage,
    message: "An internal error occurred while answering. Nothing was persisted for this question.",
  };
}
