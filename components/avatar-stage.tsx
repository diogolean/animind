"use client";

import { useEffect, useRef, useState } from "react";
import type { CharacterView, Layer } from "@/lib/contract";
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
import type { Raster } from "@/lib/png-rgba";
import { sceneryMatte } from "@/lib/scenery";
import { stageFrame, type Framing, type StageFrame } from "@/lib/stage-frame";

export function AvatarStage({
  view,
  emotion,
  lids,
  gaze,
  framing = "close",
  scenery = false,
  onCapability,
  onScenery,
}: {
  view: CharacterView;
  emotion: string;
  lids: "open" | "half" | "closed";
  gaze: GazeDirection;
  framing?: Framing;
  scenery?: boolean;
  onCapability?: (capability: EyeCapability | "unavailable", reason?: string) => void;
  onScenery?: (available: boolean) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState<StageFrame>(() => stageFrame(view, framing));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onCapabilityRef = useRef(onCapability);
  const onSceneryRef = useRef(onScenery);
  onCapabilityRef.current = onCapability;
  onSceneryRef.current = onScenery;
  useEffect(() => {
    let cancel = false;
    setFailed(false);
    void paint(view, emotion, lids, gaze, framing, scenery)
      .then((result) => {
        if (cancel) return;
        setFrame(result.frame);
        onCapabilityRef.current?.(result.capability, result.reason);
        onSceneryRef.current?.(result.scenery);
        const target = canvasRef.current;
        const context = target?.getContext("2d");
        if (!target || !context) return;
        target.width = result.canvas.width;
        target.height = result.canvas.height;
        context.clearRect(0, 0, target.width, target.height);
        context.drawImage(result.canvas, 0, 0);
      })
      .catch(() => {
        if (!cancel) {
          setFailed(true);
          onCapabilityRef.current?.("unavailable", "the view images could not be read");
          onSceneryRef.current?.(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, [view, emotion, lids, gaze, framing, scenery]);
  if (failed) return null;
  return (
    <canvas
      ref={canvasRef}
      data-testid="avatar-canvas"
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
): Promise<{ canvas: HTMLCanvasElement; capability: EyeCapability; reason?: string; scenery: boolean; frame: StageFrame }> {
  const expression = emotion !== "rest" ? view.expressions?.[emotion] : undefined;
  const mouth = expression ?? view.visemes.X;
  const separable = view.layers.some((layer) => layer.name === "iris") && view.layers.some((layer) => layer.name === "eye_socket") && view.layers.some((layer) => layer.name === "eye_white" || layer.name === "eyes");
  const plateLayer = view.layers.find((layer) => layer.name === "eye_white") ?? view.layers.find((layer) => layer.name === "eyes");
  const irisLayer = view.layers.find((layer) => layer.name === "iris");
  const socketLayer = view.layers.find((layer) => layer.name === "eye_socket");
  const body = view.layers.find((layer) => layer.name === "body");
  const images = new Map<string, HTMLImageElement>();
  const urls = new Set<string>();
  for (const layer of view.layers) if (keep(layer, lids, separable)) urls.add(layer.url);
  if (mouth) urls.add(mouth.url);
  await Promise.all([...urls].map(async (url) => images.set(url, await loadImage(url))));

  if (separable && lids === "open" && plateLayer && irisLayer && socketLayer) {
    const [plateIm, irisIm, socketIm] = await Promise.all([loadImage(plateLayer.url), loadImage(irisLayer.url), loadImage(socketLayer.url)]);
    const plate = rasterOf(plateIm);
    const iris = rasterOf(irisIm);
    const socket = rasterOf(socketIm);
    const travel = fitTravel(socket, iris, irisLayer.x - socketLayer.x, irisLayer.y - socketLayer.y, [8, 4]);
    const frame = stageFrame(view, framing);
    if (!travel) return finish(partsOf(view, lids, separable, mouth), images, frame, null, "unavailable", false, "the socket cannot hold a visible iris shift");
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
    return finish(partsOf(view, lids, separable, mouth), images, frame, { raster: composed, x: socketLayer.x, y: socketLayer.y }, "separable", false);
  }

  if (!separable && lids === "open" && body && view.layers.length === 1) {
    const bodyIm = images.get(body.url) ?? (await loadImage(body.url));
    const plate = rasterOf(bodyIm);
    const eyes = recoverPaintedEyes(plate);
    const mouthOnFace = !mouth || Boolean(expression) || !eyes || visemeSitsOnMouth(mouth, eyes.sockets, body.y);
    const frame = stageFrame(view, framing, eyes?.sockets);
    if (!eyes) return finish(partsOf(view, lids, false, mouthOnFace ? mouth : undefined), images, frame, null, "unavailable", false, "the painted plate has no separable pupil pair");
    const composed = composeRecovered(plate, eyes, gaze);
    const matte = sceneryMatte(plate);
    const shown = !scenery && matte ? applyMatte(composed, plate, matte) : composed;
    return finish(partsOf(view, lids, false, mouthOnFace ? mouth : undefined).filter((layer) => layer.name !== "body"), images, frame, { raster: shown, x: body.x, y: body.y, replace: eyes }, "recovered", Boolean(matte));
  }

  return finish(partsOf(view, lids, separable, mouth), images, stageFrame(view, framing), null, "unavailable", false, "this view has no separate iris and socket");
}

function partsOf(view: CharacterView, lids: "open" | "half" | "closed", separable: boolean, mouth: Layer | undefined): Layer[] {
  return [
    ...view.layers.filter((layer) => keep(layer, lids, separable)),
    ...(mouth ? [{ ...mouth, name: mouth.name || "mouth" }] : []),
  ].sort((a, b) => a.z - b.z);
}

function applyMatte(composed: Raster, plate: Raster, matte: Raster): Raster {
  const out: Raster = { width: composed.width, height: composed.height, data: new Uint8ClampedArray(composed.data) };
  const count = Math.min(out.data.length, matte.data.length, plate.data.length);
  for (let i = 3; i < count; i += 4) if (matte.data[i] === 0 && plate.data[i] > 0) out.data[i] = 0;
  return out;
}

function finish(
  parts: Layer[],
  images: Map<string, HTMLImageElement>,
  frame: StageFrame,
  eyes: { raster: Raster; x: number; y: number; replace?: RecoveredEyes } | null,
  capability: EyeCapability,
  scenery: boolean,
  reason?: string,
): { canvas: HTMLCanvasElement; capability: EyeCapability; reason?: string; scenery: boolean; frame: StageFrame } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, frame.w);
  canvas.height = Math.max(1, frame.h);
  const context = canvas.getContext("2d");
  if (!context) return { canvas, capability: "unavailable", scenery: false, frame, reason: "canvas is unavailable" };
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (eyes?.replace) context.drawImage(canvasFromRaster(eyes.raster), eyes.x - frame.x, eyes.y - frame.y);
  for (const layer of parts) {
    const image = images.get(layer.url);
    if (!image) continue;
    context.drawImage(image, layer.x - frame.x, layer.y - frame.y, layer.w, layer.h);
  }
  if (eyes && !eyes.replace) context.drawImage(canvasFromRaster(eyes.raster), eyes.x - frame.x, eyes.y - frame.y);
  return { canvas, capability, scenery, frame, reason };
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
