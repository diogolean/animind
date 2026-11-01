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

test("prompt automático em um clique", async ({ page }, info) => {
  shot = 0;
  let renderRequest: Record<string, unknown> | undefined;
  const characterRequests: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/render") && request.method() === "POST") renderRequest = request.postDataJSON() as Record<string, unknown>;
    if (request.url().endsWith("/api/characters") && request.method() === "POST") characterRequests.push(request.postDataJSON() as Record<string, unknown>);
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Imagine. Dirija. Gere." })).toBeVisible();
  await expect(page.getByTestId("creation-prompt")).toHaveAttribute("placeholder", /Descreva sua criação/);
  await expect(page.getByTestId("core-mode")).toHaveText("mock de dev");
  await expect(page.getByTestId("automatic-toggle")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("language-selector")).toHaveAttribute("data-value", "en-US");
  const japaneseCatalog = await (await page.request.get("/api/voices?lang=ja-JP")).json();
  expect(japaneseCatalog.languages.length).toBeGreaterThan(70);
  expect(japaneseCatalog.voices).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "ja-JP-KeitaNeural", language: "ja-JP" }),
    expect.objectContaining({ id: "ja-JP-NanamiNeural", language: "ja-JP" }),
  ]));
  expect(japaneseCatalog.voices.every((voice: { language: string }) => voice.language === "ja-JP")).toBe(true);
  const japanesePlan = await (await page.request.post("/api/plan", {
    data: { prompt: "先生が宇宙について話す" },
  })).json();
  expect(japanesePlan.language).toBe("ja-JP");
  await snap(page, info, "automatico", "01-tela-inicial");

  await page.getByTestId("language-selector").click();
  const suggestedOptions = page.getByRole("option");
  await expect(suggestedOptions.nth(0)).toContainText("English");
  await expect(suggestedOptions.nth(1)).toContainText("Português BR");
  await expect(suggestedOptions.nth(2)).toContainText("Español");
  await page.getByTestId("language-selector-search").press("Escape");

  await page.getByTestId("creation-prompt").fill("Uma conversa entre Jesus e o diabo debatendo temas bíblicos");
  const chips = page.getByTestId("plan-chips");
  await expect(chips).toBeVisible();
  await expect(page.getByTestId("plan-chip-mode")).toContainText("Debate");
  await expect(page.getByTestId("plan-chip-characters")).toContainText("Jesus + Diabo");
  await expect(page.getByTestId("plan-chip-topic")).toContainText("temas bíblicos");
  await expect(page.getByTestId("plan-chip-language")).toContainText("Português BR");
  await expect(page.getByTestId("language-selector")).toHaveAttribute("data-value", "pt-BR");
  await expect(page.getByTestId("plan-chip-voice-0")).toContainText("Masc. · Auto");
  await snap(page, info, "automatico", "02-chips");

  await page.getByTestId("language-selector").click();
  const languageSearch = page.getByTestId("language-selector-search");
  await languageSearch.fill("Japonês");
  await expect(page.getByTestId("language-selector-option-ja-JP")).toContainText("日本語");
  await snap(page, info, "automatico", "03-busca-idioma");
  await languageSearch.press("Enter");
  await expect(page.getByTestId("language-selector")).toHaveAttribute("data-value", "ja-JP");
  await expect(page.getByTestId("plan-chip-language")).toContainText("日本語");

  await page.getByTestId("plan-chip-voice-0").click();
  await page.getByTestId("plan-voice-gender-0-female").click();
  await page.getByTestId("plan-voice-select-0").selectOption("ja-JP-NanamiNeural");
  await page.getByTestId("plan-voice-preview-0").click();
  await expect(page.getByTestId("plan-chip-voice-0")).toContainText("Fem. · Nanami");
  await snap(page, info, "automatico", "04-voz-editavel");
  await page.getByRole("button", { name: "Fechar editor" }).click();
  await expect(page.getByTestId("chip-editor")).toHaveCount(0);

  await page.getByTestId("plan-chip-tone").click();
  await expect(page.getByTestId("chip-editor")).toBeVisible();
  await page.getByTestId("plan-tone").selectOption("sabio");
  await expect(page.getByTestId("plan-chip-tone")).toContainText("Sábio");
  await page.getByRole("button", { name: "Fechar editor" }).click();

  await page.getByTestId("generate").click();
  await expectPreview(page);
  await expect(page.getByTestId("transcript")).toContainText("Jesus");
  await expect(page.getByTestId("transcript")).toContainText("Diabo");
  expect(characterRequests).toHaveLength(2);
  expect(characterRequests.map((request) => request.name)).toEqual(["Jesus", "Diabo"]);
  expect(renderRequest).toMatchObject({
    tone: "sabio",
    objective: "debater",
    targetDurationSec: 90,
    configurationSource: "automatic",
    language: "ja-JP",
    voices: [
      { voice: "ja-JP-NanamiNeural", auto: false },
      { voice: "ja-JP-KeitaNeural", auto: true },
    ],
  });
  await snap(page, info, "automatico", "05-resultado");
});

