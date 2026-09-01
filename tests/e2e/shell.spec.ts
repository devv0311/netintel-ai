import { test, expect } from "@playwright/test";

/**
 * The application shell renders correctly regardless of investigation
 * state: header identity, the synthetic-data safety indicator, and the
 * later-milestone navigation entries disabled — with no console errors.
 */
test("application shell renders with header, safety indicator and disabled analysis nav", async ({
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

  // Analysis / Copilot / Reporting surfaces are later milestones.
  await expect(page.getByRole("button", { name: "Graph" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Timeline" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ask a Question" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Dossier" })).toBeDisabled();

  expect(consoleErrors).toEqual([]);
});
