import {
  PARODY_DISCLAIMER,
  type Character,
  type CreateCharacterRequest,
  type RenderJob,
  type RenderRequest,
  type ScriptLine,
  type ViewName,
} from "./contract";
import { portraitById, portraitImageUrl } from "./catalog";

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The mock never fakes a rig: views are empty and the UI shows a neutral placeholder. */
const emptyViews = (): Character["views"] => {
  const v = () => ({ canvas: { w: 512, h: 640 }, layers: [], visemes: {} });
  return { front: v(), left: v(), right: v() };
};

/* Self-contained mock of the Omni-Engine core, used when CORE_URL is unset.
 * Characters are procedural SVG cut-outs; jobs are stateless (state is encoded
 * in the job id) so this works on serverless without storage. */

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unb64 = <T,>(s: string): T => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T;

const titleCase = (s: string) =>
  s.trim().replace(/\s+/g, " ").slice(0, 40).replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());

export function mockCreateCharacter(req: CreateCharacterRequest): Character {
  const now = new Date().toISOString();
  const src = req.source;
  const base = { views: emptyViews(), createdAt: now };
  if (src.kind === "catalog") {
    const p = portraitById(src.portraitId);
    if (!p) throw new Error("Retrato não encontrado no catálogo");
    return { ...base, id: `mock_cat_${p.id}`, name: p.name, status: "ready", style: "cutout", photo: { url: portraitImageUrl(p.id), jaw: p.jaw, attribution: p.attribution } };
  }
  if (src.kind === "upload") {
    return {
      ...base,
      id: `mock_up_${hash(src.imageDataUrl.slice(0, 4096)).toString(36)}`,
      name: titleCase(src.name || "Sua foto"),
      status: "ready",
      style: "cutout",
      photo: { url: src.imageDataUrl, jaw: { x: 0.36, y: 0.55, w: 0.28, h: 0.14 } },
    };
  }
  const name = titleCase(src.prompt) || "Personagem";
  return { ...base, id: `mock_${hash(name).toString(36)}`, name, status: "placeholder", style: "rig" };
}

function script(req: RenderRequest): ScriptLine[] {
  const a = req.characters[0]?.name ?? "Personagem";
  const b = req.characters[1]?.name ?? "Rival";
  const t = req.topic?.trim() || "o futuro da animação";
  // The mock has no persona sheets, so every line is a marked paraphrase (never a fake quote).
  const lines: [number, string, string][] =
    req.template === "debate"
      ? [
          [0, "gancho", `${b}, e se tudo o que você pensa sobre ${t} estiver errado?`],
          [1, "réplica", `Errado? Mostre um fato, ${a}, não uma frase de efeito.`],
          [0, "réplica", "Os fatos estão do meu lado. Pergunte a qualquer um!"],
          [1, "tréplica", "Qualquer um não é prova. E eu trouxe argumentos."],
          [0, "fechamento", "Então que o público decida."],
        ]
      : req.template === "lesson"
        ? [
            [0, "gancho", `Turma, o que vocês sabem de verdade sobre ${t}?`],
            [0, "ponto 1", "Primeiro: entender o básico, sem pressa."],
            [0, "ponto 2", "Segundo: praticar um pouco todo dia."],
            [0, "ponto 3", "Terceiro: explicar para alguém. Quem ensina aprende duas vezes."],
            [0, "resumo", "Resumo: entender, praticar, explicar."],
          ]
        : [
            [0, "gancho", `Oi! Eu sou ${a}.`],
            [0, "tese", `Hoje eu quero falar sobre ${t}.`],
            [0, "fechamento", "Curtiu? Então compartilha com alguém!"],
          ];
  let t0 = 400;
  const view = (speaker: number, i: number): ViewName =>
    req.template === "debate" ? (speaker === 0 ? "right" : "left") : i === 1 ? (req.template === "lesson" ? "right" : "left") : "front";
  return lines.map(([speaker, beat, text], i) => {
    const dur = Math.max(1400, text.length * 62);
    const line: ScriptLine = { speaker, text, beat, kind: "paraphrase", startMs: t0, endMs: t0 + dur, view: view(speaker, i) };
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
    characters: req.characters.map((c) => ({ ...c, views: emptyViews(), photo: c.photo && { ...c.photo, url: "" } })),
  };
  return { id: `mock_${b64({ r: lite, c: Date.now() } satisfies MockJobState)}`, status: "queued", progress: 0 };
}

export function mockGetJob(id: string): RenderJob {
  const { r, c } = unb64<MockJobState>(id.replace(/^mock_/, ""));
  const p = Math.min(1, (Date.now() - c) / RENDER_MS);
  if (p < 1) return { id, status: p < 0.15 ? "queued" : "running", progress: Math.round(p * 100) / 100 };
  const lines = script(r);
  return {
    id,
    status: "done",
    progress: 1,
    result: {
      template: r.template,
      format: r.format ?? "16:9",
      width: r.format === "9:16" ? 1080 : 1280,
      height: r.format === "9:16" ? 1920 : 720,
      scenario: r.scenario,
      characters: r.characters,
      script: lines,
      durationMs: (lines.at(-1)?.endMs ?? 0) + 800,
      audioUrl: null,
      videoUrl: null,
      disclaimer: PARODY_DISCLAIMER,
      writer: "template",
      topic: r.topic?.trim() || "o futuro da animação",
    },
  };
}
