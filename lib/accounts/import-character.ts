import { keyFromAssetUrl, putObject } from "./object-store";
import { newId, normalizeRel } from "./paths";
import { saveCharacter } from "./store";
import type { LibraryCharacter, LibraryStatus, LibraryViewName } from "./types";
import { isLibraryStatus } from "./types";

const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const MAX_FILES = 200;
const ALLOWED = new Set(["png", "webp", "jpg", "jpeg", "json", "txt", "md"]);

const VIEW_BASENAMES: Record<string, LibraryViewName> = {
  front: "front",
  frente: "front",
  "view-front": "front",
  "three-quarter": "three_quarter",
  three_quarter: "three_quarter",
  threequarter: "three_quarter",
  "3-4": "three_quarter",
  "34": "three_quarter",
  profile: "profile",
  perfil: "profile",
  side: "profile",
};

const EMOTION_BASENAMES = new Set([
  "emotion",
  "emotions",
  "emotion-sheet",
  "emotions-sheet",
  "review-sheet",
  "ficha",
  "ficha-emocoes",
]);

export class ImportError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface ImportFile {
  path: string;
  bytes: Buffer;
}

function extOf(rel: string): string {
  return rel.split(".").pop()?.toLowerCase() ?? "";
}

function basenameKey(rel: string): string {
  const base = rel.split("/").pop() ?? rel;
  return base.replace(/\.[^.]+$/, "").toLowerCase();
}

function isImage(rel: string): boolean {
  return ["png", "webp", "jpg", "jpeg"].includes(extOf(rel));
}

/** A directory picker prefixes every file with the folder name. Drop that single shared segment. */
function stripSharedRoot(files: ImportFile[]): ImportFile[] {
  if (files.length < 2) return files.slice();
  const top = files[0]?.path.split("/")[0];
  if (!top || files.some((file) => file.path === top || !file.path.startsWith(`${top}/`))) return files.slice();
  return files.map((file) => ({ ...file, path: file.path.slice(top.length + 1) }));
}

