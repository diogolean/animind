import { reportPainted, reportSeparable, separableGaze, type ViewEyeReport } from "./eye-rig";
import { decodePngRgba } from "./png-rgba";

export interface EyePackageFile {
  path: string;
  bytes: Uint8Array;
}

/**
 * Reads a puppet folder and decides whether `ready` would be a lie.
 * Separable views must pass the pixel proof. A large painted plate must recover two pupils.
 * Tiny fixtures and photos without a face are left alone. Original bytes are only read.
 */
export function blockReadyWithoutEyes(puppet: Record<string, unknown>, files: EyePackageFile[]): boolean {
  if (!puppet.views || typeof puppet.views !== "object" || Array.isArray(puppet.views)) return false;
  for (const [key, value] of Object.entries(puppet.views as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const view = value as { base?: unknown; layers?: unknown };
    if ((typeof view.base !== "string" || !view.base.trim()) && files.some((file) => file.path.startsWith(`layers/${key}/`))) {
      view.base = `layers/${key}/`;
    }
    const base = typeof view.base === "string" ? view.base : undefined;
    const layers = Array.isArray(view.layers) ? view.layers : [];
    const named = layers.filter((layer): layer is { name: string; url: string; x: number; y: number; w: number; h: number; z: number } => {
      if (!layer || typeof layer !== "object") return false;
      const item = layer as Record<string, unknown>;
      return typeof item.name === "string" && typeof item.url === "string" && typeof item.x === "number" && typeof item.y === "number";
    });
    if (!named.length) continue;
    if (separableGaze(named)) {
      const plateName = named.some((layer) => layer.name === "eye_white") ? "eye_white" : "eyes";
      const plate = named.find((layer) => layer.name === plateName);
      const iris = named.find((layer) => layer.name === "iris");
      const socket = named.find((layer) => layer.name === "eye_socket");
      const rasters = {
        [plateName]: plate ? decode(files, base, plate.url) : null,
        iris: iris ? decode(files, base, iris.url) : null,
        eye_socket: socket ? decode(files, base, socket.url) : null,
      };
      if (!plate || !iris || !socket || !rasters[plateName] || !rasters.iris || !rasters.eye_socket) return true;
      const report = reportSeparable(named, {
        [plateName]: rasters[plateName],
        iris: rasters.iris,
        eye_socket: rasters.eye_socket,
      });
      if (report.gaze !== "separable") return true;
      continue;
    }
    const painted = largestPlate(named, files, base);
    if (!painted || painted.raster.width < 200 || painted.raster.height < 200) continue;
    const report: ViewEyeReport = reportPainted(painted.raster);
    if (report.gaze !== "recovered") return true;
  }
  return false;
}

function decode(files: EyePackageFile[], base: string | undefined, url: string) {
  const bytes = fileBytes(files, base, url);
  return bytes ? decodePngRgba(bytes) : null;
}

function largestPlate(
  layers: { name: string; url: string }[],
  files: EyePackageFile[],
  base: string | undefined,
): { raster: NonNullable<ReturnType<typeof decodePngRgba>> } | null {
  let best: { raster: NonNullable<ReturnType<typeof decodePngRgba>> } | null = null;
  for (const layer of layers) {
    const raster = decode(files, base, layer.url);
    if (!raster) continue;
    if (!best || raster.width * raster.height > best.raster.width * best.raster.height) best = { raster };
  }
  return best;
}

function fileBytes(files: EyePackageFile[], base: string | undefined, url: string): Uint8Array | null {
  const cleaned = url.replace(/^\.\//, "");
  const direct = files.find((file) => file.path === cleaned);
  if (direct) return direct.bytes;
  if (!base) return null;
  const joined = `${base.replace(/\/$/, "")}/${cleaned}`;
  return files.find((file) => file.path === joined)?.bytes ?? null;
}
