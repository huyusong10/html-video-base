# html-video-base

[简体中文](https://github.com/huyusong10/html-video-base/blob/main/README.md) | **English**

A minimal, extensible pure-function timeline (`f(t)`) HTML interactive video micro-kernel and multi-TTS rendering toolchain. Consumer projects only need to depend on this package in `package.json`—no need to copy or maintain `videos/base/` or build scripts in each business repo.

## Highlights

- **Pure-Function Timeline `f(t)`**: Frame state is deterministically derived from time `t`, enabling instant seeking, variable playback rates, and idempotent frame-by-frame capture.
- **Semantic Word Anchors & Dual-Stem Mixing**: Synthesizes multi-provider TTS, extracts 30Hz voice energy envelopes, aligns acoustic word timestamps, and outputs separate `soundtrack.m4a` (voice + SFX) and `bgm.m4a` (auto-ducked music) stems plus `.vtt`/`.srt` subtitles.
- **Dual-Clock Living Pause**: Freezes narrative time `t` on pause/end while keeping ambient clock `x.alive` flowing smoothly; includes normalized stage pointer fields (`x.pointer`), `V.u.interactive`, and live `V.sfx`.
- **Opt-In Multi-Language Support**: Extend videos into other languages via `V.locale()` and `--lang` without touching scene source code.
- **Dev Server, Visual Audit & Static/MP4 Export**: Includes virtual `/base/*` serving with 206 Range seeking & SSE live reload, headless Chromium layout auditing, incremental MP4 rendering, and zero-dependency static bundling.

---

## Quick Start

### 1. Install

```bash
npm install html-video-base
```

Or add the dependency and scripts to your project's `package.json`:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "init": "html-video init",
    "serve": "html-video serve",
    "build": "html-video build",
    "mix": "html-video mix",
    "verify": "html-video verify",
    "audit": "html-video audit",
    "storyboard": "html-video storyboard",
    "render": "html-video render",
    "bundle": "html-video bundle",
    "docs": "html-video docs"
  },
  "dependencies": {
    "html-video-base": "^2.7.2"
  }
}
```

### 2. Scaffold & Preview

```bash
# Scaffold a starter video and export the engineering guide to .agents/skills/html-video/
npx html-video init demo --title "Product Demo" --skill

