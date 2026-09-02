import type { GraphError, GraphErrorCode, GraphStage } from "./types";

/**
 * The one error type the graph synthesis service throws internally,
 * mirroring src/lib/resolution/errors.ts. The service catches it and
 * turns it into the `error` field of a `failed` GraphResult. `message`
 * is always user-safe — no stack traces, no filesystem paths, no
 * secrets.
 */
export class GraphServiceError extends Error {
  readonly code: GraphErrorCode;
  readonly stage: GraphStage;
  readonly issues: string[] | undefined;

  constructor(code: GraphErrorCode, stage: GraphStage, message: string, issues?: string[]) {
    super(message);
    this.name = "GraphServiceError";
    this.code = code;
    this.stage = stage;
    this.issues = issues && issues.length > 0 ? issues.slice(0, 25) : undefined;
  }

  toGraphError(): GraphError {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

/** Turns an unknown thrown value into a generic, safe INTERNAL_ERROR. */
export function toInternalError(stage: GraphStage): GraphError {
  return {
    code: "INTERNAL_ERROR",
    stage,
    message: "An internal error occurred during graph synthesis. Nothing was persisted for this run.",
  };
}
