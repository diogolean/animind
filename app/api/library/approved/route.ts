import { json } from "@/lib/core";
import { approvedLibraryCharacter } from "@/lib/approved/einstein";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public catalog. No account, Neon, or Blob required. */
export function GET() {
  return json({ characters: [approvedLibraryCharacter()] });
}
