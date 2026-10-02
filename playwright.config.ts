import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on variables already in the environment (CI).
}

const WEB_PORT = 3100;
const WORKER_PORT = 8181;
const FAKE_PORT = 4010;

// A separate database, so the tests never touch development data.
const adminUrl = process.env.DATABASE_URL ?? "postgres://askdocs:askdocs@localhost:5433/askdocs";
const e2eUrl = new URL(adminUrl);
e2eUrl.pathname = "/askdocs_e2e";

// Everything the servers need. The AI service is a local stand-in, and the key is fake,
// so a real key in .env can never reach the real service from a test.
const env = {
  E2E_ADMIN_URL: adminUrl,
  E2E_DATABASE_URL: e2eUrl.toString(),
  DATABASE_URL: e2eUrl.toString(),
  DATABASE_URL_DIRECT: e2eUrl.toString(),
  BETTER_AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123456789abcdef",
  BETTER_AUTH_URL: `http://localhost:${WEB_PORT}`,
  OPENROUTER_API_KEY: "e2e-fake-key",
  OPENROUTER_BASE_URL: `http://127.0.0.1:${FAKE_PORT}/api/v1`,
  OPENROUTER_CHAT_MODELS: "",
  OPENROUTER_EMBEDDING_MODEL: "",
  RETRIEVAL_MODE: "",
  WORKER_URL: "",
  CRON_SECRET: "",
  PORT: String(WORKER_PORT),
  FAKE_OPENROUTER_PORT: String(FAKE_PORT),
};

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${WEB_PORT}`, viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  webServer: [
    { command: "node e2e/fake-openrouter.mjs", url: `http://127.0.0.1:${FAKE_PORT}/__health`, env, reuseExistingServer: !process.env.CI },
    {
      command: "pnpm exec tsx e2e/prepare-db.mts && pnpm worker",
      url: `http://127.0.0.1:${WORKER_PORT}/health`,
      env,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm build && pnpm exec next start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/sign-in`,
      env,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
