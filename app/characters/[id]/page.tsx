import type { Metadata } from "next";
import { CharacterDetail } from "@/components/character-detail";

export const metadata: Metadata = { title: "Personagem" };

export default function CharacterPage() {
  return <CharacterDetail />;
}
