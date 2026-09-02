import { test, expect } from "@playwright/test";

/**
 * The application shell renders correctly regardless of investigation
 * state: header identity, the synthetic-data safety indicator, and the
 * later-milestone navigation entries disabled — with no console errors.
 *
 * The "Graph" entry is deliberately excluded from the always-disabled
 * assertion below: per P5.5, it enables live once graph synthesis has
 * actually succeeded (docs/data/graph.md) — this file runs after
 * investigation-graph.spec.ts in the shared-DB e2e suite (both start
 * with "i"/"s" but "investigation-*" always sorts before "shell.spec.ts"
 * lexically), so by the time this test runs the graph may already be
 * synthesized and the button correctly enabled. The accurate
 * enable/disable transition itself is tested end to end in
 * investigation-graph.spec.ts.
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
  await expect(page.getByRole("button", { name: "Analytics" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ask a Question" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Dossier" })).toBeDisabled();

  expect(consoleErrors).toEqual([]);
});
