/* core/06-layers.js · 跨幕持久层（V.layer）挂载、状态插值与实时语音能量注入 */
(function (V) {
  const { clamp, lerp, ease, h } = V.u;

  function initLayerElement(layer, stage, subs) {
    const existing = document.getElementById(`layer-${layer.id}`);
    if (existing) return existing;
    const zVal = layer.z !== undefined ? layer.z : (layer.zIndex !== undefined ? layer.zIndex : 6);
    const el = h('div', {
      id: `layer-${layer.id}`,
      class: 'stage-layer ' + (layer.cls || ''),
      style: `z-index:${zVal}`,
    });
    stage.insertBefore(el, subs);
    return el;
  }

  function mountLayers(stage, subs) {
    for (const layer of V.layers) {
      if (!layer || layer._mounted) continue;
      const el = initLayerElement(layer, stage, subs);
      const fn = layer.build || layer.create;
      const ret = fn ? fn(el, stage) : null;
      if (ret && ret.nodeType === 1 && !ret.parentNode) el.appendChild(ret);
      layer._el = el;
      layer._data = ret;
      layer._mounted = true;
    }
  }

  function resolveLayerState(layer, sc, si) {
    const prop = layer.prop || layer.id;
    const raw = sc ? sc[prop] : null;
    const val = typeof raw === 'function' ? raw(sc.ctx || V.makeCtx(sc, si), sc, si) : raw;
    return Object.assign({}, layer.defaults || layer.defaultState || {}, val || {});
  }

  function blendLayerStates(prev, next, k) {
    const out = Object.assign({}, prev, next);
    for (const key of Object.keys(out)) {
      const a = prev[key], b = next[key];
      if (typeof a === 'number' && typeof b === 'number') out[key] = lerp(a, b, k);
      else out[key] = k < 0.5 && a !== undefined ? a : b;
    }
    return out;
  }

  function computeLayerFrame(layer, sc, idx, lt) {
    const curState = resolveLayerState(layer, sc, idx);
    const blendDur = layer.blendDur === undefined ? 0.45 : layer.blendDur;
    if (idx <= 0 || blendDur <= 0 || lt >= blendDur) {
      return { state: curState, prevState: curState, curState, blend: 1 };
    }
    const prevState = resolveLayerState(layer, V.scenes[idx - 1], idx - 1);
    const blend = ease.io(clamp(lt / blendDur));
    return { state: blendLayerStates(prevState, curState, blend), prevState, curState, blend };
  }

  function updateLayers(sc, idx, lt, now, speaking) {
    if (!V.layers.length) return;
    const energy = V.getSceneEnergy(sc, idx, lt);
    for (const layer of V.layers) {
      if (!layer || !layer._mounted || typeof layer.update !== 'function') continue;
      const f = computeLayerFrame(layer, sc, idx, lt);
      layer.update(f.state, {
        t: now,
        lt,
        scene: sc,
        sceneIndex: idx,
        speaking,
        energy,
        blend: f.blend,
        prev: f.prevState,
        next: f.curState,
        el: layer._el,
        data: layer._data,
        ctx: sc.ctx,
      });
    }
  }

  V._layersRuntime = { mountLayers, updateLayers, resolveLayerState };
})(globalThis.V = globalThis.V || {});
