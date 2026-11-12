# html-video-base

纯函数时间轴（`f(t)`）HTML 视频微内核框架与多模型 TTS 渲染管线。消费方项目通过 `package.json` 依赖本包，无需在业务仓维护 `videos/base/` 与构建脚本。

## 安装与接入

```json
{
  "private": true,
  "scripts": {
    "init": "html-video init",
    "serve": "html-video serve",
    "build": "html-video build",
    "verify": "html-video verify",
    "audit": "html-video audit",
    "storyboard": "html-video storyboard",
    "render": "html-video render",
    "bundle": "html-video bundle"
  },
  "dependencies": {
    "html-video-base": "github:huyusong10/html-video-base"
  }
}
```

首次安装音频合成依赖（Python 3.10+）：

```powershell
python -m venv .runtime/venv
.runtime/venv/Scripts/pip install -r node_modules/html-video-base/requirements.txt
```

## CLI 命令

| 命令 | 用途 |
| :--- | :--- |
| `html-video init <id> [--title "..."] [--aspect 16:9\|9:16\|1:1]` | 初始化新视频骨架 |
| `html-video serve [port] [host] [--no-watch]` | 启动虚拟 `/base/*` 路由 + 206 Range 寻道 + SSE 帧保位热更新服务 |
| `html-video build [id] [--lang en] [--provider ...] [--voice ...] [--visual]` | 合成 TTS 语音、30Hz 包络、声学词对齐、混音、`.vtt`/`.srt` 字幕并固化时间轴 |
| `html-video verify [id ...] [--stamp-baked] [--visual] [--strict]` | 语义词锚门禁 + 五维音画同步校验 |
| `html-video audit [id ...] [--strict]` | 无头 Chromium 巡检 404/破损图/禁用无限动画/`f(t)` 拖拽幂等/溢出遮挡 |
| `html-video storyboard [id] [out.html] [--per-cue] [--pdf]` | 导出单文件图文分镜审阅单（可选 PDF） |
| `html-video render [id] [out.mp4] [--workers N] [--scene K] [--range a:b] [--no-cache]` | 按幕 SHA-256 增量缓存 + 多进程并行导出高清 MP4 |
| `html-video bundle [id ... \| --all] [--out dist]` | 将虚拟 `/base/*` 与视频资源打包为免 `node_modules` 的纯静态站点 |

## 微内核开放扩展 API

| API | 说明 |
| :--- | :--- |
| `V.use(plugin)` | 注册生命周期插件（`boot` / `layout` / `tick` / `seek` / `play` / `pause` / `sceneChange`） |
| `V.transition(name, (prev, curr, k, sc) => {})` | 注册自定义跨幕转场（内置 `none` / `fade` / `slide` / `wipe` / `tiles`） |
| `V.control({ id, label, title, onClick })` | 向底部控制栏扩展槽注入自定义交互按钮 |
| `V.preset(name, factory)` | 注册可复用视觉原语（挂载于 `V.c[name]`） |
| `V.layer({ id, prop, zIndex, defaultState, create, update })` | 注册跨幕持久角色/挂件层；`update(st, info)` 实时接收 30Hz 语音能量 `info.energy`（`0..1`）驱动真实口型 |
| `V.locale(lang, { title, scenes: { [id]: { title, lines, anchors } } })` | 注册多语种台词与 `x.at()` 语义词锚映射（`?lang=en` / `--lang en`） |
| `V.u.videoClip(src, opts)` + `V.u.syncVideoClip(el, t)` | 受控内嵌 `<video>` 录屏：Web 播放同步、`seekToAsync` 精确锁帧、`mix.py` 原声混音 |
| `scene.checkpoints` | Web 交互驻点暂停与分支问答（`?record=1` 导出模式自动直通） |
| `V.config.ui` / `V.themeDefaults.ui` | 定制播放器模式（`controlsMode: 'docked' \| 'overlay'`）、章节分段刻度（`chapterMarks`）、倍速档位（`rates`）与全屏图标（`icons`） |

## 主题与控制栏 CSS 变量槽位

项目侧通过覆盖 `:root` 变量即可完整切换像素风、建筑编辑风或现代科技风（底座选择器均采用低权重类 / `:where()`，不抢业务权重）：

- **视口与舞台**：`--viewport-bg`、`--stage-shadow`、`--stage-bg-image`、`--font-sans`、`--font-smoothing`、`--gl-rendering`
- **顶栏分段 `#hud`**：`--hud-left/right/top/h`、`--hud-track-h/radius/bg`、`--hud-bar-bg`、`--hud-tick-w/bg`
- **字幕胶囊 `#subs`**：`--sub-bottom`、`--sub-z`、`--sub-radius`、`--sub-bg/fg/border/border-w`、`--sub-size`
- **底部控制栏与上拉菜单**：`--ctrl-h`、`--ctrl-font/font-size`、`--ctrl-radius`、`--ctrl-btn-w/h`、`--ctrl-time-w`、`--ctrl-chap-w`、`--ctrl-track-h/radius/bg`、`--ctrl-fill-bg`、`--ctrl-mark-w/h/bg`、`--ctrl-thumb-w/h/radius/border`、`--ctrl-menu-bg/border/radius/shadow`

## 工程门禁

全库所有 JS/MJS 与 Python 函数强制圈复杂度 `< 15`（`<= 14`）：

```powershell
npm run lint:cc
npm test
```
