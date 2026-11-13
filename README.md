# html-video-base

**简体中文** | [English](https://github.com/huyusong10/html-video-base/blob/main/README.en.md)

用网页技术（HTML / CSS / JS）编写视频的通用底座与渲染工具链。

它把视频变成一套可交互的网页：既能直接在浏览器里播放、点击和拖拽进度条，也能一键合成配音字幕并导出高清 MP4。业务仓库只需安装这一个 npm 包，就能共用播放器运行时、配音管线和打包工具，不用在每个项目里重复维护一套引擎代码。

---

## 为什么这样设计

传统视频剪辑工具很难和代码版本管理、动态数据或网页交互结合；而普通网页动画在录制导出时又常常出现进度不准、音画错位。`html-video-base` 通过三个核心机制解决这些问题：

1. **画面是时间的纯函数**：每一帧怎么画，只由当前时间 `t` 决定（`update(t, x)`）。因此进度条可以任意拖拽、倍速切换，逐帧导出 MP4 也不会漂移。
2. **动画跟着台词走**：不用死算“第几秒出现哪个元素”，直接用 `x.at(0, '关键词')` 绑定台词里的重音词。之后改文案或调语速，动画卡点会自动重新对齐。
3. **运行时与业务分离**：业务目录只放分镜脚本、样式和媒体素材，底层播放器通过 `/base/*` 虚拟路由按需加载，需要独立发布时再一键打包成纯静态站点。

---

## 快速上手：从零做出第一支视频

### 第 1 步：安装

在你的项目目录执行：

```bash
npm init -y
npm install html-video-base
```

> **环境说明**：如果只是**播放或静态打包已有成品视频**（运行 `serve` / `bundle`），只需要 Node.js（20+）；如果要**合成配音或导出 MP4**（运行 `build` / `mix` / `verify` / `render`），再按需安装下文的 Python 与 FFmpeg 环境。

### 第 2 步：初始化并预览草稿

```bash
# 创建一个名为 demo 的视频骨架，并导出 AI 创作规范
npx html-video init demo --title "产品介绍" --skill

# 启动本地热更新预览（默认 http://localhost:8765/）
npx html-video serve
```

打开 `http://localhost:8765/demo/?dev=1`，就能立刻看到效果。**还没生成配音前也可以直接预览**，框架会自动按台词字数估算时长。

初始化后，你的视频目录非常轻量，只包含 4 个核心文件：

```text
videos/demo/
├── index.html       # 页面入口（自动挂载运行时与脚本）
├── video.config.js  # 画幅、配音音色、BGM、转场等全局配置
├── style.css        # 分镜样式与主题变量覆盖
└── js/scenes.js     # 分镜台词与画面更新逻辑
```

### 第 3 步：编写分镜脚本

在 `videos/demo/js/scenes.js` 中，每一幕只需定义台词（`lines`）、搭建节点（`build`）和按时间更新画面（`update`）：

```js
const { h, appear, pop } = V.u;

V.scenes.push({
  title: '核心亮点',
  lines: [
    '欢迎使用 html-video-base，只需要声明台词和动画卡点，就能直接预览和导出成片。',
  ],
  build(root) {
    this.card = h('div', { class: 'hero-card' }, '所见即所得');
    root.append(this.card);
  },
  update(t, x) {
    // 读到“动画卡点”前 0.1 秒触发卡片弹出，无需手算秒数
    pop(this.card, appear(t, x.at(0, '动画卡点', -0.1), 0.35));
  },
});
```

### 第 4 步：配音、检查与交付

当你写完分镜、准备出片时，按下面顺序执行即可：

1. **准备音频与渲染依赖（首次使用）**：

   ```bash
   # macOS / Linux
   python3 -m venv .runtime/venv
   .runtime/venv/bin/pip install -r node_modules/html-video-base/requirements.txt

   # Windows PowerShell
   python -m venv .runtime/venv
   .runtime/venv/Scripts/pip install -r node_modules/html-video-base/requirements.txt
   ```

2. **合成语音与字幕**：

   ```bash
   npx html-video build demo
   ```

   命令会自动调用 TTS 合成语音、提取 30Hz 语音包络（可用于驱动角色口型）、生成 `.vtt`/`.srt` 字幕，并分离输出人声主轨 `soundtrack.m4a` 与自动闪避的背景音乐轨 `bgm.m4a`。

   > **小技巧**：如果只调整了背景音乐、音效或停顿时长，台词原文没变，运行 `npx html-video mix demo` 即可离线秒级重混，不用重新请求 TTS。

3. **同步校验与版面巡检**：

   ```bash
   npx html-video verify demo   # 校验词锚、字幕与音画时长同步
   npx html-video audit demo    # 用无头 Chromium 检查破损图、越界、遮挡与字号
   ```

4. **交付成片（二选一或同时输出）**：

   ```bash
   # 方式 A：导出高清 MP4（支持增量缓存与多进程并行）
   npx html-video render demo

   # 方式 B：打包为纯静态网页（不依赖 node_modules，可直接部署到任意静态服务器）
   npx html-video bundle --all --out dist
   ```

---

## 在项目里配置常用脚本

为了日常敲命令更顺手，推荐在业务仓的 `package.json` 里加上脚本映射：

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

## 进阶能力：按需解锁

跑通基础流程后，如果视频需要更丰富的视觉表现、交互体验或跨语言版本，可以按下面分类查阅：

### 1. 交互与双时钟呼吸感
- **暂停时动画不停**：默认开启 `ui.livePause: true`。暂停或播完停留时，叙事时间 `t` 冻结，但环境时钟 `x.alive` / `x.clock` 会继续推进，恢复播放时也不会跳帧。角色眨眼、呼吸、粒子漂浮读取 `x.alive` 即可；录制 MP4（`?record=1`）时会自动锁定 `alive === t`，保证导出幂等。
- **鼠标跟随与可点击元素**：`x.pointer` 自动把鼠标坐标换算到舞台坐标系（消除缩放、黑边与全屏偏移），适合做视差或眼神追踪；需要响应点击的卡片或按钮用 `V.u.interactive(el, handlers)` 包一层，点击时既能触发 `V.sfx()` 微音效，又不会误触暂停播放。
- **交互驻点与彩蛋试玩**：长视频可在幕配置 `scene.checkpoints` 做互动停顿或分支问答；结尾可通过 `V.tryEgg(sec, hint)`、`V.enterSandbox()` / `V.exitSandbox()` 跳转到任意幕试玩并返回。

### 2. 跨幕角色、转场与字幕排布
- **持久角色层（`V.layer`）**：用于跨幕不闪烁的吉祥物或悬浮挂件，`update(st, info)` 会实时收到 `0..1` 的语音能量 `info.energy`，可直接驱动口型动画。
- **字幕避让与插槽（`V.subtitle` / `V.setSubLayout`）**：支持把字幕移到左/右/顶部或指定坐标来避开角色，并在字幕前后挂载 `.sub-lead` / `.sub-tail` 挂件。
- **多段关键帧（`V.u.keyframes`）**：在多时间点之间平滑过渡数值或切换离散状态，比手写多层 `lerp` 嵌套更清晰。
- **内嵌录屏同步（`V.u.videoClip` / `V.u.syncVideoClip`）**：把外部 `<video>` 录屏嵌入分镜，网页播放、逐帧截屏与 `mix.py` 原声混音自动对齐。
- **其他扩展接口**：`V.use(plugin)` 注册生命周期钩子、`V.transition()` 注册自定义转场、`V.preset()` 注册复用组件、`V.control()` / `V.icons()` / `V.makeIcon()` 扩展控制栏按钮与图标、`V.search()` / `V.openSearch()` / `V.getDeepLink()` 提供全文台词检索（`/` 或 `Ctrl+K`）与 `?t=` 时间码分享。

### 3. 多语言视频扩展
分镜代码本身保持单语种编写，需要外语版本时，在 `video.config.js` 声明 `locales`，再新增 `locales/en.js` 用 `V.locale()` 做外挂翻译即可。支持 `npx html-video build demo --lang en` 独立合成外语配音字幕，并在网页端通过 `?lang=en` 或声音菜单实时切换。详细写法见 [多语言扩展指南](skills/html-video/references/i18n.md)。

### 4. 主题与播放器外观定制
- **播放器行为**：通过 `V.config.ui` 或 `V.themeDefaults.ui` 调整控制栏隐显模式（默认 `overlay` 悬停自动显隐）、倍速档位 `rates`、图标风格 `iconPreset`（`'default' | 'pixel'`），以及音轨/断点偏好记忆（`persist` / `resume`）；也支持代码控制音轨：`V.setBgm()`、`V.setVoice()`、`V.setMuted()`、`V.clearSavedState()`。
- **CSS 变量槽位**：底层样式采用低权重选择器，业务 `style.css` 直接在 `:root` 覆盖变量即可换肤：
  - 视口与舞台：`--viewport-bg`、`--stage-shadow`、`--stage-bg-image`、`--font-sans`、`--font-smoothing`、`--gl-rendering`
  - 顶栏分段 `#hud`：`--hud-left/right/top/h`、`--hud-track-h/radius/bg`、`--hud-bar-bg`、`--hud-tick-w/bg`
  - 字幕胶囊 `#subs`：`--sub-bottom`、`--sub-z`、`--sub-radius`、`--sub-bg/fg/border/border-w`、`--sub-size`
  - 底部控制栏与菜单：`--ctrl-h`、`--ctrl-font/font-size`、`--ctrl-radius`、`--ctrl-btn-w/h`、`--ctrl-icon-btn-w`、`--ctrl-time-w`、`--ctrl-chap-w`、`--ctrl-track-h/radius/bg`、`--ctrl-fill-bg`、`--ctrl-mark-w/h/bg`、`--ctrl-thumb-w/h/radius/border`、`--ctrl-menu-bg/border/radius/shadow`

---

## 文档与 AI 协作入口

安装本包后，所有手册和创作规范都保存在本地 `node_modules/html-video-base/` 中，可以通过以下命令随时查看或导出：

- `npx html-video docs`：在终端打印本地中文/英文手册及规范文件路径（加 `--en` 输出英文提示）
- `npx html-video skill`：把完整工程规范 [SKILL.md](skills/html-video/SKILL.md) 导出到项目的 `.agents/skills/html-video/`，方便团队成员或 AI Coding Agent（Cursor / Claude Code / Codex / Antigravity 等）按统一约束编写分镜。

---

## CLI 命令速查

| 命令 | 说明 |
| :--- | :--- |
| `html-video init <id> [--title "..."] [--aspect 16:9\|9:16\|1:1] [--skill]` | 初始化新视频目录（加 `--skill` 同步导出规范） |
| `html-video skill [--out .agents/skills/html-video]` | 导出内置 `SKILL.md` 创作与工程规范 |
| `html-video docs [--en]` | 查看随包附带的文档路径与起步命令 |
| `html-video serve [port] [host] [--no-watch]` | 启动带虚拟 `/base/*`、Range 寻道与热更新的预览服务 |
| `html-video build [id] [--lang en] [--provider ...] [--bitrate 128k] [--mix-only] [--visual]` | 合成 TTS 语音、词级时间轴、双音轨与字幕 |
| `html-video mix [id] [--lang en] [--bitrate 128k] [--visual]` | 复用缓存干声快速重混配乐与音效 |
| `html-video verify [id ...] [--stamp-baked] [--visual] [--strict]` | 校验词锚、字幕与音画同步 |
| `html-video audit [id ...] [--strict] [--screenshots <dir>]` | 无头浏览器版面、图片与幂等性巡检 |
| `html-video storyboard [id] [out.html] [--per-cue] [--pdf]` | 导出图文分镜审阅单 |
| `html-video render [id] [out.mp4] [--workers N] [--scene K] [--range a:b] [--no-bgm] [--no-cache]` | 按幕缓存增量导出高清 MP4 |
| `html-video bundle [id ... \| --single \| --all] [--out dist]` | 打包免 `node_modules` 的纯静态站点 |
| `html-video manifest` | 扫描 `videos/` 并更新 `videos/manifest.js` |

## 工程门禁（本仓开发）

本仓库要求所有 JS/MJS 与 Python 函数的圈复杂度 `< 15`（`<= 14`）：

```bash
npm run lint:cc
npm test
```
