import { getGraphSnapshot } from "@/lib/graph/summary";

/**
 * GET /api/graph/snapshot?limit=&focus= — a bounded set of graph nodes
 * and edges for visualization. Without `focus`, returns up to `limit`
 * highest-degree nodes and the edges between them (never the full graph
 * unbounded). With `focus=<nodeId>`, returns that node's 1-hop
 * neighborhood only, ignoring `limit`. No database internals or
 * filesystem paths are exposed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const focus = url.searchParams.get("focus") ?? undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const snapshot = await getGraphSnapshot({ limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined, focus });
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
