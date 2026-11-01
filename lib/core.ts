import "server-only";

/**
 * Server-side bridge to the Omni-Engine core (products/animind_core). Keys never leave the server.
 *
 *   ANIMIND_CORE_URL   core base URL, e.g. http://127.0.0.1:8787 (legacy name: CORE_URL)
 *   ANIMIND_CORE_KEY   bearer token, same value as the core's CORE_API_KEY (legacy name: CORE_API_KEY)
 *   ANIMIND_CORE_MOCK  "1" -> use the built-in mock (dev only) when no core URL is set
 *
 * With neither a URL nor the explicit mock flag the API answers 503, so a
 * deploy can never silently ship the mock.
 */
export const coreUrl = () => (process.env.ANIMIND_CORE_URL || process.env.CORE_URL)?.replace(/\/$/, "") || null;
const coreKey = () => process.env.ANIMIND_CORE_KEY || process.env.CORE_API_KEY || "";

export type CoreMode = "core" | "mock" | "off";
export const coreMode = (): CoreMode => (coreUrl() ? "core" : process.env.ANIMIND_CORE_MOCK === "1" ? "mock" : "off");

export async function coreFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = coreUrl();
  if (!base) throw new Error("ANIMIND_CORE_URL not set");
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  const key = coreKey();
  if (key) headers.set("authorization", `Bearer ${key}`);
  return fetch(`${base}/v1${path}`, { ...init, headers, cache: "no-store" });
}

/** Core file URLs -> same-origin /api/files/* (keeps the canvas untainted for MediaRecorder). */
export const rewriteFileUrls = (text: string) => text.replace(/https?:\/\/[^"\s]+?\/v1\/files\//g, "/api/files/");

/** Proxy one JSON call to the core, rewriting file URLs. Network errors become 502. */
export async function proxyJson(path: string, init?: RequestInit): Promise<Response> {
  try {
    const r = await coreFetch(path, init);
    let text = rewriteFileUrls(await r.text());
    if (!r.ok) {
      // FastAPI errors come as {detail}; the UI reads {error}.
      try {
        const d = JSON.parse(text) as { error?: string; detail?: unknown };
        if (!d.error) text = JSON.stringify({ error: typeof d.detail === "string" ? d.detail : `Erro do núcleo ${r.status}` });
      } catch {
        text = JSON.stringify({ error: `Erro do núcleo ${r.status}` });
      }
    }
    return new Response(text, { status: r.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    return json({ error: `Núcleo indisponível: ${(e as Error).message}` }, 502);
  }
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });

export const coreOff = () =>
  json({ error: "Núcleo não configurado: defina ANIMIND_CORE_URL (ou ANIMIND_CORE_MOCK=1 em dev)" }, 503);
