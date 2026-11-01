import type { ToneCatalog } from "@/lib/contract";
import { coreMode, json, proxyJson } from "@/lib/core";

const MOCK_TONES: ToneCatalog = {
  tones: [
    { id: "comedia", label: "Comédia" },
    { id: "ficcao", label: "Ficção" },
    { id: "horror", label: "Horror" },
    { id: "serio", label: "Sério" },
  ],
  default: "comedia",
};

export async function GET() {
  if (coreMode() === "core") return proxyJson("/tones");
  return json(MOCK_TONES);
}
