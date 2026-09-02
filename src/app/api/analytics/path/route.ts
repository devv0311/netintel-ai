import { getPath } from "@/lib/analytics/summary";
import { RELATIONSHIP_TYPES, type RelationshipType } from "@/lib/domain/relationship";

const RELATIONSHIP_TYPE_SET = new Set<string>(RELATIONSHIP_TYPES);

/**
 * GET /api/analytics/path?source=&target=&types= — shortest-path query
 * between two entities/locations, optionally restricted to a comma-
 * separated list of relationship types (e.g.
 * `types=communication,financial`). Always returns a structured result
 * — `{ found: true, ... }` or `{ found: false, reason }` — never a
 * thrown error for "no path exists". The algorithm never manufactures
 * an edge; every edge in a found path resolves to a real, persisted
 * relationship.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const target = url.searchParams.get("target");
  if (!source || !target) {
    return Response.json({ error: "Both 'source' and 'target' query parameters are required." }, { status: 400 });
  }

  const typesParam = url.searchParams.get("types");
  let relationshipTypes: RelationshipType[] | undefined;
  if (typesParam) {
    const requested = typesParam.split(",").map((t) => t.trim()).filter(Boolean);
    const invalid = requested.filter((t) => !RELATIONSHIP_TYPE_SET.has(t));
    if (invalid.length > 0) {
      return Response.json({ error: `Unknown relationship type(s): ${invalid.join(", ")}` }, { status: 400 });
    }
    relationshipTypes = requested as RelationshipType[];
  }

  const result = await getPath(source, target, relationshipTypes);
  if (!result) {
    return Response.json({ error: "Analytics are not available yet." }, { status: 404 });
  }
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
