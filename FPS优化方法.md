# God's Eye View — 提高帧率（FPS）的方法清单

> 本机实测数据（Alienware / RTX 3060 Laptop + Intel UHD，Chrome，1920×912@DPR1.25，航线图层开）。
> 详见文末「实测对照」。所有改动均可还原。

## 0. 最根本的一条：让浏览器用独显，而不是核显
**这是本机最大的坑**。Chrome 默认跑在 **Intel UHD 核显** 上，God's Eye View 这种 WebGL 重应用会被拖到个位数帧。已修复：
- 注册表 `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` 给 `chrome.exe` / `msedge.exe` 加 `GpuPreference=2;`（= 高性能/独显）。
- 验证：`WEBGL_debug_renderer_info` 从 `Intel(R) UHD Graphics` 变成 `NVIDIA GeForce RTX 3060 Laptop GPU`。
- 对应 GUI：Windows 设置 → 系统 → 显示 → 显卡 → 把浏览器设为「高性能」。

## 1. 渲染分辨率（resolutionScale）
- 应用内：`viewer.resolutionScale`。1.25 相当于 2400×1140 渲染，像素量是 1.0 的 1.56 倍。
- 降到 **1.0 / 0.7** 直接省像素：实测 1.25→0.7 大约 **+2 FPS**（此项对 GPU 不是瓶颈时收益有限，但对弱 GPU 明显）。
- 计划：性能模式用 0.7；日常 1.25（画质优先，用户可自选）。

## 2. 三维瓦片精细度（3D Tiles / 地形 LOD）—— 收益大
- `tileset.maximumScreenSpaceError`（默认 16）和 `scene.globe.maximumScreenSpaceError`（应用设成 2）。
- **放宽到 48~64** → 更少/更粗的瓦片被请求与绘制：实测瓦片 MSE 16→64 **+6 FPS**。
- 可加 `tileset.maximumNumberOfLoadedTiles` 上限，限制并发瓦片数。

## 3. 后处理 / 风格滤镜（PostProcessStage）—— 单项收益大
- 应用有 12 个全屏后处理阶段（11 个风格 shader + 1 个锐化），同时只有 1 个启用，但**每个全屏 pass 都要多渲一遍整个画面**。
- **关掉后处理**：实测 **+10 FPS**（关掉后处理 + 瓦片 LOD + 分辨率，从 17 → 36）。
- 取舍：关后处理会丢掉「夜视/热成像/琥珀/X光…」风格观感 → 做成「性能模式」开关让用户选。

## 4. 航班图层的 billboard 数量 —— 最大单项成本
- 应用一次性把 **全球约 1.3 万架**航班全塞进一个 BillboardCollection，然后靠视锥/地平线剔除「显示」。剔除只减绘制，**集合本身仍有 1.3 万个实例要处理**。
- 实测：**关掉整个航班层 17 → 93 FPS（+76）**。这是压倒性的单项。
- 更优做法（如需进一步提速）：只把**当前视区附近**（如 <400 km）的航班加入集合、远处的从集合移除，而不是全量加入再隐藏。或在密集区降低「接触密度」。
- 军机层（adsb.lol）同理，数量小得多。

## 5. requestRenderMode（按需渲染）
- 应用已有「空闲渲染调控器」：静止时切到 `requestRenderMode`，只在相机/数据变化时重绘 → 空闲几乎不耗 GPU。
- 注意：**在后台标签页，应用会主动挂起渲染循环**（`document.hidden` → `useDefaultRenderLoop=false`），这是省电设计，不是卡。

## 6. 分辨率缩放 / DPR 之外的小项
- `viewer.targetFrameRate`：封顶帧率（如 30）可省电、平滑抖动（不提升上限帧率）。
- `msaaSamples`（抗锯齿，默认 4）：4→1 可省一些带宽（需在创建 viewer 时改，运行时改不了）。
- 关 `skyAtmosphere` / `fog` / `showGroundAtmosphere`：本机收益很小（~1 FPS），弱 GPU 可关。
- 关 HDR / 阴影：应用默认已关。

## 7. 通用工程手段（供后续）
- 用 `InstancedMesh`/单次 draw 合并模型；3D 机型每个是一个独立 draw，数量大时很贵。
- 标签（label）合并、限制同屏 label 数。
- CDP/DevTools 的 Rendering 面板开「FPS meter」，Performance 面板录帧定位耗时函数。
- 降画布尺寸（小窗/降 DPR）直接线性省像素。

## 实测对照（前台可见，RTX3060，航班层开，同一视角）
| 配置 | FPS |
|---|---|
| 基准（rs1.25 / 瓦片MSE16 / 后处理开 / 航班开） | 17.2 |
| 瓦片 LOD 放宽 MSE→64 | 23.6 |
| ＋渲染分辨率 rs→0.7 | 25.6 |
| ＋关后处理 | **35.8** |
| ＋关航班层 | **92.9** |
| （修复前）核显 Intel UHD 前台 | ~8 |

## 已落地
- 系统：Chrome/Edge GPU 偏好 = 高性能（RTX 3060）。
- 应用：`src/gev-perf.js` —— 底部「性能模式」按钮（一键 rs0.7 + 瓦片 LOD48 + 关后处理 + 帧率封顶30）+ 常驻 FPS 徽标；`index.html` 加 1 行引入。删文件+删行即还原。
