import {
  PARODY_DISCLAIMER,
  type Character,
  type CreateCharacterRequest,
  type Layer,
  type RenderJob,
  type RenderRequest,
  type ScriptLine,
} from "./contract";
import { portraitById, portraitImageUrl } from "./catalog";

/* Self-contained mock of the Omni-Engine core, used when CORE_URL is unset.
 * Characters are procedural SVG cut-outs; jobs are stateless (state is encoded
 * in the job id) so this works on serverless without storage. */

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const svg = (w: number, h: number, body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  )}`;

const SKINS = ["#f2c7a5", "#e0a57e", "#c68642", "#8d5524", "#ffd9b8", "#b5e3d8"];
const PALETTES = [
  ["#7c5cff", "#22d3ee"],
  ["#ff5c8a", "#ffb84d"],
  ["#10b981", "#a3e635"],
  ["#3b82f6", "#f472b6"],
  ["#f97316", "#facc15"],
  ["#14b8a6", "#818cf8"],
];
const HAIR = ["#1f1b2e", "#5b3a29", "#d4a24c", "#9b2c2c", "#e5e7eb", "#4c1d95"];

export function cartoonLayers(seed: string): { layers: Layer[]; palette: { primary: string; accent: string } } {
  const h = hash(seed.toLowerCase());
  const skin = SKINS[h % SKINS.length];
  const [primary, accent] = PALETTES[(h >> 3) % PALETTES.length];
  const hair = HAIR[(h >> 6) % HAIR.length];
  const hairStyle = (h >> 9) % 3;
  const ink = "#15121f";
  const L: Layer[] = [];
  const add = (name: Layer["name"], x: number, y: number, w: number, hh: number, z: number, body: string) =>
    L.push({ name, url: svg(w, hh, body), x, y, w, h: hh, z });

  add("body", 96, 400, 320, 240, 0,
    `<path d="M20 240 C20 110 80 40 160 40 C240 40 300 110 300 240 Z" fill="${primary}" stroke="${ink}" stroke-width="8"/>
     <path d="M120 44 L160 120 L200 44" fill="${accent}" stroke="${ink}" stroke-width="7" stroke-linejoin="round"/>
     <circle cx="160" cy="170" r="12" fill="${accent}" stroke="${ink}" stroke-width="5"/>`);
  const hairPath = [
    `<path d="M40 150 C30 40 130 0 170 10 C250 0 320 50 300 150 C270 90 200 80 170 70 C130 90 70 90 40 150Z" fill="${hair}" stroke="${ink}" stroke-width="8"/>`,
    `<path d="M45 140 C45 30 295 30 295 140 L295 95 C250 60 90 60 45 95Z" fill="${hair}" stroke="${ink}" stroke-width="8"/><circle cx="170" cy="22" r="26" fill="${hair}" stroke="${ink}" stroke-width="8"/>`,
    `<path d="M30 170 C10 20 330 20 310 170 C300 110 250 70 170 60 C90 70 40 110 30 170Z" fill="${hair}" stroke="${ink}" stroke-width="8"/>`,
  ][hairStyle];
  add("head", 86, 90, 340, 360, 1,
    `<ellipse cx="38" cy="200" rx="26" ry="36" fill="${skin}" stroke="${ink}" stroke-width="8"/>
     <ellipse cx="302" cy="200" rx="26" ry="36" fill="${skin}" stroke="${ink}" stroke-width="8"/>
     <path d="M50 170 C50 60 290 60 290 170 C290 290 230 340 170 340 C110 340 50 290 50 170Z" fill="${skin}" stroke="${ink}" stroke-width="8"/>
     <ellipse cx="95" cy="250" rx="22" ry="12" fill="#ff7a9a" opacity=".35"/>
     <ellipse cx="245" cy="250" rx="22" ry="12" fill="#ff7a9a" opacity=".35"/>
     <path d="M165 215 q10 25 -4 32" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>
     ${hairPath}`);
  add("eyes", 166, 250, 180, 70, 3,
    `<ellipse cx="40" cy="35" rx="28" ry="30" fill="#fff" stroke="${ink}" stroke-width="6"/>
     <ellipse cx="140" cy="35" rx="28" ry="30" fill="#fff" stroke="${ink}" stroke-width="6"/>
     <circle cx="46" cy="40" r="12" fill="${ink}"/><circle cx="146" cy="40" r="12" fill="${ink}"/>
     <circle cx="50" cy="35" r="4" fill="#fff"/><circle cx="150" cy="35" r="4" fill="#fff"/>`);
  add("eyes_closed", 166, 250, 180, 70, 3,
    `<path d="M14 38 q26 18 52 0 M114 38 q26 18 52 0" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>`);
  add("brows", 166, 215, 180, 40, 4,
    `<path d="M12 26 q28 -22 58 -4 M110 22 q30 -18 58 4" fill="none" stroke="${hair === "#e5e7eb" ? ink : hair}" stroke-width="10" stroke-linecap="round"/>`);
  const mouth = (d: string) => `<g stroke="${ink}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">${d}</g>`;
  const MX = 196, MY = 345, MW = 120, MH = 80;
  add("mouth_rest", MX, MY, MW, MH, 5, mouth(`<path d="M30 30 q30 16 60 0" fill="none"/>`));
  add("mouth_M", MX, MY, MW, MH, 5, mouth(`<path d="M28 30 L92 30" fill="none"/>`));
  add("mouth_E", MX, MY, MW, MH, 5, mouth(`<path d="M18 22 q42 34 84 0 q-42 10 -84 0Z" fill="#5a1a2b"/><path d="M26 24 q34 6 68 0" fill="#fff" stroke-width="3"/>`));
  add("mouth_A", MX, MY, MW, MH, 5, mouth(`<path d="M22 14 q38 -6 76 0 q4 52 -38 58 q-42 -6 -38 -58Z" fill="#5a1a2b"/><ellipse cx="60" cy="56" rx="20" ry="9" fill="#ff6f8f" stroke="none"/>`));
  add("mouth_O", MX, MY, MW, MH, 5, mouth(`<ellipse cx="60" cy="36" rx="20" ry="26" fill="#5a1a2b"/>`));
  return { layers: L, palette: { primary, accent } };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unb64 = <T,>(s: string): T => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T;

