# Animind

Personagens falantes animados em até 3 cliques: **descreva → escolha a cena → baixe**.
PWA (Next.js 16 App Router, React 19, TypeScript, Tailwind 4, shadcn/ui, framer-motion).

## Arquitetura

- **Núcleo** (factory do Aiwake + motor Rigly) vive em [`diogolean/Omni-Engine`](https://github.com/diogolean/Omni-Engine) e é consumido só por HTTP. Nenhuma lógica dele é copiada aqui.
- **Contrato v1:** `lib/contract.ts`
  - `POST /api/characters` → `Character` (camadas: cabeça, olhos, sobrancelhas, visemas da boca, corpo; ou rig de foto com mandíbula)
  - `POST /api/render` → `RenderJob`
  - `GET /api/jobs/:id` → `RenderJob` (com `result.script`, `audioUrl`, `videoUrl`)
- Com `CORE_URL` definido, as rotas fazem proxy para `${CORE_URL}/v1/*` com `CORE_API_KEY` (só no servidor). Sem `CORE_URL`, usam o mock em `lib/mock.ts` (personagens SVG gerados por código, jobs sem estado), então o app roda sozinho.
- **Prévia no navegador:** `lib/engine.ts` desenha as camadas no Canvas, sincroniza a boca com o envelope do áudio (TTS do núcleo ou voz placeholder sintetizada) e grava o vídeo com MediaRecorder.

## Regras do modo foto

- O catálogo (`lib/catalog.ts`) tem só retratos em domínio público, cada um com fonte e licença. Pessoas famosas vivas não entram.
- Upload exige marcar a confirmação de direito de uso (validada também na API).
- Todo vídeo sai com o aviso visível “Paródia • Gerado por IA”, gravado no próprio quadro.

## Rodar

```bash
cp .env.example .env.local   # opcional
npm install
npm run dev
```

## Contrato v2 (formato do core)

`Character.views` traz três vistas, `front`, `left` e `right`. Cada uma tem `canvas`, `layers` e `visemes`, o conjunto Rhubarb `X A B C D E F G H`, com um sprite de boca por visema. Cada `ScriptLine` pode trazer `view` e `visemes` (`t` em segundos). O renderer (`lib/engine.ts`) troca de vista por fala e de boca por visema. Enquanto o core não entrega o rig (`status: "placeholder"`, ou no mock), a UI e o vídeo mostram uma silhueta neutra.
