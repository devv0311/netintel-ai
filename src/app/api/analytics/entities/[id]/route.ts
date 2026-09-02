import { getEntityAnalyticsDetail } from "@/lib/analytics/summary";

/**
 * GET /api/analytics/entities/[id] — full analytics detail for one
 * node (a canonical entity or a location): degree breakdown, every
 * analytical signal that targets it (with its supporting graph edges),
 * and its community membership. No database internals or filesystem
 * paths are exposed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/analytics/entities/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  const detail = await getEntityAnalyticsDetail(id);
  if (!detail) {
    return Response.json({ error: "Entity not found or analytics not available." }, { status: 404 });
  }
  return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
}