const titleCase = (s: string) =>
  s.trim().replace(/\s+/g, " ").slice(0, 40).replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());

export function mockCreateCharacter(req: CreateCharacterRequest): Character {
  const now = new Date().toISOString();
  const src = req.source;
  if (src.kind === "catalog") {
    const p = portraitById(src.portraitId);
    if (!p) throw new Error("Retrato não encontrado no catálogo");
    return {
      id: `mock_cat_${p.id}`,
      name: p.name,
      style: "cutout",
      canvas: { w: 512, h: 640 },
      layers: [],
      photo: { url: portraitImageUrl(p.id), jaw: p.jaw, attribution: p.attribution },
      createdAt: now,
    };
  }
  if (src.kind === "upload") {
    return {
      id: `mock_up_${hash(src.imageDataUrl.slice(0, 4096)).toString(36)}`,
      name: titleCase(src.name || "Sua foto"),
      style: "cutout",
      canvas: { w: 512, h: 640 },
      layers: [],
      photo: { url: src.imageDataUrl, jaw: { x: 0.36, y: 0.55, w: 0.28, h: 0.14 } },
      createdAt: now,
    };
  }
  const name = titleCase(src.prompt) || "Personagem";
  const { layers, palette } = cartoonLayers(name);
  return { id: `mock_${hash(name).toString(36)}`, name, style: "cartoon", canvas: { w: 512, h: 640 }, layers, palette, createdAt: now };
}

function script(req: RenderRequest): ScriptLine[] {
  const a = req.characters[0]?.name ?? "Personagem";
  const b = req.characters[1]?.name ?? "Rival";
  const t = req.topic?.trim() || "o futuro da animação";
  const lines: [number, string][] =
    req.template === "debate"
      ? [
          [0, `Eu sou ${a}, e digo: ${t} vai mudar tudo!`],
          [1, `Mudar tudo? ${b} discorda totalmente, meu caro.`],
          [0, `Os fatos estão do meu lado. Pergunte a qualquer um!`],
          [1, `Fatos? Eu trouxe argumentos. E bigode.`],
        ]
      : req.template === "lesson"
        ? [
            [0, `Olá, turma! Hoje o assunto é ${t}.`],
            [0, `Primeiro ponto: entender o básico, sem pressa.`],
            [0, `Segundo: praticar. E lembrem, isso cai na prova!`],
          ]
        : [
            [0, `Oi! Eu sou ${a}.`],
            [0, `Hoje eu quero falar sobre ${t}.`],
            [0, `Curtiu? Então compartilha com alguém!`],
          ];
  let t0 = 400;
  return lines.map(([speaker, text]) => {
    const dur = Math.max(1400, text.length * 62);
    const line = { speaker, text, startMs: t0, endMs: t0 + dur };
    t0 += dur + 350;
    return line;
  });
}

interface MockJobState { r: RenderRequest; c: number }
const RENDER_MS = 2200;

export function mockCreateJob(req: RenderRequest): RenderJob {
  // Strip heavy fields (uploaded data URLs) from the stateless id.
  const lite: RenderRequest = {
    ...req,
    characters: req.characters.map((c) => ({ ...c, layers: [], photo: c.photo && { ...c.photo, url: "" } })),
  };
  return { id: `mock_${b64({ r: lite, c: Date.now() } satisfies MockJobState)}`, status: "queued", progress: 0 };
}

export function mockGetJob(id: string): RenderJob {
  const { r, c } = unb64<MockJobState>(id.replace(/^mock_/, ""));
  const p = Math.min(1, (Date.now() - c) / RENDER_MS);
  if (p < 1) return { id, status: p < 0.15 ? "queued" : "running", progress: Math.round(p * 100) };
  const lines = script(r);
  return {
    id,
    status: "done",
    progress: 100,
    result: {
      template: r.template,
      scenario: r.scenario,
      characters: r.characters,
      script: lines,
      durationMs: (lines.at(-1)?.endMs ?? 0) + 800,
      audioUrl: null,
      videoUrl: null,
      disclaimer: PARODY_DISCLAIMER,
    },
  };
}
