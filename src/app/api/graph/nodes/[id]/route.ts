import { getNodeDetail } from "@/lib/graph/summary";

/**
 * GET /api/graph/nodes/[id] — full graph detail for one node (a
 * canonical entity or a location): kind, label, aliases, attributes,
 * provenance, and every incident edge. Used by the Graph screen's
 * node-detail panel. No database internals or filesystem paths are
 * exposed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/graph/nodes/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  const detail = await getNodeDetail(id);
  if (!detail) {
    return Response.json({ error: "Node not found." }, { status: 404 });
  }
  return Response.json(detail, {
    headers: { "Cache-Control": "no-store" },
  });
}
