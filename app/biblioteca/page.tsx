import type { Metadata } from "next";
import { Biblioteca } from "@/components/biblioteca";

export const metadata: Metadata = { title: { absolute: "Animindly" } };

export default function BibliotecaPage() {
  return <Biblioteca />;
}
