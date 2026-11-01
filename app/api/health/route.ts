import { coreFetch, coreMode, json } from "@/lib/core";

/** Which backend the app is using: the real core, the dev mock, or none. */
export async function GET() {
  const mode = coreMode();
  if (mode !== "core") return json({ mode });
  try {
    const r = await coreFetch("/health");
    return json({ mode, core: r.ok ? await r.json() : { ok: false, status: r.status } });
  } catch (e) {
    return json({ mode, core: { ok: false, error: (e as Error).message } });
  }
}
