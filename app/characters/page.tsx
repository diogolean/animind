import type { Metadata } from "next";
import { MyCharacters } from "@/components/my-characters";

export const metadata: Metadata = { title: "Meus personagens" };

export default function CharactersPage() {
  return <MyCharacters />;
}
