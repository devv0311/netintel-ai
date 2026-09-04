/**
 * POST /api/ml/pair-score — an advisory same-entity score for two records.
 *
 * Read-only and stateless: it touches no database, creates no entity,
 * and changes no resolution. It exists so the model's output is
 * reachable from the product on the same terms it is reachable from the
 * evaluation harness — same artifact, same code path, same threshold —
 * which is what makes "inference reproduces evaluation behaviour" a
 * property of the system rather than a claim about it.
 *
 * The response always carries the classification, the model version, the
 * threshold, the deterministic resolver's own verdict and every feature
 * behind the score. A caller cannot obtain the number without the
 * evidence for it.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { deterministicPairDecision, type FeatureRecord } from "@/lib/ml/features";
import { suggestSameEntity } from "@/lib/ml/service";

const RecordSchema = z.object({
  name: z.string().min(1),
  officialName: z.string().min(1).optional(),
  aliases: z.array(z.string().min(1)).optional(),
  jurisdiction: z.string().min(1).optional(),
});

const BodySchema = z.object({ a: RecordSchema, b: RecordSchema });

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const a: FeatureRecord = parsed.data.a;
  const b: FeatureRecord = parsed.data.b;
  const suggestion = suggestSameEntity(a, b, deterministicPairDecision(a, b));
  return NextResponse.json(suggestion);
}
