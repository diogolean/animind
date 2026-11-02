# Animind accounts and invoices

Names and links only. No client secrets, API keys, or passwords belong in git. Put values in `.env.local` on a machine, or in the Vercel project's environment variables. This file lists every service this app or its Omni-Engine core calls, which env var names it needs, where the value is kept, and where the invoice shows up.

Account owner **to confirm** means this repo does not say who pays.

The Next.js app reads [`.env.example`](../.env.example). Image, script, and speech-model keys are not read here. They stay on the Omni-Engine process (`products/animind_core` in [diogolean/Omni-Engine](https://github.com/diogolean/Omni-Engine)), in that process's environment. See that repo's `products/animind_core/.env.example`.

## Google Cloud (OAuth)

| | |
| --- | --- |
| What | Sign-in with Google. Client name **Animind web**. Consent screen External, status Testing. |
| Project | [animind-513520](https://console.cloud.google.com/home/dashboard?project=animind-513520) |
| Organization | sosilha.com.br |
| Account | contato@sosilha.com.br |
| Test users | diogolean@gmail.com, contato@sosilha.com.br |
| Credentials | [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=animind-513520) |
| Consent screen | [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent?project=animind-513520) |
| Env vars (this app) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANIMIND_AUTH_URL`, `ANIMIND_AUTH_SECRET` |
| Where the values live | Local `.env.local` and, for a deploy, Vercel env (Preview and Production). Never git. |
| Callback this app sends | `{origin}/api/auth/google/callback` |
| Registered today | `http://localhost:3000/api/auth/google/callback` (used). `http://localhost:3000/api/auth/callback/google` (registered, unused). |
| Still to add on the client | The preview alias `https://<project>-git-feat-mvp-ui-<team>.vercel.app/api/auth/google/callback`, and the production origin when it exists. `http://127.0.0.1:3000/api/auth/google/callback` only if the browser uses that host. |
| Pilot link | `SEED_SUPERADMIN_EMAIL=diogolean@gmail.com` so that Google account is the `super_admin`. `contato@sosilha.com.br` is a test user and becomes role `user` unless seeded on purpose. |
| Invoices | OAuth itself is not a metered API. The Cloud billing account for this login is [Billing](https://console.cloud.google.com/billing?authuser=3) (authuser 3, `contato@sosilha.com.br`). |

## Gemini API (image generation)

| | |
| --- | --- |
| What | Character art on the Omni-Engine core (front and side views). This Next app does not call Gemini. |
| Env vars (core only) | `GEMINI_API_KEY`. Caps on the core, not here: `REEL_REEL_BUDGET_USD`, `MAX_GOOGLE_COST_PER_RUN_USD`, `GOOGLE_COST_ALLOW_ABOVE_CEILING`. |
| Where the values live | The core process environment (local core `.env`, or the host that runs the core). Not this app's Vercel env, and never git. |
| Account | **to confirm.** If the key was created in project animind-513520, it is the same Google account as OAuth (`contato@sosilha.com.br`). |
| Invoices | [Google Cloud billing](https://console.cloud.google.com/billing?authuser=3) for the project that owns the key. Keys are listed in [Google AI Studio](https://aistudio.google.com/apikey). Confirm the key's project before treating animind-513520 as the billed project. |

## DeepSeek (scripts)

| | |
| --- | --- |
| What | Script writing on the Omni-Engine core. This Next app does not call DeepSeek. |
| Env var (core only) | `DEEPSEEK_API_KEY` |
| Where the value lives | Core process environment. Never git. |
| Account | **to confirm** |
| Invoices | [DeepSeek platform usage](https://platform.deepseek.com/usage). The login that owns the key is **to confirm**. |

## OpenRouter (if used)

| | |
| --- | --- |
| What | Optional model route on the core. This repo only names the variable. Nothing in this app calls OpenRouter. |
| Env var (core only) | `OPENROUTER_API_KEY` |
| Where the value lives | Core process environment, and only if that route is turned on. Never git. |
| Account | **to confirm** |
| Invoices | [OpenRouter credits](https://openrouter.ai/settings/credits). Unused if the variable is empty. |

## Together (if used)

| | |
| --- | --- |
| What | Optional model route on the core. This repo only names the variable. Nothing in this app calls Together. |
| Env var (core only) | `TOGETHER_API_KEY` |
| Where the value lives | Core process environment, and only if that route is turned on. Never git. |
| Account | **to confirm** |
| Invoices | [Together billing](https://api.together.ai/settings/billing). Unused if the variable is empty. |

## DeepInfra (if used)

| | |
| --- | --- |
| What | Not referenced in this repo or in `.env.example`. No env var here. |
| Env var | none |
| Account | **to confirm** |
| Invoices | [DeepInfra billing](https://deepinfra.com/dash/billing) only if a key exists outside this repo. Otherwise there is nothing to pay from Animind. |

## Vercel (hosting, env, Blob)

| | |
| --- | --- |
| What | Preview and production hosting for this Next.js app. Environment variables. Public Blob store for PNG layers and `puppet.json` when `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN` is set. |
| Team / project | **to confirm.** This checkout is not linked to a Vercel project yet. Import [diogolean/animind](https://github.com/diogolean/animind), branch `feat/mvp-ui`, and do not deploy `main` until that is intended. |
| Env vars this app reads | `ANIMIND_AUTH_SECRET`, `ANIMIND_AUTH_URL`, `ANIMIND_COOKIE_SECURE` (optional), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD`, `DATABASE_URL` or `POSTGRES_URL`, `BLOB_STORE_ID`, `BLOB_READ_WRITE_TOKEN`, `ANIMIND_BLOB_ACCESS` (only `private` when the store is private). `VERCEL_OIDC_TOKEN` is injected by Vercel. `ANIMIND_CORE_URL` and `ANIMIND_CORE_KEY` only if a hosted core should answer the preview. |
| Where the values live | Vercel → Project → Settings → Environment Variables (Preview, and Production when publishing). Locally, `.env.local`. `vercel env pull` copies the Development values into that file. Never git. |
| Invoices | [Vercel account billing](https://vercel.com/account/billing). If the project sits under a team, the team's billing page instead. Which team pays is **to confirm**. Blob usage is on that same Vercel bill. |

## Neon (accounts database, via Vercel)

| | |
| --- | --- |
| What | Hosted accounts and library rows (`animind_users`, `animind_characters`, `animind_assets`) when a database URL is set. Empty URL means local `./.data`. |
| Env vars | `DATABASE_URL` (preferred). `POSTGRES_URL` is the legacy Vercel Postgres name and is accepted too. |
| Where the value lives | Created by the Neon integration on Vercel (Preview and Development). Do not turn on a database branch per preview. Scripts outside Vercel use the same URL from `.env.local`. Never git. |
| Account | The Vercel team that installs the integration. Owner **to confirm** (same gap as the Vercel team). |
| Invoices | Vercel Marketplace charges land on the [Vercel bill](https://vercel.com/account/billing). The Neon console is [console.neon.tech](https://console.neon.tech) if the database is also opened there. |

## GitHub

| | |
| --- | --- |
| What | Source repository. No GitHub Actions workflows in this repo. |
| Repo | [diogolean/animind](https://github.com/diogolean/animind) |
| Account | diogolean |
| Env vars | none |
| Invoices | [GitHub billing for user diogolean](https://github.com/settings/billing). A public repo with no Actions does not add a usage line by itself. |

## Omni-Engine core (not a vendor bill)

| | |
| --- | --- |
| What | HTTP API this app proxies to. Holds the Gemini, DeepSeek, Together, and OpenRouter keys above, plus local edge-tts (no account, no invoice) and the Rhubarb binary (no account). |
| Repo | [diogolean/Omni-Engine](https://github.com/diogolean/Omni-Engine) |
| Env vars (this app) | `ANIMIND_CORE_URL` (legacy `CORE_URL`), `ANIMIND_CORE_KEY` (same value as the core's `CORE_API_KEY`; legacy `CORE_API_KEY`). Dev only: `ANIMIND_CORE_MOCK=1` when no core URL is set. |
| Where the values live | This app's `.env.local`, and Vercel env if the preview should reach a running core. The core's own provider keys stay on the core. Never git. |
| Invoices | None for the core process. Provider invoices are the rows above. |

## This app, no outside account

| Env var | Role |
| --- | --- |
| `ANIMIND_AUTH_SECRET` | Signs the session cookie and the Google state cookie. Generate it locally. At least 16 characters. |
| `ANIMIND_DATA_DIR` | Optional override for `./.data` when hosted database and Blob variables are empty. |
| `SEED_SUPERADMIN_PASSWORD` | Pilot password for email login. Local `.env.local` and Vercel env. Never git. |
