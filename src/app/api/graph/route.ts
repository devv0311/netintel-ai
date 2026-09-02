import { runGraphSynthesis } from "@/lib/graph/service";
import { getGraphState } from "@/lib/graph/summary";
import type { GraphEvent, GraphResult } from "@/lib/graph/types";

/**
 * POST /api/graph — runs the real local graph-synthesis pipeline and
 * streams newline-delimited JSON `GraphEvent`s as each stage completes
 * (real progress, not a timed animation). The final line is always
 * `{ "type": "result", ... }`. Mirrors POST /api/resolution.
 *
 * GET /api/graph — returns the current server-derived `GraphState` as
 * JSON.
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
      const send = (event: GraphEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runGraphSynthesis(send);
      } catch (err) {
        console.error("[api/graph] unexpected stream error", err);
        const result: GraphResult = {
          status: "failed",
          investigationId: null,
          counts: null,
          persisted: null,
          warnings: [],
          stages: [],
          error: {
            code: "INTERNAL_ERROR",
            stage: "result",
            message: "An internal error occurred during graph synthesis. Nothing was persisted for this run.",
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
  const state = await getGraphState();
  return Response.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
