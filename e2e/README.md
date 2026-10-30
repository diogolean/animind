# E2E (Playwright)

One user flow, asserted on what the user sees: landing → “Quem vai falar?” → persona, tema e rival →
debate → aula. Each scene must play in the preview (canvas frames change), show the transcript
(real quotes in “ ” with a Wikiquote/Wikisource link, paraphrases marked) and offer the downloads.

| Project | When | Server | Checks |
| --- | --- | --- | --- |
| `mock` | always (CI, no keys) | `next start` with `ANIMIND_CORE_MOCK=1` | badge “mock de dev”, progress 0–100%, only paraphrases, no “MP4 do núcleo” |
| `core` | `E2E_CORE_URL` set | `next start` proxying to the real core | badge “núcleo …”, real quotes with sources, “MP4 do núcleo” served as `video/mp4` |

```bash
npx playwright install chromium         # once
npm run build
npm run test:e2e:mock                   # fast, ~1 min

# against a real core (Omni-Engine products/animind_core, ~10-20 min, uses Gemini/edge-tts/Wikiquote):
#   CORE_API_KEY=$KEY RHUBARB_PATH=... uvicorn products.animind_core.app:app --port 8797
E2E_CORE_URL=http://127.0.0.1:8797 E2E_CORE_KEY=$KEY npm run test:e2e
```

Options: `E2E_PERSONA` (default `Sócrates`), `E2E_RIVAL` (`Nietzsche`), `E2E_TOPIC` (`a verdade`),
`E2E_MOCK_PORT`/`E2E_APP_PORT` (3311/3312), `E2E_SHOTS_DIR` (copies the step screenshots and the run video
there as `9-e2e-<project>-*`). Videos, traces and reports stay in `test-results/` and `playwright-report/`
(gitignored).
