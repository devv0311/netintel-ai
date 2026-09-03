import type { PublicRecordContent } from "@/lib/domain/public-record";

/**
 * Shared shape for the read-only public-register adapters.
 *
 * Three properties are structural rather than conventional:
 *   - READ-ONLY: every adapter issues GET requests only. There is no
 *     write path, no auth, and no method parameter.
 *   - BOUNDED: `limit` is required and capped by the adapter's own
 *     MAX_LIMIT. There is no "fetch everything" mode, so a large-scale
 *     collection cannot be started by accident or by a stray flag.
 *   - REGISTRY-GATED: the caller passes a `source_id`, never a URL. The
 *     endpoint is a constant inside the adapter.
 */

export interface AdapterPlan {
  sourceId: string;
  sourceName: string;
  /** The exact endpoint that would be called. Shown by --dry-run. */
  endpoint: string;
  /** The exact query or file that would be requested. */
  request: string;
  license: string;
  licenseUrl: string;
  rateLimit: string;
  limit: number;
  estimatedRequests: number;
  estimatedBytes: number;
  destination: string;
}

export interface AdapterResult {
  plan: AdapterPlan;
  records: PublicRecordContent[];
  /** sha256 of the raw payload, for the artifact manifest. */
  rawSha256: string;
  rawBytes: number;
  warnings: string[];
}

export interface AdapterOptions {
  limit: number;
  /** Transform a raw payload already on disk instead of fetching. */
  fromFile?: string;
  root?: string;
}

/** Raised when egress is blocked or the publisher refuses; never retried in a loop. */
export class AdapterFetchError extends Error {
  readonly endpoint: string;
  constructor(endpoint: string, detail: string) {
    super(
      `Could not fetch ${endpoint}: ${detail}. ` +
        `This is reported, not retried — a policy denial or rate limit is a stop condition, not a transient error.`,
    );
    this.name = "AdapterFetchError";
    this.endpoint = endpoint;
  }
}
