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
  return { ...base, id: `mock_${hash(name).toString(36)}`, name, status: "placeholder", style: "rig", artStyle: req.artStyle ?? "cartoon" };
}

function script(req: RenderRequest): ScriptLine[] {
  const a = req.characters[0]?.name ?? "Personagem";
  const b = req.characters[1]?.name ?? "Rival";
  const t = req.topic?.trim() || "o futuro da animação";
  const T = t.charAt(0).toUpperCase() + t.slice(1);
  // The mock has no persona sheets, so every line is a marked paraphrase (never a fake quote). The debate mirrors
  // the core's arc (abertura, confronto, virada, fechamento): speakers alternate, every reply picks up a word of the
  // line before (`idea`), the turn sits in the middle and lines stay short and varied.
  type MockLine = [number, string, string, string?, string?];
  const lines: MockLine[] =
    req.template === "debate"
      ? [
          [0, "gancho", `${b}, ${t}: verdade ou moda? Responde sem fugir.`, "abertura"],
          [1, "tese", `Moda, ${a}? ${T} é coisa séria. Moda é a sua pergunta.`, "confronto", "moda"],
          [0, "réplica", `Séria? Então defina em uma frase, ${b}.`, "confronto", "séria"],
          [1, "réplica", `Uma frase? Prove você, ${a}.`, "confronto", "frase"],
          [0, "virada", `Provo. Quem nunca duvidou de ${t} nunca pensou de verdade, ${b}.`, "virada", "prov"],
          [1, "réplica", `Duvidar, ${a}? Dúvida demais vira medo.`, "virada", "duvid"],
          [0, "tréplica", `Medo é seu, ${b}. Você mesmo disse: é coisa séria.`, "fechamento", "medo"],
          [1, "fechamento", `Séria, sim. Por isso eu decido, ${a}.`, "fechamento", "séria"],
          [0, "fechamento", "Decida, então. Eu continuo perguntando… e o público decide.", "fechamento", "decid"],
        ]
      : req.template === "lesson"
        ? [
            [0, "gancho", `Hoje: ${t}. Parece fácil. Não é.`],
            [0, "pergunta", `Antes da resposta, uma pergunta melhor: como você sabe o que sabe sobre ${t}?`],
            [0, "citação", "Em outras palavras: quem explica descobre o que ainda não entendeu."],
            [0, "exemplo", "Exemplo: explique para alguém em um minuto… e veja onde você trava."],
            [0, "síntese", "Guarde isto: entender, praticar, explicar. E a próxima pergunta é sua."],
          ]
        : [
            [0, "gancho", `Oi! Eu sou ${a}.`],
            [0, "tese", `Hoje eu quero falar sobre ${t}.`],
            [0, "fechamento", "Curtiu? Então compartilha com alguém!"],
          ];
  let t0 = 400;
  const view = (speaker: number, i: number): ViewName =>
    req.template === "debate" ? (speaker === 0 ? "right" : "left") : i === 1 ? (req.template === "lesson" ? "right" : "left") : "front";
  return lines.map(([speaker, beat, text, act, idea], i) => {
    const dur = Math.max(1400, text.length * 62);
    const line: ScriptLine = { speaker, text, beat, kind: "paraphrase", startMs: t0, endMs: t0 + dur, view: view(speaker, i) };
    if (act) line.act = act;
    if (idea) line.replyTo = { line: i - 1, idea };
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
