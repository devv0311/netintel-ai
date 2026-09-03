import { test, expect } from "@playwright/test";

/**
 * The application shell renders correctly regardless of investigation
 * state: header identity, the synthetic-data safety indicator, and the
 * later-milestone navigation entries disabled — with no console errors.
 *
 * The "Graph", "Analytics" and "Corroboration" entries are deliberately
 * excluded from the always-disabled assertion below: per P5.5/P5.6/P5.7,
 * each enables live once its own synthesis has actually succeeded
 * (docs/data/graph.md, docs/data/analytics.md, docs/data/corroboration.md)
 * — this file runs after investigation-synthesis.spec.ts,
 * investigation-topology.spec.ts and investigation-corroboration.spec.ts
 * in the shared-DB e2e suite (all "investigation-*" files sort before
 * "shell.spec.ts" lexically), so by the time this test runs all three
 * may already be enabled. The accurate enable/disable transition itself
 * is tested end to end in those files.
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

  await expect(page.getByText("NetIntel AI")).toBeVisible();
  await expect(page.getByText("Investigation Workspace")).toBeVisible();
  await expect(
    page.getByText("Synthetic data only — not a real investigation"),
  ).toBeVisible();

  // Copilot / Reporting / remaining Analysis surfaces are later milestones.
  await expect(page.getByRole("button", { name: "Timeline" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Map" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ask a Question" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Dossier" })).toBeDisabled();

  expect(consoleErrors).toEqual([]);
});
