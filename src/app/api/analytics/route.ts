import { runAnalyticsSynthesis } from "@/lib/analytics/service";
import { getAnalyticsState } from "@/lib/analytics/summary";
import type { AnalyticsEvent, AnalyticsResult } from "@/lib/analytics/types";

/**
 * POST /api/analytics — runs the real local topology-analytics pipeline
 * and streams newline-delimited JSON `AnalyticsEvent`s as each stage
 * completes (real progress, not a timed animation). The final line is
 * always `{ "type": "result", ... }`. Mirrors POST /api/graph.
 *
 * GET /api/analytics — returns the current server-derived
 * `AnalyticsState` as JSON.
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
      const send = (event: AnalyticsEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runAnalyticsSynthesis(send);
      } catch (err) {
        console.error("[api/analytics] unexpected stream error", err);
        const result: AnalyticsResult = {
          status: "failed",
          investigationId: null,
          graphVersion: null,
          counts: null,
          persisted: null,
          warnings: [],
          stages: [],
          error: {
            code: "INTERNAL_ERROR",
            stage: "result",
            message: "An internal error occurred during analytics synthesis. Nothing was persisted for this run.",
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
  const state = await getAnalyticsState();
  return Response.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
