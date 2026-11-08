# Animindly accounts and invoices

Names and links only. No client secrets, API keys, or passwords belong in git. Put values in `.env.local` on a machine, or in the Vercel project's environment variables. This file lists every service this app or its Omni-Engine core calls, which env var names it needs, where the value is kept, and where the invoice shows up.

Account owner **to confirm** means this repo does not say who pays.

The Next.js app reads [`.env.example`](../.env.example). Image, script, and speech-model keys are not read here. They stay on the Omni-Engine process (`products/animind_core` in [diogolean/Omni-Engine](https://github.com/diogolean/Omni-Engine)), in that process's environment. See that repo's `products/animind_core/.env.example`.

## Google Cloud (OAuth)

| | |
| --- | --- |
| What | Sign-in with Google. Client name **Animind web** (the name on the Google Cloud consent screen; this app is Animindly). Consent screen External, status Testing. |
| Project | [animind-513520](https://console.cloud.google.com/home/dashboard?project=animind-513520) |
| Organization | sosilha.com.br |
| Account | contato@sosilha.com.br |
| Test users | diogolean@gmail.com, contato@sosilha.com.br |
| Credentials | [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=animind-513520) |
| Consent screen | [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent?project=animind-513520) |
| Env vars (this app) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANIMINDLY_AUTH_URL`, `ANIMINDLY_AUTH_SECRET` |
| Where the values live | Local `.env.local` and, for a deploy, Vercel env (Preview and Production). Never git. |
| Callback this app sends | `{origin}/api/auth/google/callback` |
| Registered today | `http://localhost:3000/api/auth/google/callback` (used). `http://localhost:3000/api/auth/callback/google` (registered, unused). |
| Still to add on the client | The preview alias `https://<project>-git-feat-mvp-ui-<team>.vercel.app/api/auth/google/callback`, and production `https://animindly.com/api/auth/google/callback`. `http://127.0.0.1:3000/api/auth/google/callback` only if the browser uses that host. |
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
| Invoices | [DeepInfra billing](https://deepinfra.com/dash/billing) only if a key exists outside this repo. Otherwise there is nothing to pay from Animindly. |

## Vercel (hosting, env, Blob)

| | |
| --- | --- |
| What | Preview and production hosting for this Next.js app. Environment variables. Public Blob store for PNG layers and `puppet.json` when `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN` is set. |
| Team / project | **to confirm.** This checkout is not linked to a Vercel project yet. Import [diogolean/animind](https://github.com/diogolean/animind), branch `feat/mvp-ui`, and do not deploy `main` until that is intended. |
| Env vars this app reads | `ANIMINDLY_AUTH_SECRET`, `ANIMINDLY_AUTH_URL`, `ANIMINDLY_COOKIE_SECURE` (optional), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD`, `DATABASE_URL` or `POSTGRES_URL`, `BLOB_STORE_ID`, `BLOB_READ_WRITE_TOKEN`, `ANIMINDLY_BLOB_ACCESS` (only `private` when the store is private). `VERCEL_OIDC_TOKEN` is injected by Vercel. `ANIMINDLY_CORE_URL` and `ANIMINDLY_CORE_KEY` only if a hosted core should answer the preview. Each `ANIMINDLY_*` name replaces `ANIMIND_*`. The app still reads the old name when the new one is unset or blank. On Vercel, copy the value to the new name and delete the old one. |
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
| What | Source repository. `.github/workflows/ci.yml` runs `npm ci`, `npm run build`, and `npm test` against an empty Postgres 16 service container. It does not use a production database. |
| Repo | [diogolean/animind](https://github.com/diogolean/animind) |
| Account | diogolean |
| Env vars | none |
| Invoices | [GitHub billing for user diogolean](https://github.com/settings/billing). The workflow uses the free GitHub-hosted runner and a throwaway Postgres service. |

## Omni-Engine core (not a vendor bill)

| | |
| --- | --- |
| What | HTTP API this app proxies to. Holds the Gemini, DeepSeek, Together, and OpenRouter keys above, plus local edge-tts (no account, no invoice) and the Rhubarb binary (no account). |
| Repo | [diogolean/Omni-Engine](https://github.com/diogolean/Omni-Engine) |
| Env vars (this app) | `ANIMINDLY_CORE_URL` (older `ANIMIND_CORE_URL`, then `CORE_URL`), `ANIMINDLY_CORE_KEY` (same value as the core's `CORE_API_KEY`; older `ANIMIND_CORE_KEY`, then `CORE_API_KEY`). Dev only: `ANIMINDLY_CORE_MOCK=1` when no core URL is set (`ANIMIND_CORE_MOCK` still works). |
| Where the values live | This app's `.env.local`, and Vercel env if the preview should reach a running core. The core's own provider keys stay on the core. Never git. |
| Invoices | None for the core process. Provider invoices are the rows above. |
| Metering | `products/animind_core` is on branch `feat/animind-core-api`, not the default branch. This app records provider, model, usage, and cost only from the response fields in the contract below. A missing or unknown cost stays null and is not stored as 0. The model is not inferred from this app's environment. The core change belongs in a later draft PR on Omni-Engine. This repo does not write that repository. |

### Minimum core response contract

`POST /v1/plan`, `POST /v1/render`, and `GET /v1/jobs/:id` need these fields when the core actually knows them. Omit a field when it is unknown. Do not send `0` for an unknown cost.

| Field | What this app does with it |
| --- | --- |
| `provider` | Stored when the response string matches `^[A-Za-z0-9._:-]{1,40}$` and the ledger row still has the local placeholder `core`, `none`, or `mock`. A missing field leaves that placeholder. It is not a cost and it is not an email. |
| `model` | Stored only when the response string matches `^[A-Za-z0-9._:-]{1,80}$`. On the reservation it replaces `unspecified`, `none`, or `mock`. Never copied from this app's env. |
| `usage.inputTokens`, `usage.outputTokens`, `usage.cachedTokens`, `usage.thinkingTokens` | Stored as separate counts. Thinking tokens are not added into output tokens. |
| `usage.imageCount`, `usage.audioSeconds`, `usage.videoSeconds` | Stored when present. |
| `reportedMinor` | Integer USD cents. A missing or non-integer value stays null. It is not treated as zero. A reservation estimate is not this field. |

The separate Omni-Engine draft, from `feat/animind-core-api`, is what has to start returning those fields. A nested provider read inside a paid render stays inside the same reservation. This app also writes one `read` row for that call, with the same user, request, and attempt. Its estimated and reported amounts stay null.

Owner-scoped proxies send `X-Animind-User` set to the account id (`usr_…`). The value matches `^[A-Za-z0-9_-]{1,80}$`. An email is deleted and never forwarded. The header goes on `/render`, `/plan`, `/characters`, `/preview`, `/scenarios`, `/jobs/`, `/files/`, and `/personas/` (sheet and deep). `GET /health`, `GET /tones`, and `GET /voices` do not send it. Omni-Engine draft [PR 100](https://github.com/diogolean/Omni-Engine/pull/100) stores the persona sheet under a hash of that header and leaves the public sheet shared when the header is absent. This repo does not change that repository.

`GET /v1/jobs` and `GET /v1/files` on the core still do not check the owner. This app records a job id or a file path only when a response it proxied for that account names it, and answers 404 to every other account before calling the core. A job or file that exists only on the core, and was never named in a stored response, is 404 here too. The 404 body is a fixed sentence. It does not include the character name or the path.

Account rows use the same driver as the spend ledger. A Neon host stays on the Neon HTTP driver. The CI Postgres service uses the wire protocol. `tests/privacy.test.ts` covers the file store. `tests/isolation-postgres.test.ts` covers two accounts on the isolated database.

### Route, meter, and lock

Rate, concurrency, and budget are the ledger. There is no process-memory limiter. Unknown money stays null and is not added as zero. A `read` row is a count, not money.

| Route | Meter | Lock |
| --- | --- | --- |
| `POST /api/plan` | `plan` reservation. Anonymous, unapproved, and core-off fall through to the local planner with no reservation. | Ledger rate, concurrency, and budget before any provider call. |
| `POST /api/render` | `render` reservation. The nested `GET /tones` on the core writes a `tone` read on the same user, request, and attempt. Both amounts on that read stay null. | Same ledger reservation. The nested read does not reserve again. |
| `POST /api/preview` | `preview` reservation. | Ledger. |
| `POST /api/characters` | `character` reservation. | Ledger. |
| `POST /api/scenarios` | `scenario` reservation. | Ledger. |
| `POST /api/personas/deep` and `GET /api/personas/deep` | `persona_deep` reservation. | Ledger. |
| `GET /api/personas/sheet` | Core mode: `persona_sheet` reservation and a proxy to the core contract, with `X-Animind-User`. Any other mode: labeled Wikiquote fixture from the file cache, no reservation and no provider. | Ledger only in core mode. The fixture path does not call the core. |
| `GET /api/jobs/:id` | `job` read. Amounts stay null. A usage object on the payload can fill the matching reservation once. A missing `reportedMinor` stays null. | Session required, then the owning account. A visitor is 401. Another account is 404. No money reservation. |
| `GET /api/files/*` | `file` read. Amounts stay null. | Session required, then the owning account. A visitor is 401. Another account is 404. No money reservation. |
| `GET /api/voices` | Local catalog. No ledger row. | None. |
| `GET /api/tones` | Local catalog. No ledger row. A core tone lookup that happens inside render is the nested read above. | None on this route. |
| `GET /api/health` | No ledger row. | None. |

## This app, no outside account

| Env var | Role |
| --- | --- |
| `ANIMINDLY_AUTH_SECRET` | Signs the session cookie and the Google state cookie. Generate it locally. At least 16 characters. |
| `ANIMINDLY_DATA_DIR` | Optional override for `./.data` when hosted database and Blob variables are empty. |
| `ANIMINDLY_GENERATION` | Must be exactly `1` or every paid call is denied. Empty is off. |
| `ANIMINDLY_SPEND_BUDGET_CENTS`, `ANIMINDLY_SPEND_USER_CENTS`, `ANIMINDLY_SPEND_TIMEOUT_MS`, `ANIMINDLY_SPEND_MAX_RETRIES`, `ANIMINDLY_SPEND_RATE_PER_MIN`, `ANIMINDLY_GENERATION_CONCURRENCY` | Required together before a paid call. No default numbers in code. Cents are USD minor units from the price table, not a subscription. Rate and concurrency are shared through the ledger. |
| `ANIMINDLY_SPEND_MAX_INPUT_TOKENS`, `ANIMINDLY_SPEND_MAX_OUTPUT_TOKENS`, `ANIMINDLY_SPEND_MAX_TOTAL_TOKENS`, `ANIMINDLY_SPEND_MAX_IMAGES`, `ANIMINDLY_SPEND_MAX_AUDIO_SEC`, `ANIMINDLY_SPEND_MAX_VIDEO_SEC` | Required per-request caps. A request over a cap is rejected. The prompt is not rewritten. |
| `ANIMINDLY_PRICE_TABLE_JSON` | Optional operator price table. Invalid JSON fails closed. Empty uses the unpublished table in the repo, which has no rows, so paid calls stay denied. |
| `ANIMINDLY_GA_MEASUREMENT_ID` | Public GA4 measurement id. Empty disables the tag. Preview host only until collection is checked. Direct gtag, not GTM. |
| `SEED_SUPERADMIN_PASSWORD` | Pilot password for email login. Local `.env.local` and Vercel env. Never git. |
