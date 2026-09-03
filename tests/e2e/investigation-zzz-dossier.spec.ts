import { test, expect, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The real end-to-end dossier / report workflow:
 *
 *   load + extract + resolve + synthesize + analyze + corroborate (if
 *     not already done)
 *   →  open the Dossier screen (sidebar entry enables live)
 *   →  Generate dossier  →  watch the real 11-stage stream
 *   →  wait for genuine completion
 *   →  verify every major section is present and populated
 *   →  verify the classification distinctions are rendered, not flattened
 *   →  expand a finding and inspect its references and full provenance
 *   →  verify a contradiction stays an Algorithmic Signal
 *   →  verify the human-verification and synthetic-data notices
 *   →  navigate from the Dossier into the Graph screen
 *   →  reload — the generated dossier persists
 *   →  regenerate — deterministic and idempotent, same report version
 *
 * No mocked network — the dev server runs the real local dossier path
 * against the same SQLite file as the other e2e specs. Named
 * "investigation-zzz-dossier" so it sorts alphabetically AFTER every
 * other "investigation-*" spec in the shared-DB full-suite run: the
 * dossier is the last pipeline stage and reports on all of them. It
 * also advances the pipeline itself if run in isolation, so it never
 * depends on file execution order to pass.
 *
 * Set CAPTURE_EVIDENCE=1 to also write the committed visual-evidence
 * screenshots under docs/progress/evidence/P5.9/.
 */

const CAPTURE = process.env.CAPTURE_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "docs/progress/evidence/P5.9");
const EVIDENCE_DATE = "2026-09-03";
/** The commit the evidence corresponds to, per docs/progress/visual-evidence-convention.md. */
const EVIDENCE_SHA = process.env.EVIDENCE_SHA ?? "f9984f2";

/**
 * Captures one committed evidence artifact. Pass a `region` locator to
 * frame a specific part of the report; omit it for the whole page.
 * The locator must already resolve to exactly one element — several
 * elements share a test id here (there are twelve sections), so callers
 * narrow with a section selector or `.first()`.
 */
