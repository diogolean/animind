import { ImageResponse } from "next/og";

export function generateStaticParams() {
  return [{ size: "180" }, { size: "192" }, { size: "512" }];
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const s = Math.min(1024, Math.max(16, Number((await params).size) || 192));
  return new ImageResponse(
    (
      <div style={{ width: s, height: s, display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
        <div style={{ width: s * 0.22, height: s * 0.22, borderRadius: s, background: "#3b6cf6" }} />
      </div>
    ),
    { width: s, height: s },
  );
}
