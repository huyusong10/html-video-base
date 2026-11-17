/* 与渲染技术无关的角色状态、连续动作和可等待的渲染器。 */
(function (V) {
  const { clamp, lerp, prog, ease, win, keyframes } = V.u;
  const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const pulse = raw => raw > 0 && raw < 1 ? Math.sin(raw * Math.PI) : 0;

  function scalarTrack(t, stops, duration = 0.3) {
    if (!Array.isArray(stops) || !stops.length) return 0;
    const keys = stops.filter(Array.isArray).map(stop => ({ at: number(stop[0], 0), value: number(stop[1], 0), dur: Math.max(0.04, number(stop[2], duration)) }));
    return keyframes(t, keys, { dur: duration }).value;
  }

  function evalTrack(t, value, fallback = 0, duration = 0.32) {
    return Array.isArray(value) ? scalarTrack(t, value, duration) : number(value, fallback);
  }

  function normalizePoses(poses, endAt, allowStart, duration) {
    const list = (poses || []).filter(Array.isArray).filter(stop => !Number.isFinite(endAt) || stop[0] < endAt - 0.02);
    if (!list.length) list.push([0, 'idle']);
    if (!allowStart && list[0][0] > 0.001) list.unshift([0, 'idle']);
    if (Number.isFinite(endAt) && list.at(-1)[1] !== 'idle') list.push([endAt, 'idle', duration]);
    return list;
  }

  function beaconAt(t, value, endAt) {
    if (t >= endAt) return false;
    if (Array.isArray(value)) return value.some(range => t >= range[0] && t < range[1]);
    return Boolean(value);
  }

  function hop(t, inAt, outAt, target, duration, dock, safe) {
    duration = Math.max(0.1, number(duration, 0.56));
    const rawIn = inAt == null ? 1 : prog(t, inAt, inAt + duration);
    const rawOut = outAt == null ? 0 : prog(t, outAt, outAt + Math.max(0.1, number(target.durOut, duration)));
    const k = ease.io(rawIn) * (1 - ease.io(rawOut));
    const x = clamp(number(target.x, dock.x), safe.minX, safe.maxX);
    const y = clamp(number(target.y, dock.y), safe.minY, safe.maxY);
    const s = clamp(number(target.s, dock.s), safe.minS, safe.maxS);
    return { k, x: lerp(dock.x, x, k), y: lerp(dock.y, y, k) + Math.sin(k * Math.PI) * number(target.arc, -36),
      s: lerp(dock.s, s, k), walk: Math.max(pulse(rawIn), pulse(rawOut)) * 0.9,
      dockBlend: 1 - k, lookBlend: k, subMode: k > 0.5 ? 'center' : 'dock', ringAlpha: clamp(1 - k * 1.75) };
  }

  function hasLookAfter(stops, after, before = Infinity) {
    return Array.isArray(stops) && stops.some(stop => stop[0] > after && stop[0] < before);
  }

  function resolveStage(t, stage, defaults) {
    if (!Array.isArray(stage)) return { ...defaults, ...stage, walk: 0 };
    const first = stage[0]?.[1] || {};
    const initial = { ...defaults, ...first };
    const keys = stage.slice(1).map(([at, state]) => ({ ...state, at, dur: Math.max(0.12, number(state.dur, 0.5)) }));
    const value = keyframes(t, keys, { init: initial });
    const walk = Math.max(0, ...keys.map(key => pulse(prog(t, key.at, key.at + key.dur)) * 0.85));
    return { ...value, walk };
  }

  function tourSegment(t, points) {
    if (t <= points[0][0] || points.length === 1) return { index: 0, fraction: 0 };
    if (t >= points.at(-1)[0]) return { index: Math.max(0, points.length - 2), fraction: 1 };
    for (let i = 0; i < points.length - 1; i++) {
      if (t >= points[i][0] && t <= points[i + 1][0]) return { index: i, fraction: ease.io(prog(t, points[i][0], points[i + 1][0])) };
    }
    return { index: 0, fraction: 0 };
  }

  function programOpening(c, t, spec, duration) {
    const start = Object.assign({ x: 960, y: c.openingY, s: 2.2 }, spec.start);
    const shift = spec.shift || {};
    const shiftDuration = Math.max(0.12, number(shift.dur, 0.65));
    const rawShift = spec.shift ? prog(t, number(shift.at, 0), number(shift.at, 0) + shiftDuration) : 0;
    const shifted = keyframes(t, [{ ...shift, at: number(shift.at, 0), dur: shiftDuration }], { init: start });
    const dockDuration = Math.max(0.2, number(spec.dockDur, 0.78));
    const latest = Math.max(0.2, duration - dockDuration - 0.12);
    const at = Math.min(number(spec.dockAt, latest), latest);
    const rawDock = prog(t, at, at + dockDuration), kDock = ease.io(rawDock);
    const settle = Math.max(at + 0.2, duration - 0.5);
    const lateLook = spec.postDockLook || hasLookAfter(spec.lookX, at + 0.05);
    return { state: { ...spec, _managed: true,
      x: lerp(shifted.x, c.dock.x, kDock), y: lerp(shifted.y, c.dock.y, kDock) + Math.sin(kDock * Math.PI) * number(spec.arc, c.openingArc),
      s: lerp(shifted.s, c.dock.s, kDock), walk: Math.max(pulse(rawShift), pulse(rawDock)) * 0.9,
      topAlpha: evalTrack(t, spec.topAlpha, V.pptMode ? ease.io(rawShift) : kDock),
      dockBlend: kDock, ringAlpha: prog(kDock, 0.45, 0.96), subMode: kDock > 0.5 ? 'dock' : 'center',
      poses: normalizePoses(spec.poses || [[0, 'wave'], [at + 0.16, 'idle']], settle, true, c.poseDuration),
      lookBlend: lateLook ? 1 - ease.io(prog(t, settle, duration - 0.06)) : 1 - kDock,
      tilt: spec.tilt === undefined ? undefined : evalTrack(t, spec.tilt) * (1 - kDock), beacon: beaconAt(t, spec.beacon, settle) },
      result: { kShift: ease.io(rawShift), kDock } };
  }

  function programDocked(c, t, spec, duration) {
    const settle = Math.max(0.5, duration - 0.5);
    const fade = 1 - ease.io(prog(t, settle, duration - 0.06));
    const hasLook = spec.lookX !== undefined || spec.lookY !== undefined;
    return { state: { ...spec, ...c.dock, _managed: true, dockBlend: 1, ringAlpha: 1, subMode: 'dock',
      topAlpha: evalTrack(t, spec.topAlpha, 1),
      poses: normalizePoses(spec.poses, settle, false, c.poseDuration),
      lookBlend: hasLook ? ease.io(win(t, 0.24, duration - 0.5, 0.36)) : 0,
      tilt: spec.tilt === undefined ? undefined : evalTrack(t, spec.tilt) * fade,
      dark: evalTrack(t, spec.dark) * (spec.darkHoldEnd ? 1 : fade), beacon: beaconAt(t, spec.beacon, settle) } };
  }

  function cameoTiming(t, spec, duration) {
    const enter = Math.max(0.16, number(spec.dur, 0.54)), leave = Math.max(0.16, number(spec.durOut, enter));
    const at = Math.max(0.02, number(spec.inAt, 0.06));
    const latest = Math.max(at + enter + 0.08, duration - leave - 0.08);
    const out = spec.outAt == null ? latest : Math.min(number(spec.outAt, latest), latest);
    return { enter, leave, at, out, fade: 1 - ease.io(prog(t, out, out + leave)) };
  }

  function cameoLook(t, spec, duration, timing, h, keep) {
    if (keep) return 1;
    const early = spec.dockLook || hasLookAfter(spec.lookX, 0.05, timing.at - 0.1);
    return early ? Math.max(h.k, ease.io(win(t, 0.24, Math.min(timing.out, duration - 0.5), 0.36))) : h.k;
  }

  function programCameo(c, t, spec, duration) {
    const stage = resolveStage(t, spec.stage, { ...c.cameoStage, arc: number(spec.arc, c.cameoStage.arc) });
    const timing = cameoTiming(t, spec, duration);
    const keep = Boolean(V.pptMode && spec.pptKeep), settle = keep ? duration + 99 : timing.out;
    const h = keep ? { k: 1, subMode: 'center', dockBlend: 0, ringAlpha: 0, ...stage, walk: 0 }
      : hop(t, timing.at, timing.out, { ...stage, durOut: timing.leave }, timing.enter, c.dock, c.safe);
    return { state: { ...spec, ...stage, ...h, _managed: true, walk: Math.max(h.walk, stage.walk * h.k),
      poses: normalizePoses(spec.poses, settle, false, c.poseDuration),
      lookBlend: cameoLook(t, spec, duration, timing, h, keep),
      tilt: spec.tilt === undefined ? undefined : evalTrack(t, spec.tilt) * h.k,
      dark: spec.dark === 'hop' ? h.k : evalTrack(t, spec.dark) * (keep ? 1 : timing.fade),
      beacon: beaconAt(t, spec.beacon === 'hop' ? h.k > 0.5 : spec.beacon, settle) }, result: h };
  }

  function tourPosition(t, spec, points, segment) {
    const a = points[segment.index], b = points[Math.min(points.length - 1, segment.index + 1)];
    const x = lerp(number(a[1], 960), number(b[1], 960), segment.fraction);
    const y = lerp(number(a[2], 520), number(b[2], 520), segment.fraction);
    const s = spec.s === undefined ? lerp(number(a[3], 1.05), number(b[3], 1.05), segment.fraction) : evalTrack(t, spec.s, 1.05);
    const lookX = spec.lookX === undefined && points.length > 1 ? clamp((number(b[1], x) - number(a[1], x)) / 120, -0.9, 0.9) : spec.lookX;
    return { x, y, s, lookX };
  }

  function programTour(c, t, spec, duration) {
    const points = spec.waypoints?.length ? spec.waypoints : [[0.5, 960, 520, 1.1]];
    const first = points[0], last = points.at(-1), segment = tourSegment(t, points);
    const position = tourPosition(t, spec, points, segment);
    const enter = Math.max(0.16, number(spec.dur, 0.5)), at = Math.max(0.04, number(spec.inAt, first[0] - 0.55));
    const latest = Math.max(at + enter + 0.1, duration - enter - 0.08);
    const out = spec.outAt == null ? latest : Math.min(number(spec.outAt, latest), latest);
    const h = hop(t, at, out, { ...position, arc: number(spec.arc, -22) }, enter, c.dock, c.safe);
    const walk = points.length > 1 ? ease.io(prog(t, first[0] - 0.22, first[0] + 0.14)) * (1 - ease.io(prog(t, last[0] - 0.18, last[0] + 0.18))) * 0.9 : 0;
    return { state: { ...spec, ...h, _managed: true, topAlpha: evalTrack(t, spec.topAlpha, 1),
      walk: Math.max(h.walk, walk * h.k), poses: normalizePoses(spec.poses || [[at + 0.08, 'guide']], out, false, c.poseDuration),
      lookX: position.lookX, lookBlend: h.k, beacon: beaconAt(t, spec.beacon, out) },
      result: { ...h, segIdx: segment.index, segFrac: segment.fraction } };
  }

  function programFinale(c, t, spec) {
    const stage = { x: 960, y: 470, s: 1.92, arc: -42, ...spec.stage };
    const at = number(spec.returnAt === undefined ? spec.inAt : spec.returnAt, 0.2);
    const h = spec.fromDock === false ? { k: 1, ...stage, subMode: 'center', dockBlend: 0, ringAlpha: 0 }
      : hop(t, at, null, stage, Math.max(0.2, number(spec.dur, 0.76)), c.dock, c.safe);
    const poses = spec.fromDock === false ? [[0, 'present'], [1, 'wave']] : [[0, 'idle'], [at + 0.15, 'wave']];
    const early = spec.lookX !== undefined || spec.lookY !== undefined;
    return { state: { ...spec, ...h, s: spec.fromDock === false ? evalTrack(t, stage.s, 1.92) : h.s, _managed: true, persistStage: true,
      topAlpha: evalTrack(t, spec.topAlpha, 1 - h.k),
      poses: normalizePoses(spec.poses || poses, null, spec.fromDock === false, c.poseDuration),
      lookBlend: early ? Math.max(h.k, ease.io(prog(t, 0.24, 0.64))) : h.k,
      beacon: beaconAt(t, spec.beacon === 'hop' ? h.k > 0.5 : spec.beacon, Infinity) }, result: h };
  }

  function poseTrack(t, stops, duration, poseFromName, mix) {
    if (!stops?.length) return poseFromName('idle');
    let state = poseFromName(stops[0][1]);
    for (const [at, name, span = duration] of stops.slice(1)) {
      const k = ease.io(prog(t, at, at + Math.max(0.06, number(span, duration))));
      if (k > 0) state = mix(state, poseFromName(name), k, lerp);
    }
    return state;
  }

  function defaultMix(from, to, k) {
    const output = { ...from, ...to };
    for (const field of Object.keys(output)) {
      output[field] = typeof from[field] === 'number' && typeof to[field] === 'number' ? lerp(from[field], to[field], k) : (k < 0.5 ? from[field] : to[field]);
    }
    return output;
  }

  const PROGRAMS = { opening: programOpening, docked: programDocked, cameo: programCameo, tour: programTour, finale: programFinale };

  function makeMotion(definition, submit) {
    const c = { dock: { x: 138, y: 1035, s: 0.9 }, safe: { minX: 110, maxX: 1810, minY: 130, maxY: 1035, minS: 0.5, maxS: 2.6 },
      openingY: 468, openingArc: -42, cameoStage: { x: 310, y: 536, s: 1.88, arc: -34 }, poseDuration: 0.44, ...definition.motion };
    const api = { kf: scalarTrack, evalTrack,
      hop: (t, enter, leave, target, duration = 0.56) => hop(t, enter, leave, target, duration, c.dock, c.safe),
      poseTrack: (t, stops, duration = c.poseDuration) => poseTrack(t, stops, duration, definition.poseFromName || (pose => ({ pose })), definition.poseMix || defaultMix),
    };
    for (const [name, program] of Object.entries({ ...PROGRAMS, ...definition.programs })) api[name] = (scene, t, spec = {}) => {
      const sceneIndex = typeof scene === 'object' ? V.scenes.indexOf(scene) : scene;
      const duration = number(V.scenes[sceneIndex]?.duration, 20);
      const output = program(c, Math.max(0, t), spec, duration);
      submit(output.state, V.getFrameState(), { sceneIndex, lt: t });
      return output.result;
    };
    return api;
  }

  function actorHost(definition, layerParent) {
    const existing = definition.element?.();
    if (existing) return { element: existing, owned: false };
    if (typeof document === 'undefined') return { element: null, owned: false };
    const element = V.u.h('div', { class: 'video-actor', 'data-actor-id': definition.id });
    const parent = definition.parent?.() || layerParent || document.getElementById('stage');
    if (parent) parent.appendChild(element);
    return { element, owned: true };
  }

  V.actor = function (definition) {
    if (!definition?.id || !definition.renderer) throw new TypeError('actor requires id and renderer');
    const renderer = definition.renderer;
    let mounted = null, ready = null, current = null, source = null, disposed = false, disposal = null;
    let layer = null, layerParent = null, ownedLayer = false;
    const context = (request = current, extra = {}) => ({ ...request, element: mounted?.element, data: mounted?.data,
      capabilities: renderer.capabilities || {}, ...extra });

    function apply(request, extra) {
      const updated = renderer.update?.(request.state, context(request, extra));
      if (updated && typeof updated.then === 'function') throw new TypeError('actor renderer.update must be synchronous; use prepare');
      request.applied = true;
    }

    function mount(frame) {
      if (mounted || disposed) return ready;
      mounted = actorHost(definition, layerParent);
      mounted.pending = true;
      source = V.managedSource({ id: `actor:${definition.id}`, element: () => mounted?.element,
        active: (_frame, request) => request.state.visible !== false,
        timeoutMs: definition.timeoutMs, readyTimeoutMs: definition.readyTimeoutMs,
        async initialize({ signal, mode }) {
          const data = await renderer.mount?.(mounted.element, { frame, signal, mode, capabilities: renderer.capabilities || {} });
          if (signal.aborted || disposed) throw new DOMException('Actor disposed', 'AbortError');
          mounted.data = data; mounted.pending = false;
          return data;
        },
        async prepare(request, preparedFrame, { signal, data }) {
          if (signal.aborted || disposed || current !== request) throw new DOMException('Actor frame superseded', 'AbortError');
          const extra = { frame: preparedFrame, signal, data };
          if (!request.applied) apply(request, extra);
          if (renderer.prepare) await renderer.prepare(request.state, context(request, extra));
          if (signal.aborted || disposed) throw new DOMException('Actor frame superseded', 'AbortError');
        },
      });
      ready = source.ready().then(() => mounted.element);
      ready.catch(() => {});
      return ready;
    }

    const reservation = definition.subtitle ? V.subtitleReservation(definition.subtitle) : null;
    const api = {
      capabilities: Object.freeze({ ...(renderer.capabilities || {}) }),
      mount,
      update(state, frame = V.getFrameState(), extra = {}) {
        if (disposed) throw new Error(`Actor "${definition.id}" is disposed`);
        mount(frame);
        current = { state: Object.freeze({ ...definition.defaults, ...state }), frame, sceneIndex: frame?.sceneIndex, lt: frame?.lt, ...extra };
        source.setState(current);
        if (reservation && definition.autoSubtitle !== false) reservation.apply(number(state.dockBlend, 0), definition.reserve?.(state, frame), frame);
        if (!mounted.pending) apply(current);
        return current.state;
      },
      stage(state, frame) { return api.update({ dockBlend: 0, subMode: 'center', ...state }, frame); },
      transition(from, to, fraction, frame) { return api.update((definition.mix || defaultMix)(from, to, clamp(fraction)), frame); },
      reserveSubtitle: (fraction, overrides, frame) => reservation?.apply(fraction, overrides, frame),
      dispose() {
        if (disposal) return disposal;
        disposed = true;
        const layerIndex = V.layers.indexOf(layer);
        if (layerIndex >= 0) V.layers.splice(layerIndex, 1);
        const sourceDisposal = source?.dispose();
        disposal = (async () => {
          try { await sourceDisposal; await ready; } catch {}
          try { await renderer.dispose?.(context()); }
          finally {
            if (mounted?.owned) mounted.element?.remove();
            if (ownedLayer) layerParent?.remove();
          }
        })();
        return disposal;
      },
    };
    Object.assign(api, makeMotion(definition, api.update));
    if (definition.layer) {
      const existing = typeof document === 'undefined' ? null : document.getElementById(`layer-${definition.id}`);
      layer = V.layer({ ...definition.layer, id: definition.id,
        build(element) { layerParent = element; ownedLayer = element !== existing; api.mount(V.getFrameState()); return mounted.element; },
        update: (state, info) => api.update(state, info.frame) });
    }
    return api;
  };
})(globalThis.V = globalThis.V || {});
