import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // The database reset runs here, not in a `globalSetup` hook: Playwright
    // starts the web server first, and the server opens the database as soon
    // as it answers the readiness request — so by the time globalSetup ran,
    // the file was already held open. See tests/e2e/reset-e2e-db.mjs.
    command: "node tests/e2e/reset-e2e-db.mjs && npm run dev",
    url: "http://localhost:3000",
    // Always a fresh server so it picks up the e2e DATABASE_URL below.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: "./data/cipher-e2e.db",
    },
  },
});
