import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const enabled = Boolean(process.env.E2E_AUTH_SECRET && process.env.E2E_DATA_DIR && process.env.E2E_SUPERADMIN_EMAIL && process.env.E2E_SUPERADMIN_PASSWORD);

function run(script: string, args: string[] = []) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(process.cwd(), "node_modules", ".bin", "tsx"), [script, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ANIMIND_DATA_DIR: process.env.E2E_DATA_DIR,
        ANIMIND_SKIP_ENV_FILE: "1",
        DATABASE_URL: "",
        POSTGRES_URL: "",
        BLOB_READ_WRITE_TOKEN: "",
        BLOB_STORE_ID: "",
        SEED_SUPERADMIN_EMAIL: process.env.E2E_SUPERADMIN_EMAIL,
        SEED_SUPERADMIN_PASSWORD: process.env.E2E_SUPERADMIN_PASSWORD,
        ANIMIND_SKIP_CHARACTER_IMPORT: "1",
        ANIMIND_CHARACTER_ZIP: "",
      },
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}: ${stderr}`))));
  });
}

test("super admin entra e vê o personagem importado", async ({ page }) => {
  test.skip(!enabled, "defina E2E_AUTH_SECRET, E2E_DATA_DIR, E2E_SUPERADMIN_EMAIL e E2E_SUPERADMIN_PASSWORD");
  const email = process.env.E2E_SUPERADMIN_EMAIL!;
  const password = process.env.E2E_SUPERADMIN_PASSWORD!;
  await run("scripts/seed-superadmin.ts");
  const folder = path.join(process.env.E2E_DATA_DIR!, "einstein-folder");
  await mkdir(path.join(folder, "views"), { recursive: true });
  const puppet = { name: "Einstein", views: { front: { canvas: { w: 8, h: 8 }, layers: [], visemes: {} } } };
  await writeFile(path.join(folder, "puppet.json"), JSON.stringify(puppet));
  await writeFile(path.join(folder, "views", "front.png"), PNG);
  await writeFile(path.join(folder, "views", "three-quarter.png"), PNG);
  await writeFile(path.join(folder, "views", "profile.png"), PNG);
  await writeFile(path.join(folder, "emotion-sheet.png"), PNG);
  await run("scripts/import-character.ts", ["--dir", folder, "--email", email, "--name", "Einstein", "--persona", "wikiquote:Albert_Einstein"]);

  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("my-characters")).toBeVisible();
  await expect(page.getByTestId("account-role")).toHaveAttribute("data-role", "super_admin");
  await expect(page.getByTestId("character-card").filter({ hasText: "Einstein" })).toBeVisible();
  await page.getByTestId("character-card").filter({ hasText: "Einstein" }).click();
  await expect(page.getByTestId("view-front").locator("img")).toBeVisible();
  await expect(page.getByTestId("view-three-quarter-left").locator("img")).toBeVisible();
  await expect(page.getByTestId("view-profile").locator("img")).toBeVisible();
  await expect(page.getByTestId("emotion-sheet").locator("img")).toBeVisible();
  await expect(page.getByTestId("persona-ref")).toHaveText("wikiquote:Albert_Einstein");
  await page.getByTestId("use-debate").click();
  await expect(page.getByTestId("library-character")).toContainText("Einstein");
  await expect(page.getByTestId("library-character")).toContainText("debate");
});
