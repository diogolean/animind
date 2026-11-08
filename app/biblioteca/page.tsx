import type { Metadata } from "next";
import { Biblioteca } from "@/components/biblioteca";

export const metadata: Metadata = { title: "Library" };

export default function BibliotecaPage() {
  return <Biblioteca />;
}
