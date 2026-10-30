import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * The real user flow, asserted on what the user sees:
 * landing -> "Quem vai falar?" -> persona, topic and rival -> debate -> lesson,
 * each with a playing preview, a transcript (real quotes carry their source)
 * and, with the core, the "MP4 do núcleo" download.
 *
 * E2E_SHOTS_DIR=/path also copies each step's screenshot and the run video there
 * as 9-e2e-<project>-<n>-<step>.png / .webm.
 */
const PERSONA = process.env.E2E_PERSONA ?? "Sócrates";
const RIVAL = process.env.E2E_RIVAL ?? "Nietzsche";
const TOPIC = process.env.E2E_TOPIC ?? "a verdade";

let shot = 0;
async function snap(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(`${String(++shot).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await info.attach(name, { path: file, contentType: "image/png" });
  const dir = process.env.E2E_SHOTS_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    await copyFile(file, path.join(dir, `9-e2e-${info.project.name}-${path.basename(file)}`));
  }
}

/** The preview canvas is animating: two frames a moment apart differ. */
async function expectCanvasMoves(page: Page) {
  const canvas = page.getByTestId("preview-canvas");
  await expect(canvas).toBeVisible();
  const a = await canvas.screenshot();
  await page.waitForTimeout(700);
  const b = await canvas.screenshot();
  expect(Buffer.compare(a, b), "preview frames should change while playing").not.toBe(0);
}

/** Wait for a finished render while checking the progress label never leaves 0..100%. */
async function waitForPreview(page: Page, timeout: number) {
  const seen: number[] = [];
  const deadline = Date.now() + timeout;
  const canvas = page.getByTestId("preview-canvas");
  while (!(await canvas.isVisible())) {
    const label = await page.getByText(/^\d+%$/).first().textContent({ timeout: 1000 }).catch(() => null);
    if (label) seen.push(Number(label.replace("%", "")));
    const err = page.locator("[data-sonner-toast][data-type=error]");
    if (await err.count()) throw new Error(`render failed: ${await err.first().textContent()}`);
    if (Date.now() > deadline) throw new Error("timed out waiting for the preview");
    await page.waitForTimeout(500);
  }
  for (const p of seen) expect(p, `progress label ${p}%`).toBeLessThanOrEqual(100);
}

test("debate and lesson from 'Quem vai falar?'", async ({ page }, info) => {
  shot = 0;
  const core = info.project.name === "core";
  const slow = core ? 20 * 60_000 : 30_000;

  await test.step("landing", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Quem vai falar?" })).toBeVisible();
    await expect(page.getByTestId("core-mode")).toHaveText(core ? /^núcleo (real|\(arte mock\))$/ : "mock de dev");
    await snap(page, info, "landing");
  });

  await test.step("persona", async () => {
    await page.getByTestId("prompt").fill(PERSONA);
    await expect(page.getByTestId("create")).toBeEnabled();
    await page.getByTestId("create").click();
    // The character card shows its name and the scene controls appear.
    await expect(page.getByTestId("tpl-debate")).toBeVisible({ timeout: slow });
    await expect(page.getByText(PERSONA, { exact: false }).first()).toBeVisible();
    await snap(page, info, "persona");
  });

  await test.step("topic and rival", async () => {
    await page.getByTestId("topic").fill(TOPIC);
    await page.getByTestId("rival").fill(RIVAL);
    await snap(page, info, "tema-rival");
  });

  const transcript = page.getByTestId("transcript");

  await test.step("debate renders and plays", async () => {
    await page.getByTestId("tpl-debate").click();
    await waitForPreview(page, slow * 2);
    await expectCanvasMoves(page);
    await snap(page, info, "debate-tocando");
    await expect(transcript).toBeVisible();
    await expect(transcript).toContainText(/réplica/i);
    // Both speakers are in the transcript.
    await expect(transcript).toContainText(PERSONA.split(/[ ,]/)[0]);
    await expect(transcript).toContainText(RIVAL.split(/[ ,]/)[0]);
  });

  await test.step("debate transcript sources", async () => {
    await checkTranscript(page, core);
    await snap(page, info, "debate-transcricao");
  });

  await test.step("debate downloads", async () => {
    await checkDownloads(page, core, slow);
    await snap(page, info, "debate-pronto");
  });

  await test.step("lesson renders and plays", async () => {
    await page.getByTestId("tpl-lesson").click();
    await expect(transcript.getByText(/ponto 1/i)).toBeVisible({ timeout: slow * 2 });
    await expectCanvasMoves(page);
    await snap(page, info, "aula-tocando");
    await checkTranscript(page, core);
    await checkDownloads(page, core, slow);
    await snap(page, info, "aula-pronta");
  });

  const video = page.video();
  await page.close();
  const dir = process.env.E2E_SHOTS_DIR;
  if (dir && video) await video.saveAs(path.join(dir, `9-e2e-${info.project.name}-fluxo-tela.webm`));
});

async function checkTranscript(page: Page, core: boolean) {
  const transcript = page.getByTestId("transcript");
  const quotes = transcript.getByTestId("line-quote");
  const paraphrases = transcript.getByTestId("line-paraphrase");
  await expect(paraphrases.first()).toContainText("Paráfrase");
  if (!core) {
    // The mock has no persona sheets: nothing may be presented as a real quote.
    await expect(quotes).toHaveCount(0);
    await expect(transcript.getByText("Citação real")).toHaveCount(0);
    return;
  }
  // The core found Wikiquote sheets for real people: real quotes carry a source and a link.
  expect(await quotes.count(), "real quotes in the transcript").toBeGreaterThan(0);
  for (const q of await quotes.all()) {
    await expect(q.locator("p")).toHaveText(/^“[\s\S]+”$/);
    const link = q.getByRole("link");
    await expect(link).toContainText("Citação real");
    await expect(link).toContainText(/Wiki(quote|source)/);
    await expect(link).toHaveAttribute("href", /^https:\/\/[a-z]+\.wiki(quote|source)\.org\/wiki\//);
  }
  await expect(transcript.getByRole("link", { name: /na Wikiquote/ }).first()).toBeVisible();
}

async function checkDownloads(page: Page, core: boolean, slow: number) {
  // The browser recording finishes after one full play of the preview.
  await expect(page.getByTestId("download")).toBeVisible({ timeout: slow });
  await expect(page.getByTestId("download")).toHaveAttribute("download", /\.(webm|mp4)$/);
  const coreMp4 = page.getByTestId("download-core");
  if (!core) {
    await expect(coreMp4).toHaveCount(0);
    return;
  }
  await expect(coreMp4).toContainText("MP4 do núcleo");
  const href = await coreMp4.getAttribute("href");
  expect(href).toMatch(/^\/api\/files\/.+\.mp4$/);
  const r = await page.request.get(href!);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("video/mp4");
  expect((await r.body()).byteLength).toBeGreaterThan(200_000);
}