test("controles manuais na mesma página", async ({ page }, info) => {
  shot = 0;
  let renderRequest: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/render") && request.method() === "POST") renderRequest = request.postDataJSON() as Record<string, unknown>;
  });
  await page.goto("/");
  await page.getByTestId("automatic-toggle").click();
  await expect(page.getByTestId("automatic-toggle")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("manual-controls")).toBeVisible();
  await expect(page.getByTestId("manual-language")).toHaveAttribute("data-value", "en-US");
  await page.getByTestId("manual-mode-debate").click();
  await page.getByTestId("manual-character-name-0").fill("Luna");
  await page.getByTestId("manual-character-prompt-0").fill("astronauta jovem, macacão laranja, otimista");
  await page.getByTestId("manual-character-add").click();
  await page.getByTestId("manual-character-name-1").fill("Orion");
  await page.getByTestId("manual-character-prompt-1").fill("robô astrônomo azul, preciso e desconfiado");
  await page.getByTestId("manual-voice-gender-0-female").click();
  await page.getByTestId("manual-voice-select-0").selectOption("en-US-AvaMultilingualNeural");
  await page.getByTestId("manual-voice-select-1").selectOption("en-US-BrianMultilingualNeural");
  await page.getByTestId("manual-voice-preview-0").click();
  await page.getByTestId("manual-type-illustrated").click();
  await page.getByTestId("manual-art-retro").click();
  await page.getByTestId("manual-topic").fill("se a humanidade deve morar em Marte");
  await page.getByTestId("manual-tone").selectOption("terror");
  await page.getByTestId("manual-objective").selectOption("convencer");
  await page.getByTestId("manual-duration-90").click();
  await page.getByTestId("manual-scenario-prompt").click();
  await page.getByTestId("manual-scenario-description").fill("nave retrofuturista com Saturno na janela e luz azul");
  await page.getByTestId("format-9x16").click();
  await snap(page, info, "manual", "01-controles-abertos");

  await page.getByTestId("generate").click();
  await expectPreview(page);
  await expect(page.getByTestId("scenario-fallback")).toContainText("cenário existente mais próximo");
  await expect(page.getByTestId("preview-canvas")).toHaveAttribute("width", "1080");
  await expect(page.getByTestId("transcript")).toContainText("Luna");
  await expect(page.getByTestId("transcript")).toContainText("Orion");
  expect(renderRequest).toMatchObject({
    tone: "terror",
    objective: "convencer",
    style: "retro",
    targetDurationSec: 90,
    configurationSource: "manual",
    language: "en-US",
    voices: [
      { voice: "en-US-AvaMultilingualNeural", auto: false },
      { voice: "en-US-BrianMultilingualNeural", auto: false },
    ],
  });
  await snap(page, info, "manual", "02-resultado");
});
