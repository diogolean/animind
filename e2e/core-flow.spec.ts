import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Real Omni-Engine core (products/animind_core). Skipped unless the Playwright
 * project is `core`, which exists only when E2E_CORE_URL is set. Image and
 * script keys are optional: the core still cuts layers and speaks with edge-tts.
 */
test("monólogo com recorte, roteiro, voz e MP4 do núcleo", async ({ page }, info) => {
  test.skip(info.project.name !== "core", "núcleo real fora do ar: defina E2E_CORE_URL para rodar este fluxo");

  let renderRequest: Record<string, unknown> | undefined;
  let characterBody: Record<string, unknown> | undefined;
  let finishedJob: { result?: { videoUrl?: string | null; writer?: string; script?: unknown[]; voices?: { gender?: string; voice?: string }[] } } | undefined;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/render") && request.method() === "POST") renderRequest = request.postDataJSON() as Record<string, unknown>;
    if (request.url().endsWith("/api/characters") && request.method() === "POST") characterBody = request.postDataJSON() as Record<string, unknown>;
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/jobs/") || response.request().method() !== "GET") return;
    const data = (await response.json().catch(() => null)) as { status?: string; result?: NonNullable<typeof finishedJob>["result"] } | null;
    if (data?.status === "done" && data.result) finishedJob = { result: data.result };
  });

  await page.goto("/");
  await expect(page.getByTestId("core-mode")).toHaveText(/^núcleo/);
  await expect(page.getByTestId("core-mode")).not.toHaveText("mock de dev");

  await page.getByTestId("automatic-toggle").click();
  await page.getByTestId("manual-mode-monologue").click();
  await page.getByTestId("manual-character-name-0").fill("Luna");
  await page.getByTestId("manual-character-prompt-0").fill("young astronomer in an orange suit");
  await page.getByTestId("manual-voice-gender-0-female").click();
  await page.getByTestId("manual-type-illustrated").click();
  await page.getByTestId("manual-topic").fill("the moon");
  await page.getByTestId("manual-duration-30").click();
  await expect(page.getByTestId("manual-language")).toHaveAttribute("data-value", "en-US");

  await page.getByTestId("generate").click();
  const character = page.getByTestId("stream-character-0");
  await expect(character).toBeVisible();
  await expect(character).toHaveAttribute("data-source", /loading|core/);
  await expect(character).toHaveAttribute("data-source", "core", { timeout: 180_000 });
  await expect(character).not.toHaveAttribute("data-source", "local");
  await expect(page.getByTestId("stream-badge-0")).toHaveText("Recorte do núcleo");
  const cutout = page.getByTestId("stream-cutout");
  await expect(cutout).toBeVisible();
  const layer = cutout.locator("img").first();
  await expect(layer).toHaveAttribute("src", /\/api\/files\//);

  await expect(page.getByTestId("job-status")).toBeVisible();
  const player = page.getByTestId("core-player");
  await expect(player).toBeVisible({ timeout: 15 * 60_000 });
  await expect(player).toHaveAttribute("src", /\/api\/files\/.*\.mp4/);
  await expect.poll(async () => player.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  const duration = await player.evaluate((el: HTMLVideoElement) => el.duration);
  expect(duration).toBeGreaterThan(2);
  await player.evaluate((el: HTMLVideoElement) => el.play());
  await expect.poll(async () => player.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.2);

  await expect(page.getByTestId("transcript")).toContainText("Luna");
  await expect(page.getByTestId("script-writer")).toContainText(/deepseek|gemini|template/);
  await expect(page.getByTestId("download-core")).toHaveAttribute("href", /\/api\/files\/.*\.mp4/);
  expect(characterBody).toMatchObject({ name: "Luna", characterType: "illustrated", gender: "female" });
  expect(renderRequest).toMatchObject({ language: "en-US", targetDurationSec: 30, template: "solo" });
  const voices = (renderRequest?.voices ?? []) as { voice?: string }[];
  expect(voices[0]?.voice ?? "").toMatch(/Neural/);
  expect(finishedJob?.result?.videoUrl ?? "").toContain("/api/files/");
  expect(finishedJob?.result?.script?.length ?? 0).toBeGreaterThan(0);
  expect(["deepseek", "gemini", "template"]).toContain(finishedJob?.result?.writer);
  expect(finishedJob?.result?.voices?.[0]?.gender).toBe("female");

  await snap(page, info);
});

async function snap(page: Page, info: TestInfo) {
  const file = info.outputPath("core-flow-player.png");
  await page.screenshot({ path: file, fullPage: true });
  await info.attach("core-flow-player", { path: file, contentType: "image/png" });
}
