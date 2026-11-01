import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { placeForPersona } from "../lib/eras";
import { mockSheet } from "../lib/quote-sheets";

/**
 * The real user flow, asserted on what the user sees:
 * landing -> "Quem vai falar?" -> persona, topic and rival -> debate -> lesson,
 * each with a playing preview, a transcript (every real quote is checked word for word against the persona sheet)
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
  await page.waitForTimeout(700); // let the 0.5 s layout transitions settle
  await page.screenshot({ path: file, fullPage: true });
  await info.attach(name, { path: file, contentType: "image/png" });
  const dir = process.env.E2E_SHOTS_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    await copyFile(file, path.join(dir, `9-e2e-${info.project.name}-${path.basename(file)}`));
  }
}

/**
 * The preview canvas is animating: two frames a moment apart differ. The canvas is
 * visible while the art and voice still load, so allow playback a few seconds to start.
 */
async function expectCanvasMoves(page: Page) {
  const canvas = page.getByTestId("preview-canvas");
  await expect(canvas).toBeVisible();
  await expect(async () => {
    const a = await canvas.screenshot();
    await page.waitForTimeout(700);
    const b = await canvas.screenshot();
    expect(Buffer.compare(a, b), "preview frames should change while playing").not.toBe(0);
  }).toPass({ timeout: 15_000 });
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
    if (core) {
      // A core started from an older checkout would render the era set as the studio: catch it up front.
      const h = (await (await page.request.get("/api/health")).json()) as { core?: { scenarios?: string[] } };
      const era = placeForPersona(PERSONA);
      if (era && h.core?.scenarios) expect(h.core.scenarios, "core can render the persona's era set").toContain(era);
    }
    await snap(page, info, "landing");
  });

  await test.step("art style", async () => {
    for (const id of ["cartoon", "anime", "retro", "realista", "cyberpunk", "aquarela"]) await expect(page.getByTestId(`art-${id}`)).toBeVisible();
    await page.getByTestId("art-anime").click();
    await expect(page.getByTestId("art-anime")).toHaveClass(/bg-muted/);
    await snap(page, info, "estilo-anime");
  });

  await test.step("persona", async () => {
    await page.getByTestId("prompt").fill(PERSONA);
    await expect(page.getByTestId("create")).toBeEnabled();
    await page.getByTestId("create").click();
    // The character card shows its name and the scene controls appear.
    await expect(page.getByTestId("tpl-debate")).toBeVisible({ timeout: slow });
    await expect(page.getByText(PERSONA, { exact: false }).first()).toBeVisible();
    // A real core rig ships the Gemini front view next to the side view.
    // A mock fallback (Gemini 402 / no credit) says so on the card instead of failing the request.
    const fallback = await page.getByTestId("art-fallback").count();
    // ...and the header badge follows: Gemini is off for the rest of this core process.
    if (core && fallback) await expect(page.getByTestId("core-mode")).toHaveText("núcleo (arte mock)", { timeout: 15_000 });
    if (core && !fallback && (await page.getByTestId("core-mode").textContent())?.includes("real"))
      await expect(page.getByTestId("front-view")).toBeVisible({ timeout: slow });
    // The set follows the persona's era: a classical philosopher starts in the Ágora.
    const era = placeForPersona(PERSONA) ?? "studio";
    await expect(page.getByTestId(`place-${era}`)).toHaveClass(/bg-muted/);
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
    await expectSceneNotBlank(page, placeForPersona(PERSONA) === "agora");
    await snap(page, info, "debate-tocando");
    await expect(transcript).toBeVisible();
    await expect(transcript).toContainText(/réplica/i);
    // Four-act debate: a hook, a turn in the middle and a close (mock and core share the shape).
    await expect(transcript).toContainText(/gancho/i);
    await expect(transcript).toContainText(/virada/i);
    await expect(transcript).toContainText(/fechamento/i);
    // Both speakers are in the transcript.
    await expect(transcript).toContainText(PERSONA.split(/[ ,]/)[0]);
    await expect(transcript).toContainText(RIVAL.split(/[ ,]/)[0]);
  });

  await test.step("vertical 9:16 debate", async () => {
    await page.getByTestId("format-9x16").click();
    await page.getByTestId("persona-deep").click();
    await expect(page.getByTestId("deep-status")).toContainText(/pronta/, { timeout: slow });
    await page.getByTestId("tpl-debate").click();
    await waitForPreview(page, slow * 2);
    await expect(page.getByTestId("preview-canvas")).toHaveAttribute("width", "1080");
    await expectCanvasMoves(page);
    await snap(page, info, "debate-vertical-profundo");
    await page.getByTestId("format-16x9").click();
    await page.getByTestId("persona-quick").click();
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
    await expect(transcript.getByText(/pergunta/i).first()).toBeVisible({ timeout: slow * 2 });
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

/** The scenery behind the speakers is a built set, not a flat fill: luminance varies across the frame
 *  and the frame is neither black nor blown out. The sunlit Ágora also reads warm (red over blue). */
async function expectSceneNotBlank(page: Page, warm: boolean) {
  const st = await page.getByTestId("preview-canvas").evaluate((c: HTMLCanvasElement) => {
    try {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let n = 0, s = 0, s2 = 0, r = 0, b = 0;
      for (let i = 0; i < d.length; i += 4 * 53) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        n++; s += y; s2 += y * y; r += d[i]; b += d[i + 2];
      }
      const mean = s / n;
      return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), r: r / n, b: b / n };
    } catch {
      return null; // tainted canvas: cannot read pixels, skip
    }
  });
  if (!st) return;
  expect(st.std, `scene contrast ${JSON.stringify(st)}`).toBeGreaterThan(18);
  expect(st.mean, "scene brightness").toBeGreaterThan(25);
  expect(st.mean, "scene brightness").toBeLessThan(235);
  if (warm) expect(st.r, "sunlit Ágora reads warm").toBeGreaterThan(st.b + 8);
}

