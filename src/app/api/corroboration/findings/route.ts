import { getCorroborationFindings } from "@/lib/corroboration/summary";
import {
  CORROBORATION_CLASSIFICATIONS,
  CORROBORATION_FINDING_TYPES,
  CORROBORATION_KINDS,
  type CorroborationClassification,
  type CorroborationFindingType,
  type CorroborationKind,
} from "@/lib/domain/corroboration";

/**
 * GET /api/corroboration/findings — a paginated, filterable page of
 * corroboration findings for the current graph version. Query params:
 * `offset`, `limit`, `kind` (spatial|temporal|spatiotemporal), `type`
 * (a specific finding type), `classification`
 * (corroborated_fact|algorithmic_signal), `entityId`. An unknown filter
 * value is ignored rather than erroring. Never exposes database
 * internals or filesystem paths.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);

  const page = await getCorroborationFindings({
    offset: Number.isFinite(offset) ? offset : 0,
    limit: Number.isFinite(limit) ? limit : 25,
    kind: oneOf<CorroborationKind>(url.searchParams.get("kind"), CORROBORATION_KINDS),
    type: oneOf<CorroborationFindingType>(url.searchParams.get("type"), CORROBORATION_FINDING_TYPES),
    classification: oneOf<CorroborationClassification>(
      url.searchParams.get("classification"),
      CORROBORATION_CLASSIFICATIONS,
    ),
    entityId: url.searchParams.get("entityId"),
  });

  if (!page) {
    return Response.json({ error: "Corroboration is not available for the current investigation." }, { status: 404 });
  }
  return Response.json(page, { headers: { "Cache-Control": "no-store" } });
}
