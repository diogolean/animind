# Animindly

Painel em [animindly.com](https://animindly.com) para criar personagens falantes: **descreva → revise o plano → gere**.
PWA (Next.js 16 App Router, React 19, TypeScript, Tailwind 4, shadcn/ui, framer-motion).

## Arquitetura

- **Núcleo** (factory do Aiwake + motor Rigly) vive em [`diogolean/Omni-Engine`](https://github.com/diogolean/Omni-Engine) e é consumido só por HTTP. Nenhuma lógica dele é copiada aqui.
- **Contrato:** `lib/contract.ts` (v2, rotas em `/v1`)
  - `POST /api/characters` → `Character` (camadas: cabeça, olhos, sobrancelhas, visemas da boca, corpo; ou rig de foto com mandíbula)
  - `POST /api/render` → `RenderJob`
  - `GET /api/jobs/:id` → `RenderJob` (com `result.script`, `audioUrl`, `videoUrl`)
  - `GET /api/tones` → catálogo de tons do núcleo (`/v1/tones`)
  - `GET /api/voices?lang=` → catálogo de vozes por idioma; tenta `/v1/voices` e usa lista fake no mock/fallback
  - `POST /api/plan` → prompt livre para `CreationPlan`; tenta o futuro `/v1/plan` e usa a heurística local como fallback
  - `POST /api/scenarios` → contrato do gerador de cenário; usa cenário existente como fallback enquanto `/v1/scenarios` não existe
- Com `ANIMINDLY_CORE_URL` definido, as rotas fazem proxy para `${ANIMINDLY_CORE_URL}/v1/*` com `ANIMINDLY_CORE_KEY` (só no servidor). Personagens por descrição são recortados pelo núcleo; catálogo e upload continuam como rig de foto feito no app.
  - `GET /api/files/*` repassa as camadas PNG, a voz e o `preview.mp4` do núcleo pela mesma origem (o Canvas não fica “tainted” e o MediaRecorder grava).
  - `GET /api/health` diz o modo (`core`, `mock` ou `off`); o cabeçalho mostra “núcleo real”, “mock de dev” ou “núcleo não configurado”.
- O mock (`lib/mock.ts`, silhuetas e jobs sem estado) é só fallback explícito de dev: `ANIMINDLY_CORE_MOCK=1`. Sem URL e sem essa flag, a API responde 503.
- **Prévia no navegador:** enquanto o núcleo recorta o personagem, a tela mostra só uma silhueta de carregamento. O SVG local permanece apenas como fallback explícito (`mock de dev` ou núcleo fora). Assim que `POST /v1/characters` responde, as camadas reais entram no lugar. O player do núcleo é o `preview.mp4` (`GET /v1/jobs/:id` → `result.videoUrl`). Sem MP4 (mock), `lib/engine.ts` ainda desenha as camadas no Canvas. O visual cinematográfico (`lib/cinema.ts`) espelha o render do núcleo: cenários em camadas com paralaxe e desfoque de profundidade, luz de recorte e sombra suave nos personagens, câmera com push-in, balanço de mão e cortes por fala (dissolve e chicote), gradação de cor, vinheta, legendas e lower-thirds com nome e fonte.

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
personagens com nome e prompt próprios. O tipo padrão é `stick` (`type: "stick"` no núcleo).
`illustrated` vai como `type: "rig"`, o pipeline Aiwake. Sem chave de imagem o núcleo devolve
as mesmas camadas com `generator` `mock` ou `procedural` e um aviso na tela.

O cenário automático usa `lib/eras.ts` (por exemplo, Sócrates → Ágora). A opção por prompt chama
`POST /api/scenarios`, que tentará o futuro `/v1/scenarios`; em 404/405/501 escolhe deterministicamente
o cenário existente mais próximo e devolve `source: "fallback"` com uma nota visível na UI.

O switch **Automático** começa ligado. `lib/planner.ts` extrai o elenco e o tema do prompt e delega as
escolhas criativas para `lib/auto-config.ts`. Por exemplo, “Sócrates fala sobre a morte” resulta em
Sábio, Ensinar, Ghibli retrô, Ágora e 60s.

## Idioma e vozes

A interface abre em inglês. O seletor EN/PT grava `animindly-locale` e não troca a moeda: os gastos continuam em USD.
O idioma do vídeo começa em `en-US` e segue a escolha do usuário (ou a detecção do texto). Nomes próprios não são traduzidos.
`pt-BR` também está na lista de idiomas de conteúdo e a lista em código aceita novos idiomas. No Automático, `lib/planner.ts` detecta português por vocabulário/acentos, senão usa inglês.
`CreationPlan.language` aparece como chip editável e o render envia `language`; o adapter também
preenche `lang` para compatibilidade com a PR #93 do núcleo.

Cada personagem tem gênero vocal (`male`/`female`) e `voiceId` opcional. Sem escolha explícita, a UI
seleciona vozes distintas do gênero indicado; o chip de cada personagem abre gênero, catálogo e botão
de prévia. `GET /api/voices?lang=` devolve o catálogo local e não chama o núcleo. A prévia usa a URL do catálogo
quando houver e Web Speech como fallback.

Os tons de produto são Humor, Terror, Educacional, Sábio e Sério. `GET /api/tones` devolve o catálogo local e não chama o núcleo.
No render pago, o núcleo ainda pode ser consultado uma vez dentro da mesma reserva. Um catálogo antigo, sem o id, cai no alias: Humor → `comedia`,
Terror → `horror`, Educacional e Sábio → `serio`. O render envia `tone`, `objective` e `duration`
(a partir de `targetDurationSec`) para o núcleo.

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

Para usar o núcleo real, crie o `.env.local` (ignorado pelo git) com `ANIMINDLY_CORE_URL=http://127.0.0.1:8787` e `ANIMINDLY_CORE_KEY=<chave do núcleo>`. O E2E contra o núcleo roda com `E2E_CORE_URL=... E2E_CORE_KEY=... npx playwright test --project=core`.

```bash
# núcleo (no Omni-Engine): CORE_API_KEY=... uvicorn products.animind_core.app:app --port 8787
cp .env.example .env.local   # ANIMINDLY_CORE_URL=http://127.0.0.1:8787 e ANIMINDLY_CORE_KEY=...
npm install
npm run dev                  # sem núcleo: ANIMINDLY_CORE_MOCK=1 npm run dev
```

Testes E2E (Playwright, projeto `mock` sem chaves e `core` contra o núcleo real): veja [`e2e/README.md`](e2e/README.md).

## Contas e biblioteca

Papéis: `user`, `admin`, `super_admin`. Cada personagem pertence a uma conta. Um `super_admin` vê e gerencia a biblioteca de todo mundo; os outros papéis só a própria. A senha fica com scrypt e a sessão é um cookie assinado (`ANIMINDLY_AUTH_SECRET`, mínimo 16 caracteres). Nada disso entra no git.

Os nomes de todas as variáveis estão em [`.env.example`](.env.example). O nome atual é `ANIMINDLY_*`. Se `ANIMINDLY_<NAME>` estiver vazio, o app ainda lê `ANIMIND_<NAME>`. Na Vercel, copie o valor para o nome novo e apague o antigo. Copie o exemplo para `.env.local` (ignorado pelo git) e preencha só o modo que for usar. Valor vazio é o mesmo que ausente. Quem paga cada serviço, e onde fica a chave, está em [`docs/ACCOUNTS.md`](docs/ACCOUNTS.md).

A biblioteca guarda nome, referência da ficha, as vistas que a pasta trouxer (frente, 3/4 esquerda, 3/4 direita e perfil; o perfil é opcional), URL do `puppet.json`, URLs das camadas e o status (`draft`, `ready`, `archived`). O cartão da lista mostra só a vista frontal. A página do personagem compõe essa figura inteira; vista, emoção e olhos mudam a mesma prévia. A ficha de emoções grande continua abaixo, com zoom. A URL gravada é `/api/library/assets/...`.

### Dois Einsteins privados

Não há catálogo público. **Einstein realista** e **Einstein charge** são pacotes separados em `private/characters/` (o Next não serve essa pasta). O realista traz frente, 3/4 esquerda e 3/4 direita, camadas, bocas e a ficha de emoções dele. A charge traz a frente, as bocas Rhubarb, a ficha e os demos em português e inglês. Um pacote não preenche as vistas que faltam no outro.

`GET /api/library` e `GET /api/library/:id` exigem sessão. Um visitante anônimo e outra conta não recebem esses personagens nem os arquivos em `/api/library/assets/...`. Um `super_admin` continua vendo todas as bibliotecas; uma conta nova criada pelo Google entra como `user`. `npm run seed` grava os dois pacotes na conta do `SEED_SUPERADMIN_EMAIL` já existente, sem escolher o primeiro cadastro. Sem esse e-mail e sem a base, os arquivos ficam no repositório e não entram em conta nenhuma.

O histórico do git público ainda contém a cópia antiga que chegou a estar em `public/characters/einstein_approved/`. Tirar a pasta de `public/` impede o site de servi-la daqui para a frente; não apaga o que já foi clonado.

### Geração e gastos

Escrever a ideia na página inicial não chama provedor: o plano local é regra, sem modelo. Qualquer chamada ao núcleo (`/api/render`, `/api/plan` quando o núcleo responde, prévia, personagem, job, arquivo, cenário, persona, voz e tom) passa por `guardedGeneration` antes do `fetch`. Sem `ANIMINDLY_GENERATION=1`, sem os tetos `ANIMINDLY_SPEND_BUDGET_CENTS` e `ANIMINDLY_SPEND_USER_CENTS`, sem timeout, retries e taxa, e sem uma linha de preço para a operação, a chamada não sai. Este repositório não publica id de modelo nem tarifa oficial. Um super admin não fura o teto global. O painel `/admin/gastos` é só dele. `GET /api/health` continua sem medição.

### Audiência

`ANIMINDLY_GA_MEASUREMENT_ID` liga o gtag direto da GA4. Vazio desliga. O valor público do site é `G-M5DBWNFQVV` (conta 415352684, propriedade 563169403, stream 16293660277). Ele não está no código de propósito. O pedido de coleta só acontece depois do consentimento, e o texto da ideia não entra no evento. Não usar um contêiner GTM.

### Celular

A interface atual é o cliente móvel: o mesmo site, com `viewport-fit=cover`, área segura e alvos de toque nos controles da biblioteca, do login e da ficha. Não há projeto nativo nem loja neste repositório. Uma versão de app futura usaria as mesmas rotas autenticadas (`/api/auth/me`, `/api/library`, `/api/library/:id`, `/api/library/assets/...`); o dono continua decidido no servidor.

### Modo local (`npm run dev`, inclusive no Windows)

Sem `DATABASE_URL`, `POSTGRES_URL`, `BLOB_STORE_ID` e `BLOB_READ_WRITE_TOKEN`, contas e PNG ficam em `./.data` (`accounts.json` e `objects/`). O diretório é criado no primeiro `npm run seed` e está no `.gitignore`. `ANIMINDLY_DATA_DIR` só muda essa pasta; vazio significa `./.data`.

No PowerShell, a partir da raiz do repositório:

```powershell
copy .env.example .env.local
npm install
npm run seed
npm run dev
```

No `.env.local` local, preencha e deixe o resto vazio:

```text
ANIMINDLY_AUTH_SECRET=<pelo menos 16 caracteres>
SEED_SUPERADMIN_EMAIL=diogolean@gmail.com
SEED_SUPERADMIN_PASSWORD=<senha do piloto>
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
ANIMINDLY_AUTH_URL=http://localhost:3000
```

`DATABASE_URL`, `POSTGRES_URL`, `BLOB_STORE_ID` e `BLOB_READ_WRITE_TOKEN` ficam vazios nesse arquivo.

`ANIMINDLY_AUTH_URL` pode ficar vazio: quem abre `http://localhost:3000` usa essa origem mesmo que a variável aponte para a Vercel. `localhost` e `127.0.0.1` são URIs diferentes. Deixe `ANIMINDLY_COOKIE_SECURE` vazio para o cookie valer em `http://`. Não defina `VERCEL=1` na máquina: com essa flag e sem `DATABASE_URL` a API responde 503 em vez de usar o disco.

`npm run seed` precisa imprimir `store=file assets=file`. Aí `http://localhost:3000` abre a conta do Diogo. O mesmo vale para `npm run import-character`. Os dois scripts leem `.env.local` sem substituir variável que já está no ambiente.

Se `uploads/albert_einstein.zip`, `.data/inbox/albert_einstein.zip` ou o arquivo em `ANIMINDLY_CHARACTER_ZIP` existir, o seed importa esse pacote para o `SEED_SUPERADMIN_EMAIL`. O zip e os PNG ficam de fora do git. Os bytes vão para `./.data` ou para o Blob. Rodar o seed de novo, com o mesmo dono e o mesmo nome, substitui o personagem em vez de duplicar. `npm run import-character -- --zip <arquivo.zip> --email "$SEED_SUPERADMIN_EMAIL"` faz o mesmo import.

O app manda o Google de volta para este caminho, já cadastrado no cliente **Animind web**:

```text
http://localhost:3000/api/auth/google/callback
```

`http://localhost:3000/api/auth/callback/google` também está cadastrado nesse cliente e o app não usa. `127.0.0.1` é outro host: se o navegador abrir esse, cadastre `http://127.0.0.1:3000/api/auth/google/callback`. O `npm run dev` escuta a porta 3000. `SEED_SUPERADMIN_EMAIL=diogolean@gmail.com` faz esse login Google cair no `super_admin`.

### Modo Vercel (preview de `feat/mvp-ui`, nunca `main`)

O preview ainda não existe: esta máquina não tem `VERCEL_TOKEN`, o CLI está deslogado e o repositório não está ligado a um projeto Vercel. Não há deploy de `main` nem de produção para criar daqui. O passo que falta é seu: em [vercel.com/new](https://vercel.com/new) importe `diogolean/animind`, deixe os deploys de Preview ligados e não publique `main`. Conecte o Neon sem branch de banco por preview, e um Blob público. Os nomes das variáveis ficam abaixo; os valores só na Vercel.

O disco da função some a cada invocação, então o preview não usa `./.data`. Contas ficam no Neon. PNGs e `puppet.json` ficam no Vercel Blob e continuam sendo servidos por `/api/library/assets/...`.

Integrações no projeto Vercel, ambientes **Preview** e **Development** (Production só se for publicar de propósito):

| Integração | Variáveis que ela cria |
| --- | --- |
| Neon (Marketplace / Storage) | `DATABASE_URL` (o app também aceita `POSTGRES_URL`, o nome antigo do Vercel Postgres) |
| Vercel Blob, loja **pública** | `BLOB_STORE_ID` na função; `BLOB_READ_WRITE_TOKEN` para os scripts fora da Vercel |

Ao conectar o Neon, deixe desligada a opção de criar um branch de banco por preview. Com ela ligada, o preview lê um banco vazio e o seed feito no branch principal não aparece.

Variáveis que você cria à mão, nos mesmos ambientes, só com o nome (o valor não entra no git):

- `ANIMINDLY_AUTH_SECRET`
- `ANIMINDLY_AUTH_URL` (origem do preview, sem caminho)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SEED_SUPERADMIN_EMAIL` (`diogolean@gmail.com`, para o login Google cair no `super_admin`)
- `SEED_SUPERADMIN_PASSWORD`

`VERCEL_OIDC_TOKEN` a Vercel injeta sozinha; não cole um valor. `ANIMINDLY_BLOB_ACCESS` só entra se a loja Blob for privada (`private`).

`ANIMINDLY_AUTH_URL` no preview é o alias estável, por exemplo `https://<project>-git-feat-mvp-ui-<team>.vercel.app`. O hostname com hash muda a cada deploy; quem abre esse host é enviado ao alias antes de ir ao Google, e a sessão fica nesse host. Em produção, a origem é `https://animindly.com`.

Redirect URIs do preview e da produção:

```text
https://<project>-git-feat-mvp-ui-<team>.vercel.app/api/auth/google/callback
https://animindly.com/api/auth/google/callback
```

Depois do push de `feat/mvp-ui` e de um redeploy do preview, um `vercel env pull` grava o Neon e o Blob no `.env.local`. Com essas variáveis preenchidas, o `npm run dev` da mesma pasta fala com a Vercel, não com `./.data`. Para voltar ao disco local, esvazie `DATABASE_URL`, `POSTGRES_URL`, `BLOB_STORE_ID` e `BLOB_READ_WRITE_TOKEN`.

```bash
vercel link
vercel env pull .env.local --environment=development
npm run seed
npm run import-character -- --dir /caminho/do/personagem --email "$SEED_SUPERADMIN_EMAIL"
```

O seed e o import precisam imprimir `store=postgres assets=blob`. Aí o login no URL de preview dessa branch abre a biblioteca do Diogo. A pasta inteira do Einstein passa pelo script: o envio pelo navegador pode estourar o limite de corpo da função.

### Entrar com Google

O botão **Entrar com Google** fica ao lado do e-mail e da senha, nos dois modos. O fluxo é o authorization code no servidor. O redirect URI que o app envia é `{origem}/api/auth/google/callback`. O e-mail só entra se o Google marcar `email_verified`. Se esse e-mail já tem conta, a sessão usa essa conta sem mudar papel, nome nem senha: `diogolean@gmail.com` cai no `super_admin` quando `SEED_SUPERADMIN_EMAIL` é esse endereço. Um e-mail novo vira `user` e não entra com senha. Rode o seed antes do primeiro login com Google para a conta já nascer `super_admin`. Um login anterior cria `user`; o seed seguinte promove esse e-mail.

`ANIMINDLY_AUTH_SECRET` assina a sessão e o cookie de estado (`animind_google_state`, 10 minutos). Sem `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`, o botão volta para `/login?error=google_unconfigured` e não chama o Google.

O cliente já existe. Projeto [animind-513520](https://console.cloud.google.com/apis/credentials?project=animind-513520), conta `contato@sosilha.com.br`, organização `sosilha.com.br`, nome **Animind web** (nome no Google Cloud; o app se chama Animindly). Consentimento External, em Testing, com test users `diogolean@gmail.com` e `contato@sosilha.com.br`. Copie o Client ID e o Client secret desse cliente para o `.env.local` e, no modo Vercel, para Preview e Production. O valor não entra no git. Antes do login no preview, acrescente no mesmo cliente o redirect URI `https://<project>-git-feat-mvp-ui-<team>.vercel.app/api/auth/google/callback` e o de produção `https://animindly.com/api/auth/google/callback`.

A página **Biblioteca** lista tudo o que a conta gerou: personagem, vista, ficha de emoções, imagem, roteiro, áudio, vídeo e debate. Cada item aponta para o personagem ou o job de origem. Um `super_admin` vê os de todo mundo. Importar um personagem grava essas linhas na hora; terminar uma criação grava roteiro, debate, imagem, áudio e vídeo sozinho. O texto vai para o mesmo armazenamento dos PNG (disco local ou Vercel Blob) e a ficha fica na mesma tabela de contas (`animind_assets` no Neon).

A pasta precisa de `puppet.json`. As fotos de galeria saem de `views/front.png`, `views/three-quarter.png` (ou `3-4.png`) e, se existir, `views/profile.png`, ou do campo `rest` de cada vista no puppet. As camadas podem ficar em `layers/<vista>/` (`layers/front/torso.png`, `layers/three-quarter/mouths/X.png`): o import resolve cada `url` relativo ao `base` da vista. `emotion-sheet.png` e `persona.txt` (uma linha com a referência da ficha) são opcionais. O mesmo envio existe em `POST /api/library/import` (multipart, campo `file` repetido com o caminho relativo) e na página **Meus personagens**. Dali, **Novo vídeo** e **Debate** abrem o estúdio com esse personagem. A ficha do personagem mostra só as vistas presentes e a ficha de emoções em tamanho grande; um clique abre a imagem inteira.

`npm test` cobre papéis, seed, importação, o login com Google (OAuth mockado, sem chamar o Google) e o fato de os bytes não irem parar no JSON. O E2E da biblioteca (`e2e/library.spec.ts`) só roda com `E2E_AUTH_SECRET`, `E2E_DATA_DIR`, `E2E_SUPERADMIN_EMAIL` e `E2E_SUPERADMIN_PASSWORD`.

Com o núcleo, o player oferece dois downloads: a gravação do Canvas (WebM/MP4 do navegador) e o “MP4 do núcleo” (H.264 1280×720 renderizado pelo Rigly).

## Contrato v2 (formato do core)

`Character.views` traz três vistas, `front`, `left` e `right`. Cada uma tem `canvas`, `layers` e `visemes`, o conjunto Rhubarb `X A B C D E F G H`, com um sprite de boca por visema. Cada `ScriptLine` pode trazer `view` e `visemes` (`t` em segundos). O renderer (`lib/engine.ts`) troca de vista por fala e de boca por visema. Enquanto o core não entrega o rig (`status: "placeholder"`, ou no mock), a UI e o vídeo mostram uma silhueta neutra.
