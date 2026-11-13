---
name: html-video
description: 基于 html-video-base 编写、定制主题、校验音画同步、巡检版面与导出 MP4 / 静态包的工程规范。在新建或修改 HTML 交互视频时读取本文件。
---

# html-video-base 创作与工程规范

## 1. 标准工程结构

预览与打包服务默认以 `videos/` 为根目录，严禁拷贝引擎源码到本地 `videos/base/`，统一通过虚拟路由 `../base/*` 引用底座：

```text
project-root/
├── package.json                  # 依赖 html-video-base，声明 serve/build/verify/audit/render/bundle 脚本
└── videos/
    ├── assets/                   # 跨视频共享资产（字体、Logo、吉祥物，视频内用 ../assets/... 访问）
    └── <video-id>/
        ├── index.html            # 挂载 ../base/css/base.css、style.css、timings.js、../base/js/engine.js 与分镜脚本
        ├── video.config.js       # 标题、节奏、TTS、控制栏与字幕插槽配置
        ├── style.css             # 主题 CSS 变量覆盖与分镜样式
        ├── assets/
        │   ├── soundtrack.m4a    # build 自动生成的解说与动作音效主轨
        │   ├── bgm.m4a           # build 自动生成的独立带闪避背景音乐轨（可独立开关）
        │   └── voice/timings.js  # build 自动生成的词级时间戳、30Hz 包络与固化布局
        └── js/
            └── scenes.js         # V.scene(...) 分镜定义
```

## 2. CLI 工具链

| 命令 | 用途 |
| :--- | :--- |
| `npx html-video init <id> [--title "..."] [--skill]` | 初始化标准视频目录（`--skill` 同步导出本规范至 `.agents/skills/html-video/`） |
| `npx html-video serve [port]` | 启动带 `206 Range` 与 SSE 保位热重载的本地预览服务 |
| `npx html-video build <id> [--bitrate 128k] [--mix-only]` | 合成 TTS（单句 SHA-256 缓存）、分离导出 `soundtrack.m4a`（解说+SFX）与 `bgm.m4a`（配乐）并写入 `bakedLayout` |
| `npx html-video mix <id> [--bitrate 128k]` | 台词未改时免联网快速重混：直接复用缓存干声或从现有 `soundtrack.m4a` 切片，秒级重混 `bgm`/`sfx`/停顿间隔 |
| `npx html-video verify [id] [--stamp-baked]` | 校验语义词锚、字幕分段与物理双音轨时长零漂移 |
| `npx html-video audit [id] [--screenshots .runtime/audit]` | 无头浏览器巡检破损图、越界、字幕遮挡、兄弟卡片压盖、小字号与 `f(t)` 幂等性 |
| `npx html-video render <id> [out.mp4] [--scene K] [--no-bgm]` | 按幕增量缓存 + 静止帧复用导出 1080p MP4（`--no-bgm` 可导出纯解说无配乐版） |
| `npx html-video bundle <id> --single --out dist` | 打包免依赖静态目录（`--all` 可带多视频索引门户一起打包） |

## 3. 纯函数分镜与时间轴契约

1. **纯函数 `f(t)` 约束**：`update(t, x)` 必须仅由入参时间 `t` 决定 DOM/SVG 状态。严禁使用 `setTimeout`、`setInterval`、自建 `requestAnimationFrame` 或跨帧累加变量；CSS `@keyframes` 在 `?record=1` 录制态下会自动按 `--anim-t` 锁定相位。
2. **语义词锚与多段插值**：视觉动作一律用 `x.at(lineIdx, '关键词', offset)` 或 `x.cue(lineIdx)` 对齐口播重音，禁止硬编码拍脑袋秒数；角色走位、多段运镜或连续状态切换优先用 `V.u.keyframes(t, [{ at: 0, x: 960, pose: 'wave' }, { at: x.at(0, '核心'), x: 420, dur: 0.5, pose: 'point' }])`，避免手写多层 `lerp` 嵌套。
3. **双时钟暂停呼吸与舞台交互指针场**：
   - **暂停态不死板（`ui.livePause: true` 默认开启）**：暂停时叙事时间轴 `t` 严格冻结，环境时钟 `x.alive` / `x.clock`（在 `V.layer` / `V.subtitle` / `onRender` 中同为 `info.alive`）连续递增且恢复播放零回跳；角色呼吸、眨眼、粒子微动统一读取 `x.alive`，叙事卡点统一读取 `t`。需要终章播完后继续推进尾幕时间或保持可点交互时，在 `V.config` 设 `interactiveEnd: true` 并在尾幕设 `live: true`。
   - **舞台归一化指针（`V.pointer` / `x.pointer`）与交互元素（`V.u.interactive`）**：框架自动将鼠标逆向映射到 `1920×1080` 舞台坐标（暴露 `x/y`、`-1..1` 归一化 `nx/ny`、带阻尼回中 `sx/sy` 与在场权重 `presence`，并在 `#stage` 注入 `--ptr-x/--ptr-y/--ptr-px/--ptr-py/--ptr-presence`），可零样板实现鼠标跟随视差、聚光灯与吉祥物眼神追踪；画布内可点击卡片/Tab/按钮统一用 `V.u.interactive(el, fnOrEventMap)` 包装，自动开启 `pointer-events` 并阻止点击误触发播放器暂停/播放。`?record=1` 导出态自动归零指针并锁定 `alive === t`，确保逐帧导出 100% 幂等。
4. **彩蛋沙盒试玩**：调用 `V.tryEgg(targetTime, '操作提示')` 跳入任意幕试玩并自动悬浮返回条，用户点返回或按 `Esc` 调 `V.exitSandbox()` 回到终章。

