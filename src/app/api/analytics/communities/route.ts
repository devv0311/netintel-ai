import { getCommunities } from "@/lib/analytics/summary";

/**
 * GET /api/analytics/communities — every detected community/cluster,
 * sorted by size: cluster id, members, dominant entity/relationship
 * types, and representative (highest-betweenness) members. Neutral
 * terminology only — never "criminal organization".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const communities = await getCommunities();
  if (!communities) {
    return Response.json({ error: "Analytics are not available yet." }, { status: 404 });
  }
  return Response.json({ communities }, { headers: { "Cache-Control": "no-store" } });
}
