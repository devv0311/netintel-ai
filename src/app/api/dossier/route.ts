import { runDossierGeneration } from "@/lib/dossier/service";
import { getDossierState } from "@/lib/dossier/summary";
import type { DossierEvent, DossierResult } from "@/lib/dossier/types";

/**
 * POST /api/dossier — generates the case dossier and streams
 * newline-delimited JSON `DossierEvent`s as each of the eleven stages
 * completes (real progress, not a timed animation). The final line is
 * always `{ "type": "result", ... }`. Mirrors POST /api/corroboration.
 *
 * Generation is idempotent: regenerating an unchanged case returns
 * `status: "already_generated"` with the same dossier id and report
 * version, and writes nothing.
 *
 * GET /api/dossier — returns the current server-derived `DossierState`
 * (not_available / pending / generated / stale) as JSON.
 *
 * Node runtime: the pipeline uses `node:sqlite`. Never cached. Errors
 * are returned as a structured `failed` result, never as a stack trace,
 * a filesystem path, or a raw AI-provider error string.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: DossierEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runDossierGeneration(send);
      } catch (err) {
        console.error("[api/dossier] unexpected stream error", err);
        const result: DossierResult = {
          status: "failed",
          dossierId: null,
          reportVersion: null,
          investigationId: null,
          graphVersion: null,
          counts: null,
          persisted: null,
          warnings: [],
          stages: [],
          error: {
            code: "INTERNAL_ERROR",
            stage: "result",
            message: "An internal error occurred while generating the dossier. No report was written for this run.",
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
  const state = await getDossierState();
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}
