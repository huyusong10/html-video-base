/* 示例场景脚本：演示纯函数渲染 f(t)、语义锚点 ctx.at()、数字跳动 countUp、焦点切换 spotlight 与路径生长 drawPath */
(function () {
  const { h, pop, appear, prog, stagger, countUp, spotlight, drawPath } = V.u;

  // 第 1 幕：演示 ctx.at() 句内语义卡点与卡片聚焦
  V.scenes.push({
    title: '核心机制 · 纯函数时间轴与语义锚点',
    lines: [
      { text: '欢迎使用通用 HTML 视频底座。所有画面都是时间的纯函数，依次支持草稿预览、语义锚点卡点与逐帧无损导出。', pause: 0.25 },
    ],
    build(root) {
      const E = (this.E = {});
      E.fpsNum = h('strong', null, '0');
      const specs = [
        ['01 · DRAFT', '草稿秒开预览', '未生成配音前自动按字重估算时长，写完代码即可交互拖拽'],
        ['02 · ANCHOR', '语义锚点卡点', '直接按台词关键词触发动画，改文案或调语速后自动吸附对齐'],
        ['03 · EXPORT', '逐帧无损导出', '无头浏览器确定性寻道截屏，音画零漂移直出 MP4'],
      ];
      E.cards = specs.map(([tag, title, desc]) =>
        h('div', { class: 'tpl-card' },
          h('div', null,
            h('span', { class: 'tpl-step' }, tag),
            h('h3', null, title),
            h('p', null, desc))));

      E.wrap = h('div', { class: 'abs tpl-frame' },
        h('div', { class: 'tpl-head' },
          h('div', null,
            h('div', { class: 'tpl-kicker' }, 'PURE FUNCTION TIMELINE'),
            h('h1', { class: 'tpl-title' }, '__VIDEO_TITLE__')),
          h('div', { class: 'tpl-kpi' }, E.fpsNum, h('span', null, 'FPS 确定性渲染'))),
        h('div', { class: 'tpl-grid' }, ...E.cards));

      root.append(E.wrap);
    },
    update(t, x) {
      const E = this.E;
      countUp(E.fpsNum, 0, V.config.fps || 30, prog(t, 0.1, 0.9), v => `${Math.round(v)}`);

      E.cards.forEach((card, i) => {
        pop(card, stagger(E.cards.length, i, t, 0.25, 0.5, 0.4));
      });

      // 按台词读到的关键词精确切换高亮卡片（无需手算秒数）
      const tDraft = x.at(0, '草稿预览', -0.1);
      const tAnchor = x.at(0, '语义锚点', -0.1);
      const tExport = x.at(0, '逐帧无损', -0.1);
      const focusIdx = t < tDraft ? null : t < tAnchor ? 0 : t < tExport ? 1 : 2;
      spotlight(E.cards, focusIdx);
    },
  });

  // 第 2 幕：演示 SVG 连线描边生长 drawPath
  V.scenes.push({
    title: '构建管线 · 从脚本到成片闭环',
    lines: [
      { text: '只需一行构建命令，即可自动完成语音合成、背景乐闪避混音与五维音画同步体检。', pause: 0.3 },
    ],
    build(root) {
      const E = (this.E = {});
      const lineSvg = h('div', {
        class: 'tpl-flow-svg',
        html: `<svg viewBox="0 0 1680 560" width="100%" height="100%">
          <path id="flowLine" d="M 380 280 L 1300 280" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round"/>
        </svg>`,
      });
      E.path = lineSvg.querySelector('#flowLine');

      const steps = [
        ['1. 场景脚本', 'scenes.js + style.css'],
        ['2. 语音与混音', 'voice.py + mix.py'],
        ['3. 同步校验与导出', 'verify-sync + render'],
      ];
      E.nodes = steps.map(([b, s]) => h('div', { class: 'tpl-node' }, h('b', null, b), h('span', null, s)));

      root.append(
        h('div', { class: 'abs tpl-frame' },
          h('div', { class: 'tpl-head' },
            h('div', null,
              h('div', { class: 'tpl-kicker' }, 'BUILD PIPELINE'),
              h('h2', { class: 'tpl-title' }, '自动化配音、混音与同步锁定'))),
          h('div', { class: 'tpl-flow' }, lineSvg, ...E.nodes)));
    },
    update(t, x) {
      const E = this.E;
      pop(E.nodes[0], appear(t, 0.15, 0.35));
      pop(E.nodes[1], appear(t, x.at(0, '语音合成', -0.15), 0.35));
      pop(E.nodes[2], appear(t, x.at(0, '五维', -0.15), 0.35));
      drawPath(E.path, prog(t, 0.3, x.at(0, '五维', 0.2)));
    },
  });
})();