function collectImageRefs(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    const rel = normalizeRel(value.replace(/^\.\//, ""));
    if (rel && isImage(rel)) into.add(rel);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageRefs(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectImageRefs(item, into);
  }
}

function lookupAsset(value: string, urls: Map<string, string>, base?: string): string {
  const cleaned = value.replace(/^\.\//, "");
  const direct = normalizeRel(cleaned);
  if (direct && urls.has(direct)) return urls.get(direct)!;
  if (!base) return value;
  const joined = normalizeRel(`${base.replace(/\/$/, "")}/${cleaned}`);
  return joined && urls.has(joined) ? urls.get(joined)! : value;
}

/** Rewrites image paths to object URLs. Strings inside a view resolve against that view's `base` (`layers/front/torso.png`). */
function rewrite(value: unknown, urls: Map<string, string>, base?: string): unknown {
  if (typeof value === "string") return lookupAsset(value, urls, base);
  if (Array.isArray(value)) return value.map((item) => rewrite(item, urls, base));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nextBase = typeof record.base === "string" ? record.base : base;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      out[key] = rewrite(item, urls, key === "base" ? undefined : nextBase);
    }
    return out;
  }
  return value;
}

function personaFromFiles(files: ImportFile[], urls: Map<string, string>): string | null {
  const json = files.find((file) => file.path === "persona.json" || file.path.endsWith("/persona.json"));
  if (json) {
    try {
      const parsed = JSON.parse(json.bytes.toString("utf8")) as Record<string, unknown>;
      for (const key of ["ref", "url", "wikiquote", "personaSheetRef"]) {
        if (typeof parsed[key] === "string" && parsed[key].trim()) return parsed[key].trim().slice(0, 500);
      }
    } catch {
      // A broken persona file falls through to its object URL.
    }
    return urls.get(json.path) ?? null;
  }
  const text = files.find((file) => /(^|\/)persona(-sheet)?\.txt$/.test(file.path));
  if (!text) return null;
  const body = text.bytes.toString("utf8").trim();
  if (!body) return null;
  if (body.length <= 300) return body.split("\n")[0]!.trim();
  return urls.get(text.path) ?? null;
}

function stringField(puppet: Record<string, unknown>, key: string): string | null {
  const value = puppet[key];
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

function pickView(files: ImportFile[], urls: Map<string, string>, view: LibraryViewName): string | undefined {
  const matches = files.filter((file) => isImage(file.path) && VIEW_BASENAMES[basenameKey(file.path)] === view);
  matches.sort((a, b) => Number(b.path.includes("/views/")) - Number(a.path.includes("/views/")) || a.path.length - b.path.length);
  return matches[0] ? urls.get(matches[0].path) : undefined;
}

function pickEmotion(files: ImportFile[], urls: Map<string, string>): string | null {
  const matches = files.filter((file) => isImage(file.path) && EMOTION_BASENAMES.has(basenameKey(file.path)));
  matches.sort((a, b) => a.path.length - b.path.length);
  return matches[0] ? (urls.get(matches[0].path) ?? null) : null;
}

function viewNameOf(key: string): LibraryViewName | undefined {
  return VIEW_BASENAMES[key.toLowerCase().replace(/[\s_]+/g, "-")];
}

function overlayPuppetViews(puppet: Record<string, unknown>, urls: Map<string, string>, views: LibraryCharacter["views"]): void {
  for (const bag of [puppet.presentation, puppet.viewImages]) {
    if (!bag || typeof bag !== "object") continue;
    for (const [key, value] of Object.entries(bag)) {
      if (typeof value !== "string") continue;
      const rel = normalizeRel(value.replace(/^\.\//, ""));
      const url = rel ? urls.get(rel) : undefined;
      const view = viewNameOf(key);
      if (view && url) views[view] = url;
    }
  }
  if (!puppet.views || typeof puppet.views !== "object") return;
  for (const [key, value] of Object.entries(puppet.views)) {
    const view = viewNameOf(key);
    if (!view) continue;
    const raw = typeof value === "string" ? value : value && typeof value === "object" ? (value as { rest?: unknown }).rest : undefined;
    if (typeof raw !== "string") continue;
    const rel = normalizeRel(raw.replace(/^\.\//, ""));
    const url = rel ? urls.get(rel) : undefined;
    if (url) views[view] = url;
  }
}

/**
 * Uploads a generated character folder (puppet.json + PNG layers) into one user's library.
 * Layer bytes go to object storage; the record keeps URLs only.
 */
export async function importCharacterPackage(options: {
  ownerId: string;
  name?: string;
  personaSheetRef?: string;
  status?: string;
  files: ImportFile[];
}): Promise<LibraryCharacter> {
  if (options.status && !isLibraryStatus(options.status)) throw new ImportError("Status inválido");
  const files: ImportFile[] = [];
  let total = 0;
  for (const file of options.files) {
    const rel = normalizeRel(file.path);
    if (!rel) throw new ImportError(`Caminho inválido: ${file.path}`);
    if (!ALLOWED.has(extOf(rel))) continue;
    if (file.bytes.length > MAX_FILE) throw new ImportError(`${rel} passa de 8 MB`, 413);
    total += file.bytes.length;
    files.push({ path: rel, bytes: file.bytes });
  }
  if (files.length > MAX_FILES) throw new ImportError("Pasta com arquivos demais");
  if (total > MAX_TOTAL) throw new ImportError("Pasta grande demais (máx. 64 MB)", 413);
  const rooted = stripSharedRoot(files);
  files.length = 0;
  files.push(...rooted);
  const puppets = files.filter((file) => file.path === "puppet.json" || file.path.endsWith("/puppet.json"));
  puppets.sort((a, b) => a.path.length - b.path.length);
  const puppetFile = puppets[0];
  if (!puppetFile) throw new ImportError("A pasta precisa de um puppet.json");
  let puppet: Record<string, unknown>;
  try {
    const parsed = JSON.parse(puppetFile.bytes.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    puppet = parsed as Record<string, unknown>;
  } catch {
    throw new ImportError("puppet.json não é JSON válido");
  }

  const id = newId("chr");
  const urls = new Map<string, string>();
  for (const file of files) {
    if (file.path === puppetFile.path) continue;
    const url = await putObject(`characters/${id}/${file.path}`, file.bytes);
    urls.set(file.path, url);
  }
  const rewritten = rewrite(puppet, urls) as Record<string, unknown>;
  const puppetUrl = await putObject(`characters/${id}/${puppetFile.path}`, Buffer.from(JSON.stringify(rewritten)));

  const views: LibraryCharacter["views"] = {};
  for (const view of ["front", "three_quarter", "profile"] as const) {
    const url = pickView(files, urls, view);
    if (url) views[view] = url;
  }
  overlayPuppetViews(puppet, urls, views);

  const emotionFromPuppet = ["emotionSheet", "emotionSheetUrl", "reviewSheet"].map((key) => stringField(puppet, key)).find(Boolean);
  const emotionRel = emotionFromPuppet ? normalizeRel(emotionFromPuppet.replace(/^\.\//, "")) : null;
  const emotionSheetUrl = ((emotionRel && urls.get(emotionRel)) || pickEmotion(files, urls)) ?? null;

  const persona =
    options.personaSheetRef?.trim().slice(0, 500) ||
    personaFromFiles(files, urls) ||
    stringField(puppet, "personaSheetRef") ||
    stringField(puppet, "personaSheet") ||
    stringField(puppet, "persona");

  const puppetName = stringField(puppet, "name");
  const name = (options.name?.trim() || puppetName || "Personagem").slice(0, 80);
  const now = new Date().toISOString();
  const referenced = new Set<string>();
  const gallery = new Set(Object.values(views));
  if (emotionSheetUrl) gallery.add(emotionSheetUrl);
  collectImageRefs(puppet, referenced);
  const layers = files
    .filter((file) => isImage(file.path) && (referenced.has(file.path) || /(^|\/)layers\//.test(file.path)))
    .map((file) => ({ name: basenameKey(file.path), url: urls.get(file.path)! }))
    .filter((layer) => layer.url && !gallery.has(layer.url));

  const character: LibraryCharacter = {
    id,
    ownerId: options.ownerId,
    name,
    personaSheetRef: persona || null,
    views,
    puppetUrl,
    layers,
    emotionSheetUrl,
    status: (options.status as LibraryStatus) || "ready",
    createdAt: now,
    updatedAt: now,
  };
  const saved = await saveCharacter(character);
  if (!keyFromAssetUrl(saved.puppetUrl)) throw new ImportError("Falha ao gravar o puppet", 500);
  return saved;
}
