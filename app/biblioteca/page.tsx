import type { Metadata } from "next";
import { Biblioteca } from "@/components/biblioteca";

export const metadata: Metadata = { title: "Biblioteca" };

export default function BibliotecaPage() {
  return <Biblioteca />;
}
