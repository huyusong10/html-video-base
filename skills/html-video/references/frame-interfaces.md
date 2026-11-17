# 帧状态、外部画面与自定义巡检

分镜、持久层和插件可以读取统一的只读帧快照。iframe、外部 Canvas 等画面通过 `V.frameSource()` 参与异步定位，巡检与 MP4 导出等待相同的准备流程。

## 读取当前帧

在 `update(t, x)` 中读取 `x.frame`，在持久层与 `onRender(info)` 中读取 `info.frame`。独立组件可以调用 `V.getFrameState()`；首次渲染前返回 `null`。

| 字段 | 用途 |
| --- | --- |
| `id` | 区分更新请求。只用于匹配异步结果，不作为动画时间或缓存标识。 |
| `now`、`lt` | 全片与场景局部的叙事时间，单位为秒。`lt = now - scene.start`。 |
| `clock`、`alive`、`sceneClock` | 环境时钟；暂停时可以继续，录制时 `clock = now`。`sceneClock` 相对当前场景起点。 |
| `idle`、`uiDt` | 暂停环境时间和交互更新间隔，单位为秒。录制及精确定位的 `uiDt` 为零。 |
| `playing`、`ended` | 播放与结束状态。拖拽、切语言等待期间不视为正在播放。 |
| `isRecord`、`pptMode` | 页面启动时确定的录制和 PPT 模式。业务只读。 |
| `pointer` | 独立的只读指针快照。`active` 表示窗口内已收到指针输入，离开窗口或失焦后为假；`rawX/rawY` 允许超出舞台；`overUI` 表示命中控件或 `[data-video-ui]` 区域。 |
| `energy` | 当前场景、当前叙事时间的语音能量。业务结合播放状态决定是否驱动口型。 |

原有 `x.at()`、`x.cue()`、`x.clock` 等接口保持兼容。末幕交互续时的 `update` 入参行为不变；帧中的叙事时间与环境时间分别表达。前一幕参与持久层混合时，其上下文获得同一帧编号下的局部时间与能量。

字幕的 `onUpdate(cue, info, dom)` 同样提供 `info.frame`。组件初始化时使用只读的 `V.environment`：`isRecord`、`pptMode` 和 `mode`（`record`、`ppt`、`interactive`），无需等待第一帧。

## 控制播放与定位画面

业务按钮使用 `V.player` 控制播放器：

```js
V.player.goToScene('intro');
V.player.goToScene(2, { sandbox: true, hint: '调整参数后返回' });
V.player.seek(30);
V.player.play();
V.player.pause();
V.player.replay();
```

`seek()` 同步音轨、检查点和跳转事件，PPT 模式下跳到对应页面；`goToScene(indexOrId, { offset })` 的场景序号从零开始，局部偏移默认为 0.05 秒。PPT 页码从一开始，使用 `goToPage(page)`、`nextPage()`、`prevPage()`。`getState()` 返回即时的播放状态、时间、场景、模式、试玩状态和页码。`tryAt(time, hint, options)`、`exitSandbox()` 可直接控制试玩。

`V.seekTo()` 与 `V.seekToAsync()` 保留工具定位画面的语义，不替代用户跳转。自定义导出和截图仍使用异步定位或巡检会话，以等待外部画面完成。

## 接入外部画面

```js
const unregister = V.frameSource({
  id: 'model',
  element: () => model.host,
  active: () => model.visible,
  timeoutMs: 15000,
  async prepare(frame, { signal }) {
    await model.prepare(frame, { signal });
  },
  dispose() { model.dispose(); },
});
```

`element()` 返回已连接的宿主节点；节点尚未创建或 `active()` 为假时，不等待该源。`prepare()` 的成功表示本次参数已应用且画面可截图，不能只表示模型已加载。初始化等待、相机和模型参数转换由业务适配器完成。

框架先更新分镜、字幕、持久层和同步 `onRender` 回调，再准备外部源。`await V.seekToAsync(t)` 等待图片、视频和所有活跃外部源，返回这次帧快照。正常播放不阻塞音频与界面；新帧取消旧请求，适配器须检查 `signal`，防止过期结果写回。跨 iframe 时还应匹配请求编号和目标窗口。

每次准备有独立的超时预算。精确定位、录制与导出遇到错误会失败；预览通过 `onFrameError({ frame, error })` 和控制台报告错误。注销会取消该源正在等待的任务，并调用 `dispose()`；重复注销无副作用。

活跃外部源和 iframe 默认不复用静止帧。业务必须在录制时停止自由镜头、自发补间等独立更新，以保证同一时间产生同一画面。同步等待本身不会让任意外部程序自动满足这个约束。

## 自定义巡检

```js
import assert from 'node:assert/strict';
import { withAuditSession } from 'html-video-base/audit';

await withAuditSession({ projectRoot: '/project/course' }, async audit => {
  const video = await audit.openVideo('demo', { mode: 'record' });
  const first = await video.capture(1);
  await video.seek(0);
  const again = await video.capture(1);
  assert.deepEqual(first.image, again.image);
});
```

一门课程对应一个 `projectRoot`，目录下应有 `videos/`。同一会话复用服务与浏览器，各视频使用独立页面；回调失败时也会关闭资源。

- `openVideo(id, { mode, lang })`：模式可为 `record`、`interactive` 或 `ppt`。页面初始暂停，模式不可通过修改内部字段切换。
- `openPage(pathname, options)`：打开同一服务上的门户等普通页面，等待加载和字体完成，返回 Playwright 页面；`options` 可设置视口。会话结束时统一关闭。
- `video.metadata`：页面完成初始布局后的时间轴快照，包含时长、场景与字幕区间；换语言或重布局后应重新打开视频。
- `video.seek(t)`：等待精确定位，返回帧快照。
- `video.capture(t, options)`：串行完成定位和 PNG 截图，返回 `{ frame, image }`；可传入截图路径等 Playwright 截图选项。
- `video.page`：供业务发送鼠标事件、读取角色 DOM。交互截图中的环境时钟仍会推进；精确帧比较应使用 `record` 模式。
- `video.issues`：运行错误、非可选资源错误及帧准备错误的快照。业务负责断言与最终门禁策略。
- `video.close()`：提前关闭视频页面；会话结束会关闭剩余页面。

只需要静态服务时，可使用 `startVideoServer({ projectRoot, host, port, watch })`，从 `html-video-base/server` 导入。默认监听本机随机端口，返回 `{ origin, close }`；`await close()` 会结束连接并释放服务。
