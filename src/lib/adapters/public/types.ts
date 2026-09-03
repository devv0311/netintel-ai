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

/**
 * How a payload actually reached us.
 *
 * This exists because the two channels do NOT carry the same evidential
 * weight, and collapsing them would make the manifest lie:
 *
 *   direct-https — this process opened the socket. `rawSha256` is the
 *     hash of the bytes the publisher sent, and re-running the collector
 *     against an unchanged record reproduces it exactly.
 *   agent-relay  — the payload was retrieved through an operator-side
 *     web tool because direct egress to the publisher is blocked by
 *     policy, then written to disk and transformed from there. The
 *     content is the publisher's; the BYTES are not proven to be, since
 *     a relay may reformat insignificant whitespace. `rawSha256` is
 *     therefore the hash of the stored payload, NOT a verified
 *     wire-byte hash, and a byte-exact provenance claim requires a
 *     `direct-https` re-run from an unrestricted network.
 *
 * Recording this is the difference between provenance and decoration.
 */
export type RetrievalChannel = "direct-https" | "agent-relay";

export interface AdapterResult {
  plan: AdapterPlan;
  records: PublicRecordContent[];
  /**
   * sha256 of the raw payload. Under `direct-https` this is a wire-byte
   * hash; under `agent-relay` it is a hash of the stored payload only —
   * see RetrievalChannel.
   */
  rawSha256: string;
  rawBytes: number;
  retrievalChannel: RetrievalChannel;
  /** Per-payload provenance, one entry per raw file transformed. */
  sourcePayloads: { file: string; sha256: string; bytes: number; records: number }[];
  /**
   * The raw payloads themselves, so the collector can write them next to
   * the manifest. A manifest that records a sha256 of bytes kept nowhere
   * is not provenance: nobody can verify it, and the derived records
   * cannot be rebuilt or audited against what the publisher actually
   * sent. The first direct collections shipped exactly that hole.
   */
  rawPayloads: { file: string; body: string }[];
  warnings: string[];
}

export interface AdapterOptions {
  limit: number;
  /** Transform a raw payload already on disk instead of fetching. */
  fromFile?: string;
  /**
   * Transform every *.json payload in a directory instead of fetching —
   * the relay path. Used when egress to the publisher is blocked and the
   * payloads were retrieved out-of-band; sets `retrievalChannel` to
   * "agent-relay" so the manifest cannot silently claim otherwise.
   */
  fromDir?: string;
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
