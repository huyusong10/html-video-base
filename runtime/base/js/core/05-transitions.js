/* core/05-transitions.js · 基于 V.transition() 契约注册内置换幕过渡，支持外部自定义覆盖或新增 */
(function (V) {
  const { clamp, ease, h } = V.u;
  const DEFAULT_TILE_COLORS = ['#2563EB', '#3B82F6', '#6366F1', '#0EA5E9', '#64748B'];

  V.transition('none', {
    mount() { return {}; },
    update(_dom, _near, _dur, curScene) {
      if (curScene && curScene.root) curScene.root.style.transform = '';
    },
  });

  V.transition('fade', {
    mount(box) {
      const veil = h('div', { class: 'wipe-veil' });
      box.appendChild(veil);
      return { veil };
    },
    update(dom, near, dur) {
      const k = dur > 0 && Math.abs(near) < dur ? 1 - ease.io(Math.abs(near) / dur) : 0;
      dom.veil.style.opacity = String(clamp(k));
    },
  });

  V.transition('slide', {
    mount(box) {
      const veil = h('div', { class: 'wipe-veil' });
      box.appendChild(veil);
      return { veil };
    },
    update(dom, near, dur, curScene) {
      const active = dur > 0 && Math.abs(near) < dur;
      const k = active ? 1 - ease.io(Math.abs(near) / dur) : 0;
      dom.veil.style.opacity = String(clamp(k * 0.85));
      if (!curScene || !curScene.root) return;
      if (!active) { curScene.root.style.transform = ''; return; }
      const dx = near < 0 ? -42 * ease.in(1 + near / dur) : 42 * (1 - ease.out(near / dur));
      curScene.root.style.transform = `translateX(${dx}px)`;
    },
  });

  V.transition('wipe', {
    mount(box, cfg) {
      const curtain = h('div', { class: 'wipe-curtain' });
      if (cfg.wipeColor) curtain.style.background = cfg.wipeColor;
      box.appendChild(curtain);
      return { curtain };
    },
    update(dom, near, dur) {
      const active = dur > 0 && Math.abs(near) < dur;
      const k = !active ? 0 : (near < 0 ? ease.in(1 + near / dur) : 1 - ease.out(near / dur));
      dom.curtain.style.transformOrigin = near < 0 ? '0% 50%' : '100% 50%';
      dom.curtain.style.transform = `scaleX(${clamp(k)})`;
    },
  });

  V.transition('tiles', {
    dur: 0.42,
    mount(box, cfg) {
      const tile = cfg.tileSize || 120;
      const cols = Math.ceil((V.stageWidth || 1920) / tile);
      const rows = Math.ceil((V.stageHeight || 1080) / tile);
      const colors = cfg.wipeColors || DEFAULT_TILE_COLORS;
      const tiles = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const el = h('i', {
            style: `width:${tile}px;height:${tile}px;left:${c * tile}px;top:${r * tile}px;background:${colors[(c * 3 + r * 7) % colors.length]}`,
          });
          box.appendChild(el);
          tiles.push([el, (c + r) / Math.max(1, cols + rows - 2)]);
        }
      }
      return { tiles, cleared: false };
    },
    update(dom, near, dur) {
      if (!(dur > 0) || Math.abs(near) >= dur) {
        if (!dom.cleared) {
          for (const [el] of dom.tiles) el.style.transform = 'scale(0)';
          dom.cleared = true;
        }
        return;
      }
      dom.cleared = false;
      for (const [el, delay] of dom.tiles) {
        const k = near < 0
          ? clamp((near + dur) / dur * 1.6 - delay * 0.6)
          : 1 - clamp(near / dur * 1.6 - delay * 0.6);
        const s = Math.round(clamp(k) * 4) / 4;
        el.style.transform = `scale(${s})`;
      }
    },
  });
})(globalThis.V = globalThis.V || {});
