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
import type { Raster } from "@/lib/png-rgba";

export function AvatarStage({
  view,
  emotion,
  lids,
  gaze,
  onCapability,
}: {
  view: CharacterView;
  emotion: string;
  lids: "open" | "half" | "closed";
  gaze: GazeDirection;
  onCapability: (capability: EyeCapability | "unavailable", reason?: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onCapabilityRef = useRef(onCapability);
  onCapabilityRef.current = onCapability;
  const frame = faceFrame(view);
  useEffect(() => {
    let cancel = false;
    setFailed(false);
    void paint(view, emotion, lids, gaze, frame)
      .then((result) => {
        if (cancel) return;
        onCapabilityRef.current(result.capability, result.reason);
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
          onCapabilityRef.current("unavailable", "the view images could not be read");
        }
      });
    return () => {
      cancel = true;
    };
  }, [view, emotion, lids, gaze, frame.x, frame.y, frame.w, frame.h]);
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

function faceFrame(view: CharacterView): { x: number; y: number; w: number; h: number } {
  const head = view.layers.find((layer) => layer.name === "head");
  if (!head) return { x: 0, y: 0, w: view.canvas.w, h: view.canvas.h };
  const padX = Math.round(head.w * 0.06);
  const padY = Math.round(head.h * 0.06);
  const x = Math.max(0, head.x - padX);
  const y = Math.max(0, head.y - padY);
  return {
    x,
    y,
    w: Math.min(view.canvas.w - x, head.w + padX * 2),
    h: Math.min(view.canvas.h - y, head.h + padY * 2),
  };
}

async function paint(
  view: CharacterView,
  emotion: string,
  lids: "open" | "half" | "closed",
  gaze: GazeDirection,
  frame: { x: number; y: number; w: number; h: number },
): Promise<{ canvas: HTMLCanvasElement; capability: EyeCapability; reason?: string }> {
  const expression = emotion !== "rest" ? view.expressions?.[emotion] : undefined;
  const mouth = expression ?? view.visemes.X;
  const separable = view.layers.some((layer) => layer.name === "iris") && view.layers.some((layer) => layer.name === "eye_socket") && view.layers.some((layer) => layer.name === "eye_white" || layer.name === "eyes");
  const parts = [
    ...view.layers.filter((layer) => keep(layer, lids, separable)),
    ...(mouth ? [{ ...mouth, name: expression ? "expression" : "mouth" }] : []),
  ].sort((a, b) => a.z - b.z);
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    parts.map(async (layer) => {
      if (!images.has(layer.url)) images.set(layer.url, await loadImage(layer.url));
    }),
  );
  const plateLayer = view.layers.find((layer) => layer.name === "eye_white") ?? view.layers.find((layer) => layer.name === "eyes");
  const irisLayer = view.layers.find((layer) => layer.name === "iris");
  const socketLayer = view.layers.find((layer) => layer.name === "eye_socket");
  if (separable && lids === "open" && plateLayer && irisLayer && socketLayer) {
    const [plateIm, irisIm, socketIm] = await Promise.all([loadImage(plateLayer.url), loadImage(irisLayer.url), loadImage(socketLayer.url)]);
    const plate = rasterOf(plateIm);
    const iris = rasterOf(irisIm);
    const socket = rasterOf(socketIm);
    const travel = fitTravel(socket, iris, irisLayer.x - socketLayer.x, irisLayer.y - socketLayer.y, [8, 4]);
    if (!travel) return finish(parts, images, frame, null, "unavailable", "the socket cannot hold a visible iris shift");
    const [vx, vy] = gazeVector(gaze);
    const composed = composeSeparable({
      plate,
      iris,
      socket,
      plateOrigin: [plateLayer.x, plateLayer.y],
      irisOrigin: [irisLayer.x, irisLayer.y],
      socketOrigin: [socketLayer.x, socketLayer.y],
      offset: [Math.round(vx * travel[0]), Math.round(vy * travel[1])],
    });
    return finish(parts, images, frame, { raster: composed, x: socketLayer.x, y: socketLayer.y }, "separable");
  }
  const body = view.layers.find((layer) => layer.name === "body");
  if (!separable && lids === "open" && body && view.layers.length === 1) {
    const bodyIm = await loadImage(body.url);
    const plate = rasterOf(bodyIm);
    const eyes = recoverPaintedEyes(plate);
    if (!eyes) return finish(view.layers, images, frame, null, "unavailable", "the painted plate has no separable pupil pair");
    return finish(parts.filter((layer) => layer.name !== "body"), images, frame, { raster: composeRecovered(plate, eyes, gaze), x: body.x, y: body.y, replace: eyes }, "recovered");
  }
  return finish(parts, images, frame, null, "unavailable", "this view has no separate iris and socket");
}

function finish(
  parts: Layer[],
  images: Map<string, HTMLImageElement>,
  frame: { x: number; y: number; w: number; h: number },
  eyes: { raster: Raster; x: number; y: number; replace?: RecoveredEyes } | null,
  capability: EyeCapability,
  reason?: string,
): { canvas: HTMLCanvasElement; capability: EyeCapability; reason?: string } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, frame.w);
  canvas.height = Math.max(1, frame.h);
  const context = canvas.getContext("2d");
  if (!context) return { canvas, capability: "unavailable", reason: "canvas is unavailable" };
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (eyes?.replace) {
    context.drawImage(canvasFromRaster(eyes.raster), eyes.x - frame.x, eyes.y - frame.y);
  }
  for (const layer of parts) {
    const image = images.get(layer.url);
    if (!image) continue;
    context.drawImage(image, layer.x - frame.x, layer.y - frame.y, layer.w, layer.h);
  }
  if (eyes && !eyes.replace) {
    context.drawImage(canvasFromRaster(eyes.raster), eyes.x - frame.x, eyes.y - frame.y);
  }
  return { canvas, capability, reason };
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
