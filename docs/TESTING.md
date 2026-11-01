# 测试

公开仓库的基础测试不需要个人存档，也不需要安装或运行游戏。测试只读取仓库中的应用代码与整理后的静态目录，不连接生产站点。

## 环境与命令

使用 Node.js 20 或更新版本；本次核验使用 Node.js 24.21.0。打包另需 Python 3。`happy-dom` 仅用于开发测试，版本由 `package-lock.json` 固定，不参与静态站点运行。

在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm test
```

`npm test` 按顺序运行以下检查，任何一步失败都会停止。修改静态模板或翻译后先执行 `npm run build`；测试不自动覆盖生成的页面。命令以 `package.json` 当前脚本为准。

```sh
node scripts/build_pages.mjs --check
node scripts/validate_catalog.mjs
node tests/pages.test.mjs
node tests/completion.test.mjs
node tests/map-view.test.mjs
node tests/map-interaction.test.mjs
node tests/map-tiles.test.mjs
node tests/i18n.test.mjs
node tests/terrain-data.test.mjs
node tests/terrain-loading.test.mjs
node tests/terrain-assets.test.mjs
node tests/analytics.test.mjs
node scripts/test_codec.mjs
node tests/ui.test.mjs
node tests/ui.test.mjs en
```

排查问题时可以单独执行对应命令；正常完整检查执行一次 `npm test` 即可。

## 不带个人存档时的覆盖范围

| 检查 | 命令 | 已核验的结果与范围 |
| --- | --- | --- |
| 生成与路由 | `node scripts/build_pages.mjs --check`、`node tests/pages.test.mjs` | 检查两份英文页、robots.txt、sitemap 可复现；四个静态路由的 canonical、hreflang、语言切换、资源路径、FAQ 与 JSON-LD 一致性；入口保持简洁，工具有独立地图模式与折叠详情。 |
| 静态目录 | `node scripts/validate_catalog.mjs` | 检查 698 个点位、13 类目录、187 个铃铛参照和 80 条任务元数据，以及 ID 唯一性、地图和类别引用、坐标、条件关系和运行时目录不含原始解包来源字段。 |
| 完成规则 | `node tests/completion.test.mjs` | 验证周目、Actor 与事件节点记录的存在性、已消耗钥匙、部分存档缺字段、任务关联与已知前置的区别，以及 13 类目录的状态统计。 |
| 地图绘图 | `node tests/map-view.test.mjs` | 验证 UV 左上原点和 Y 向下、真实画布比例、筛选不改变游戏地图框、部分点无命中时不混用坐标系、非法点、强制世界坐标模式，以及固定世界范围。 |
| 二维地图操作 | `node tests/map-interaction.test.mjs` | DOM 仿真检查留白区域坐标换算、指针锚定缩放、整图／标记／按钮滚轮阻止页面滚动、缩放边界、拖动、双指、取消和解绑；不启动真实浏览器。 |
| 原生地图切片 | `node tests/map-tiles.test.mjs` | 检查原生图映射、三级原生尺寸，以及 2,548 块 WebP 的尺寸、边缘切片、内容哈希与字节统计。运行时切片挂载上限由 UI 用例核对，36 个节点不是浏览器内存预算。 |
| 双语数据 | `node tests/i18n.test.mjs` | 核对游戏英文名称样本和名称覆盖、中文搜索原文、缺译回退；翻译不改变 ID、坐标、规则、完成判定或铃铛距离。 |
| 楼层格式与轮廓 | `node tests/terrain-data.test.mjs` | 二维轮廓的有限值、多边形与洞、预算、gzip、长度、哈希、手动高度区域和地图取景检查；SVG 路径及洞填充由 UI 用例另行核对。 |
| 独立加载与取消 | `node tests/terrain-loading.test.mjs` | 使用 fetch 替身检查共享世界缓存、释放、请求取消、切图竞态、下载重试和路径限制，并确认二维加载无需 Worker。默认游戏贴图不加载楼层清单，以及页面不请求归档 3D，由 UI 用例另行检查。 |
| 发布地图资产 | `node tests/terrain-assets.test.mjs` | 按发布清单检查地图图像、楼层文件引用、文件大小、SHA-256、计数和高度分组；拒绝私人路径、缺失引用和不应发布的原始资产。具体资产数量以当前清单及测试输出为准。 |
| 访问计数 | `node tests/analytics.test.mjs` | 固定公开路由、首次真实交互门槛、每次页面加载最多一次、隐藏页与脚本事件排除、机器人／DNT／GPC／停用偏好、来源仅保留 origin，无私人请求体。 |
| 存档容器 | `node scripts/test_codec.mjs` | 默认使用合成数据，`private_fixture_used` 为 `false`。检查 WebCrypto AES-GCM、zlib、认证、时间与槽位选择、重复名称、越界、重叠、尾随数据、解压长度和资源限制，并运行真实 Oodle WASM 的 stored frame 烟测。 |
| 双语界面 | `node tests/ui.test.mjs`、`node tests/ui.test.mjs en` | 使用合成加密双槽存档与小型显示样本。核对三态统计、切槽、任务、CSV XYZ、中文名搜索、默认游戏预览与按视野切片、三种二维模式切换、标记反向缩放、无 3D 或附近高度控件、清空与错误；控制加载时序，防止旧异步结果覆盖新选择或留下旧高亮。 |

各项通过数量以本次命令输出为准；界面用例会随交互变化增加，不固定为某个旧版本的数量。

Oodle 烟测把自行生成的 JSON 包装为合成 stored frame，再经实际 WASM 模块解码，验证 WASM 的加载与调用链。stored frame 不需要执行真实 Mermaid 压缩数据的解码算法，因此这项测试不等同于真实游戏 Mermaid 压缩流的覆盖。

公开界面测试使用 Happy DOM，验证事件和 DOM 状态，不代表真实浏览器排版、浏览器 WebAssembly SIMD 或生产 HTTPS 环境已经通过检查。

UI 仿真中的资源请求为不带存档内容的 GET；独立访问计数的 POST 在 `analytics.test.mjs` 中以模拟浏览器验证。不能据此宣称网站没有网络统计，实际客户端行为见[隐私说明](PRIVACY.md)。

地图测试验证已生成 UV 的绘制和回退行为，不验证原生网格重建与运行中的游戏完全相同。离线预处理使用 Qhull；共圆点连边、浮点边界与三角网裁切细节仍需运行时比对，游戏自己的图标避让也会改变截图位置。详见[地图投影说明](MAP-PROJECTION.md)。

楼层资产测试验证发布文件及显示数据约定，并限制数据体积与面数；杀气塔三处独立高度以附近 5 米 XY 内、垂直偏差不超过 1.5 米的显示面复核，不沿用原始导航顶点的精确距离标准。图像检查覆盖 WebP 尺寸、比例、哈希与共享引用。这些检查不证明简化楼层面逐点等同于原始导航地面，也不能证明当前游戏状态下可达。共享世界、坐标转换和显示近似见[地形说明](TERRAIN.md)。

Node 与 DOM 仿真不启动真实浏览器或 GPU。CPU 微基准只能说明测量环境中的转换和分配开销，不能作为浏览器帧率、移动端触控或内存上限的实测结论。已停用的 3D 测试仅作源码归档，不属于默认发布验证。

## 可选的私有回归样本

开发时额外核验过真实 PBZS 的 AES-GCM 与 Oodle WASM 路径，并与原生解码结果作过比较。个人 `.sav`、解码后的各槽位 JSON、`.ooz` 文件及用户状态没有随仓库分发。

基础公开测试不需要以下入口。两种回归方式独立：codec 接收目录位置参数，UI 读取 `PBZ_TEST_SAVE` 环境变量。

### codec：与预期解码结果对照

```sh
node scripts/test_codec.mjs /path/to/private-fixture
```

目录应含 `source.sav`，以及该文件实际包含的每个游戏槽位和元数据槽位的同名预期 JSON。测试额外执行一项原生解码对照，要求至少存在一个游戏槽位，并逐槽比较完整 JSON 内容；不固定为五个槽位，也不固定某个用户的保存时间。此脚本不读取 `PBZ_TEST_SAVE`。

### UI：模拟导入自己的存档

在 POSIX shell 中：

```sh
PBZ_TEST_SAVE=/path/to/PBZSaveGame.sav node tests/ui.test.mjs
```

在 PowerShell 中：

```powershell
$env:PBZ_TEST_SAVE = 'C:\private\PBZSaveGame.sav'
node tests/ui.test.mjs
Remove-Item Env:PBZ_TEST_SAVE
```

设置后，UI 用该 `.sav` 替代默认合成双槽文件，执行相同的选择文件、切槽、状态重算、任务、CSV、清空和错误处理回归；期望值由 `analyzeSlot` 动态计算。它不需要 codec 回归目录中的同名 JSON，也不把环境变量作为 codec 的目录参数。可追加 `en` 参数或设置 `PBZ_TEST_LANGUAGE=en` 测试英文界面。

回归样本请放在仓库外。不要将其放入 `public/`、提交 Git，或作为发布包附件。正常应用的存档选择与解码均在用户浏览器本地完成。

## 结果文件

- `scripts/test_codec.mjs` 会生成或覆盖 `scripts/test_codec_results.json`，无私有样本时 `private_fixture_used: false`；有效私有目录另增加原生对照，用例数量以实际输出为准。
- `tests/ui.test.mjs` 会生成 `artifacts/ui-test-results.zh.json` 或 `.en.json`，记录语言、合成／私有 fixture 类型、检查结果与模拟资源请求；其验证方式标为 Happy DOM。
- 这些文件是运行结果，不是测试输入，不需要提交到 Git。

## 打包静态站点

在仓库根目录执行：

```sh
python scripts/package.py
```

也可以使用 `npm run package`。输出为 `dist/PBZItemlist.zip`，从 `public/` 中打包运行所需的应用、静态目录、许可证与解码器及其对应源码，并排除旧版 `data/terrain/**`。它不依赖仓库外的解包文件，也不包含开发测试目录或个人回归样本；旧版高密度导航派生文件仍保留在源码供回归比较。

压缩包内的 `index.html` 直接位于根目录。解压后以该目录作为静态服务器的文档根即可独立发布；无需 Node.js 服务端或存档上传接口。脚本会检查 ZIP 完整性和路径，并拒绝个人存档、密钥、原始 Unreal 资源及重复源码压缩包等文件。

## 手动浏览器检查

使用本机静态服务器提供 `public/`，例如：

```sh
python -m http.server 8767 --bind 127.0.0.1 --directory public
```

然后打开 `http://127.0.0.1:8767/`，进入检查器；同时核对 `/en/` 和 `/phantom-blade-zero/en/` 的静态英文入口：

1. 不选存档，核对类别与地图筛选、点位列表及载入前的计数。
2. 选择自己的 `.sav`，核对进度、槽位、最新时间和状态重算；在网络面板检查没有携带存档内容的上传请求。
3. 游戏地图始终保留当前 1024 预览作底，网络中不应出现楼层清单或几何。逐步放大并平移，检查 2K／4K／8K 级别仅加载视野切片，切片图像节点不超过 36 个；不应整套下载全部地图。最高细节为原生 8K，不把浏览器缓存当作节点上限的一部分。
4. 核对模式只包含游戏地图、分层平面图与世界坐标，没有 3D 入口或“附近高度”复选框。手动切换高度区域，选中物品时不自动改变所选高度；楼层采用 SVG 矢量。核对光标锚定滚轮、32 倍上限、拖动、双指、双击和缩放按钮；滚轮在标记／按钮上以及缩放边界时不带动网页，放大后标记仍小且选中点有定位十字。
5. 切图或换模式后，检查旧请求取消、底图和标记更新；返回可正常重载。再核对游戏 UV／世界坐标的独立布局、未校准点回退，并确认不请求归档 3D 模型或 Three.js。
6. 导出 CSV、切换槽位、清除数据，再选择无效文件，检查状态和错误提示。
7. 点选坐标和铃铛近邻，检查窄屏布局与键盘操作；比对游戏截图时记录地图、点位编号和高度，并考虑游戏图标避让造成的偏移。

WebCrypto 需要 HTTPS 或受信任的本机 localhost 环境。Oodle 解码还需要浏览器支持 WebAssembly SIMD；部署的 CSP 需要允许本站脚本及 `wasm-unsafe-eval`。原始游戏坐标的直线近邻仅用于定位，不代表道路可达性。

本地访问不会触发线上计数。生产检查时如需排除自己的交互访问，可使用[隐私说明](PRIVACY.md)中的浏览器停用偏好。

## ooz-wasm 的源码与构建

运行站点使用固定版本 `public/vendor/ooz-wasm/build/ooz.js`，其中内嵌 WASM；无需服务器端解码进程。相关 GPL、版权说明、版本与包校验信息应随代码保留。

`public/vendor/ooz-wasm/source/` 提供对应上游源码与 CMake 构建脚本。在安装 Emscripten、CMake 后，可在该目录运行：

```sh
emcmake cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

上游没有记录发布包所用的精确 Emscripten 版本。因此这里提供源码与构建步骤，不声称重建后能得到逐字节相同的二进制。
