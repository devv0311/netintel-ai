import { getBridgeEntities } from "@/lib/analytics/summary";

/**
 * GET /api/analytics/bridges — every entity/location identified as a
 * structural bridge (an articulation point whose removal would split
 * the network), sorted by bridge score. An algorithmic signal about
 * network position, never a claim of wrongdoing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const bridges = await getBridgeEntities();
  if (!bridges) {
    return Response.json({ error: "Analytics are not available yet." }, { status: 404 });
  }
  return Response.json({ bridges }, { headers: { "Cache-Control": "no-store" } });
}
