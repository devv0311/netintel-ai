import type { DossierError, DossierErrorCode, DossierStage } from "./types";

/**
 * The one error type the dossier service throws internally, mirroring
 * src/lib/corroboration/errors.ts. The service catches it and turns it
 * into the `error` field of a `failed` DossierResult. `message` is
 * always user-safe — no stack traces, no filesystem paths, no secrets.
 */
export class DossierServiceError extends Error {
  readonly code: DossierErrorCode;
  readonly stage: DossierStage;
  readonly issues: string[] | undefined;

  constructor(code: DossierErrorCode, stage: DossierStage, message: string, issues?: string[]) {
    super(message);
    this.name = "DossierServiceError";
    this.code = code;
    this.stage = stage;
    this.issues = issues && issues.length > 0 ? issues.slice(0, 25) : undefined;
  }

  toDossierError(): DossierError {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

/** Turns an unknown thrown value into a generic, safe INTERNAL_ERROR. */
export function toInternalError(stage: DossierStage): DossierError {
  return {
    code: "INTERNAL_ERROR",
    stage,
    message: "An internal error occurred while generating the dossier. No report was written for this run.",
  };
}
