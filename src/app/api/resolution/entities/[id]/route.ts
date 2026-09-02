import { getEntityDetail } from "@/lib/resolution/summary";

/**
 * GET /api/resolution/entities/[id] — full resolution detail for one
 * canonical entity: every contributing decision, with its own
 * reason/confidence/provenance. Used by the resolution-results detail
 * view. No database internals or filesystem paths are exposed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/resolution/entities/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  const detail = await getEntityDetail(id);
  if (!detail) {
    return Response.json({ error: "Entity not found." }, { status: 404 });
  }
  return Response.json(detail, {
    headers: { "Cache-Control": "no-store" },
  });
}
