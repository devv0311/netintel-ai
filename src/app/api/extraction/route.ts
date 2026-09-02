import { runExtraction } from "@/lib/extraction/service";
import { getExtractionState } from "@/lib/extraction/summary";
import type { ExtractionEvent, ExtractionResult } from "@/lib/extraction/types";

/**
 * POST /api/extraction — runs the real local extraction pipeline and
 * streams newline-delimited JSON `ExtractionEvent`s as each stage
 * completes (real progress, not a timed animation). The final line is
 * always `{ "type": "result", ... }`. Mirrors POST /api/ingestion.
 *
 * GET /api/extraction — returns the current server-derived
 * `ExtractionState` as JSON.
 *
 * Node runtime: the pipeline uses `node:sqlite`. Never cached. Errors
 * are returned as a structured `failed` result, never as a stack trace.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ExtractionEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runExtraction(send);
      } catch (err) {
        console.error("[api/extraction] unexpected stream error", err);
        const result: ExtractionResult = {
          status: "failed",
          investigationId: null,
          counts: null,
          persisted: null,
          warnings: [],
          stages: [],
          error: {
            code: "INTERNAL_ERROR",
            stage: "result",
            message:
              "An internal error occurred during extraction. Nothing was persisted for this run.",
          },
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        };
        send({ type: "result", result });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(): Promise<Response> {
  const state = await getExtractionState();
  return Response.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