```js
V.scene({
  id: 'intro',
  title: '核心机制',
  live: false,
  lines: ['先用 HTML 对齐交互逻辑，定稿后再归档成结构化文档。'],
  build(root, x) {
    this.card = V.u.h('div', { class: 'hero-card' }, 'HTML 原型先行');
    root.append(this.card);
  },
  update(t, x) {
    const k = V.u.appear(t, x.at(0, '对齐', -0.1), 0.35);
    V.u.pop(this.card, k);
  },
});
```

## 4. 字幕、控制栏与图标定制契约

- **字幕伴随插槽与避让**：通过 `V.subtitle({ lead: (h, V) => el, tail, position, modes, onUpdate(cue, info, dom) })` 挂载前置吉祥物或角标；单幕可设 `subLayout: 'left' | { pos: 'center', offsetX: 56, maxWidth: 1520 }` 动态避让角色。
- **PotPlayer 式悬浮控制栏与配置项（`V.config.ui`）**：
  - `controlsMode: 'overlay' | 'docked'`（默认为 `'overlay'`：鼠标移入视频或在画面内移动立即唤醒底栏，在画面上静止 `idleHideDelay: 1500` 毫秒自动隐退，移出视频窗口 `leaveHideDelay: 220` 毫秒速隐，悬停底栏时保持常亮，全屏静止同步隐鼠；悬停进度条实时跟随 `.track-tip` 预览章节与时间；按键盘快进/静音/切章仅在右上角闪出 `#osd` 胶囊，不弹底栏顶跳字幕）
  - `persist: true`（默认仅按路径记忆倍速、字幕、双音轨开关等观看偏好）、`resume: false`（断点续播默认关闭，刷新默认从头播放；长时培训课程可显式设 `resume: true`，超过 `resumeMinSec: 5` 秒刷新自动续播）、`livePause: true`、`osd: true`、`chapterMarks: true`、`hud: true`、`rate: true`、`webFull: true`、`iconPreset: 'default' | 'pixel'`
- **全图标控制栏与业务图标覆盖规范**：
  - 控制栏左右按钮默认统一使用 `32×30` 紧凑矢量图标（返回主界面 `home`、播放/暂停/重播 `play`/`pause`/`replay`、章节箭头 `chapCaret`、倍速 `rate` 在 `1.0x` 显示仪表图标并在非 `1.0x` 动态切换为紧凑数字、字幕 `subsOn`/`subsOff`、声音多态 `volumeOn`/`volumeVoice`/`volumeBgm`/`volumeMute`、全屏 `webEnter`/`webExit`/`fullEnter`/`fullExit`）。
  - **业务新增按钮建议一律用图标**：调用 `V.control({ id: 'xray', position: 'right', title: 'X-Ray 透视', icon: ['M...'], onClick(e, V) {} })`，不要塞多字中文撑宽工具栏。
  - **覆盖默认图标**：可通过 `V.icons({ play: '...', subsOn: '...' })` 或 `V.config.ui.icons` 按需覆盖任意内置键名；像素风主题可直接设 `ui: { iconPreset: 'pixel' }` 并加 `--ctrl-ico-render: crispEdges`。图标值支持 `16×16` `<path d>` 数组、内联 SVG 字符串、完整 `<svg>` 字符串或 `(h, V) => Node` 渲染函数。
- **内置检索、深链与双音轨独立控制**：按 `/` 或 `Ctrl+K` 全文检索台词与章节跳转；点击时间码复制当前 `?t=` 深链；点击声音图标上拉菜单或按 `B` 键可独立开关 BGM（`V.setBgm(on)` / `V.setVoice(on)`，按 `M` 全部静音）。

## 5. 核心 CSS 主题变量表

在视频自身的 `style.css` `:root` 中覆盖以下变量即可换肤，无需重写控制栏结构：

| 变量分组 | 关键变量名 |
| :--- | :--- |
| 画布与字体 | `--bg`、`--viewport-bg`、`--surface`、`--ink`、`--muted`、`--accent`、`--font-sans`、`--font-smoothing`、`--stage-bg-image` |
| 顶栏进度 `#hud` | `--hud-left`、`--hud-right`、`--hud-top`、`--hud-track-h`、`--hud-track-bg`、`--hud-bar-bg`、`--hud-tick-w` |
| 胶囊字幕 `#subs` | `--sub-bottom`、`--sub-bg`、`--sub-fg`、`--sub-border`、`--sub-size`、`--sub-radius`、`--sub-padding`、`--sub-gap`、`--sub-max-w` |
| 播放控制栏 `#controls` | `--ctrl-h`、`--ctrl-bg`、`--ctrl-fg`、`--ctrl-font`、`--ctrl-radius`、`--ctrl-btn-w`、`--ctrl-btn-h`、`--ctrl-track-h`、`--ctrl-fill-bg`、`--ctrl-thumb-w`、`--ctrl-thumb-radius`、`--ctrl-menu-bg` |

## 6. 画面排版硬约束（防 PPT 化）

- **单帧单焦点**：同屏并列独立模块 `<= 3` 个，严禁九宫格卡片墙与大段朗读稿上屏；讲到当前项时用 `V.u.spotlight(els, idx)` 聚光，非当前项降权。
- **远视字阶下限**：`1920×1080` 画布正文字号 `>= 22px`，最小标签/角标 `>= 18px`（仿真第三方软件界面可设 `data-allow-small-font="1"` 豁免）。
- **交付前必跑巡检**：执行 `npx html-video verify` 与 `npx html-video audit --screenshots .runtime/audit`，若生成告警截图需逐张目视核查后再交付。
