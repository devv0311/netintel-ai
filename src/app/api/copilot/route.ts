import { askCopilot } from "@/lib/copilot/service";
import { getCopilotState } from "@/lib/copilot/summary";
import type { CopilotEvent, CopilotResult } from "@/lib/copilot/types";

/**
 * POST /api/copilot — answers one investigative question and streams
 * newline-delimited JSON `CopilotEvent`s as each of the nine stages
 * completes (real progress, not a timed animation). The final line is
 * always `{ "type": "result", ... }`. Mirrors POST /api/corroboration.
 *
 * GET /api/copilot — returns the current server-derived `CopilotState`
 * (readiness, corpus counts, model/prompt/schema versions, and the
 * bound suggested questions) as JSON.
 *
 * Node runtime: the pipeline uses `node:sqlite`. Never cached. Errors
 * are returned as a structured `failed` result, never as a stack trace,
 * and never as a raw AI-provider error string.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failedResult(question: string, message: string): CopilotResult {
  return {
    status: "failed",
    question,
    response: null,
    modelError: null,
    warnings: [],
    stages: [],
    error: { code: "INTERNAL_ERROR", stage: "parse_question", message },
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

export async function POST(req: Request): Promise<Response> {
  let question = "";
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object" && "question" in body && typeof body.question === "string") {
      question = body.question;
    }
  } catch {
    question = "";
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: CopilotEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await askCopilot(question, send);
      } catch (err) {
        console.error("[api/copilot] unexpected stream error", err);
        send({
          type: "result",
          result: failedResult(question, "An internal error occurred while answering. No answer was produced."),
        });
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
  const state = await getCopilotState();
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}
