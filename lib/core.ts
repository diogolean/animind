import "server-only";
import { opaqueUserId } from "./accounts/opaque-user";
import { productEnv } from "./product-env";
import { spendFrame } from "./spend/context";

/**
 * Server-side bridge to the Omni-Engine core (products/animind_core). Keys never leave the server.
 *
 *   ANIMINDLY_CORE_URL   core base URL, e.g. http://127.0.0.1:8787 (older names: ANIMIND_CORE_URL, CORE_URL)
 *   ANIMINDLY_CORE_KEY   bearer token, same value as the core's CORE_API_KEY (older names: ANIMIND_CORE_KEY, CORE_API_KEY)
 *   ANIMINDLY_CORE_MOCK  "1" -> use the built-in mock (dev only) when no core URL is set (older name: ANIMIND_CORE_MOCK)
 *
 * With neither a URL nor the explicit mock flag the API answers 503, so a
 * deploy can never silently ship the mock.
 */
export const coreUrl = () => (productEnv("CORE_URL") || process.env.CORE_URL)?.replace(/\/$/, "") || null;
const coreKey = () => productEnv("CORE_KEY") || process.env.CORE_API_KEY || "";

export type CoreMode = "core" | "mock" | "off";
export const coreMode = (): CoreMode => (coreUrl() ? "core" : productEnv("CORE_MOCK") === "1" ? "mock" : "off");

/** Paths whose result belongs to one account. Health and shared catalogs are not in this list. */
const OWNER_SCOPED = /^\/(render|plan|characters|preview|scenarios|jobs\/|files\/|personas\/|avatars)/;

export function coreUserHeader(userId: string | null | undefined): { "x-animind-user"?: string } {
  const id = opaqueUserId(userId);
  return id ? { "x-animind-user": id } : {};
}

function withOwner(path: string, headers: Headers): void {
  const pathOnly = path.split("?")[0] ?? path;
  if (!OWNER_SCOPED.test(pathOnly)) {
    headers.delete("x-animind-user");
    return;
  }
  const explicit = headers.get("x-animind-user");
  const id = opaqueUserId(explicit ?? spendFrame()?.userId);
  if (id) headers.set("x-animind-user", id);
  else headers.delete("x-animind-user");
}

export async function coreFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = coreUrl();
  if (!base) throw new Error("ANIMINDLY_CORE_URL not set");
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  const key = coreKey();
  if (key) headers.set("authorization", `Bearer ${key}`);
  withOwner(path, headers);
  const frame = spendFrame();
  const attempts = (frame?.maxRetries ?? 0) + 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(`${base}/v1${path}`, {
        ...init,
        headers,
        cache: "no-store",
        signal: frame ? AbortSignal.timeout(frame.timeoutMs) : init?.signal,
      });
    } catch (error) {
      lastError = error;
      if (!frame || attempt === attempts - 1) throw error;
      const allowed = frame.allowRetry ? await frame.allowRetry() : false;
      if (!allowed) throw error;
      frame.noteRetry(attempt + 1);
    }
  }
  throw lastError;
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
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") return json({ error: "Tempo esgotado" }, 504);
    return json({ error: `Núcleo indisponível: ${(e as Error).message}` }, 502);
  }
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });

export const coreOff = () =>
  json({ error: "Núcleo não configurado: defina ANIMINDLY_CORE_URL (ou ANIMINDLY_CORE_MOCK=1 em dev)" }, 503);
