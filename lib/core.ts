import "server-only";

/** Server-side bridge to the Omni-Engine core. Keys never leave the server. */
export const coreUrl = () => process.env.CORE_URL?.replace(/\/$/, "") || null;

export async function coreFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = coreUrl();
  if (!base) throw new Error("CORE_URL not set");
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (process.env.CORE_API_KEY) headers.set("authorization", `Bearer ${process.env.CORE_API_KEY}`);
  return fetch(`${base}/v1${path}`, { ...init, headers, cache: "no-store" });
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });
