import { Suspense } from "react";
import { CreationStudio } from "@/components/creation-studio";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <CreationStudio />
    </Suspense>
  );
}
