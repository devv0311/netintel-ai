import { runIngestion } from "@/lib/ingestion/service";
import { getInvestigationState } from "@/lib/ingestion/summary";
import type {
  IngestionEvent,
  IngestionResult,
  IngestionSourceInput,
} from "@/lib/ingestion/types";

/**
 * POST /api/ingestion  — runs the real local ingestion pipeline and
 * streams newline-delimited JSON `IngestionEvent`s as each stage
 * completes (real progress, not a timed animation). The final line is
 * always `{ "type": "result", ... }`.
 *
 * GET  /api/ingestion  — returns the current server-derived
 * `InvestigationState` as JSON.
 *
 * Node runtime: the pipeline uses `node:fs` and `node:sqlite`. Never
 * cached. Errors are returned as a structured `failed` result, never as
 * a stack trace.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSource(body: unknown): IngestionSourceInput {
  if (
    body &&
    typeof body === "object" &&
    "source" in body &&
    (body as { source?: unknown }).source &&
    typeof (body as { source: unknown }).source === "object"
  ) {
    const source = (body as { source: Record<string, unknown> }).source;
    if (source.kind === "uploaded" && "contents" in source) {
      return {
        kind: "uploaded",
        contents: source.contents,
        filename:
          typeof source.filename === "string" ? source.filename : undefined,
      };
    }
  }
  return { kind: "builtin-corpus" };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const source = parseSource(body);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: IngestionEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runIngestion(source, send);
      } catch (err) {
        console.error("[api/ingestion] unexpected stream error", err);
        const result: IngestionResult = {
          status: "failed",
          corpus: null,
          investigationId: null,
          counts: null,
          persisted: null,
          stages: [],
          error: {
            code: "INTERNAL_ERROR",
            stage: "result",
            message:
              "An internal error occurred during ingestion. Nothing was persisted for this run.",
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
  const state = await getInvestigationState();
  return Response.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
