import { json } from "@/lib/core";
import { productEnv } from "@/lib/product-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Direct GA4 measurement id only. A tag-manager container id is rejected. */
const MEASUREMENT = /^G-[A-Z0-9]+$/;

export async function GET() {
  const id = productEnv("GA_MEASUREMENT_ID");
  if (!id || !MEASUREMENT.test(id)) return json({ enabled: false });
  return json({ enabled: true, measurementId: id });
}
