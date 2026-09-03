import { getEntityPairOverlaps } from "@/lib/corroboration/summary";

/**
 * GET /api/corroboration/pairs — entity pairs with repeated spatial/
 * temporal overlap, aggregated from the current graph version's
 * findings: per pair, how many spatial / temporal / repeated-overlap /
 * contradiction findings relate them, how many are corroborated facts,
 * the strongest classification present, and the contributing finding
 * ids. Ordered strongest-corroboration first.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const pairs = await getEntityPairOverlaps();
  if (!pairs) {
    return Response.json({ error: "Corroboration is not available for the current investigation." }, { status: 404 });
  }
  return Response.json({ pairs }, { headers: { "Cache-Control": "no-store" } });
}
