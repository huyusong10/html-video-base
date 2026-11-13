# html-video-base

[简体中文](https://github.com/huyusong10/html-video-base/blob/main/README.md) | **English**

A lightweight web-native video engine and multi-TTS rendering toolchain.

With `html-video-base`, your videos are interactive web pages built with HTML, CSS, and JavaScript: viewers can scrub, click, and inspect them directly in the browser, and you can also synthesize voiceovers, generate subtitles, and render lossless MP4s from the exact same source. Consumer repositories only need this single npm dependency—no need to copy runtime files or build scripts across projects.

---

## Why It Works This Way

Traditional video editors do not play nicely with Git, dynamic layouts, or live interaction, while ordinary web animations easily drift out of sync during screen capture. `html-video-base` solves this with three design principles:

1. **Every frame is a pure function of time**: Scene rendering (`update(t, x)`) depends solely on time `t`. Seeking, variable playback speeds, and frame-by-frame MP4 capture stay deterministic with zero drift.
2. **Animations snap to spoken words**: Instead of hardcoding fragile timestamps, bind animations to keywords in your script via `x.at(0, 'keyword')`. When you edit copy or adjust TTS speed, timing re-aligns automatically.
3. **Runtime separated from content**: Your repo holds only scenes, styles, and media assets. During development, `serve` mounts the core runtime at `/base/*`; for deployment, `bundle` outputs a self-contained static site.

---

## Getting Started: Your First Video in 4 Steps

### Step 1: Install

```bash
npm init -y
npm install html-video-base
```

> **Prerequisites**: Node.js (20+) is all you need to **preview or statically bundle pre-built videos** (`serve` / `bundle`). Python 3.10+ and FFmpeg are only required when **synthesizing audio or exporting MP4s** (`build` / `mix` / `verify` / `render`).

### Step 2: Scaffold & Preview

```bash
# Create a starter video named "demo" and export the authoring guide
npx html-video init demo --title "Product Overview" --skill

# Start local live-reload server (http://localhost:8765/)
npx html-video serve
```

Open `http://localhost:8765/demo/?dev=1`. Even before generating TTS audio, you can scrub and preview the draft right away—durations are estimated from script length automatically.

Your new video folder stays minimal with just 4 files:

```text
videos/demo/
├── index.html       # Entry page loading the runtime and your scripts
├── video.config.js  # Aspect ratio, TTS voice, BGM, transitions, etc.
├── style.css        # Scene styles and CSS theme variable overrides
└── js/scenes.js     # Spoken lines and pure-function scene animations
```

### Step 3: Write a Scene

In `videos/demo/js/scenes.js`, each scene declares spoken `lines`, builds DOM nodes once in `build`, and updates them from time `t` in `update`:

```js
const { h, appear, pop } = V.u;

V.scenes.push({
  title: 'Core Highlights',
  lines: [
    'With html-video-base, you declare script lines and word anchors to preview and render videos directly from code.',
  ],
  build(root) {
    this.card = h('div', { class: 'hero-card' }, 'Code as Video');
    root.append(this.card);
  },
  update(t, x) {
    // Trigger card pop 0.1s before the narrator speaks "word anchors"
    pop(this.card, appear(t, x.at(0, 'word anchors', -0.1), 0.35));
  },
});
```

### Step 4: Voiceover, Verification & Delivery

When your scenes are ready to ship:

1. **Set up Python audio dependencies (first time only)**:

   ```bash
   # macOS / Linux
   python3 -m venv .runtime/venv
   .runtime/venv/bin/pip install -r node_modules/html-video-base/requirements.txt

   # Windows PowerShell
   python -m venv .runtime/venv
   .runtime/venv/Scripts/pip install -r node_modules/html-video-base/requirements.txt
   ```

2. **Build voiceover, BGM & subtitles**:

   ```bash
   npx html-video build demo
   ```

   This synthesizes TTS voiceovers, extracts a 30Hz energy envelope (for lip-syncing characters), generates `.vtt`/`.srt` subtitles, and writes separate `soundtrack.m4a` (voice + SFX) and `bgm.m4a` (auto-ducked music) stems.

   > **Tip**: If you only tweaked music, SFX, or pauses without changing the spoken text, run `npx html-video mix demo` to remix offline in seconds using cached dry voice stems.

3. **Verify sync & layout**:

   ```bash
   npx html-video verify demo   # Check word anchors, subtitles, and audio/visual alignment
   npx html-video audit demo    # Run headless Chromium checks for broken images, overflow, and overlaps
   ```

4. **Deliver (MP4 or standalone static site)**:

   ```bash
   # Option A: Render 1080p MP4 (with per-scene incremental cache & multi-worker rendering)
   npx html-video render demo

   # Option B: Bundle into a standalone static site (no node_modules required)
   npx html-video bundle --all --out dist
   ```

---

## Recommended `package.json` Scripts

Add shortcut scripts to your project's `package.json` for daily workflow:

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
    "html-video-base": "^2.7.3"
  }
}
```

---

## Going Further

Once the core workflow is up and running, explore these built-in capabilities as needed:

### 1. Interactivity & Dual-Clock Ambient Motion
- **Living pause (`ui.livePause: true`)**: When paused or at the end of a video, narrative time `t` freezes while the ambient clock `x.alive` / `x.clock` keeps advancing smoothly. Drive idle breathing, blinking, or background particles from `x.alive`; during MP4 export (`?record=1`), `alive` locks to `t` for deterministic capture.
- **Normalized stage pointer & clickable elements**: `x.pointer` maps cursor coordinates into stage space automatically (accounting for scaling, letterboxing, and fullscreen). Wrap clickable cards or buttons with `V.u.interactive(el, handlers)` to trigger `V.sfx()` micro-sounds without accidentally toggling play/pause.
- **Checkpoints & sandbox jumps**: Configure `scene.checkpoints` for interactive pause prompts or branching Q&A, and use `V.tryEgg(sec, hint)`, `V.enterSandbox()`, and `V.exitSandbox()` for finale try-it-out jumps.

### 2. Cross-Scene Characters, Transitions & Subtitles
- **Persistent character layers (`V.layer`)**: Keep mascots or HUD overlays continuous across scene cuts; `update(st, info)` receives real-time 30Hz voice energy `info.energy` (`0..1`) for mouth/lip animation.
- **Subtitle positioning & slots (`V.subtitle` / `V.setSubLayout`)**: Move subtitles (`center`/`left`/`right`/`top` or custom coordinates) to avoid overlapping characters, and attach `.sub-lead` / `.sub-tail` widgets.
- **Multi-stop keyframes (`V.u.keyframes`)**: Smoothly interpolate numeric properties and switch discrete states across multiple time stops without nested `lerp` boilerplate.
- **Embedded video clips (`V.u.videoClip` / `V.u.syncVideoClip`)**: Embed `<video>` recordings that stay frame-locked during scrubbing/rendering and mix cleanly in `mix.py`.
- **More extension APIs**: `V.use(plugin)` (lifecycle hooks), `V.transition()` (custom transitions), `V.preset()` (reusable visual primitives), `V.control()` / `V.icons()` / `V.makeIcon()` (custom player buttons & icons), and `V.search()` / `V.openSearch()` / `V.getDeepLink()` (script search via `/` or `Ctrl+K` and `?t=` deep links).

### 3. Multi-Language Videos
Keep your main scene scripts clean in one primary language. Add extra languages by listing `locales` in `video.config.js` and adding `locales/<lang>.js` with `V.locale()`. Use `npx html-video build demo --lang en` to generate separate localized audio/subtitles, and switch live via `?lang=en` or the player audio menu. See [i18n.md](skills/html-video/references/i18n.md) (ZH) for details.

### 4. Theme & Player Customization
- **Player behavior**: Configure `V.config.ui` or `V.themeDefaults.ui` for control bar behavior (defaults to `controlsMode: 'overlay'`), playback `rates`, `iconPreset` (`'default' | 'pixel'`), and storage options (`persist`, `resume`). Control stems programmatically with `V.setBgm()`, `V.setVoice()`, `V.setMuted()`, and `V.clearSavedState()`.
- **CSS theme variables**: Base selectors use low specificity, so overriding `:root` variables in `style.css` restyles the entire player:
  - Viewport & stage: `--viewport-bg`, `--stage-shadow`, `--stage-bg-image`, `--font-sans`, `--font-smoothing`, `--gl-rendering`
  - Top segment HUD (`#hud`): `--hud-left/right/top/h`, `--hud-track-h/radius/bg`, `--hud-bar-bg`, `--hud-tick-w/bg`
  - Subtitles (`#subs`): `--sub-bottom`, `--sub-z`, `--sub-radius`, `--sub-bg/fg/border/border-w`, `--sub-size`
  - Control bar & menus: `--ctrl-h`, `--ctrl-font/font-size`, `--ctrl-radius`, `--ctrl-btn-w/h`, `--ctrl-icon-btn-w`, `--ctrl-time-w`, `--ctrl-chap-w`, `--ctrl-track-h/radius/bg`, `--ctrl-fill-bg`, `--ctrl-mark-w/h/bg`, `--ctrl-thumb-w/h/radius/border`, `--ctrl-menu-bg/border/radius/shadow`