interface Sheet { found: boolean; quotes: { id: string; text: string; source: string; url: string }[] }
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Every "Citação real" on screen is checked against the speaker's sheet (/api/personas/sheet): the text word for
 * word, the source and the link. Written lines are marked "Paráfrase", and the script's self-check passed.
 */
async function checkTranscript(page: Page, core: boolean) {
  const transcript = page.getByTestId("transcript");
  const quotes = transcript.getByTestId("line-quote");
  const paraphrases = transcript.getByTestId("line-paraphrase");
  await expect(paraphrases.first()).toContainText("Paráfrase");
  await expect(transcript.getByTestId("script-qa")).toHaveAttribute("data-pass", "true");
  await expect(transcript.getByTestId("script-qa")).toContainText("Roteiro conferido");
  const sheets: Sheet[] = [];
  for (const name of [PERSONA, RIVAL]) {
    const r = await page.request.get(`/api/personas/sheet?${new URLSearchParams({ name, lang: "pt-BR" })}`);
    expect(r.status(), `sheet of ${name}`).toBe(200);
    sheets.push((await r.json()) as Sheet);
  }
  const expectQuotes = core ? sheets[0].found || sheets[1].found : !!(mockSheet(PERSONA) || mockSheet(RIVAL));
  if (!expectQuotes) {
    // No sheet: nothing may be presented as a real quote.
    await expect(quotes).toHaveCount(0);
    await expect(transcript.getByText("Citação real")).toHaveCount(0);
    return;
  }
  expect(await quotes.count(), "real quotes in the transcript").toBeGreaterThan(0);
  for (const q of await quotes.all()) {
    await expect(q.locator("p")).toHaveText(/^“[\s\S]+”$/);
    const said = norm((await q.locator("p").textContent())!.replace(/^“|”$/g, ""));
    const speaker = Number(await q.getAttribute("data-speaker"));
    const hit = sheets[speaker]?.quotes.find((x) => norm(x.text) === said);
    expect(hit, `quote is literally in the sheet of speaker ${speaker}: ${said}`).toBeTruthy();
    expect(await q.getAttribute("data-quote-id")).toBe(hit!.id);
    const link = q.getByRole("link");
    await expect(link).toContainText("Citação real");
    await expect(link).toContainText(/Wiki(quote|source)/);
    await expect(link).toHaveAttribute("href", hit!.url);
    await expect(link).toHaveAttribute("title", hit!.source);
    expect(hit!.url).toMatch(/^https:\/\/[a-z]+\.wiki(quote|source)\.org\/wiki\//);
  }
  // Written lines never pose as quotes.
  for (const l of await paraphrases.all()) {
    await expect(l.locator("p")).not.toHaveText(/[“”"]/);
    expect(await l.getAttribute("data-beat")).not.toMatch(/^cita/);
  }
  await expect(transcript.getByRole("link", { name: /na Wikiquote/ }).first()).toBeVisible();
}

async function checkDownloads(page: Page, core: boolean, slow: number) {
  // The browser recording finishes after one full play of the preview.
  await expect(page.getByTestId("download")).toBeVisible({ timeout: slow });
  await expect(page.getByTestId("download")).toHaveAttribute("download", /\.(webm|mp4)$/);
  // After the take (which fades to black) the player keeps a real frame on screen.
  const brightness = await page.getByTestId("preview-canvas").evaluate((c: HTMLCanvasElement) => {
    try {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4 * 97) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / (3 * Math.ceil(d.length / (4 * 97)));
    } catch {
      return null; // tainted canvas: cannot read pixels, skip
    }
  });
  if (brightness !== null) expect(brightness, "finished player should not stay black").toBeGreaterThan(8);
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
