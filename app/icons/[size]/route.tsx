import { ImageResponse } from "next/og";

export function generateStaticParams() {
  return [{ size: "180" }, { size: "192" }, { size: "512" }];
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const s = Math.min(1024, Math.max(16, Number((await params).size) || 192));
  return new ImageResponse(
    (
      <div style={{ width: s, height: s, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#7c5cff,#22d3ee)" }}>
        <div style={{ width: s * 0.62, height: s * 0.62, borderRadius: s * 0.31, background: "#0d0b14", display: "flex", alignItems: "center", justifyContent: "center", gap: s * 0.08, position: "relative" }}>
          <div style={{ width: s * 0.09, height: s * 0.13, borderRadius: s, background: "#fff", marginTop: -s * 0.1 }} />
          <div style={{ width: s * 0.09, height: s * 0.13, borderRadius: s, background: "#fff", marginTop: -s * 0.1 }} />
          <div style={{ position: "absolute", bottom: s * 0.12, width: s * 0.2, height: s * 0.09, borderRadius: `0 0 ${s}px ${s}px`, background: "#ff6f8f" }} />
        </div>
      </div>
    ),
    { width: s, height: s },
  );
}
