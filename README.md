# html-video-base

**简体中文** | [English](https://github.com/huyusong10/html-video-base/blob/main/README.en.md)

纯函数时间轴（`f(t)`）HTML 交互式视频微内核框架与多模型 TTS 渲染管线。业务项目只需在 `package.json` 中依赖本包，即可直接获得完整播放器运行时、字幕与双音轨混音管线、无头视觉巡检及 MP4 / 纯静态导出能力，无需在业务仓维护 `videos/base/` 与构建脚本。

## 核心特性

- **纯函数时间轴 `f(t)`**：画面状态完全由时间 `t` 决定，支持任意拖拽、倍速、幂等逐帧渲染。
- **语义词锚与双音轨混音**：支持多模型 TTS 配音、30Hz 语音能量包络提取、词级时间戳对齐，分离输出 `soundtrack.m4a`（解说 + 音效）与 `bgm.m4a`（自动闪避背景音乐）。
- **双时钟呼吸引擎**：暂停或播完驻留时叙事时间冻结，环境动画时钟 `x.alive` 持续流淌，支持鼠标交互、舞台指针场与实时微音效。
- **零侵入多语言扩展**：通过 `V.locale()` 与 `--lang` 外挂语种包，无需改写分镜源码。
- **一键打包与导出**：内置开发热更新服务（虚拟 `/base/*` + 206 Range + SSE）、无头 Chromium 版面巡检、增量缓存 MP4 导出及免 `node_modules` 纯静态打包。

---

## 快速开始

### 1. 安装依赖

```bash
npm install html-video-base
```

或在业务项目的 `package.json` 中声明依赖与常用脚本：

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

### 2. 初始化视频与文档规范

```bash
# 新建首个视频骨架，并导出完整创作规范到 .agents/skills/html-video/
npx html-video init demo --title "产品演示" --skill

# 启动本地预览（默认监听 http://localhost:8765/，支持热更新）
npx html-video serve
```

> 仅需**本地播放或静态部署已有成品视频**时，Node.js 环境即可直接运行 `serve` 与 `bundle`。

### 3. 安装音频合成与渲染环境（可选）

仅在需要**合成配音（`build`）、重混（`mix`）、音画校验（`verify`）或导出 MP4（`render`）**时，需准备 Python 3.10+ 与 FFmpeg：

- **macOS / Linux**：

  ```bash
  python3 -m venv .runtime/venv
  .runtime/venv/bin/pip install -r node_modules/html-video-base/requirements.txt
  ```

- **Windows PowerShell**：

  ```powershell
  python -m venv .runtime/venv
  .runtime/venv/Scripts/pip install -r node_modules/html-video-base/requirements.txt
  ```

---

## 文档与 AI 规范入口

安装 `html-video-base` 后，完整手册与工程规范已内置在包内，可通过以下方式随时查看或导出：

| 方式 | 说明 |
| :--- | :--- |
| `npx html-video docs` | 在终端查看本地手册、Skill 规范与多语言指南的绝对路径及常用命令（加 `--en` 输出英文） |
| `npx html-video --help` | 查看全部 CLI 子命令与参数说明 |
| `npx html-video skill` | 将内置完整创作规范导出至项目 `.agents/skills/html-video/`（供团队成员与 AI Coding Agent 直接读取） |
| [创作与工程规范（SKILL.md）](skills/html-video/SKILL.md) | 目录结构、纯函数 `f(t)` 契约、词锚对齐、角色层与视觉巡检细则 |
| [多语言扩展指南（i18n.md）](skills/html-video/references/i18n.md) | 外挂语种包 `V.locale()`、原文直映与多语种构建说明 |
| [English Manual（README.en.md）](README.en.md) | 英文版完整使用手册 |

---

## CLI 命令速查

| 命令 | 用途 |
| :--- | :--- |
| `html-video init <id> [--title "..."] [--aspect 16:9\|9:16\|1:1] [--skill]` | 初始化新视频骨架（`--skill` 同步导出 Agent 规范至 `.agents/skills/html-video/`） |
| `html-video skill [--out .agents/skills/html-video]` | 单独导出内置 `SKILL.md` 创作与主题规范 |
| `html-video docs [--en]` | 查看随包内置的中文/英文文档路径与快速上手提示 |
| `html-video serve [port] [host] [--no-watch]` | 启动虚拟 `/base/*` 路由 + 206 Range 寻道 + SSE 帧保位热更新服务 |
| `html-video build [id] [--lang en] [--provider ...] [--bitrate 128k] [--mix-only] [--visual]` | 合成 TTS 语音、30Hz 包络、声学词对齐，分离输出 `soundtrack.m4a`（解说+音效）与 `bgm.m4a`（带闪避配乐）、`.vtt`/`.srt` 字幕并固化时间轴 |
| `html-video mix [id] [--lang en] [--bitrate 128k] [--visual]` | 免联网极速混音：直接复用本地干声缓存或从现有 `soundtrack.m4a` 切片，重混 `bgm`/`sfx`/停顿节奏并固化时间轴 |
| `html-video verify [id ...] [--stamp-baked] [--visual] [--strict]` | 语义词锚门禁 + 五维音画与双音轨同步校验 |
| `html-video audit [id ...] [--strict] [--screenshots <dir>]` | 无头 Chromium 巡检破损图、越界、字幕遮挡、兄弟卡片压盖、最小字号、`f(t)` 幂等并自动落盘告警截图 |
| `html-video storyboard [id] [out.html] [--per-cue] [--pdf]` | 导出单文件图文分镜审阅单（可选 PDF） |
| `html-video render [id] [out.mp4] [--workers N] [--scene K] [--range a:b] [--no-bgm] [--no-cache]` | 按幕 SHA-256 增量缓存 + 静止帧自动复用 + 多进程并行导出高清 MP4（`--no-bgm` 可导出纯解说无配乐版） |
| `html-video bundle [id ... \| --single \| --all] [--out dist]` | 将虚拟 `/base/*` 与视频资源打包为免 `node_modules` 的纯静态站点（`--single` 生成单视频根目录） |
| `html-video manifest` | 扫描 `videos/` 目录并同步生成 `videos/manifest.js` |

---

## 微内核开放扩展 API

| API | 说明 |
| :--- | :--- |
| `V.use(plugin)` | 注册生命周期插件（`onBoot` / `onLayout` / `onRender` / `onSeek` / `onPlay` / `onPause` / `onSceneEnter` / `onEnded`，兼容短名 `boot` / `layout` / `tick` / `seek` / `play` / `pause` / `sceneChange` / `ended`） |
| `V.transition(name, { dur, mount(box, cfg), update(dom, near, dur, current, cfg) })` | 注册自定义跨幕转场（内置 `none` / `fade` / `slide` / `wipe` / `tiles`） |
| `V.control({ id, icon, title, onClick, sync })` | 向底部控制栏扩展槽注入自定义图标按钮（推荐传 `16×16` SVG 路径数组、SVG 字符串或渲染函数） |
| `V.icons(dict)` / `V.makeIcon(spec)` | 覆盖控制栏内置图标字典（`home` / `play` / `pause` / `replay` / `rate` / `subsOn` / `subsOff` / `volumeOn` / `volumeVoice` / `volumeBgm` / `volumeMute` / `webEnter` / `webExit` / `fullEnter` / `fullExit`）或生成同规格图标节点 |
| `V.preset(name, factory)` | 注册可复用视觉原语（挂载于 `V.c[name]`） |
| `V.layer({ id, prop, zIndex, defaultState, create, update })` | 注册跨幕持久角色/挂件层；`update(st, info)` 实时接收 30Hz 语音能量 `info.energy`（`0..1`）驱动真实口型 |
| `V.subtitle({ position, modes, lead, tail, onUpdate })` + `V.setSubLayout(spec)` | 定制字幕位置（`center`/`left`/`right`/`top` 或任意坐标避让吉祥物）、挂载前置/后置吉祥物与角标插槽（`.sub-lead` / `.sub-tail`），并支持按幕 `scene.subLayout` 或逐帧 `f(t)` 动态联动 |
| `V.locale(lang, { title, scenes: { [id]: { title, lines, anchors } } })` | 注册多语种台词与 `x.at()` 语义词锚映射（`?lang=en` / `--lang en`） |
| `V.u.keyframes(t, stops, opts)` | 多段纯函数关键帧插值：数值属性平滑过渡（默认 `smooth`），字符串/布尔状态按停靠点离散切换，避免手写多层 `lerp` 嵌套 |
| `V.pointer` / `x.pointer` + `V.u.interactive(el, handlers)` | 舞台归一化指针场（自动抵消 `scale` 缩放、黑边与全屏偏移，暴露 `x/y/nx/ny`、阻尼平滑 `sx/sy/presence` 及 `#stage` `--ptr-x/--ptr-y/--ptr-px/--ptr-py/--ptr-presence` 变量；`?record=1` 自动归零保证 `f(t)` 确定性）与免冒泡抢播的舞台交互元素绑定 |
| `x.alive` / `x.clock` + `ui.livePause` | 双时钟呼吸引擎：暂停或播完驻留时叙事时间轴 `t` 冻结，环境时钟 `x.alive` / `x.clock` 连续流淌（恢复播放零回跳，后台标签页自动休眠，`?record=1` 自动锁定 `alive === t`） |
| `V.u.videoClip(src, opts)` + `V.u.syncVideoClip(el, t)` | 受控内嵌 `<video>` 录屏：Web 播放同步、`seekToAsync` 精确锁帧、`mix.py` 原声混音 |
| `scene.checkpoints` | Web 交互驻点暂停与分支问答（`?record=1` 导出模式自动直通） |
| `V.tryEgg(targetSec, hint)` / `V.enterSandbox` / `V.exitSandbox` | 终章彩蛋与沙盒试玩跳转及悬浮返回条 |
| `V.search(query)` / `V.openSearch()` / `V.getDeepLink(t)` | 内置全文台词与章节检索跳转（快捷键 `/` 或 `Ctrl+K`）及时间码点击复制 `?t=` 深链 |
| `V.setBgm(on)` / `V.setVoice(on)` / `V.setMuted(on)` / `V.clearSavedState()` | 解说主轨与 BGM 伴奏轨独立开关（上拉菜单 / `B` 键开关配乐、`M` 键静音），以及偏好记忆与断点续播清理 |
| `V.config.ui` / `V.themeDefaults.ui` | 定制播放器模式（默认 `controlsMode: 'overlay'`：鼠标进入或移动于视频内即显控制栏、静止 `1.5s` 自动隐退、移出窗口 `0.22s` 速隐、全屏同步隐鼠；悬停进度条实时跟随 `.track-tip` 章节时间预览；键盘操作仅在右上角闪出 `#osd` 胶囊而不弹底栏顶跳字幕；`persist: true` 默认仅记忆倍速/字幕/音轨偏好，断点续播默认关闭，长视频可显式开启 `resume: true`）、图标预设（`iconPreset: 'default' \| 'pixel'`）与倍速档位（`rates`） |

---

## 主题与控制栏 CSS 变量槽位

项目侧通过覆盖 `:root` 变量即可完整切换像素风、建筑编辑风或现代科技风（底座选择器均采用低权重类 / `:where()`，不抢业务权重）：

- **视口与舞台**：`--viewport-bg`、`--stage-shadow`、`--stage-bg-image`、`--font-sans`、`--font-smoothing`、`--gl-rendering`
- **顶栏分段 `#hud`**：`--hud-left/right/top/h`、`--hud-track-h/radius/bg`、`--hud-bar-bg`、`--hud-tick-w/bg`
- **字幕胶囊 `#subs`**：`--sub-bottom`、`--sub-z`、`--sub-radius`、`--sub-bg/fg/border/border-w`、`--sub-size`
- **底部控制栏与上拉菜单**：`--ctrl-h`、`--ctrl-font/font-size`、`--ctrl-radius`、`--ctrl-btn-w/h`、`--ctrl-icon-btn-w`、`--ctrl-time-w`、`--ctrl-chap-w`、`--ctrl-track-h/radius/bg`、`--ctrl-fill-bg`、`--ctrl-mark-w/h/bg`、`--ctrl-thumb-w/h/radius/border`、`--ctrl-menu-bg/border/radius/shadow`

---

## 工程门禁

全库所有 JS/MJS 与 Python 函数强制圈复杂度 `< 15`（`<= 14`）：

```bash
npm run lint:cc
npm test
```
