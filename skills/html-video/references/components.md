# 交互值、角色与字幕组件

公共组件负责重复的交互处理、动作编排和画面等待。业务主题保留造型、骨骼、材质、模型加载和分镜参数，继续通过 [公共帧快照](frame-interfaces.md) 取得时间与输入。

## 保存观众的手动选择

自动演示与观众选择同时存在时，用 `V.manualState()` 决定当前值。录制时始终采用自动值，观众在预览中的选择不会进入导出画面。

```js
const selected = V.manualState({
  resetOn: ['play', 'sceneExit'],
  enabled: frame => !frame?.playing,
});

V.u.interactive(button, () => selected.set(2));

// 在分镜 update(t, x) 中：
const activeTab = selected.resolve(automaticTab, x.frame);
```

`resetOn` 默认包含 `play`、`seek` 和 `sceneExit`，分别在开始播放、跳转和离开所属场景时清除选择。需要暂停时允许选择、恢复播放后回到自动演示的界面，可使用上例。需要长期保留观众选择时设为 `[]`。PPT 模式允许交互，是否允许播放过程中修改由 `enabled(frame)` 决定。

`set(value, frame)` 保存选择，`clear()` 恢复自动值，`resolve(automatic, frame)` 返回本帧采用的值。省略帧参数时读取当前帧；首次渲染前仍会按 `V.environment.isRecord` 判断模式。`dispose()` 清除选择并注销重置处理。

已有代码通过对象属性读写时，可以绑定属性，避免逐帧重复写播放态判断：

```js
V.manualState({ resetOn: ['play', 'sceneExit'] }).bind(view, 'manualTab');
view.manualTab = 2;
const active = view.manualTab ?? automaticTab;
view.manualTab = null; // 清除手动值
```

绑定属性的自动值默认是 `null`，第三个参数可显式指定 `undefined` 或其他值。赋 `null` 或 `undefined` 会清除选择；需要保存这些值时直接使用 `set()` 和 `resolve()`。对象和数组应整体替换，例如 `state.set({ ...old, expanded: true })`，不要修改 `resolve()` 返回的自动对象。

创建手动状态的场景或组件负责释放它。场景会在再次进入时重新执行 `build()`；移除旧 DOM 不会注销状态。将句柄保存在场景上，重建前调用旧句柄的 `dispose()`：

```js
build(root) {
  this.tabState?.dispose();
  const view = this.view = {};
  this.tabState = V.manualState({ resetOn: [] }).bind(view, 'manualTab');
  // 创建本次视图。
}
```

组件工厂可以返回 `dispose()`，由持有旧组件的调用方在替换前调用。`resetOn` 只决定何时恢复自动值，不替代实例清理；需要长期保留的状态仍由其长期持有者管理。

## 让角色响应指针

`V.pointerResponse()` 处理暂停时的平滑视线、悬停问候和轻跳；角色主题提供自己的位置与命中区域。每个角色创建一个实例，同一个 `frame.id` 只推进一次平滑计算，可从多个绘制分支读取同一结果。

```js
const gaze = V.pointerResponse();

function updateCharacter(frame, x, y) {
  const response = gaze.update(frame, {
    x, y, eyeY: y - 28, opacity: 1,
    hitX: x, hitY: y - 26, hitRx: 48, hitRy: 58,
  });
  drawEyes(response.lx, response.ly, response.focus);
  drawGreeting(response.greet, response.hop);
}
```

位置和半径均为舞台坐标。可通过 `geometry(frame)` 提供几何信息，或通过 `hitTest(pointer, geometry, wasHovered, frame)` 自定义命中判断。`snapOnFirst` 控制首次输入是否直接跟到指针，`suppressUIInPpt` 控制 PPT 模式下悬停控件时是否抑制视线响应。平滑采用 `frame.uiDt`，录制帧返回零响应；组件不监听 DOM 事件，也不创建时钟。`reset()` 清除此前响应。

## 将角色编排与绘制分开

`V.actor()` 接收状态并调用业务渲染器。状态可以包含屏幕位置，也可以包含三维位置、四元数、动画片段、表情或业务字段；平台原样传递这些字段，不规定骨骼和模型格式。

```js
const guide = V.actor({
  id: 'guide',
  element: () => guideHost,
  renderer: {
    capabilities: { dimensions: 2, poses: ['idle', 'wave'] },
    mount(element, { signal, mode }) { return createSvgGuide(element); },
    update(state, { frame, data }) { drawSvgGuide(data, state, frame); },
    dispose({ data }) { data?.remove(); },
  },
});

// 在分镜 update(t, x) 中：
guide.update({ x: 680, y: 540, pose: 'wave' }, x.frame);
```

`element()` 返回已经连接的宿主。省略时，组件在舞台内创建 `.video-actor` 宿主，并在销毁时删除。`mount()` 在首次挂载时运行一次，返回的对象作为后续上下文的 `data`。`capabilities` 用来描述渲染器支持的维度或姿态，供业务选择合适的表现。

