import type { Metadata } from "next";
import { MyCharacters } from "@/components/my-characters";

export const metadata: Metadata = { title: "My characters" };

export default function CharactersPage() {
  return <MyCharacters />;
}
