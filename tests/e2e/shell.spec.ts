import { test, expect } from "@playwright/test";

/**
 * The application shell renders correctly regardless of investigation
 * state: header identity, the synthetic-data safety indicator, and the
 * later-milestone navigation entries disabled — with no console errors.
 *
 * The "Graph", "Analytics", "Corroboration", "Ask a Question" and
 * "Dossier" entries are deliberately excluded from the always-disabled
 * assertion below: per P5.5–P5.9, each enables live once the stage it
 * depends on has actually succeeded (docs/data/graph.md,
 * docs/data/analytics.md, docs/data/corroboration.md,
 * docs/data/dossier.md) — this file runs after every
 * "investigation-*" spec in the shared-DB e2e suite (all
 * "investigation-*" files sort before "shell.spec.ts" lexically), so by
 * the time this test runs all five may already be enabled. The accurate
 * enable/disable transition itself is tested end to end in those files.
 *
 * "Timeline" and "Map" stay here because they are genuinely still
 * unimplemented, and this assertion is what will catch it if one of
 * them is ever wired up without its milestone.
 */
test("application shell renders with header, safety indicator and disabled future-milestone nav", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("/");

  await expect(page.getByText("CIPHER")).toBeVisible();
  await expect(page.getByText("Investigation Workspace")).toBeVisible();
  await expect(
    page.getByText("Synthetic data only — not a real investigation"),
  ).toBeVisible();

  // The remaining Analysis surfaces are later milestones with no backing stage.
  await expect(page.getByRole("button", { name: "Timeline" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Map" })).toBeDisabled();

  expect(consoleErrors).toEqual([]);
});