# Start local live-reload server (http://localhost:8765/)
npx html-video serve
```

> For **playing or statically bundling pre-built videos**, Node.js alone is sufficient (`serve` and `bundle` do not require Python or FFmpeg).

### 3. Audio Synthesis & MP4 Rendering Environment (Optional)

When you need TTS synthesis (`build`), remixing (`mix`), audio-visual sync verification (`verify`), or MP4 export (`render`), set up Python 3.10+ and FFmpeg:

- **macOS / Linux**:

  ```bash
  python3 -m venv .runtime/venv
  .runtime/venv/bin/pip install -r node_modules/html-video-base/requirements.txt
  ```

- **Windows PowerShell**:

  ```powershell
  python -m venv .runtime/venv
  .runtime/venv/Scripts/pip install -r node_modules/html-video-base/requirements.txt
  ```

---

## Documentation & Agent Skill Discovery

All manuals and engineering specifications ship inside the installed npm package:

| Entry | Description |
| :--- | :--- |
| `npx html-video docs --en` | Print installed doc paths (`README.en.md`, `README.md`, `SKILL.md`, `i18n.md`) and quick-start commands |
| `npx html-video --help` | Show all CLI commands and options |
| `npx html-video skill` | Export the authoring & theming specification to `.agents/skills/html-video/` for teams and AI coding agents |
| [Authoring & Engineering Spec (SKILL.md)](skills/html-video/SKILL.md) | Standard layout, pure-function `f(t)` contract, word anchors, mascot layers, and audit rules (ZH) |
| [Opt-In i18n Guide (i18n.md)](skills/html-video/references/i18n.md) | `V.locale()` external language packs, literal text mapping, and multi-lang builds (ZH) |
| [中文手册（README.md）](README.md) | Full Chinese documentation |

---

## CLI Commands

| Command | Purpose |
| :--- | :--- |
| `html-video init <id> [--title "..."] [--aspect 16:9\|9:16\|1:1] [--skill]` | Scaffold a new video (`--skill` also exports `SKILL.md` to `.agents/skills/html-video/`) |
| `html-video skill [--out .agents/skills/html-video]` | Export built-in `SKILL.md` authoring & theming specification |
| `html-video docs [--en]` | Print installed documentation paths and quick-start commands |
| `html-video serve [port] [host] [--no-watch]` | Start virtual `/base/*` HTTP server with 206 Range seeking & SSE live reload |
| `html-video build [id] [--lang en] [--provider ...] [--bitrate 128k] [--mix-only] [--visual]` | Synthesize TTS, 30Hz envelope & word alignment; export `soundtrack.m4a`, `bgm.m4a`, `.vtt`/`.srt` and bake layout |
| `html-video mix [id] [--lang en] [--bitrate 128k] [--visual]` | Fast offline remix using cached dry voice stems or slicing `soundtrack.m4a` |
| `html-video verify [id ...] [--stamp-baked] [--visual] [--strict]` | Verify semantic word anchors and 5-dimension audio-visual sync |
| `html-video audit [id ...] [--strict] [--screenshots <dir>]` | Headless Chromium check for broken images, overflow, subtitle occlusion, card overlap, min font size & `f(t)` idempotency |
| `html-video storyboard [id] [out.html] [--per-cue] [--pdf]` | Export single-file visual storyboard review sheet (optional PDF) |
| `html-video render [id] [out.mp4] [--workers N] [--scene K] [--range a:b] [--no-bgm] [--no-cache]` | Incremental SHA-256 scene-cached & static-frame-reused multi-worker MP4 export |
| `html-video bundle [id ... \| --single \| --all] [--out dist]` | Bundle virtual `/base/*` and video assets into a standalone static site (no `node_modules` needed) |
| `html-video manifest` | Scan `videos/` and sync `videos/manifest.js` |

---

## Micro-Kernel Extension APIs

| API | Description |
| :--- | :--- |
| `V.use(plugin)` | Register lifecycle hooks (`onBoot` / `onLayout` / `onRender` / `onSeek` / `onPlay` / `onPause` / `onSceneEnter` / `onEnded`; aliases `boot` / `layout` / `tick` / `seek` / `play` / `pause` / `sceneChange` / `ended`) |
| `V.transition(name, { dur, mount(box, cfg), update(dom, near, dur, current, cfg) })` | Register custom cross-scene transitions (built-in: `none` / `fade` / `slide` / `wipe` / `tiles`) |
| `V.control({ id, icon, title, onClick, sync })` | Inject custom icon buttons into the player control bar (`16×16` SVG path array, SVG string, or render fn) |
| `V.icons(dict)` / `V.makeIcon(spec)` | Override built-in player icons (`home` / `play` / `pause` / `replay` / `rate` / `subsOn` / `subsOff` / `volumeOn` / `volumeVoice` / `volumeBgm` / `volumeMute` / `webEnter` / `webExit` / `fullEnter` / `fullExit`) |
| `V.preset(name, factory)` | Register reusable visual primitives under `V.c[name]` |
| `V.layer({ id, prop, zIndex, defaultState, create, update })` | Register persistent cross-scene character/widget layers driven by 30Hz voice energy `info.energy` (`0..1`) |
| `V.subtitle({ position, modes, lead, tail, onUpdate })` + `V.setSubLayout(spec)` | Customize subtitle placement (`center`/`left`/`right`/`top` or explicit coords) and `.sub-lead` / `.sub-tail` mascot slots |
| `V.locale(lang, { title, scenes: { [id]: { title, lines, anchors } } })` | Register translated scripts, UI text mappings, and `x.at()` anchor mappings (`?lang=en` / `--lang en`) |
| `V.u.keyframes(t, stops, opts)` | Multi-stop pure-function interpolation (smooth numeric tweening + discrete string/boolean state switches) |
| `V.pointer` / `x.pointer` + `V.u.interactive(el, handlers)` | Normalized stage pointer field (`x/y/nx/ny`, damped `sx/sy/presence`, `#stage` CSS vars; zeroed when `?record=1`) and click-safe stage interaction helper |
| `x.alive` / `x.clock` + `ui.livePause` | Dual-clock ambient engine: freezes narrative `t` while keeping `x.alive` running during pause/end (locked to `t` when `?record=1`) |
| `V.u.videoClip(src, opts)` + `V.u.syncVideoClip(el, t)` | Synchronized embedded `<video>` clips with deterministic seeking and audio mixing in `mix.py` |
| `scene.checkpoints` | Interactive pause checkpoints & branching Q&A in Web playback (auto-bypassed in `?record=1`) |
| `V.tryEgg(targetSec, hint)` / `V.enterSandbox` / `V.exitSandbox` | Easter-egg / sandbox jump from finale with floating return bar |
| `V.search(query)` / `V.openSearch()` / `V.getDeepLink(t)` | Full-text script & chapter search (`/` or `Ctrl+K`) and `?t=` timestamp deep links |
| `V.setBgm(on)` / `V.setVoice(on)` / `V.setMuted(on)` / `V.clearSavedState()` | Independent voice/BGM track toggles (`B` for BGM, `M` for mute) and preference/resume storage controls |
| `V.config.ui` / `V.themeDefaults.ui` | Player UI configuration (`controlsMode: 'overlay'`, `persist`, `resume`, `iconPreset: 'default' \| 'pixel'`, `rates`) |

---

## Theme & Control Bar CSS Variables

Override `:root` variables to customize themes without fighting selector specificity (base selectors use low-specificity classes / `:where()`):

- **Viewport & Stage**: `--viewport-bg`, `--stage-shadow`, `--stage-bg-image`, `--font-sans`, `--font-smoothing`, `--gl-rendering`
- **Top Segment HUD `#hud`**: `--hud-left/right/top/h`, `--hud-track-h/radius/bg`, `--hud-bar-bg`, `--hud-tick-w/bg`
- **Subtitles `#subs`**: `--sub-bottom`, `--sub-z`, `--sub-radius`, `--sub-bg/fg/border/border-w`, `--sub-size`
- **Bottom Control Bar & Menus**: `--ctrl-h`, `--ctrl-font/font-size`, `--ctrl-radius`, `--ctrl-btn-w/h`, `--ctrl-icon-btn-w`, `--ctrl-time-w`, `--ctrl-chap-w`, `--ctrl-track-h/radius/bg`, `--ctrl-fill-bg`, `--ctrl-mark-w/h/bg`, `--ctrl-thumb-w/h/radius/border`, `--ctrl-menu-bg/border/radius/shadow`

---

## Quality Gates

All JS/MJS and Python functions enforce cyclomatic complexity `< 15` (`<= 14`):

```bash
npm run lint:cc
npm test
```
