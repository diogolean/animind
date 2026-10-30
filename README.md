# Animind

Personagens falantes animados em até 3 cliques: **descreva → escolha a cena → baixe**.
PWA (Next.js 16 App Router, React 19, TypeScript, Tailwind 4, shadcn/ui, framer-motion).

## Arquitetura

- **Núcleo** (factory do Aiwake + motor Rigly) vive em [`diogolean/Omni-Engine`](https://github.com/diogolean/Omni-Engine) e é consumido só por HTTP. Nenhuma lógica dele é copiada aqui.
- **Contrato:** `lib/contract.ts` (v2, rotas em `/v1`)
  - `POST /api/characters` → `Character` (camadas: cabeça, olhos, sobrancelhas, visemas da boca, corpo; ou rig de foto com mandíbula)
  - `POST /api/render` → `RenderJob`
  - `GET /api/jobs/:id` → `RenderJob` (com `result.script`, `audioUrl`, `videoUrl`)
- Com `ANIMIND_CORE_URL` definido, as rotas fazem proxy para `${ANIMIND_CORE_URL}/v1/*` com `ANIMIND_CORE_KEY` (só no servidor). Personagens por descrição são recortados pelo núcleo; catálogo e upload continuam como rig de foto feito no app.
  - `GET /api/files/*` repassa as camadas PNG, a voz e o `preview.mp4` do núcleo pela mesma origem (o Canvas não fica “tainted” e o MediaRecorder grava).
  - `GET /api/health` diz o modo (`core`, `mock` ou `off`); o cabeçalho mostra “núcleo real”, “mock de dev” ou “núcleo não configurado”.
- O mock (`lib/mock.ts`, silhuetas e jobs sem estado) é só fallback explícito de dev: `ANIMIND_CORE_MOCK=1`. Sem URL e sem essa flag, a API responde 503.
- **Prévia no navegador:** `lib/engine.ts` desenha as camadas no Canvas, sincroniza a boca com o envelope do áudio (TTS do núcleo ou voz placeholder sintetizada) e grava o vídeo com MediaRecorder. O visual cinematográfico (`lib/cinema.ts`) espelha o render do núcleo: cenários em camadas com paralaxe e desfoque de profundidade, luz de recorte e sombra suave nos personagens, câmera com push-in, balanço de mão e cortes por fala (dissolve e chicote), gradação de cor, vinheta, legendas e lower-thirds com nome e fonte.

## Roteiros: citações reais, paráfrases marcadas

- O núcleo escreve debate (gancho, réplicas curtas alternadas, tréplica, fechamento), aula (gancho, 3 pontos, exemplo, resumo) e solo, com limite de palavras e de tempo por fala ajustado ao TTS.
- Cada `ScriptLine` traz `kind`: `"quote"` é citação literal da ficha da persona (Wikiquote), com `quote.source` e `quote.url`; `"paraphrase"` é fala escrita para a cena e nunca aparece como citação (`basis` aponta a citação que ela parafraseia, se houver). Sem ficha (personagem inventado), tudo é paráfrase.
- Na tela: selo “CITAÇÃO REAL · fonte · Wikiquote” ou “PARÁFRASE”, citação em itálico entre aspas, legendas em páginas de duas linhas. Abaixo do player, `components/transcript.tsx` lista o roteiro com o link de cada fonte.
- O composer pede o tema e o nome do rival do debate. O rival fica em cache por nome na sessão, então trocar de cena não cria outro personagem.

## Regras do modo foto

- O catálogo (`lib/catalog.ts`) tem só retratos em domínio público, cada um com fonte e licença. Pessoas famosas vivas não entram.
- Upload exige marcar a confirmação de direito de uso (validada também na API).
- Todo vídeo sai com o aviso visível “Paródia • Gerado por IA”, gravado no próprio quadro.

## Rodar

```bash
# núcleo (no Omni-Engine): CORE_API_KEY=... uvicorn products.animind_core.app:app --port 8787
cp .env.example .env.local   # ANIMIND_CORE_URL=http://127.0.0.1:8787 e ANIMIND_CORE_KEY=...
npm install
npm run dev                  # sem núcleo: ANIMIND_CORE_MOCK=1 npm run dev
```

Testes E2E (Playwright, projeto `mock` sem chaves e `core` contra o núcleo real): veja [`e2e/README.md`](e2e/README.md).

Com o núcleo, o player oferece dois downloads: a gravação do Canvas (WebM/MP4 do navegador) e o “MP4 do núcleo” (H.264 1280×720 renderizado pelo Rigly).

## Contrato v2 (formato do core)

`Character.views` traz três vistas, `front`, `left` e `right`. Cada uma tem `canvas`, `layers` e `visemes`, o conjunto Rhubarb `X A B C D E F G H`, com um sprite de boca por visema. Cada `ScriptLine` pode trazer `view` e `visemes` (`t` em segundos). O renderer (`lib/engine.ts`) troca de vista por fala e de boca por visema. Enquanto o core não entrega o rig (`status: "placeholder"`, ou no mock), a UI e o vídeo mostram uma silhueta neutra.
