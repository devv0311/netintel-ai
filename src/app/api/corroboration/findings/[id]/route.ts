import { getCorroborationFindingDetail } from "@/lib/corroboration/summary";

/**
 * GET /api/corroboration/findings/[id] — full detail for one
 * corroboration finding: its subject entities and anchor locations
 * (id-resolved to labels/coordinates), the temporal window, the
 * structured metric value, the method and explanation, the exact
 * classification, and the full provenance object plus the cited source
 * evidence-item and observable-record ids. No database internals or
 * filesystem paths are exposed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/corroboration/findings/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  const detail = await getCorroborationFindingDetail(id);
  if (!detail) {
    return Response.json({ error: "Finding not found or corroboration not available." }, { status: 404 });
  }
  return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
}
