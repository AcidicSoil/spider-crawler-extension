# Local model verification — 2026-11-07

The local llama.cpp router at `127.0.0.1:8800` advertised **13** entries. A live extension integration test discovered all 13 without inventing models or treating text output as disqualifying. The dedicated StartLux server at `127.0.0.1:8812` adds one independent native System One entry.

| Model/server entry | Observed inference result | Notes |
| --- | --- | --- |
| `ggml-org/Julia-1-GGUF:Q8_0` | Pass: native `noul` and `choice` | Direct cached GGUF |
| `ggml-org/Laya-GGUF:Q8_0` | Pass: native `noul` and `choice` | Direct cached GGUF |
| `ggml-org/Kev-0.8B-GGUF:Q8_0` | Pass: native `noul` and `choice` | Direct cached GGUF |
| `ggml-org/Clef-Flash-GGUF:Q4_K_M` | Unverified | Local CPU load did not become ready within 43.6 seconds; host is memory/disk constrained |
| `julia-1`, `kev-0.8b` | Discovered; alias inference untested | Preset aliases for cached GGUFs |
| `laya`, `clef-flash` | Discovered; alias inference untested | Preset aliases advertised as text-output while unloaded |
| `mradermacher/StartLux-Decision-v1-4B-GGUF:Q4_K_S` | Router discovery only | Native decision support **verified on separate upstream engine**, not on router |
| `bombdefuser-124/Intern-Decision-4B-GGUF:FIXED` | Discovered; native System One unverified | Text-output serving metadata |
| `LiquidAI/LFM2-1.2B-Tool-GGUF:Q8_0` | Discovered; decision inference unverified | Text-output serving metadata |
| `unsloth/Qwen3.5-4B-GGUF:Q4_K_XL` | Discovered; decision inference unverified | Text-output serving metadata |
| `unsloth/Qwen3.5-9B-MTP-GGUF:Q4_K_S` | Discovered; decision inference unverified | Text-output serving metadata |
| Dedicated StartLux engine, `model-v1-4b` | Pass: live `noul`, `choice`, Spider Crawler `jev-test`, PAB category choice | `127.0.0.1:8812/v1`, official decision engine backed by cached Q4_K_S GGUF |

**Method:** models were observed from the live `GET /models` and native `GET /v1/models` APIs. Decision support was validated by actual HTTP `POST /v1/systemone` requests containing structured `noul` and `choice` questions. Metadata discovery was checked separately from successful inference. A production-sized 16-link StartLux Noul batch returned HTTP 200 and 16 valid probabilities in **25.2 seconds** on CPU, within the extension's 30-second local timeout but with only 4.8 seconds of headroom. The combined test runner passed 35 Node and 6 Bun tests with live endpoints enabled.

**Blocker:** WSL root reached roughly 100 MB free; swap usage was about 29 GiB of 32 GiB. Clef-Flash has a 6.7 GB local GGUF. The on-demand router probe was stopped rather than risk extra downloads or resource exhaustion. No other services were intentionally terminated. Do not mark blocked or untested models as passing.

**Repeatable checks:** `./scripts/test.sh` runs Bun backend tests and Node extension tests. With `SPIDER_LIVE_ROUTER_URL` and `SPIDER_LIVE_STARTLUX_URL` set, the script additionally tests all discovered router IDs and live StartLux `noul` inference. Those checks do not claim semantic accuracy for unrelated text-only models or guarantee that the router can load every cached entry.
