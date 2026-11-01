# E2E (Playwright)

Two complete user flows are asserted on what the user sees:

- prompt único com Automático ligado: extrai Jesus + Diabo, debate e tema; mostra chips editáveis e gera;
- Automático desligado: modo, personagens, tipo, estilo, tom, objetivo, cenário e duração aparecem na mesma página.

Each scene must animate in the preview, show both the transcript and a passing “Roteiro conferido”
self-check. The tests also inspect the `/api/characters` and `/api/render` payloads. Tela inicial,
chips, controles manuais e resultados são capturados quando `E2E_SHOTS_DIR` is set.

| Project | When | Server | Checks |
| --- | --- | --- | --- |
| `mock` | always (CI, no keys) | `next start` with `ANIMIND_CORE_MOCK=1` | plano local, chips, manual, cenário fallback, preview e transcript |
| `core` | `E2E_CORE_URL` set | `next start` proxying to the real core | o mesmo estúdio contra os jobs reais |

```bash
npx playwright install chromium         # once
npm run build
npm run test:e2e:mock                   # fast, ~1 min

# against a real core (Omni-Engine products/animind_core, ~10-20 min, uses Gemini/edge-tts/Wikiquote):
#   cd Omni-Engine && CORE_API_KEY=$KEY RHUBARB_PATH=... ANIMIND_DATA_DIR=/tmp/animind-data \
#     python -m uvicorn products.animind_core.app:app --host 127.0.0.1 --port 8787
#   restart it after every pull: a core from an older checkout renders unknown sets (e.g. agora) as the studio;
#   the core project checks /v1/health `scenarios` up front and the app warns when the set it got differs.
E2E_CORE_URL=http://127.0.0.1:8787 E2E_CORE_KEY=$KEY npm run test:e2e
```

Options: `E2E_MOCK_PORT`/`E2E_APP_PORT` (3311/3312) and `E2E_SHOTS_DIR` (copies named screenshots).
Videos, traces and reports stay in `test-results/` and `playwright-report/` (gitignored).
