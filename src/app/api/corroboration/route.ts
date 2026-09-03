import { runCorroborationSynthesis } from "@/lib/corroboration/service";
import { getCorroborationState } from "@/lib/corroboration/summary";
import type { CorroborationEvent, CorroborationResult } from "@/lib/corroboration/types";

/**
 * POST /api/corroboration — runs the real local spatial/temporal
 * corroboration pipeline and streams newline-delimited JSON
 * `CorroborationEvent`s as each stage completes (real progress, not a
 * timed animation). The final line is always `{ "type": "result", ... }`.
 * Mirrors POST /api/analytics.
 *
 * GET /api/corroboration — returns the current server-derived
 * `CorroborationState` as JSON.
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
      const send = (event: CorroborationEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runCorroborationSynthesis(send);
      } catch (err) {
        console.error("[api/corroboration] unexpected stream error", err);
        const result: CorroborationResult = {
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
            message: "An internal error occurred during corroboration synthesis. Nothing was persisted for this run.",
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
  const state = await getCorroborationState();
  return Response.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