`update()` 必须同步完成。异步加载放在 `mount()`，异步绘制放在 `prepare()`。组件通过 [受管画面](external-sources.md) 统一初始化、取消旧请求、等待精确定位和管理宿主显隐：`readyTimeoutMs` 限制一次初始化，`timeoutMs` 限制初始化完成后的单帧准备，均默认 15000 毫秒。状态设为 `{ visible: false }` 时隐藏宿主且不等待绘制。`await actor.mount(frame)` 可等待初始化，`await actor.dispose()` 取消等待并释放资源；初始化失败也会执行销毁后的宿主清理。

同步绘制出错时，预览通过 `onFrameError` 和控制台报告，播放器继续更新；精确定位与导出会失败。误将 `update()` 写成异步函数时同样报告接口错误，不使用其异步结果。

底层加载器不响应取消时，`await actor.dispose()` 不等待它结束，自有宿主仍会移除。加载器随后返回或拒绝时，框架再调用一次 `renderer.dispose()`；成功返回的数据会传入销毁上下文，迟到的清理错误通过 `onFrameError` 和控制台报告。加载器始终不结束且不响应 `signal` 时，适配器需自行释放它持有的部分资源。

`update()` 和 `prepare()` 的上下文包含 `frame`、`state`、`sceneIndex`、`lt`、`element`、`data` 和 `capabilities`。`mount(element, context)` 将宿主作为第一个参数，上下文提供 `frame`、`signal`、`mode` 和 `capabilities`。`prepare()` 的上下文也提供 `signal`；异步适配器必须在提交结果前检查取消信号，避免旧请求覆盖新画面。

### 接入异步三维模型

下面的 `loadModel()` 由业务实现，可返回任意模型库的对象。模型加载、骨骼、动画切换和资源释放都由该适配器处理，不要求安装特定的三维库。

```js
const modelActor = V.actor({
  id: 'spatial-guide',
  element: () => canvasHost,
  readyTimeoutMs: 30000,
  renderer: {
    capabilities: { dimensions: 3, poses: ['idle', 'explain'] },
    async mount(host, { signal, mode }) {
      return loadModel(host, { signal, mode });
    },
    async prepare(state, { frame, signal, data }) {
      await data.selectAnimation(state.pose, { signal });
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      data.model.position.set(state.position.x, state.position.y, state.position.z);
      data.model.quaternion.fromArray(state.quaternion);
      data.mixer.setTime(frame.clock);
      await data.render({ signal });
    },
    dispose({ data }) { data?.dispose(); },
  },
});

// 在分镜 update(t, x) 中；可向前或向后定位：
modelActor.update({
  position: { x: 1, y: 2, z: 3 },
  quaternion: [0, 0.5, 0, 0.866],
  pose: 'explain',
}, x.frame);
```

动画混合器直接采样当前帧时间，不能通过跨帧累加 `delta` 推进。`prepare()` 返回成功时，模型姿态与画面必须已经可以截图。录制时由适配器关闭独立运镜、自由补间或模型库自带的循环。

### 使用或扩展连续动作

角色提供 `opening(scene, t, spec)`、`docked(scene, t, spec)`、`cameo(scene, t, spec)`、`tour(scene, t, spec)`、`finale(scene, t, spec)`，分别计算开场入位、停靠、短暂出场、巡游和终章展示。它们以局部时间计算状态，再调用同一个渲染器。`scene` 可传场景对象或从零开始的序号。

默认动作使用 1920×1080 屏幕坐标。`motion` 可调整 `dock`、`safe`、`openingY`、`openingArc`、`cameoStage` 和 `poseDuration`。姿态名称通过业务的 `poseFromName(name)` 转为渲染器状态，`poseMix(from, to, fraction)` 负责姿态混合；已有骨骼主题可保留自己的姿态字典。

三维轨迹或其他坐标系可以直接调用 `update()`，也可在 `programs` 中增加或替换动作。每个函数接收 `(motion, localTime, spec, sceneDuration)`，返回 `{ state, result }`，`state` 交给渲染器，`result` 返回调用方。不要将默认二维走位误当成三维轨迹插值。

`stage(state, frame)` 提交舞台状态，`transition(from, to, fraction, frame)` 提交两状态之间的过渡。默认混合只对顶层数值插值；四元数、向量和骨骼需提供 `mix(from, to, fraction)`。组件不会对四元数做逐分量线性插值。

## 让字幕与角色配合

字幕前后的小角色可通过伴随组件挂载，沿用已有字幕更新回调：

```js
V.subtitleCompanion({
  slot: 'lead',
  create() { return createCloud(); },
  update(element, cue, info) {
    drawCloud(element, { time: info.frame.clock, energy: info.energy });
  },
});
```

`slot` 默认为 `lead`，也可设为 `tail`；`enabled(frame)` 控制是否更新。组件不创建播放时钟，字幕信息中的 `frame` 与当前画面一致。

停靠角色需要腾出字幕空间时，可在 `V.actor()` 中设置 `subtitle: { stage, docked }`。默认按状态的 `dockBlend` 在居中与左对齐字幕之间过渡；`autoSubtitle: false` 可关闭自动处理，再调用 `actor.reserveSubtitle(blend, overrides, frame)`。也可单独使用 `V.subtitleReservation()` 的 `resolve()` 或 `apply()`。主题通过 `resolve(blend, target, frame)` 自定义布局，角色自身不必包含字幕 DOM 逻辑。
