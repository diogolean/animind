# Animind

Painel para criar personagens falantes: **descreva → revise o plano → gere**.
PWA (Next.js 16 App Router, React 19, TypeScript, Tailwind 4, shadcn/ui, framer-motion).

## Arquitetura

- **Núcleo** (factory do Aiwake + motor Rigly) vive em [`diogolean/Omni-Engine`](https://github.com/diogolean/Omni-Engine) e é consumido só por HTTP. Nenhuma lógica dele é copiada aqui.
- **Contrato:** `lib/contract.ts` (v2, rotas em `/v1`)
  - `POST /api/characters` → `Character` (camadas: cabeça, olhos, sobrancelhas, visemas da boca, corpo; ou rig de foto com mandíbula)
  - `POST /api/render` → `RenderJob`
  - `GET /api/jobs/:id` → `RenderJob` (com `result.script`, `audioUrl`, `videoUrl`)
  - `GET /api/tones` → catálogo de tons do núcleo (`/v1/tones`)
  - `POST /api/plan` → prompt livre para `CreationPlan`; tenta o futuro `/v1/plan` e usa a heurística local como fallback
  - `POST /api/scenarios` → contrato do gerador de cenário; usa cenário existente como fallback enquanto `/v1/scenarios` não existe
- Com `ANIMIND_CORE_URL` definido, as rotas fazem proxy para `${ANIMIND_CORE_URL}/v1/*` com `ANIMIND_CORE_KEY` (só no servidor). Personagens por descrição são recortados pelo núcleo; catálogo e upload continuam como rig de foto feito no app.
  - `GET /api/files/*` repassa as camadas PNG, a voz e o `preview.mp4` do núcleo pela mesma origem (o Canvas não fica “tainted” e o MediaRecorder grava).
  - `GET /api/health` diz o modo (`core`, `mock` ou `off`); o cabeçalho mostra “núcleo real”, “mock de dev” ou “núcleo não configurado”.
- O mock (`lib/mock.ts`, silhuetas e jobs sem estado) é só fallback explícito de dev: `ANIMIND_CORE_MOCK=1`. Sem URL e sem essa flag, a API responde 503.
- **Prévia no navegador:** `lib/engine.ts` desenha as camadas no Canvas, sincroniza a boca com o envelope do áudio (TTS do núcleo ou voz placeholder sintetizada) e grava o vídeo com MediaRecorder. O visual cinematográfico (`lib/cinema.ts`) espelha o render do núcleo: cenários em camadas com paralaxe e desfoque de profundidade, luz de recorte e sombra suave nos personagens, câmera com push-in, balanço de mão e cortes por fala (dissolve e chicote), gradação de cor, vinheta, legendas e lower-thirds com nome e fonte.

## Roteiros: citações reais, paráfrases marcadas

- O núcleo escreve debate (gancho, réplicas curtas alternadas, tréplica, fechamento), aula (gancho, 3 pontos, exemplo, resumo) e solo, com limite de palavras e de tempo por fala ajustado ao TTS.
- Cada `ScriptLine` traz `kind`: `"quote"` é citação literal da ficha da persona (Wikiquote), com `quote.source` e `quote.url`; `"paraphrase"` é fala escrita para a cena e nunca aparece como citação (`basis` aponta a citação que ela parafraseia, se houver). Sem ficha (personagem inventado), tudo é paráfrase.
- `scriptQA` (núcleo e mock, em todo template) confere cada citação palavra por palavra contra a ficha (texto, fonte e link) e reprova citação inventada, paráfrase apresentada como literal (aspas, “nas palavras de…”, “como escrevi:”) e fala escrita rotulada como citação; também confere o arco (debate: gancho, virada, fechamento memorável; aula: gancho, pergunta, citação, exemplo, virada, síntese curta). A transcrição mostra “Roteiro conferido · N citações reais conferidas” (`data-testid="script-qa"`).
- `GET /api/personas/sheet?name=` devolve a ficha (citações literais com fonte e link) para conferir qualquer citação da tela; no núcleo é `GET /v1/personas/sheet`. O mock traz fichas reais de Sócrates e Nietzsche (`lib/quote-sheets.ts`, copiadas literalmente do cache do núcleo, Wikiquote CC BY-SA 4.0) e as usa nas falas de citação; qualquer outra persona no mock só tem paráfrases.
- Na tela: selo “CITAÇÃO REAL · fonte · Wikiquote” ou “PARÁFRASE”, citação em itálico entre aspas, legendas em páginas de duas linhas. Abaixo do player, `components/transcript.tsx` lista o roteiro com o link de cada fonte.
- O plano separa nome e prompt visual de cada personagem. Monólogo usa uma persona; diálogo/debate aceita de duas a seis.
- Tema, direção livre do roteiro, narrativa, tom e duração desejada seguem no `RenderRequest`.

## Prompt único, plano editável e cenário

A tela inicial tem uma única caixa “Descreva sua criação”. Com Automático ligado, `POST /api/plan`
infere modo (monólogo, diálogo ou debate), personagens, tema, tom, objetivo, estilo, cenário e duração.
O resultado aparece em chips editáveis; o único clique necessário depois de escrever é **Gerar**.
Os personagens só são enviados para a factory nesse momento.

`lib/planner.ts` implementa hoje o mesmo contrato com regras determinísticas. A rota tenta primeiro
o futuro `POST /v1/plan`, portanto trocar a heurística por um planejador barato no núcleo não muda a UI.
Com Automático desligado, os mesmos controles aparecem juntos na página, incluindo de um a seis
personagens com nome e prompt próprios. O tipo padrão é `stick`; `illustrated` identifica o pipeline
complexo Aiwake, ainda não aplicado pela PR #93 do núcleo.

O cenário automático usa `lib/eras.ts` (por exemplo, Sócrates → Ágora). A opção por prompt chama
`POST /api/scenarios`, que tentará o futuro `/v1/scenarios`; em 404/405/501 escolhe deterministicamente
o cenário existente mais próximo e devolve `source: "fallback"` com uma nota visível na UI.

O switch **Automático** começa ligado. `lib/planner.ts` extrai o elenco e o tema do prompt e delega as
escolhas criativas para `lib/auto-config.ts`. Por exemplo, “Sócrates fala sobre a morte” resulta em
Sábio, Ensinar, Ghibli retrô, Ágora e 60s.

Os tons de produto são Humor, Terror, Educacional, Sábio e Sério. `GET /api/tones` normaliza o catálogo
do núcleo: Humor → `comedia`, Terror → `horror` e Sério → `serio`; Educacional e Sábio aparecem com
um selo de fallback e usam `serio` enquanto o núcleo não os oferecer. O objetivo (`ensinar`, `debater`,
`entreter` ou `convencer`), `configurationSource`, direção e duração são enviados no `RenderRequest`,
mas a PR #93 do núcleo ainda ignora esses campos.

## Modos de persona: Rápido x Profundo

O contrato mantém **Rápido / Profundo** em `personaMode`; a interface minimalista atual envia `quick`.

- **Rápido** (padrão): o personagem é inferido de poucos termos-chave. Usa uma base rasa (Wikiquote + resumo da Wikipedia), que fica em cache junto com a persona.
- **Profundo**: dispara um job em segundo plano no núcleo (`POST /api/personas/deep`, com o status em `GET /api/personas/deep?name=`). O job indexa os textos completos da Wikipedia, Wikiquote e Wikisource, em trechos com embeddings locais, sem custo de API. A UI mostra "Base profunda: pronta · N trechos". Se a base ainda não estiver pronta, o render usa o modo rápido.

Nos dois modos, os trechos servem só de contexto para as falas escritas. Citações continuam literais e com fonte, e falas que copiam trechos são rejeitadas.

## Estilos de arte e vista frontal

O seletor de estilo começa em Ghibli retrô (padrão do núcleo) e também oferece Cartoon, Anime, Retrô,
Realista, Cyberpunk e Aquarela (`ART_STYLES` em `lib/contract.ts`). O estilo vai como `artStyle` no `POST /api/characters`
(entra no prompt do Gemini) e como `style` no render (visual da cena: paleta, LUT, textura). No mock o
estilo é só ecoado.

Personagens do core real trazem `imageUrl` (perfil) e `frontImageUrl` (vista frontal gerada pelo
Gemini com o perfil como referência); o core usa a frontal nas falas para a câmera.

## Regras do modo foto

- O catálogo (`lib/catalog.ts`) tem só retratos em domínio público, cada um com fonte e licença. Pessoas famosas vivas não entram.
- Upload exige marcar a confirmação de direito de uso (validada também na API).
- Todo vídeo sai com o aviso visível “Paródia • Gerado por IA”, gravado no próprio quadro.

## Rodar

Para usar o núcleo real, crie o `.env.local` (ignorado pelo git) com `ANIMIND_CORE_URL=http://127.0.0.1:8787` e `ANIMIND_CORE_KEY=<chave do núcleo>`. O E2E contra o núcleo roda com `E2E_CORE_URL=... E2E_CORE_KEY=... npx playwright test --project=core`.

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