---

## Documentation & Agent Skill Discovery

All manuals and engineering specifications are bundled inside `node_modules/html-video-base/`:

- `npx html-video docs --en`: Print local paths to the English/Chinese manuals, Agent Skill, and quick-start commands.
- `npx html-video skill`: Export [SKILL.md](skills/html-video/SKILL.md) to `.agents/skills/html-video/` so teammates and AI coding agents (Cursor, Claude Code, Codex, Antigravity, etc.) follow the exact framework conventions.

---

## CLI Reference

| Command | Description |
| :--- | :--- |
| `html-video init <id> [--title "..."] [--aspect 16:9\|9:16\|1:1] [--skill]` | Scaffold a new video directory (`--skill` exports Agent Skill) |
| `html-video skill [--out .agents/skills/html-video]` | Export built-in `SKILL.md` authoring specification |
| `html-video docs [--en]` | Print installed documentation paths and quick-start commands |
| `html-video serve [port] [host] [--no-watch]` | Start preview server with virtual `/base/*`, 206 Range, and SSE live reload |
| `html-video build [id] [--lang en] [--provider ...] [--bitrate 128k] [--mix-only] [--visual]` | Synthesize TTS, word timestamps, dual stems, and subtitles |
| `html-video mix [id] [--lang en] [--bitrate 128k] [--visual]` | Remix BGM/SFX offline from cached dry voice stems |
| `html-video verify [id ...] [--stamp-baked] [--visual] [--strict]` | Verify word anchors, subtitles, and audio-visual sync |
| `html-video audit [id ...] [--strict] [--screenshots <dir>]` | Headless Chromium check for layout, images, and `f(t)` idempotency |
| `html-video storyboard [id] [out.html] [--per-cue] [--pdf]` | Export single-file visual storyboard review sheet |
| `html-video render [id] [out.mp4] [--workers N] [--scene K] [--range a:b] [--no-bgm] [--no-cache]` | Render 1080p MP4 with incremental scene caching |
| `html-video bundle [id ... \| --single \| --all] [--out dist]` | Bundle standalone static site without `node_modules` |
| `html-video manifest` | Scan `videos/` and sync `videos/manifest.js` |

## Quality Gates (Repo Development)

All JS/MJS and Python functions in this repository enforce cyclomatic complexity `< 15` (`<= 14`):

```bash
npm run lint:cc
npm test
```
