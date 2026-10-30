import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite (see e2e/README.md). Two projects run the same user flow:
 *   mock  always: the app with ANIMIND_CORE_MOCK=1, no keys, fast (CI).
 *   core  only when E2E_CORE_URL is set: the app proxies to a real Omni-Engine core.
 * Both use the production build (`npm run build` first).
 */
const coreUrl = process.env.E2E_CORE_URL?.replace(/\/$/, "");
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 3311);
const CORE_PORT = Number(process.env.E2E_APP_PORT ?? 3312);

const server = (port: number, env: Record<string, string>) => ({
  command: `npx next start -p ${port}`,
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: false,
  timeout: 120_000,
  env,
});

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    video: { mode: "on", size: { width: 1280, height: 900 } },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [
    { name: "mock", timeout: 120_000, use: { baseURL: `http://127.0.0.1:${MOCK_PORT}` } },
    ...(coreUrl ? [{ name: "core", timeout: 40 * 60_000, use: { baseURL: `http://127.0.0.1:${CORE_PORT}` } }] : []),
  ],
  webServer: [
    server(MOCK_PORT, { ANIMIND_CORE_MOCK: "1", ANIMIND_CORE_URL: "", CORE_URL: "" }),
    ...(coreUrl
      ? [server(CORE_PORT, { ANIMIND_CORE_URL: coreUrl, ANIMIND_CORE_KEY: process.env.E2E_CORE_KEY ?? "", ANIMIND_CORE_MOCK: "" })]
      : []),
  ],
});
