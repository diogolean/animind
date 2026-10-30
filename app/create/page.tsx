import type { Metadata } from "next";
import { CreateClient } from "./create-client";

export const metadata: Metadata = { title: "Criar" };

export default async function CreatePage({ searchParams }: PageProps<"/create">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <CreateClient q={one(sp.q)} portrait={one(sp.portrait)} upload={one(sp.upload) === "1"} />
    </div>
  );
}
