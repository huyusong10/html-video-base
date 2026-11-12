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
| `npx html-video build <id> [--bitrate 128k]` | 合成 TTS（单句 SHA-256 缓存）、分离导出 `soundtrack.m4a`（解说+SFX）与 `bgm.m4a`（配乐）并写入 `bakedLayout` |
| `npx html-video verify [id] [--stamp-baked]` | 校验语义词锚、字幕分段与物理双音轨时长零漂移 |
| `npx html-video audit [id] [--screenshots .runtime/audit]` | 无头浏览器巡检破损图、越界、字幕遮挡、兄弟卡片压盖、小字号与 `f(t)` 幂等性 |
| `npx html-video render <id> [out.mp4] [--scene K] [--no-bgm]` | 按幕增量缓存 + 静止帧复用导出 1080p MP4（`--no-bgm` 可导出纯解说无配乐版） |
| `npx html-video bundle <id> --single --out dist` | 打包免依赖静态目录（`--all` 可带多视频索引门户一起打包） |

## 3. 纯函数分镜与时间轴契约

1. **纯函数 `f(t)` 约束**：`update(t, x)` 必须仅由入参时间 `t` 决定 DOM/SVG 状态。严禁使用 `setTimeout`、`setInterval`、自建 `requestAnimationFrame` 或跨帧累加变量；CSS `@keyframes` 在 `?record=1` 录制态下会自动按 `--anim-t` 锁定相位。
2. **语义词锚同步**：视觉动作一律用 `x.at(lineIdx, '关键词', offset)` 或 `x.cue(lineIdx)` 对齐口播重音，禁止硬编码拍脑袋秒数。
3. **终章驻留与持续运动**：需要播放结束后继续交互或保持环境动画时，在 `V.config` 设 `interactiveEnd: true`，对应幕设 `live: true`，可点击控件标记 `data-interactive="1"`。`update(t, x)` 与 `onRender(e)` 中可用 `x.clock` / `e.clock` 驱动暂停态环境微动。
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

## 4. 字幕、控制栏与内置交互能力

- **字幕伴随插槽与避让**：通过 `V.subtitle({ lead: (h, V) => el, tail, position, modes, onUpdate(cue, info, dom) })` 挂载前置吉祥物或角标；单幕可设 `subLayout: 'left' | { pos: 'center', offsetX: 56, maxWidth: 1520 }` 动态避让角色。
- **控制栏与配置项（`V.config.ui`）**：
  - `controlsMode: 'docked' | 'overlay'`（常驻底栏 / 空闲自动隐退并联动字幕上移避让）
  - `chapterMarks: true`、`hud: true`、`rate: true`、`webFull: true`、`icons: { webEnter, webExit, fullEnter, fullExit }`
- **内置检索、深链与双音轨独立控制**：按 `/` 或 `Ctrl+K` 全文检索台词与章节跳转；点击时间码复制当前 `?t=` 深链；点击「声音」上拉菜单或按 `B` 键可独立开关 BGM（`V.setBgm(on)` / `V.setVoice(on)`，按 `M` 全部静音）。

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
