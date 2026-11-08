# 🕷 Spider Crawler

A Chrome / Edge / Brave extension that drops **one big creature** onto any web page. Pick a **spider**, an **octopus** or a **slime**.

It crawls the page, **grabs the links you are hunting for** and **wraps everything else** in silk, ink or goo.

Turn on **Jev** and select a decision-capable local or remote model to classify links by meaning rather than keywords. Latency depends on the selected model and server.

**▶ [Watch the 38 s showcase clip (mp4)](https://github.com/AlungranPJ/spider-crawler-extension/raw/main/docs/showcase.mp4)**: spider + Jev, octopus, slime, 8-bit.

| 🕷 Spider + Jev hunt | 🐙 Octopus + Jev hunt |
|---|---|
| ![Spider](docs/demo-jev.gif) | ![Octopus](docs/demo-octopus.gif) |
| **🧪 Slime** | **👾 8-bit mode** |
| ![Slime](docs/demo-slime.gif) | ![8-bit](docs/demo-8bit.gif) |

Separate clips: [spider](docs/demo-jev.mp4), [octopus](docs/demo-octopus.mp4), [slime](docs/demo-slime.mp4).

## Creatures

| | Moves like | Grabs a match | Wraps a non-match |
|---|---|---|---|
| 🕷 **Spider** | 8 legs with 2-bone IK and an alternating tetrapod gait. Feet stay planted on the page | Bites it, then silk line and pulse rings | Silk cocoon spiral |
| 🐙 **Octopus** | 8 wavy tentacles with suckers. Tips stick to the page and step with the same IK gait | Shoots a tentacle out to the link | Ink cloud |
| 🧪 **Slime** | A bouncy blob that squashes and stretches on every hop and leaves a goo trail | Stretches a pseudopod and absorbs it | Goo blob that drips |

You can switch creatures live from the toolbar popup.

## Features

- **Hunt mode.** Type what you want (`spiders`, `pricing pages`, `open-source AI tools`...).
  - Matches are grabbed and ripped into the HUD.
  - Non-matches are wrapped.
  - Leave it empty and every link is a find.
- **Jev judging (optional).** Link relevance is judged in batched yes/no decisions. Choose an installed local decision model without an API key, or configure a supported remote provider. If unconfigured, the extension uses keyword matching.
- **Skins.** 6 built-ins: Venom (purple x green), Laya (ice blue), Ember, Ghost, Black Gold and Matrix. A color editor lets you make your own, and skins export and import as JSON so you can share them. Skins work on all three creatures.
- **Neon or 8-bit.** Neon has glow and gradients. 8-bit renders at 1/4 resolution with hard pixels and a retro HUD.
- **Size and speed sliders**, plus a HUD toggle.
- **Crawl log.** Every find is saved locally. Export it as JSON from the popup.

## Install (2 minutes)

1. Download the latest `spider-crawler-vX.Y.Z.zip` from [Releases](../../releases) and unzip it. You can also clone this repo.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the unzipped folder (the one containing `manifest.json`).
5. Open a website, click the extension toolbar icon, and enable **Animate on this tab**. Other tabs stay inactive.

Click the toolbar icon for quick settings: activate the creature on the current tab, hunt, creature, mode, skin and the crawl log. New tabs stay inactive until you enable them. Tab activation survives navigation within that tab and resets when it closes. **Settings** opens the full options page. Disabling the extension in Chrome also removes an existing overlay without requiring a reload.

## Using Jev

Jev uses the System One decision protocol to classify links as relevant or unrelated to your hunt.

**Local decision models (no key):**

1. Start an existing System One-compatible local model server, such as a llama.cpp router. The default server URL is `http://127.0.0.1:8800/v1`; you can enter another loopback port in **Settings → Hunt & Jev**.
2. Choose **Local System One**. Discovery runs when settings open, on page focus, and every 30 seconds while visible. The extension reads `GET /v1/models` and, for llama.cpp routers, `GET /models?reload=1` to include GGUF files downloaded after router startup without restarting it. **Refresh models** does the same immediately. No model names are hardcoded.
3. Pick **Decision model** from the discovered models. Models advertising `decisions` as an output modality appear as decision candidates. Other models, including those advertising `text`, remain selectable as **unverified** until tested. Text output does not establish or rule out decision capability. Use **Test Jev** before hunting. If a router cache refresh fails, the UI reports that its model list is stale.
4. Press **Test Jev** to exercise the selected model, then enter **Hunt for**.

**No model is selected automatically.** Model IDs come directly from the server, not a built-in list. Your choice and endpoint are stored locally. If the model disappears or the server is unavailable, the choice remains visible; no different model is substituted. Changing the endpoint successfully clears the old model choice so you can select one served by the new endpoint. Local endpoints are restricted to `http://127.0.0.1:<port>/v1` or `http://localhost:<port>/v1`.

A GGUF filename containing “Decision” and the server's `output_modalities: ["text"]` are not evidence of whether `/v1/systemone` is supported. For example, a StartLux GGUF remains selectable for testing, but actual decisions require a compatible serving engine (see [StartLux engine instructions](https://github.com/StartLuxLabs/StartLux-Decision/blob/main/docs/engines.md)). The extension never treats text output alone as proof of incompatibility or verified decision support.

**Remote Jev providers:** TypeSafe, OpenCode Zen, OpenRouter Decisions API, and Venice remain available. Select the provider, enter its API key, press **Save key**, and use **Test Jev**. Changing to Local System One does not erase your remote credentials.

Each request sends the page title, URL and a batch of visible links (text and URL), with a `noul` question per link. A link is grabbed when `p(yes) >= threshold`, which defaults to 0.5. An unconfigured model, a missing remote key or a decision-service failure falls back to keyword matching.

**Privacy:** Remote API keys stay in `chrome.storage.local`, are never synced or exposed to webpages, and are sent only to the chosen remote provider by the extension service worker. Local inference is keyless; page/link information is sent to the explicitly configured loopback service, not an external provider.

## Skin JSON

```json
{
  "name": "Pink Venom",
  "shell": "#10051c", "shellMid": "#2a0b4a", "shellHi": "#5a1a9a",
  "leg": "#b04dff", "legTip": "#39ff88", "accent": "#ff00aa",
  "glow": "#b04dff", "eye": "#39ff88"
}
```

Paste this into **Skin JSON** on the options page and press **Import JSON as skin**. PRs with new built-in skins are welcome (`shared.js`).

## How it works

| File | Role |
|---|---|
| `content.js` | Original IK creature animation, visible DOM targets, decisions, target execution |
| `background.js` | Jev/System One requests and authenticated extension-to-backend messages |
| `server/app.mjs` | Backend target selection and SQLite action history |
| `server/start.mjs` | Loopback HTTP listener and preview server |
| `shared.js` | Skins and default settings |
| `popup.*`, `options.*` | Controls, local model selection and results access |

The extension remains dependency-free Manifest V3. The backend uses the installed **Bun** runtime and built-in SQLite; no separate crawling engine or browser automation service is required.

## Backend-controlled, current-page hunting

The backend **does not fetch other pages or navigate the browser**. Its job is to coordinate the actual animated spider on the page the user is viewing:

1. Enable **Animate on this tab** in the extension popup. Only that tab's content script draws the spider. It discovers visible links and computes a local keyword or optional Jev/System One decision for each one.
2. The extension sends the candidates, spider position, page URL, and hunt objective to `POST /api/next`.
3. The backend prioritizes relevant links, chooses the closest in that class, and records the pending target.
4. The original spider renderer walks to that target and performs its bite or wrap animation.
5. On arrival, `POST /api/actions` validates the assignment and records the completed action in SQLite. `GET /api/results` exposes local results; the popup's **Backend results** button opens them.

Targets and completed actions are scoped to a unique page/hunt session. The server stores completed actions across restarts; the client never invents successful backend records. When the backend is unavailable, the spider shows **backend offline** rather than claiming an action was assigned. The settings-page playground retains the upstream local-only animation preview.

### Launch

```bash
# Managed profile: starts the backend and opens the extension preview and example page.
pinchtab-profile-manager spider-crawler-extension start --json

# Manage the project's single backend/preview process.
pinchtab-profile-manager spider-crawler-extension project status --json
pinchtab-profile-manager spider-crawler-extension project stop --json
pinchtab-profile-manager spider-crawler-extension project start --json

# Or run the backend directly from the extension checkout (outside PPM).
bun server/start.mjs
```

The backend listens only on `127.0.0.1:5195`. It serves the live link-and-results dashboard at `/` and preview assets on `/popup.html` and `/options.html`; its health endpoint is `GET /api/health`. Cross-origin browser writes are rejected unless the request comes from a browser extension origin; local processes can still call the unauthenticated loopback API. Do not expose port `5195` through a network proxy or port forward. Actions are persisted under `~/.local/state/spider-crawler-extension/actions.sqlite` (override with `SPIDER_DB` only if explicitly configured). The listener is intentionally local; it has no external crawl capability.

Run scoped tests:

```bash
node --test tests/jev-local.test.mjs tests/jev-settings.test.mjs tests/popup-controls.test.mjs tests/spider-coordinator.test.mjs
bun test tests/backend.test.mjs
```

### References

[cr4wler](https://github.com/funsaized/cr4wler) informed Shadow DOM overlay and exclusion patterns. The [original Spider Crawler](https://github.com/AlungranPJ/spider-crawler-extension) supplies the existing creature renderer and inverse-kinematics gait. [Fred Fokan's web-crawler](https://github.com/fredfokan/web-crawler) served as a leg-placement behavior reference; no unlicensed source was copied.

## Credits

Inspired by the "four decision models racing down a web page" spider video from [atomic.chat](https://x.com/atomic_chat_hq/status/2107828492297720017). This is an independent project, not affiliated with atomic.chat, TypeSafe, OpenAI or Anthropic.

Built with Claude (via the Hermes agent). The code was written, run and tested in a real Chromium with Playwright.

## License

MIT
