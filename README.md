# html-video-base

**简体中文** | [English](https://github.com/huyusong10/html-video-base/blob/main/README.en.md)

用网页技术（HTML / CSS / JS）编写视频的通用底座与渲染工具链。

它把视频变成一套可交互的网页：既能直接在浏览器里播放、点击和拖拽进度条，也能一键合成配音字幕并导出高清 MP4。业务仓库只需安装这一个 npm 包，就能共用播放器运行时、配音管线和打包工具，不用在每个项目里重复维护一套引擎代码。

视频首页和目录由业务项目自行维护。预览服务直接读取项目文件；多视频打包会原样复制 `videos/` 根目录下的文件，没有项目首页时按视频路径访问。

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

   导出会保留按幕缓存，把未命中的长幕拆成临时小段并行渲染，完成后无损合并为每幕的一份缓存。默认按可用逻辑 CPU 数量分配并发（最多 8 个任务），并为每个任务分配 JPEG 解码与 H.264 编码线程。`--workers N` 或 `WORKERS=N` 可指定并发数，实际数量受 CPU 预算和待渲染任务数限制。

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

配音缓冲或当前受管画面尚未初始化完成时，叙事时间等待，页面显示准备提示；呼吸、眨眼和指针响应继续更新。配音或画面加载失败时显示重试入口。拖动进度条时暂停音轨，松手后从预览位置恢复。暂停动画保持开启，重复的样式、SVG 属性与控制栏文字只在值变化时写入。

播放器面向桌面浏览器。键盘焦点停留在控制栏内时，控制栏保持显示。

导出时，短片段会减少自动 worker 数，避免重复启动浏览器页面。三维资源较重的视频可设置 `render: { maxAutoWorkers: 2 }` 限制自动并发；命令行 `--workers N` 和环境变量 `WORKERS` 仍可指定并发。渲染缓存包含入口 HTML 引用的本地脚本和样式文件。
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

### 4. 默认配置与播放器定制

`V.getCfg()` 依次读取工程 `V.projectDefaults`、主题 `V.themeDefaults`、单片 `V.config` 和语言覆写。全都未填写时，框架使用自己的默认值。工程与主题脚本放在 `video.config.js` 前加载，浏览器和构建工具会读取同一份。未填写的字段继承上层；`ui`、`tts`、`bgm` 和 `sfx` 对象允许只改其中一个字段，数组整体替换。`bgm: false` 和 `tts: false` 可分别关闭配乐和配音。

发音写在 `tts.pronunciation`，例如 `{ 'Win+L': 'Win 加 L', AI: 'A I' }`。词表按词覆盖，同一个词填 `false` 时保留原写法。框架按字面匹配，长词优先，每处只替换一次。`tts.polyphoneFix: false` 只关闭通用多音词。发音词表不修改字幕。原有顶层 `pronunciation` 字段仍可读取。

一句话内需要换个断句时，可在该条台词写 `{ text: '发现异常后执行命令。', speechText: '发现异常后，执行命令。' }`。只允许调整中文句读标点，不能拆开数字、缩写或发音词条。框架先断句，再应用词表；字幕继续显示 `text`。两句之间的留白由 `gap + pause` 决定。只改句间间隔可用 `mix`；改了朗读输入则用 `build`，校验会检查是否仍在使用旧配音。已有配音没有输入记录时，不要求为未调整的旧片重建。

在单片配置中设置 `pauseReport: true`，`build`、`mix` 和 `verify` 会在 `.runtime/reports/<视频 ID>/pauses.md` 输出报告（其他语言有独立文件）。句间按时间轴计算；句内按已有语音强度估算，缺数据标为「未测」。报告不影响混音、字幕或静态包。
- **播放器行为**：通过 `V.config.ui` 或 `V.themeDefaults.ui` 调整控制栏隐显模式（默认 `overlay` 悬停自动显隐）、倍速档位 `rates`、图标风格 `iconPreset`（`'default' | 'pixel'`），以及音轨/断点偏好记忆（`persist` / `resume`）；也支持代码控制音轨：`V.setBgm()`、`V.setVoice()`、`V.setMuted()`、`V.clearSavedState()`。需要返回项目页面时，在 `V.config.homeUrl` 中填写地址；未配置时不显示返回按钮。
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

普通播放时，点击字幕图标打开字幕设置，可以开关字幕、选择大中小字号，以及切换靠左或居中对齐。默认使用中号、靠左。小号沿用课程原有字号，播放器会按课程记住选择。

### 按需启用加载界面

在课程入口 `index.html` 的 `<body>` 开头加上 `<script src="../base/js/loading.js"></script>`。将外部样式表和播放器脚本放在它后面，再按原有方式调用 `V.boot()`。加载页显示静态的「正在加载…」，等起播画面、音频和课程登记的启动资源准备好后再显示播放器。启动失败时可在加载页重试。播放缓冲和 PPT 翻页等待也使用这条提示。录制和截图模式会自动隐藏加载界面。

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
| `html-video pptx <id> [out.pptx \| --publish] [--mode image\|editable] [--pages 1,3-5] [--lang en]` | 按 PPT 页序导出图片版或混合可编辑版，并写入演讲者备注 |
| `html-video render [id] [out.mp4] [--workers N] [--scene K] [--range a:b] [--no-bgm] [--no-cache]` | 按幕缓存增量导出高清 MP4 |
| `html-video bundle [id ... \| --single \| --all] [--out dist]` | 打包免 `node_modules` 的纯静态站点 |

课程启用 `ppt: true` 后可导出 PPTX。默认导出全部 PPT 页的图片版，`--pages` 按网页 PPT 模式的页码选页，`--mode editable` 导出混合可编辑版。两版使用相同的页序和演讲者备注。

混合版转换课程显式标记的元素，其他画面保留为背景截图。

- `data-pptx-native="text"` 导出单行文本。
- `data-pptx-native="svg"` 将 SVG 中受支持的矩形、线条、圆和单行文本导为原生对象。渐变、复杂变换和标记了 `data-pptx-raster` 的元素保留在截图里。
- `data-pptx-native="chart"` 结合 `data-pptx-chart` 导出原生折线图。数据含 `labels`、`axes` 和 `series`。坐标轴用 `min`、`max`、`step` 和 `unit` 定义。数列用 `name`、六位十六进制 `color` 和对应标签的 `values` 定义，`null` 表示空缺，`axis: 1` 使用第二条数值轴。

先执行 `html-video pptx <id> --publish` 发布图片版，再用 `--mode editable --publish` 发布混合版。PPT 模式的工具栏会显示已发布的下载选项。执行 `html-video bundle` 可把两版随静态站点一起发布。

## 工程门禁（本仓开发）

按改动影响范围选择测试级别：

| 命令 | 使用场景 | 检查范围 |
| :--- | :--- | :--- |
| `npm test` | 日常小改后的基本检查 | 引擎组装、圈复杂度、参数与路径、时间轴与字幕、缓存标识，以及初始化／预览服务／静态打包 |
| `npm run test:full` | 核心行为修改、较大重构、发布前 | 包含全部轻量检查，再验证 Chromium 交互与帧复用、音频处理、真实视频导出及失败恢复 |

按改动范围选择检查：文档和文案检查内容与链接；代码先运行轻量检查，再选择受影响接口或代表性分镜的回归。跨模块修改或发布前运行完整回归。全量视频截图与逐帧巡检由调用者明确选择。

轻量测试需要 Node.js 和基础 Python 环境；全量测试还需要工具链使用的 Python 音频依赖、FFmpeg 和 Chromium。每次测试使用独立临时目录，结束后自动清理。

修复具体问题时，可以在轻量检查之外单独运行对应的回归文件。以下命令只检查渲染缓存标识，最后一个参数应为新的临时目录：

```bash
node tools/test-render-cache-identity.mjs .runtime/cache-check-1
```

本仓库要求所有 JS/MJS 与 Python 函数的圈复杂度 `< 15`（`<= 14`）。两级测试都包含该检查，也可以单独运行 `npm run lint:cc`。

帧状态、外部画面准备与自定义巡检见 [接入指南](skills/html-video/references/frame-interfaces.md)。

公共实现包括 [受管外部画面](skills/html-video/references/external-sources.md)、[交互与可替换渲染器的角色组件](skills/html-video/references/components.md) 和 [内容读取与采样巡检](skills/html-video/references/content-and-audit.md)。角色渲染器可使用 SVG、Canvas 或 3D 引擎，平台统一编排和异步画面等待，不依赖具体骨骼或模型格式。多课程和共享资源仍由业务组织。