async function captureEvidence(page: Page, kind: string, region?: Locator): Promise<void> {
  if (!CAPTURE) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const target = path.join(EVIDENCE_DIR, `P5.9_${kind}_${EVIDENCE_DATE}_${EVIDENCE_SHA}.png`);
  if (region) {
    await region.screenshot({ path: target });
  } else {
    await page.screenshot({ path: target, fullPage: true });
  }
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function stateOf(page: Page, url: string): Promise<string> {
  const res = await page.request.get(url);
  if (!res.ok()) return "unknown";
  return ((await res.json()) as { status?: string }).status ?? "unknown";
}

/** POST the streaming endpoint, consume it to completion, then poll GET until the stage reports `want`. */
async function advance(page: Page, url: string, want: string, data?: unknown): Promise<void> {
  if ((await stateOf(page, url)) === want) return;
  const res = await page.request.post(url, { ...(data ? { data } : {}), timeout: 120_000 });
  expect(res.ok(), `${url} -> ${res.status()}`).toBeTruthy();
  await res.body();
  await expect
    .poll(() => stateOf(page, url), { timeout: 60_000, intervals: [250, 500, 1000] })
    .toBe(want);
}

/**
 * Advances the pipeline through corroboration using the authoritative
 * server APIs — the same streaming endpoints the UI buttons drive — so
 * the setup phase never races a panel's own hydration effect. The
 * dossier workflow itself is exercised entirely through the real UI in
 * the test body.
 */
async function ensureCorroborated(page: Page): Promise<void> {
  await advance(page, "/api/ingestion", "loaded", { source: { kind: "builtin-corpus" } });
  await advance(page, "/api/extraction", "extracted");
  await advance(page, "/api/resolution", "resolved");
  await advance(page, "/api/graph", "synthesized");
  await advance(page, "/api/analytics", "synthesized");
  await advance(page, "/api/corroboration", "synthesized");
  await page.goto("/");
  await expect(page.getByTestId("corroboration-synthesis-complete")).toBeVisible({ timeout: 20_000 });
}

/** Every section the dossier must show an investigator. */
const REQUIRED_SECTIONS = [
  "case_summary",
  "evidence_inventory",
  "key_entities",
  "key_relationships",
  "analytical_signals",
  "corroboration",
  "contradictions",
  "investigative_leads",
  "copilot_material",
  "provenance_index",
  "classification_confidence",
  "limitations",
] as const;

test.describe.serial("dossier / report workflow", () => {
  test("corroborated → Generate dossier → all sections, classifications, provenance and cross-navigation work", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    // A. before generation — everything upstream is done, no report yet
    await ensureCorroborated(page);
    await expect(page.getByTestId("nav-dossier")).toBeEnabled();
    await page.getByTestId("nav-dossier").click();
    await expect(page.getByTestId("dossier-idle")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("dossier-available")).toBeVisible();
    await captureEvidence(page, "screenshot-initial-state", page.getByTestId("dossier-idle"));

    // trigger the real generation
    await page.getByTestId("start-dossier-generation").click();

    // B. progress — the real 11-stage list appears the instant generation starts
    await expect(page.getByRole("list", { name: "Dossier stages" })).toBeVisible({ timeout: 15_000 });
    await captureEvidence(page, "screenshot-generating");

    // C. after generation — wait for genuine completion
    await expect(page.getByTestId("dossier-report")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("dossier-report-header")).toBeVisible();
    await captureEvidence(page, "screenshot-completed-dossier");

    // D. every required section is present
    for (const kind of REQUIRED_SECTIONS) {
      await expect(
        page.locator(`[data-testid="dossier-section"][data-section-kind="${kind}"]`),
        `section ${kind} is missing from the report`,
      ).toBeVisible();
    }
    const findings = page.getByTestId("dossier-finding");
    expect(await findings.count()).toBeGreaterThan(0);

    // E. classification distinctions are RENDERED, not flattened away.
    // A fact and an inference must not read alike (docs/requirements.md §7).
    for (const classification of [
      "observed_fact",
      "corroborated_fact",
      "algorithmic_signal",
      "ai_inference",
      "investigative_lead",
    ]) {
      await expect(
        page.getByTestId(`dossier-census-${classification}`),
        `the census does not report ${classification}`,
      ).toBeVisible();
      expect(
        await page.locator(`[data-testid="dossier-finding"][data-classification="${classification}"]`).count(),
        `no finding carries ${classification}`,
      ).toBeGreaterThan(0);
    }
    await captureEvidence(page, "screenshot-classifications", page.getByTestId("dossier-census"));

    // the synthetic-data indicator and the human-verification disclaimer
    await expect(page.getByTestId("dossier-synthetic-notice")).toBeVisible();
    await expect(page.getByTestId("dossier-verification-notice")).toBeVisible();

    // F. a finding expands to its references and full provenance
    const keyEntity = page
      .locator('[data-section-kind="key_entities"] [data-testid="dossier-finding-toggle"]')
      .first();
    await keyEntity.click();
    const detail = page.getByTestId("dossier-finding-detail").first();
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("dossier-finding-references").first()).toBeVisible();
    const provenance = page.getByTestId("dossier-finding-provenance").first();
    await expect(provenance).toBeVisible();
    // The provenance chain must end at this stage, visibly.
    await expect(provenance).toContainText("dossier:assemble");
    await captureEvidence(page, "screenshot-finding-detail", page.locator('[data-section-kind="key_entities"]'));
    await captureEvidence(page, "screenshot-provenance", detail);

    // G. contradictions are preserved as contradictions
    const contradictions = page.locator('[data-section-kind="contradictions"]');
    await expect(contradictions).toBeVisible();
    const contradictionFindings = contradictions.locator('[data-testid="dossier-finding"]');
    const contradictionCount = await contradictionFindings.count();
    expect(contradictionCount).toBeGreaterThan(0);
    // Every one of them stays an Algorithmic Signal — never a fact.
    expect(
      await contradictions.locator('[data-testid="dossier-finding"][data-classification="algorithmic_signal"]').count(),
    ).toBe(contradictionCount);
    await captureEvidence(page, "screenshot-contradictions", contradictions);

    // leads are present and stay leads
    const leads = page.locator('[data-section-kind="investigative_leads"]');
    await expect(leads).toBeVisible();
    const leadCount = await leads.locator('[data-testid="dossier-finding"]').count();
    expect(leadCount).toBeGreaterThan(0);
    expect(
      await leads.locator('[data-testid="dossier-finding"][data-classification="investigative_lead"]').count(),
    ).toBe(leadCount);
    await captureEvidence(page, "screenshot-verification-leads", leads);

    // H. cross-navigation from a dossier finding into the Graph screen
    const contradictionToggle = contradictions.locator('[data-testid="dossier-finding-toggle"]').first();
    await contradictionToggle.click();
    const viewInGraph = page.getByTestId("dossier-view-in-graph").first();
    await expect(viewInGraph).toBeVisible({ timeout: 10_000 });
    await captureEvidence(page, "screenshot-cross-navigation", contradictions);
    await viewInGraph.click();
    await expect(page.getByTestId("graph-screen")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("graph-node-detail")).toBeVisible({ timeout: 15_000 });

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("reload preserves the generated dossier and regeneration is deterministic and idempotent", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    // A. reload — the report comes back from persisted state, not memory
    await page.goto("/");
    await expect(page.getByTestId("nav-dossier")).toBeEnabled();
    await page.getByTestId("nav-dossier").click();
    await expect(page.getByTestId("dossier-report")).toBeVisible({ timeout: 30_000 });

    const versionBefore = await page.getByTestId("dossier-report-version").textContent();
    const generatedBefore = await page.getByTestId("dossier-generated-at").textContent();
    const findingsBefore = await page.getByTestId("dossier-finding").count();
    expect(versionBefore).toBeTruthy();
    expect(findingsBefore).toBeGreaterThan(0);
    await captureEvidence(page, "screenshot-reload-persisted", page.getByTestId("dossier-report-header"));

    // B. regenerate — identical case state must produce the identical report
    await page.getByTestId("regenerate-dossier").click();
    await expect(page.getByTestId("dossier-generation-note")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("dossier-generation-note")).toContainText(/idempotent/i);

    const versionAfter = await page.getByTestId("dossier-report-version").textContent();
    const generatedAfter = await page.getByTestId("dossier-generated-at").textContent();
    const findingsAfter = await page.getByTestId("dossier-finding").count();

    expect(versionAfter, "report version changed for unchanged case state").toBe(versionBefore);
    expect(findingsAfter).toBe(findingsBefore);
    // The report was reused, not rewritten, so its generation time stands.
    expect(generatedAfter).toBe(generatedBefore);
    await captureEvidence(page, "screenshot-regeneration-idempotent", page.getByTestId("dossier-report-header"));

    // C. the report is not stale — it describes the current graph version
    await expect(page.getByTestId("dossier-stale-notice")).toHaveCount(0);

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  /**
   * The side-by-side comparison required by
   * docs/progress/visual-evidence-convention.md §2.
   *
   * Left is the INTENDED content model — the twelve items blueprint task
   * H1 requires a dossier to carry, quoted from
   * docs/implementation-blueprint.md. Right is the state actually
   * IMPLEMENTED, read live from the generated report rather than
   * asserted by hand, so the comparison cannot drift from reality.
   *
   * This is also a real check, not just a picture: every intended item
   * must map to a section that exists in the generated report, and the
   * test fails if one does not.
   */
  test("intended content model versus the implemented report — side-by-side", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");
    const res = await page.request.get("/api/dossier/report");
    expect(res.ok(), "no generated dossier to compare against").toBeTruthy();
    const detail = (await res.json()) as {
      dossier: {
        reportVersion: string;
        graphVersion: string;
        counts: { findings: number; sections: number; byClassification: Record<string, number> };
        sections: { kind: string; title: string; findings: unknown[]; notes: string[] }[];
      };
    };
    const sections = new Map(detail.dossier.sections.map((s) => [s.kind, s]));

    /** Blueprint H1's required content, mapped to where the report delivers it. */
    const INTENDED: { intended: string; sectionKind: string; note?: string }[] = [
      { intended: "Case summary", sectionKind: "case_summary" },
      { intended: "Suspect profiles", sectionKind: "key_entities" },
      { intended: "Key relationships", sectionKind: "key_relationships" },
      { intended: "Analytical signals", sectionKind: "analytical_signals" },
      {
        intended: "Timeline",
        sectionKind: "corroboration",
        note: "Delivered as the temporal window carried on each corroboration finding. There is no separate timeline visualization — the Timeline screen is a later milestone.",
      },
      { intended: "Spatial evidence", sectionKind: "corroboration", note: "Spatial co-location and proximity findings." },
      {
        intended: "Financial relationships",
        sectionKind: "key_relationships",
        note: "Financial edges appear as key relationships, carrying their own classification.",
      },
      { intended: "Contradictions", sectionKind: "contradictions" },
      {
        intended: "Supporting evidence",
        sectionKind: "evidence_inventory",
        note: "Plus the per-finding reference list on every finding in the report.",
      },
      {
        intended: "Provenance",
        sectionKind: "provenance_index",
        note: "Plus the full six-field provenance block on every finding.",
      },
      {
        intended: "Confidence",
        sectionKind: "classification_confidence",
        note: "Plus the per-finding confidence shown inline.",
      },
      {
        intended: "AI-inference qualification",
        sectionKind: "classification_confidence",
        note: "Plus the per-finding classification badge; the schema forbids a section carrying a classification it does not permit.",
      },
    ];

    // Every intended item must actually be delivered.
    for (const row of INTENDED) {
      expect(sections.has(row.sectionKind), `intended "${row.intended}" maps to a missing section`).toBe(true);
    }

    const BEYOND = detail.dossier.sections
      .map((s) => s.kind)
      .filter((k) => !INTENDED.some((r) => r.sectionKind === k));

    const rows = INTENDED.map((row) => {
      const section = sections.get(row.sectionKind)!;
      return `<tr>
        <td class="i">${row.intended}</td>
        <td class="a"><b>${section.title}</b><span class="m">${section.findings.length} findings · ${section.notes.length} notes</span>${
          row.note ? `<span class="n">${row.note}</span>` : ""
        }</td>
        <td class="s">delivered</td>
      </tr>`;
    }).join("");

    const census = Object.entries(detail.dossier.counts.byClassification)
      .filter(([, n]) => Number(n) > 0)
      .map(([c, n]) => `<span class="b">${n} ${c.replace(/_/g, " ")}</span>`)
      .join("");

    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      body{font:13px/1.5 ui-sans-serif,system-ui,sans-serif;margin:0;padding:24px;background:#fff;color:#0a0a0a;width:1100px}
      h1{font-size:16px;margin:0 0 2px}
      .sub{color:#71717a;font-size:11px;margin-bottom:16px}
      table{border-collapse:collapse;width:100%}
      th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#71717a;border-bottom:1px solid #e4e4e7;padding:6px 8px}
      td{border-bottom:1px solid #f4f4f5;padding:8px;vertical-align:top}
      td.i{width:210px;font-weight:600}
      td.a b{display:block}
      td.s{width:90px;color:#166534;font-weight:600}
      .m{display:block;color:#71717a;font-size:11px;font-family:ui-monospace,monospace}
      .n{display:block;color:#52525b;font-size:11px;margin-top:3px}
      .b{display:inline-block;border:1px solid #e4e4e7;border-radius:5px;padding:1px 7px;margin:0 5px 5px 0;font-size:11px}
      .foot{margin-top:14px;color:#52525b;font-size:11px}
    </style>
    <h1>P5.9 Dossier / Report — intended content model vs. implemented report</h1>
    <div class="sub">Left: the content model blueprint task H1 requires. Right: read live from the generated report at commit ${EVIDENCE_SHA}, graph version ${detail.dossier.graphVersion}, report ${detail.dossier.reportVersion}.</div>
    <table>
      <tr><th>Intended (blueprint H1)</th><th>Implemented (live report)</th><th>Status</th></tr>
      ${rows}
    </table>
    <div class="foot">
      <div><b>Delivered beyond the H1 model:</b> ${BEYOND.map((k) => k.replace(/_/g, " ")).join(", ")}.</div>
      <div style="margin-top:8px"><b>Report totals:</b> ${detail.dossier.counts.sections} sections, ${detail.dossier.counts.findings} findings.</div>
      <div style="margin-top:6px">${census}</div>
    </div>`);

    await captureEvidence(page, "comparison", page.locator("body"));

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
