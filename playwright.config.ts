import { defineConfig, devices } from "@playwright/test";

// Keine `retries` hier: die eine CI-Wiederholung setzt das Makefile-Ziel `e2e`.
export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/**/*.spec.ts", "tests/akzeptanz/**/*.spec.ts"],
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000", // standardwert: lokale App
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
