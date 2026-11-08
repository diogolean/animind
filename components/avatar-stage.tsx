"use client";

import { useEffect, useRef, useState } from "react";
import type { CharacterView, Layer, Viseme } from "@/lib/contract";
import {
  composeRecovered,
  composeSeparable,
  fitTravel,
  gazeVector,
  recoverPaintedEyes,
  type EyeCapability,
  type GazeDirection,
  type RecoveredEyes,
} from "@/lib/eye-rig";
import { visemeSitsOnMouth } from "@/lib/mouth-place";
import { plateKind, presentAvatar, sceneryState, type PlateKind, type SceneryState } from "@/lib/avatar-source";
import type { Raster } from "@/lib/png-rgba";
import { stageMouth } from "@/lib/pack-voice";
import { stageFrame, type Framing, type StageFrame } from "@/lib/stage-frame";

export function AvatarStage({
  view,
  emotion,
  lids,
  gaze,
  framing = "close",
  scenery = false,
  sceneryId = null,
  viseme = null,
  onCapability,
  onScenery,
  onPlate,
}: {
  view: CharacterView;
  emotion: string;
  lids: "open" | "half" | "closed";
  gaze: GazeDirection;
  framing?: Framing;
  scenery?: boolean;
  sceneryId?: string | null;
  viseme?: Viseme | null;
  onCapability?: (capability: EyeCapability | "unavailable", reason?: string) => void;
  onScenery?: (state: SceneryState) => void;
  onPlate?: (plate: { width: number; height: number; kind: PlateKind }) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [plateKind, setPlateKind] = useState<PlateKind | "pending">("pending");
  const [frame, setFrame] = useState<StageFrame>(() => stageFrame(view, framing));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previousRef = useRef<HTMLCanvasElement | null>(null);
  const onCapabilityRef = useRef(onCapability);
  const onSceneryRef = useRef(onScenery);
  const onPlateRef = useRef(onPlate);
  onCapabilityRef.current = onCapability;
  onSceneryRef.current = onScenery;
  onPlateRef.current = onPlate;
  useEffect(() => {
    let cancel = false;
    let fade = 0;
    setFailed(false);
    void paint(view, emotion, lids, gaze, framing, scenery, sceneryId, viseme)
      .then((result) => {
        if (cancel) return;
        setFrame(result.frame);
        setPlateKind(result.plate.kind);
        onCapabilityRef.current?.(result.capability, result.reason);
        onSceneryRef.current?.(result.scenery);
        onPlateRef.current?.(result.plate);
        const target = canvasRef.current;
        const context = target?.getContext("2d");
        if (!target || !context) return;
        target.width = result.canvas.width;
        target.height = result.canvas.height;
        const previous = previousRef.current;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const sameSize = previous && previous.width === result.canvas.width && previous.height === result.canvas.height;
        if (reduced || !sameSize) {
          context.clearRect(0, 0, target.width, target.height);
          context.drawImage(result.canvas, 0, 0);
        } else {
          const from = previous;
          const started = performance.now();
          context.clearRect(0, 0, target.width, target.height);
          context.drawImage(from, 0, 0);
          const step = (now: number) => {
            if (cancel) return;
            const alpha = Math.min(1, (now - started) / 160);
            context.clearRect(0, 0, target.width, target.height);
            context.globalAlpha = 1 - alpha;
            context.drawImage(from, 0, 0);
            context.globalAlpha = alpha;
            context.drawImage(result.canvas, 0, 0);
            context.globalAlpha = 1;
            if (alpha < 1) fade = requestAnimationFrame(step);
          };
          fade = requestAnimationFrame(step);
        }
        previousRef.current = result.canvas;
      })
      .catch(() => {
        if (!cancel) {
          setFailed(true);
          onCapabilityRef.current?.("unavailable", "the view images could not be read");
          onSceneryRef.current?.("needs-original");
        }
      });
    return () => {
      cancel = true;
      cancelAnimationFrame(fade);
    };
  }, [view, emotion, lids, gaze, framing, scenery, sceneryId, viseme]);
  if (failed) return null;
  return (
    <canvas
      ref={canvasRef}
      data-testid="avatar-canvas"
      data-emotion={emotion}
      data-viseme={viseme ?? "X"}
      data-template={framing === "close" ? "face" : "body"}
      data-plate={plateKind}
      className="mx-auto block w-full bg-black motion-reduce:transition-none"
      style={{ aspectRatio: `${frame.w} / ${frame.h}` }}
    />
  );
}

async function paint(
  view: CharacterView,
  emotion: string,
  lids: "open" | "half" | "closed",
  gaze: GazeDirection,
  framing: Framing,
  scenery: boolean,
  sceneryId: string | null,
  viseme: Viseme | null,
): Promise<{ canvas: HTMLCanvasElement; capability: EyeCapability; reason?: string; scenery: SceneryState; plate: { width: number; height: number; kind: PlateKind }; frame: StageFrame }> {
  const chosen = stageMouth(view, emotion, viseme);
  const mouth = chosen.layer;
  const separable = view.layers.some((layer) => layer.name === "iris") && view.layers.some((layer) => layer.name === "eye_socket") && view.layers.some((layer) => layer.name === "eye_white" || layer.name === "eyes");
  const plateLayer = view.layers.find((layer) => layer.name === "eye_white") ?? view.layers.find((layer) => layer.name === "eyes");
  const irisLayer = view.layers.find((layer) => layer.name === "iris");
  const socketLayer = view.layers.find((layer) => layer.name === "eye_socket");
  const sceneryLayers = view.layers.filter((layer) => layer.name === "scenery");
  const sceneryLayer = sceneryId ? sceneryLayers.find((layer) => layer.url === sceneryId) : sceneryLayers[0];
  const plateLayers = view.layers.filter((layer) => layer.name !== "scenery");
  const body = plateLayers.find((layer) => layer.name === "body");
  const avatarLayer = body ?? plateLayers.find((layer) => layer.name === "torso") ?? plateLayers.find((layer) => layer.name === "head");
  const images = new Map<string, HTMLImageElement>();
  const urls = new Set<string>();
  for (const layer of view.layers) if (keep(layer, lids, separable)) urls.add(layer.url);
  if (mouth) urls.add(mouth.url);
  if (sceneryLayer) urls.add(sceneryLayer.url);
  if (avatarLayer) urls.add(avatarLayer.url);
  await Promise.all([...urls].map(async (url) => images.set(url, await loadImage(url))));
  const avatarImage = avatarLayer ? images.get(avatarLayer.url) : undefined;
  const avatarRaster = avatarImage ? rasterOf(avatarImage) : null;
  const kind: PlateKind = avatarRaster ? kindOf(avatarLayer!.url, avatarRaster) : "baked";
  const measured = { width: avatarRaster?.width ?? 0, height: avatarRaster?.height ?? 0, kind };
  const scene = sceneryState(kind, Boolean(sceneryLayer));
  const showScenery = scenery && scene === "ready";
  const sceneryDraw = showScenery ? sceneryLayer : undefined;

  if (separable && lids === "open" && plateLayer && irisLayer && socketLayer) {
    const [plateIm, irisIm, socketIm] = await Promise.all([loadImage(plateLayer.url), loadImage(irisLayer.url), loadImage(socketLayer.url)]);
    const plate = rasterOf(plateIm);
    const iris = rasterOf(irisIm);
    const socket = rasterOf(socketIm);
    const travel = fitTravel(socket, iris, irisLayer.x - socketLayer.x, irisLayer.y - socketLayer.y, [8, 4]);
    const frame = stageFrame(view, framing);
    if (!travel) return finish(partsOf(view, lids, separable, mouth), images, frame, null, "unavailable", scene, measured, sceneryDraw, "the socket cannot hold a visible iris shift");
    const [vx, vy] = gazeVector(gaze);
    const composed = composeSeparable({
      plate,
      iris,
      socket,
      plateOrigin: [plateLayer.x, plateLayer.y],
      irisOrigin: [irisLayer.x, irisLayer.y],
      socketOrigin: [socketLayer.x, socketLayer.y],
      offset: [vx * travel[0], vy * travel[1]],
    });
    return finish(partsOf(view, lids, separable, mouth), images, frame, { raster: composed, x: socketLayer.x, y: socketLayer.y }, "separable", scene, measured, sceneryDraw);
  }

  if (!separable && lids === "open" && body && plateLayers.length === 1) {
    const bodyIm = images.get(body.url) ?? (await loadImage(body.url));
    const plate = rasterOf(bodyIm);
    const eyes = recoverPaintedEyes(plate);
    const expression = emotion !== "rest" && Boolean(view.expressions?.[emotion]);
    const mouthOnFace = !mouth || expression || !eyes || chosen.speaking || visemeSitsOnMouth(mouth, eyes.sockets, body.y);
    const frame = stageFrame(view, framing, eyes?.sockets);
    if (!eyes) return finish(partsOf(view, lids, false, mouthOnFace ? mouth : undefined), images, frame, null, "unavailable", scene, measured, undefined, "the painted plate has no separable pupil pair");
    const composed = composeRecovered(plate, eyes, gaze);
    const sceneryRaster = showScenery && sceneryLayer ? rasterOf(images.get(sceneryLayer.url)!) : null;
    const shown = presentAvatar(composed, sceneryRaster, showScenery, scene);
    return finish(partsOf(view, lids, false, mouthOnFace ? mouth : undefined).filter((layer) => layer.name !== "body"), images, frame, { raster: shown, x: body.x, y: body.y, replace: eyes }, "recovered", scene, measured);
  }

  return finish(partsOf(view, lids, separable, mouth), images, stageFrame(view, framing), null, "unavailable", scene, measured, sceneryDraw, "this view has no separate iris and socket");
}

function partsOf(view: CharacterView, lids: "open" | "half" | "closed", separable: boolean, mouth: Layer | undefined): Layer[] {
  return [
    ...view.layers.filter((layer) => keep(layer, lids, separable)),
    ...(mouth ? [{ ...mouth, name: mouth.name || "mouth" }] : []),
  ].sort((a, b) => a.z - b.z);
}

function finish(
  parts: Layer[],
  images: Map<string, HTMLImageElement>,
  frame: StageFrame,
  eyes: { raster: Raster; x: number; y: number; replace?: RecoveredEyes } | null,
  capability: EyeCapability,
  scenery: SceneryState,
  plate: { width: number; height: number; kind: PlateKind },
  sceneryLayer?: Layer,
  reason?: string,
): { canvas: HTMLCanvasElement; capability: EyeCapability; reason?: string; scenery: SceneryState; plate: { width: number; height: number; kind: PlateKind }; frame: StageFrame } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, frame.w);
  canvas.height = Math.max(1, frame.h);
  const context = canvas.getContext("2d");
  if (!context) return { canvas, capability: "unavailable", scenery, plate, frame, reason: "canvas is unavailable" };
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (sceneryLayer) {
    const backdrop = images.get(sceneryLayer.url);
    if (backdrop) context.drawImage(backdrop, sceneryLayer.x - frame.x, sceneryLayer.y - frame.y, sceneryLayer.w, sceneryLayer.h);
  }
  if (eyes?.replace) context.drawImage(canvasFromRaster(eyes.raster), eyes.x - frame.x, eyes.y - frame.y);
  for (const layer of parts) {
    if (layer.name === "scenery") continue;
    const image = images.get(layer.url);
    if (!image) continue;
    context.drawImage(image, layer.x - frame.x, layer.y - frame.y, layer.w, layer.h);
  }
  if (eyes && !eyes.replace) context.drawImage(canvasFromRaster(eyes.raster), eyes.x - frame.x, eyes.y - frame.y);
  return { canvas, capability, scenery, plate, frame, reason };
}

const plateCache = new Map<string, PlateKind>();

function kindOf(url: string, raster: Raster): PlateKind {
  const cached = plateCache.get(url);
  if (cached) return cached;
  const kind = plateKind(raster);
  plateCache.set(url, kind);
  return kind;
}

function keep(layer: Layer, lids: "open" | "half" | "closed", separable: boolean): boolean {
  if (layer.name === "eye_socket") return false;
  if (layer.name === "eyes_closed") return lids === "closed";
  if (layer.name === "eyes_half") return lids === "half";
  if (lids !== "open" && (layer.name === "eyes" || layer.name === "iris" || layer.name === "eye_white")) return false;
  if (separable && lids === "open" && (layer.name === "eyes" || layer.name === "iris" || layer.name === "eye_white")) return false;
  return true;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(url));
    image.src = url;
  });
  imageCache.set(url, pending);
  return pending;
}

function rasterOf(image: HTMLImageElement): Raster {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(canvas.width * canvas.height * 4) };
  context.drawImage(image, 0, 0);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: frame.data };
}

function canvasFromRaster(raster: Raster): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d");
  context?.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
  return canvas;
}
