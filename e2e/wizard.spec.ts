import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

let shot = 0;

async function snap(page: Page, info: TestInfo, flow: string, name: string) {
  await page.waitForTimeout(300);
  const file = info.outputPath(`${String(++shot).padStart(2, "0")}-${flow}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await info.attach(`${flow}-${name}`, { path: file, contentType: "image/png" });
  if (process.env.E2E_SHOTS_DIR) {
    await mkdir(process.env.E2E_SHOTS_DIR, { recursive: true });
    await copyFile(file, path.join(process.env.E2E_SHOTS_DIR, `${flow}-${name}.png`));
  }
}

async function fillCharacter(page: Page, name: string, prompt: string) {
  await page.getByTestId("character-name").fill(name);
  await page.getByTestId("character-prompt").fill(prompt);
}

async function expectPreview(page: Page) {
  const canvas = page.getByTestId("preview-canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("transcript")).toBeVisible();
  await expect(page.getByTestId("script-qa")).toHaveAttribute("data-pass", "true");
  await expect(async () => {
    const first = await canvas.screenshot();
    await page.waitForTimeout(600);
    const second = await canvas.screenshot();
    expect(Buffer.compare(first, second), "preview should animate").not.toBe(0);
  }).toPass({ timeout: 15_000 });
}

test("novo fluxo de monólogo", async ({ page }, info) => {
  shot = 0;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Quem vai falar?" })).toBeVisible();
  await expect(page.getByTestId("core-mode")).toHaveText("mock de dev");
  await page.getByTestId("mode-monologue").click();
  await page.getByTestId("type-stick").click();
  await page.getByTestId("art-ghibli").click();
  await fillCharacter(page, "Sócrates", "filósofo idoso, túnica clara, sereno, curioso e bem-humorado");
  await snap(page, info, "monologo", "01-modo");
  await page.getByTestId("add-character").click();

  await expect(page.getByTestId("flow-step-1")).toBeVisible();
  await expect(page.getByTestId("character-card")).toContainText("Sócrates");
  await snap(page, info, "monologo", "02-personagens");
  await page.getByTestId("continue").click();

  await page.getByTestId("topic").fill("como fazer perguntas melhores");
  await page.getByTestId("tone").selectOption("comedia");
  await page.getByTestId("narrative").selectOption("aula");
  await page.getByTestId("duration-30").click();
  await page.getByTestId("script-prompt").fill("Abra com uma pergunta e termine com um desafio prático.");
  await snap(page, info, "monologo", "03-tema-roteiro");
  await page.getByTestId("continue").click();

  await page.getByTestId("scenario-auto").click();
  await snap(page, info, "monologo", "04-cenario");
  await page.getByTestId("continue").click();

  await expect(page.getByText("Automático por época", { exact: true })).toBeVisible();
  await snap(page, info, "monologo", "05-gerar");
  await page.getByTestId("generate").click();
  await expectPreview(page);
  await expect(page.getByTestId("transcript")).toContainText("Sócrates");
  await snap(page, info, "monologo", "06-resultado");
});

test("novo fluxo de diálogo com cenário por prompt", async ({ page }, info) => {
  shot = 0;
  await page.goto("/");
  await page.getByTestId("mode-dialogue").click();
  await page.getByTestId("type-illustrated").click();
  await page.getByTestId("art-retro").click();
  await fillCharacter(page, "Luna", "astronauta jovem, macacão laranja, cabelo curto, personalidade otimista");
  await snap(page, info, "dialogo", "01-modo");
  await page.getByTestId("add-character").click();

  await fillCharacter(page, "Orion", "robô astrônomo antigo, metal azul gasto, preciso e desconfiado");
  await page.getByTestId("add-character").click();
  await expect(page.getByTestId("character-card")).toHaveCount(2);
  await snap(page, info, "dialogo", "02-personagens");
  await page.getByTestId("continue").click();

  await page.getByTestId("topic").fill("se a humanidade deve morar em Marte");
  await page.getByTestId("tone").selectOption("ficcao");
  await page.getByTestId("duration-90").click();
  await page.getByTestId("script-prompt").fill("Os dois discordam, mas descobrem um risco que muda a conversa.");
  await snap(page, info, "dialogo", "03-tema-roteiro");
  await page.getByTestId("continue").click();

  await page.getByTestId("scenario-prompt").click();
  await page.getByTestId("scenario-description").fill("nave retrofuturista com Saturno na janela e luz azul");
  await snap(page, info, "dialogo", "04-cenario");
  await page.getByTestId("continue").click();

  await page.getByTestId("format-9x16").click();
  await snap(page, info, "dialogo", "05-gerar");
  await page.getByTestId("generate").click();
  await expectPreview(page);
  await expect(page.getByTestId("scenario-fallback")).toContainText("cenário existente mais próximo");
  await expect(page.getByTestId("preview-canvas")).toHaveAttribute("width", "1080");
  await expect(page.getByTestId("transcript")).toContainText("Luna");
  await expect(page.getByTestId("transcript")).toContainText("Orion");
  await snap(page, info, "dialogo", "06-resultado");
});
