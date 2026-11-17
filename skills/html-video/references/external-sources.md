# 外部受管画面

独立 Canvas、三维渲染器和 iframe 可以交给平台管理初始化、显隐与逐帧准备。业务提交当前希望显示的状态，平台在分镜更新后统一准备画面；精确定位、截图和导出等待相同的流程。

`V.frameSource()` 保留为底层扩展入口。通常优先使用 `V.managedSource()`；iframe 使用 `V.iframeSource()`。

## 接入本页渲染器

```js
let host;
const model = V.managedSource({
  id: 'model',
  element: () => host,
  active: frame => Boolean(V.scenes[frame.sceneIndex].usesModel),
  readyTimeoutMs: 15000,
  timeoutMs: 15000,
  async initialize({ signal, mode }) {
    return createModel(host, { signal, mode });
  },
  async prepare(state, frame, { signal, data }) {
    await data.renderAt(state, frame.now, { signal });
  },
  dispose() { releaseModel(); },
});

// 分镜 build() 创建并挂载 host；update() 只提交当前状态。
model.setState({ camera: [20, 15, 30], progress: 0.4 });
```

平台不解释 `state` 的字段。相机、屋顶、路线、拆解件、角色骨骼等状态由业务计算；业务适配器负责将它们应用到实际渲染器。

| 配置 | 用途 |
| --- | --- |
| `id` | 页面内唯一的画面源编号，出错时用于定位。 |
| `element()` | 返回宿主节点。自动初始化与截帧准备要求节点已经连接到页面；可以在 getter 内同步创建占位宿主。登记画面源时不会执行此函数。 |
| `active(frame, state)` | 可选的场景归属或显示条件。未指定时，非空状态视为活跃；平台通过宿主的 `visibility` 隐藏或恢复显示。 |
| `preload` | 可为布尔值或 `environment => boolean`，默认关闭。宿主连接后，可以在状态尚未显示时预加载，例如 `env => !env.isRecord`。 |
| `initialize({ signal, mode })` | 一次初始化，可返回 Promise 和渲染器数据。`mode` 为 `record`、`ppt` 或 `interactive`。返回值作为后续 `prepare` 的 `context.data`。 |
| `prepare(state, frame, { signal, data })` | 应用当前提交状态，并在画面可截图后完成。返回 Promise 时，精确定位和导出会等待。 |
| `readyTimeoutMs` | 初始化超时，默认 15000 毫秒。新帧不会重启这段等待。 |
| `timeoutMs` | 单帧准备超时，默认 15000 毫秒；从初始化完成后开始计时。 |
| `dispose()` | 可选的资源释放函数，可以返回 Promise。 |

句柄提供以下操作：

- `setState(state)`：提交期望状态，不直接调用渲染器。传入 `null` 或 `undefined` 时隐藏宿主，并停止等待它的逐帧准备；已开始的初始化继续共享。
- `ready()`：显式预加载，返回共享的初始化 Promise 和初始化数据。
- `retry()`：初始化失败后显式发起一次新尝试。初始化成功或仍在进行时，返回已有 Promise。
- `status`：读取初始化阶段：`idle`、`loading`、`ready`、`failed` 或 `disposed`。
- `state`：读取最近提交的状态，便于业务巡检；不要通过它修改已提交的对象。
- `dispose()`：取消等待、移除平台回调并释放资源。可以 `await`；重复调用返回同一个清理 Promise。

初始化失败会保留失败结果，不会自动反复重试。初始化函数应检查自己的 `signal`，并清理取消时已经创建的部分资源。销毁后的句柄不能重试，应重新登记。

## 接入 iframe

父页面创建宿主和其中的 iframe，但不必提前设置 iframe 的 `src`：

```js
const model = V.iframeSource({
  id: 'model',
  src: 'assets/model/index.html',
  element: () => host, // 也可以直接返回 iframe
  active: frame => Boolean(V.scenes[frame.sceneIndex].usesModel),
  preload: env => !env.isRecord,
});

model.setState({ camera: [20, 15, 30], progress: 0.4 });
```

平台按父页面启动模式设置 URL 中的 `record`、`capture`、`ppt` 参数，并通过协议传递模式。需要完全自行维护 URL 参数时设置 `passMode: false`。`origin` 默认取目标 URL 的来源，也可以显式指定完整来源，例如 `https://model.example.com`；不接受 `*` 或不透明来源。

子页面在业务桥接脚本之前加载平台客户端。路径按实际目录调整：

```html
<script src="../../../base/js/frame-client.js"></script>
<script src="model-adapter.js"></script>
```

客户端不依赖 `V` 或 Three.js：

```js
const client = VFrameClient.connect({
  // 默认从 document.referrer 获取父页面来源；没有 referrer 时应显式填写。
  origin: 'https://video.example.com',
  async initialize({ signal, mode }) {
    await model.ready({ signal });
    model.setMode(mode);
  },
  async prepare(state, frame, { signal, mode }) {
    await model.renderAt(state, frame.now, { signal, mode });
  },
  dispose() { return model.dispose(); },
});
```

父子端校验来源、窗口、连接编号和请求编号；旧请求的完成消息不会确认新帧。子端可通过 `client.ready` 和 `client.frameId` 读取初始化完成状态及最后完成的帧编号。父端销毁连接时会调用子端的 `dispose`；本地 `client.dispose()` 还会移除协议监听。子端释放函数应允许在初始化未完成时执行。

iframe 自行导航或刷新后，应销毁旧句柄并重新登记，避免沿用上一页的初始化结果。

## 渲染器的责任

初始化的 `signal` 与逐帧准备的 `signal` 相互独立。新帧取消旧的准备请求，但继续等待同一次初始化。异步适配器须在写入画面前检查逐帧 `signal`，避免旧结果覆盖新状态。

录制模式下，适配器应停用自由镜头、自发补间等独立更新，再按指定时间计算完整画面。平台不会拦截任意外部程序的 RAF 或计时器，也不会替模型计算领域状态。

每次 `prepare` 的完成都应表示本帧已可截图。仅表示“加载完成”或“更新请求已发送”不足以完成本帧准备。
