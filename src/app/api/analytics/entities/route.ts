import { getRankedEntities } from "@/lib/analytics/summary";

/**
 * GET /api/analytics/entities?offset=&limit= — a paginated view of
 * entities ranked by structural prominence (never the full corpus in
 * one response — capped server-side). Each row exposes the component
 * metrics (degree centrality, betweenness centrality, bridge score)
 * behind its rank, per this milestone's requirement that a ranking
 * never hide the signals that produced it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const offsetParam = url.searchParams.get("offset");
  const limitParam = url.searchParams.get("limit");
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const page = await getRankedEntities({
    offset: offset !== undefined && Number.isFinite(offset) ? offset : undefined,
    limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
  });
  if (!page) {
    return Response.json({ error: "Analytics are not available yet." }, { status: 404 });
  }
  return Response.json(page, { headers: { "Cache-Control": "no-store" } });
}
