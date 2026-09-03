import { getDossierDetail } from "@/lib/dossier/summary";

/**
 * GET /api/dossier/report — returns the full generated dossier plus its
 * resolved references and whether the graph version it describes is
 * still current.
 *
 * With no `?id=`, returns the report for the current graph version,
 * falling back to the newest report if only a superseded one exists —
 * which comes back with `stale: true` rather than being presented as
 * current. Mirrors GET /api/corroboration/findings/[id].
 *
 * 404 when no report has been generated yet. Errors are structured and
 * user-safe: never a stack trace, a filesystem path, or a secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? undefined;

  try {
    const detail = await getDossierDetail(id);
    if (!detail) {
      return Response.json(
        {
          error: {
            code: "NOT_FOUND",
            message: id
              ? "No dossier with that identifier exists for this investigation."
              : "No dossier has been generated for this investigation yet.",
          },
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/dossier/report] unexpected error", err);
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An internal error occurred while loading the dossier.",
        },
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
