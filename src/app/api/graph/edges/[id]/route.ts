import { getEdgeDetail } from "@/lib/graph/summary";

/**
 * GET /api/graph/edges/[id] — full provenance/evidence detail for one
 * graph edge: relationship type, direction, classification, confidence,
 * attributes, conflicts, and the resolved extracted-record evidence
 * trail (the "why does this edge exist" answer). No database internals
 * or filesystem paths are exposed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/graph/edges/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  const detail = await getEdgeDetail(id);
  if (!detail) {
    return Response.json({ error: "Edge not found." }, { status: 404 });
  }
  return Response.json(detail, {
    headers: { "Cache-Control": "no-store" },
  });
}
