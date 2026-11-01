# 影之刃零全收集检查器 / PBZItemlist

《影之刃零》的存档查漏与物品位置工具。导入 `.sav` 文件，检查遗漏的收集物、铃铛和任务记录；也可以直接浏览清单。

## 在线使用

**[打开影之刃零检查器](https://game.kero.zone/phantom-blade-zero/)** · **[English](https://game.kero.zone/phantom-blade-zero/en/)**

[游戏全收集检查器入口](https://game.kero.zone/)是多游戏工具的总入口，当前提供影之刃零检查器。

打开网页后选择自己的 `.sav` 文件即可，存档在浏览器本地解析，无需安装。

[使用指南](docs/USAGE.md) · [地形说明](docs/TERRAIN.md) · [存档与隐私](docs/PRIVACY.md) · [开发说明](docs/DEVELOPMENT.md) · [参与贡献](CONTRIBUTING.md)

当前目录包含 **13 类、698 个收集点位**，另有任务名称与分支目标说明。点位数量是本工具的数据口径，不等同于游戏内物品总数或地图完成度。

界面提供简体中文和英文。英文名称优先采用游戏英文文本，保留中文名称供搜索；语言切换不改变点位编号、坐标或完成判定。默认地图使用游戏原生美术贴图与游戏 UV 标记，也可切换分层平面图和世界坐标。

默认地图保留 **1024 像素预览**作底，每张约 100 KB；8 张共用预览合计 **777,384 字节**。放大时按当前视野加载 2048、4096 或原生最高 8192 像素级别的 512 像素 WebP 切片，同时挂载不超过 36 块。全套 2,548 块切片共 **119,700,168 字节**，这是磁盘总量，不是首次下载量；浏览器自身缓存与实际内存由浏览器管理。默认地图不加载楼层几何或地形清单。

滚轮围绕指针位置缩放，最高 32 倍；拖动平移、双指缩放和双击放大均可使用。鼠标位于地图、标记或地图按钮上时，滚轮操作留在地图内，达到缩放上限也不滚动网页。标记保持较小的屏幕尺寸，选中点显示定位十字；楼层轮廓采用 SVG 矢量，放大不会出现低分辨率画布的锯齿块。

可选分层平面图使用独立、简化后的导航轮廓，按 5 米高度层整理，用于查看楼层关系，不是完整游戏场景。原始包、完整导航转储和 HLOD 场景资源不随站点发布。数据边界见[地形说明](docs/TERRAIN.md)；UV 精度边界见[地图投影说明](docs/MAP-PROJECTION.md)。本工具不计算路线。

楼层轮廓覆盖 9 个来源世界、12 个原生地图分区，gzip 合计 **1,128,873 字节**，不在默认游戏地图中下载。当前页面只提供二维视图，不加载 WebGL 或 3D 模型；选中物品不会自动限制附近高度。

## 能做什么

- 在浏览器中解码 **PBZS 3** 存档，支持自动与手动槽位，默认选择最近保存的可用槽位。
- 按地图、类别、名称或编号筛选，集中查看未完成与待确认点位。
- 在游戏贴图、分层平面图与世界 XY 间切换；按高度区域核对物品，查看原生 XYZ 和附近铃铛。
- 查看完成依据与可核对条件；独立浏览任务状态、当前分支及已完成分支。
- 导出当前筛选结果为 CSV，或清空当前页面中的存档会话。

收集类别包含铃铛、黑石碎片、杀气琥珀碎片、记忆之花、钥匙、主要物品、武器、杀器、饰品、药品，以及龙柱、榕树和稻草人挑战。

## 存档如何处理

存档读取、解码与状态计算都在当前浏览器内完成。应用没有存档上传接口、账号系统或存档持久化；不会写回或修改游戏存档。刷新页面或清空会话后，需要重新选择文件。

页面需下载 HTML、JavaScript 与图鉴；地图图像、可选楼层数据和存档所需的 WebAssembly 解码器按需加载。这些资源请求不携带所选存档内容。

线上有独立的交互访问计数，只在用户真实操作页面后发送一次公开页面访问，不记录存档、搜索或筛选操作。计数内容、DNT／GPC 支持及当前浏览器停用方法见[隐私说明](docs/PRIVACY.md)。

## 本地运行

运行站点只需 Python 3，无需安装 npm 依赖或执行构建：

```sh
git clone https://github.com/geturin/PBZItemlist.git
cd PBZItemlist
python -m http.server 8767 --bind 127.0.0.1 --directory public
```

打开 <http://localhost:8767/> 进入游戏入口，或直接打开 <http://localhost:8767/phantom-blade-zero/>。英文工具页位于 `/phantom-blade-zero/en/`。请通过 **HTTPS 或 localhost** 访问；直接双击 `index.html` 的 `file://` 方式不适用于模块加载与 WebCrypto。

浏览器需要支持 ES modules、WebCrypto、`DecompressionStream` 和 WebAssembly SIMD。格式不支持或文件校验失败时，页面会显示错误。

## 开发与测试

使用 Node.js **20 或更新版本**和 npm：

```sh
npm ci
npm test
```

更新静态界面或翻译后，执行 `node scripts/build_pages.mjs` 生成英文页面、站点地图和 robots.txt；`node scripts/build_pages.mjs --check` 检查生成结果是否过期。

测试覆盖图鉴与完成判定、贴图和楼层轮廓的独立加载、地图投影、请求取消、存档解码、双语静态路由及界面交互。UI 默认使用合成加密双槽存档，验证三态统计、切槽、任务筛选和 CSV，无需个人存档。可单独运行 `node tests/ui.test.mjs`；设置 `PBZ_TEST_LANGUAGE=en` 可测试英文页。合成解码用例调用真实 WASM 的 Oodle stored frame，但不覆盖实际游戏中的 Mermaid 熵压缩流。用例数量以测试输出为准。

可使用环境变量 `PBZ_TEST_SAVE` 为 UI 增加真实存档回归；解码器与独立原生结果的比较则使用另一套可选目录参数。两种方式及其输入要求见[开发说明](docs/DEVELOPMENT.md#可选的真实存档检查)。仓库不附带真实存档或其解密 JSON。

DOM 仿真用于验证交互逻辑，不能代替真实浏览器的显示、布局和兼容性检查。

## 打包与部署

在项目根目录执行，需要 Python 3：

```sh
npm run package
```

也可直接执行 `python scripts/package.py`。输出为 `dist/PBZItemlist.zip`，ZIP 根目录即 `public/` 中的站点内容；将其解压到静态站点根目录，并通过 HTTPS 访问即可。打包流程不生成独立的源码 ZIP 或上游源码归档；完整项目源码及 ooz 对应源码保留在本仓库。

## 项目结构

```text
public/                 可直接部署的静态站点
  index.html            中文游戏入口
  en/index.html         生成的英文游戏入口
  phantom-blade-zero/   中文工具及生成的英文工具页
  css/app.css           响应式样式
  js/app.js             本地导入、筛选、坐标图与交互
  js/map-view.js        游戏投影与世界坐标的独立绘图
  js/terrain-data.js    可选楼层数据的独立加载、取消与缓存释放
  js/map-interaction.js 指针锚定缩放、平移与双指操作
  js/map-tiles.js       当前视野内的原生地图切片
  js/terrain-2d.js      楼层轮廓的 SVG 矢量绘制
  js/save-codec.js      PBZS 3 读取与校验
  js/completion.js      点位及任务状态分析
  js/i18n.js            双语文案与图鉴名称覆盖
  data/catalog.json     精简图鉴与判定标识
  data/catalog.en.json  英文名称覆盖，不复制坐标与规则
  data/map-images/      游戏贴图的轻量预览
  data/map-images-hi/   原生最高 8K 地图的分级切片与清单
  data/terrain-low/     可选二维楼层轮廓及清单
  vendor/ooz-wasm/      固定版本解码器、许可证和对应源码
tests/                  自动化测试
scripts/                检查与发布辅助脚本
  package.py            将 public/ 打包为静态站点 ZIP
  build_pages.mjs       生成双语静态页及搜索引擎元信息
docs/                   使用与开发文档
dist/                   打包生成目录，不作为源码提交
LICENSE                 GPL-3.0-or-later
```

`public/` 是站点发布根目录。GitHub 源码仓库、静态站点与用户本地选择的存档是三个独立部分；部署时无需携带存档或测试样本。

## 数据保留范围

当前站点使用的整理结果包括名称、类别、地图、原生坐标、逐点地图投影、地图画布比例、完成判定标识、必要的事件关联、任务目标、地图贴图的预览与细节图，以及简化的楼层示意。少量资源标识用于追溯某条判定的依据。旧版高密度导航派生文件仍保留在源码的 `public/data/terrain/`，供回归比较；当前页面不请求它们，打包时排除整个目录。

发布包不包含游戏可执行文件、原始资源包、完整解包目录、原始投影锚点、旧版高密度导航派生网格或场景网格、源全尺寸 PNG、整份脚本或本地化转储，也不包含个人存档、解密后的私人进度、调查临时文件或服务器凭据。地图切片由原生贴图生成，源 PNG 留在私有分析目录。`vendor/ooz-wasm/` 中的开源解码器及其对应源码属于应用运行与许可证履行所需内容。

## 判断结果的边界

“待确认”表示当前记录不足以作出判断。任务关联、周目差异与点位统计口径见[使用指南](docs/USAGE.md)；导航表面覆盖及限制见[地形说明](docs/TERRAIN.md)，UV 精度边界见[地图投影说明](docs/MAP-PROJECTION.md)，判定规则见[数据说明](docs/DATA.md)。

本工具为非官方项目。遇到不一致时，可查看物品详情中的判断依据，再对照游戏内状态；反馈方法见[贡献指南](CONTRIBUTING.md)。

## 许可证与第三方来源

应用代码使用 **GPL-3.0-or-later**，全文见 [LICENSE](LICENSE)。

本地 Oodle 解压由固定版本 **ooz-wasm 2.0.0** 提供，同样使用 GPL-3.0-or-later：

- [第三方归属与构建说明](public/vendor/ooz-wasm/ATTRIBUTION.md)
- [随仓库提供的对应源码](public/vendor/ooz-wasm/source/)
- [固定版本与来源校验记录](public/vendor/ooz-wasm/PROVENANCE.json)
- 上游：[SnosMe/ooz-wasm](https://github.com/SnosMe/ooz-wasm)、[powzix/ooz](https://github.com/powzix/ooz)

已停用的 3D 实验代码及 Three.js 依赖仅在源码中归档，不随站点发布。归档依赖的 [MIT 许可证](public/vendor/three/LICENSE)、[归属说明](public/vendor/three/ATTRIBUTION.md)与[来源记录](public/vendor/three/PROVENANCE.json)仍保留；应用整体许可证不取代第三方自身许可证。

游戏名称及相关内容的权利归其各自权利人所有。
