import { getResolvedEntitiesPage } from "@/lib/resolution/summary";

/**
 * GET /api/resolution/entities?offset=&limit= — a representative,
 * paginated page of resolved canonical entities. Never returns the full
 * entity set in one response (limit is capped server-side). No database
 * internals or filesystem paths are exposed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);

  const page = await getResolvedEntitiesPage(
    Number.isFinite(offset) ? offset : 0,
    Number.isFinite(limit) ? limit : 25,
  );

  return Response.json(page, {
    headers: { "Cache-Control": "no-store" },
  });
}
