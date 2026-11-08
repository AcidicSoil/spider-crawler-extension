---
version: alpha
name: "spider-crawler-extension"
description: "Existing browser extension identity, source verified on 2026-11-02."
colors:
  primary: "#b04dff"
  background: "#0d0716"
  text: "#e9ddff"
  accent: "#39ff88"
spacing:
  bodyPadding: "14px"
  fieldGap: "4px"
  controlGap: "8px"
rounded:
  input: "7px"
  button: "8px"
  card: "12px"
typography:
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
  heading:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
components:
  popup:
    textColor: "{colors.text}"
  field:
    textColor: "{colors.text}"
  status:
    textColor: "{colors.accent}"
---

## Overview

This is the established browser extension UI, not a new theme. The toolbar popup controls creature, visual mode, skin, hunt text, crawl log and settings; the content script draws its creature over the destination webpage without replacing the site's content. Source: `popup.html`, `ui.css`, `shared.js`, `content.js`, `manifest.json`.

## Colors

The root palette in `ui.css` uses `--bg:#0d0716`, `--card:#170c26`, `--fg:#e9ddff`, `--muted:#a58fc7`, `--purple:#b04dff`, `--green:#39ff88`, and `--border:#3a1f5c`. These are incumbent tokens. Built-in skins in `shared.js` change the creature colors independently of the popup palette. Do not introduce a second global theme for third-party imports.

## Typography

The popup body uses `13px/1.45 system-ui, -apple-system, Segoe UI, sans-serif`; `h1` is 16px and `h2` is 14px with uppercase green text. Field captions are 12px. `textarea` uses 12px monospace with 1.4 line-height. All values come from `ui.css`.

## Layout

`popup.html` sets the popup body to 270px width. `ui.css` applies 14px body padding, 4px gaps between field labels/inputs, 8px gaps for two-column controls, and 6px gaps in two-column button grids. The options page is up to 760px wide. It keeps the existing skin editor and local System One settings; the popup links to the live backend results dashboard. The canvas overlay in `content.js` lives inside a single Shadow DOM host (`#__spider_root`), is fixed to the viewport with `width:100vw`, `height:100vh` and `pointer-events:none`, and does not take page layout space. Link-hit/cocoon decorations still apply to ordinary page anchors through a separate document-level stylesheet. Existing interactions must continue to work across scrolling and resize.

## Elevation & Depth

Cards have solid `--card` fills, a `--border` one-pixel line, and rounded corners. The popup logo uses a green glow. The overlay canvas is at `z-index:2147483646` and ephemeral chips/HUD at `2147483647` in `content.js`. The primary action uses a purple/green linear gradient and a restrained purple hover shadow. For light shell colors, the HUD and collection chips use the dark incumbent `#0d0716` background and high-contrast light text rather than white-on-white. Keep source page controls reachable.

## Shapes

Inputs use a 7px corner radius, buttons 8px, cards 12px. Spider mode uses eight articulated two-bone legs; octopus and slime are existing selectable creatures. Alternate neon/8-bit render modes must remain supported. These are source behavior, not proposed redesigns.

## Components

`popup.html` controls animation, hunt objective, creature, visual mode, skin, and existing local find logs. It also shows the real backend health result and provides access to backend action history. `options.html` retains the original skin/hunt editor and local System One model-selection controls. `content.js` owns the single IK creature renderer, visible-link detection, optional Jev decisions, animation, and action completion. `background.js` forwards page-scoped target and action messages to the loopback backend and keeps remote keys private. The Bun backend owns the next-target decision and validates/persists completed actions in SQLite. Backend failures are visible but never produce invented successful actions. The native extension remains dependency-free, with its existing visual language and keyboard focus behaviors. Extension-context invalidation removes the existing overlay, and local decision model discovery updates from the server on settings focus and every 30 seconds while visible without changing the selected model. The backend does not navigate or crawl across pages. The options-page playground retains its local animated preview.

## Do's and Don'ts

- Keep a single active spider renderer in a tab. Never overlay two independent spiders.
- Preserve popup colors, skins, controls, pointer pass-through and reduction-of-motion handling unless verified browser tests support a deliberate change.
- Reuse MIT-licensed external code with copyright/license notices; treat unlicensed repositories as functional references only.
- Keep target selection and action persistence in the backend; keep DOM access and animation in the extension.
- The user approved the incumbent visual language in this conversation on 2026-11-02. The verified PPM browser captured popup/overlay screenshots under `.design/evidence/`; retain source-linked evidence when the UI changes, and verify interaction/focus states before closing.
