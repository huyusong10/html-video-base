# 内容读取与定向截图

标题、分镜、台词、词锚和时间区间由框架统一读取。业务负责课程排序、署名、门户展示和额外检索规则，不需要自建脚本沙盒或为新 API 补空函数。

## 读取视频内容

```js
import {
  readVideoMetadata,
  readVideoCatalog,
  createVideoManifest,
  createSearchIndex,
} from 'html-video-base/content';

const video = readVideoMetadata({ projectRoot, id: 'intro' });
const catalog = readVideoCatalog({ projectRoot, ids: ['intro', 'details'] });
const manifest = createVideoManifest(catalog, {
  mapVideo: video => ({ department: video.config.dept || '' }),
});
const index = createSearchIndex(catalog, {
  mapVideo: video => ({ chapter: chapterById.get(video.id) }),
  mapScene: scene => ({ keywords: keywordsByScene.get(scene.id) || '' }),
});
```

`projectRoot` 是一支或一组视频所在的工程目录，其下应有 `videos/`。未提供时使用命令启动时的工程根目录。多课程如何选择工程和共享素材，继续由业务脚本安排。

`readVideoMetadata()` 返回可序列化的普通数据：

| 字段 | 内容和用途 |
| --- | --- |
| `config` | 有效视频配置；函数不包含在返回值中。业务从中读取署名等额外字段。 |
| `title`、`subtitle`、`description` | 清单和检索入口使用的标题与说明。 |
| `width`、`height`、`fps`、`ppt` | 创建预览、截图或导出任务时使用的规格。 |
| `duration` | 当前布局下的全片时长，单位为秒。 |
| `scenes` | 按配置脚本顺序排列的场景。每项包含 `id/index/title/start/duration/lines/cues/sourceScript`。`lines` 保留声明的词锚，`cues` 使用场景局部时间。 |
| `layout.source` | `baked` 表示使用了有效固化时间轴；`estimated` 表示按当前配置和可用配音信息计算；旧的自定义运行时未报告来源时为 `unknown`。使用 `ignoreBaked: true` 可以明确重新计算。 |
| `assetReferences` | 默认是 `null`。传入 `includeAssets: true` 后，扫描当前视频的 `index.html`、`style.css`、配置及分镜静态字面量中的素材引用，不递归读取其他 CSS 或脚本；运行时拼接出的路径不保证可枚举。 |

传入 `includeLiterals: true` 后，场景增加 `literals`，包含 `V.scene()` 或 `V.scenes.push()` 场景声明中的静态字符串。业务可自行筛选画面关键词。动态创建的场景仍可读取时间轴，但不保证能关联到某个源声明的字面量。

`readVideoCatalog({ ids })` 保留传入 ID 的顺序；省略 `ids` 时发现当前工程中的全部视频。它只读取数据，不启动浏览器。

固化布局的全片时长须为正数，场景起点与时长须为非负数。缺失这些字段、含有非有限数值，或台词区间格式有误时，框架会回退到 `estimated` 布局。

`createVideoManifest()` 生成默认清单字段，`mapVideo` 可以补充或覆盖字段。`createSearchIndex()` 返回 `{ videos, scenes }`，默认跳过章节过场和无台词的 PPT 跳过页，`mapVideo/mapScene` 负责业务字段。`readVideoManifest({ projectRoot })` 可读取框架格式的 `window.VIDEO_MANIFEST = [...]` 数据文件，用于保留业务额外字段。

## 只选择需要的截图点

```js
import { withAuditSession, sampleFrames } from 'html-video-base/audit';

await withAuditSession({ projectRoot }, async audit => {
  const video = await audit.openVideo('intro');
  const points = sampleFrames(video.metadata, {
    scenes: [2],
    cues: [1],
    positions: ['early', 'mid', 'end'],
  });
  await video.captureMany(points, { outDir: '.runtime/audit/intro' });
});
```

场景和台词下标从零开始。`sampleFrames()` 默认使用 `smoke` 模式，仅选择首幕首句的三个时间点。显式传入 `scenes` 或 `cues` 后，仅在选定范围内采样。

- `mode: 'summary'`：每幕取首句、中间句和末句。
- `mode: 'all'`：选择全部台词；需要扩大范围时明确使用。
- `positions`：可用 `early/mid/end`，也可传入 `0..1` 的句内比例。没有台词的场景使用场景中点。

采样点包含 `name/time/sceneIndex/cueIndex`，时间统一为全片秒数，并限制在对应场景内。业务也可以直接提供 `{ name, time }` 或数值时间点。

`video.metadata.layout.source` 为 `browser`，表示场景区间来自当前页面的实际布局；`timingSource` 仍说明该布局使用固化还是估算时间轴。启动浏览器不会自动提高配音时间精度。

## 批量捕获与业务断言

`captureMany(points, options)` 在同一视频会话中串行执行整批定位、等待和 PNG 截图，不会与该会话中其他定位操作交错。返回每个点的帧状态和文件路径。默认不在内存中保留整批图片。

| 选项 | 用途 |
| --- | --- |
| `outDir` | 保存截图的目录。生成文件名根据采样点命名，过滤路径分隔符。同批路径重复时追加 `_2`、`_3` 等编号，保留每张截图；方法不会清理已有文件。 |
| `screenshot` | 传给单张截图的 Playwright 截图选项。 |
| `retainImages: true` | 在返回结果中保留 `image`，适合少量帧比较。 |
| `onCapture(item, image)` | 每帧完成后的异步回调，适合流式保存业务检查结果。不要在回调内等待同一视频会话的另一次定位。可调用 `video.close()` 结束会话；当前批次以 `AbortError` 结束，已保存的 PNG 保留。 |
| `signal` | 取消任务；取消后不开始下一张截图，已经保存的文件保留。 |

角色骨骼、模型路线和业务文字的正确性仍由业务断言。默认根据改动选择场景或代表性接入，确实需要时再显式扩大范围。
