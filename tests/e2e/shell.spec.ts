import { test, expect } from "@playwright/test";

test("application shell renders with an empty state and no console errors", async ({
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
  await expect(page.getByText("No investigation loaded")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload Evidence" })).toBeDisabled();

  expect(consoleErrors).toEqual([]);
});
