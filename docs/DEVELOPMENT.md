# 开发说明

本项目为无构建步骤的静态应用。用户提供的存档只在页面内存中读取、解码和分析，站点无需后端、数据库或账号。

## 环境与常用命令

- 运行站点：Python 3，或其他能够正确提供 ES modules 的静态 HTTP 服务器。
- 执行项目测试：Node.js 20 或更新版本、npm。
- 打包静态站点：Python 3；`npm run package` 是 Python 打包脚本的命令入口。
- 在真实浏览器运行解码器：HTTPS / localhost、WebCrypto、`DecompressionStream`、WebAssembly SIMD。

```sh
npm ci
npm test
python -m http.server 8767 --bind 127.0.0.1 --directory public
```

访问 <http://localhost:8767/>。`npm` 依赖用于开发与测试；静态站点运行所需资源已放在 `public/`。

## 数据流与模块职责

```text
用户选择 .sav
  → save-codec.js：容器校验、认证解密、限额解压、JSON 读取
  → 按保存时间选择默认槽位
  → completion.js：结合 catalog.json 计算点位与任务状态
  → app.js：筛选、统计、详情与导出
  → map-view.js：游戏地图投影或世界坐标的绘图布局
```

| 文件 | 职责 |
| --- | --- |
| `public/index.html` | 页面语义结构、对话框及内容安全策略 |
| `public/css/app.css` | 响应式样式、焦点状态和减少动画支持 |
| `public/js/app.js` | 文件选择、槽位切换、筛选、SVG 坐标图、任务日志、CSV |
| `public/js/map-view.js` | 独立处理地图 UV 与世界 XY，固定画布、比例和刻度 |
| `public/js/save-codec.js` | PBZS 3 读取、WebCrypto AES-GCM、zlib / 本地 ooz-wasm 解压 |
| `public/js/completion.js` | 完成判定、周目判断、相关任务状态与附近铃铛 |
| `public/data/catalog.json` | 界面所需的精简静态记录 |
| `public/vendor/ooz-wasm/` | 固定版本 WASM 解码器、适配层、归属信息及对应源码 |
| `scripts/validate_catalog.mjs` | 图鉴结构、标识、地图与坐标校验 |
| `scripts/package.py` | 仅将 `public/` 内容打包为部署 ZIP |

`decodeSave()` 输出槽位对象及默认槽位名；`analyzeSlot()` 接收一个槽位与图鉴，返回点位、分类／地图摘要和任务记录。UI 不应自行根据名称或坐标猜测某项已经完成。

## PBZS 3 读取边界

读取器检查文件头、版本、目录边界、槽位名、数据段布局及声明长度，再认证解密和解压。当前实现的主要限制为：

| 项目 | 限制 |
| --- | --- |
| 存档文件 | 40 MiB |
| 目录数据 | 1 MiB |
| 单槽位解压数据 | 50 MiB |
| 全部槽位解压数据 | 150 MiB |
| 槽位数量 | 128 |
| 槽位名 UTF-8 长度 | 128 字节 |

修改限制时，应同步更新 UI 提示与对应测试。遇到未知版本或认证失败，应给出明确错误，不要跳过校验继续解释数据。

可用游戏槽位按保存时间排序；同一时间的选择还会参考存档中的继续游戏槽位和槽位名。分析基于用户选中的槽位，不把其他槽位的记录合并进当前结果。

## 完成状态约定

`done`、`missing`、`unknown` 分别对应已完成、未完成与待确认。

- 有可识别的激活、获得、场景拾取、敌群发奖或奖励事件记录时，按对应规则判定完成。
- 判定所需模块齐全且没有对应记录时，才可按规则显示未完成。
- 模块缺失、编号无法匹配或实际前置逻辑未恢复时，保持待确认。
- 某些装备需要核对获得周目。不要把“曾拥有”直接等同于当前周目完成，也不要把背包当前数量为零直接等同于从未获得。
- 钥匙可能已被使用；任务状态可能只是关联证据。任务完成、失败或进行中都不能替代某件物品自身的领取逻辑。

统计按目录中的可见点位计算。整花父项与花瓣、同一物品的多个来源以及不计入游戏总百分比的类别，必须保留明确口径。不要将 UI 点位比例改写为游戏内总完成度。

## 图鉴数据与精简原则

`catalog.json` 只保留公开应用需要的名称、类别、地图、世界坐标、逐点地图 UV、画布比例、判定标识、必要关联及任务目标。13 类、698 个点位是当前目录版本的范围，不是对全部可达内容的保证。

1.1.0 默认使用离线重建的游戏地图投影。旧版查看器把世界 XY 平面直接绘制为 X 向右、Y 向上的图，不能还原游戏按 `GroupZ` 分组、再按命中高度选择的锚点三角网格 UV，所以铃铛的相对方向可能不同。重建时使用 Qhull 生成 XY Delaunay 三角网，再按已确认的原生裁切、命中筛选和插值规则计算逐点 UV；Qhull 的共圆点连边及边界细节尚未与运行中的游戏比对。具体规则和证据见[地图投影说明](MAP-PROJECTION.md)。该预处理不在浏览器执行，运行或测试站点无需安装 Qhull。

`createMapView(points, mapMetadata, options)` 接收原始记录对象。游戏模式要求有效的 `mapProjection` 和至少一个有 `mapPosition` 的点，使用左上原点、Y 向下的 UV，并保持画布比例；缺 UV 的点返回 `null`，不混入世界坐标。传入 `options.mode: "world"` 可强制使用世界 XY。图层应以整个分区的点创建布局，再绘制筛选结果，避免类别筛选改变范围；世界模式也可通过 `mapMetadata.worldBounds` 固定边界。

两种模式都保留原生 XYZ，附近铃铛和 CSV 继续使用原生坐标。游戏自身的图标避让可能移动截图中的标记；离线投影不保证逐像素相同，也不提供路线导航。公开图鉴不包含用于预处理的原始锚点、网格或贴图。

更新目录时：

1. 记录适用的数据版本与证据，优先保留可复查的条目标识。
2. 核对地图归属、重复来源、聚合父项与缺失坐标。
3. 将确定的判定标识与未恢复的条件分开处理。
4. 只提交精简结果及必要说明，不提交完整资源转储或调查环境。

仓库不以重建完整游戏资源库为目标。游戏可执行文件、原始资源包、完整解包目录、贴图、整份本地化／脚本转储和个人存档不属于发布内容。

## 自动化测试

`npm test` 是默认入口，按以下顺序执行。任一步失败都会停止后续步骤。

| 顺序 | 脚本 | 默认覆盖 |
| --- | --- | --- |
| 1 | `scripts/validate_catalog.mjs` | 13 类、698 点位及铃铛／任务引用；编号唯一性、地图归属、字段与坐标格式 |
| 2 | `tests/completion.test.mjs` | 分类规则、缺失字段、周目、待确认边界及任务状态 |
| 3 | `tests/map-view.test.mjs` | UV 方向、贴图比例、固定画布、部分命中、非法点、世界坐标回退及强制切换 |
| 4 | `scripts/test_codec.mjs` | 合成检查：认证、zlib、排序、格式与长度边界，以及真实 WASM 解码合成 Oodle stored frame |
| 5 | `tests/ui.test.mjs` | DOM 仿真检查，包括图鉴类别、中性空态、位置浏览、投影模式与不携带存档的 GET 请求 |

各脚本用例数量以本次测试输出为准，不将 UI 数量绑定到固定版本的条目数。

默认测试不依赖真实存档。Oodle 合成用例使用 stored frame，验证 WASM 与读取器的接线和输出，但**不覆盖实际游戏存档中的 Mermaid 熵压缩流**；不要把这项结果当成全部真实压缩流的兼容性证明。

DOM 仿真检查不是实际浏览器验收，不能证明视觉布局、移动端触控、WebAssembly SIMD 或所有浏览器行为都正确。涉及这些行为的改动还需在有条件的真实浏览器环境中另行核对；不要把未进行的检查写成已经通过。

### 可选的真实存档检查

真实输入有两种独立检查方式。默认测试都不要求这些输入，仓库也不附带真实存档或解密结果。

#### UI 回归：`PBZ_TEST_SAVE`

令 `PBZ_TEST_SAVE` 指向自己持有的有效 `.sav` 文件，然后运行 `npm test`。这个变量由 `tests/ui.test.mjs` 读取，用于增加载入、槽位切换、筛选、详情、任务记录、CSV 和清空会话等 DOM 回归；**`scripts/test_codec.mjs` 不读取此变量**。

PowerShell：

```powershell
$env:PBZ_TEST_SAVE = 'C:\path\to\PBZSaveGame.sav'
npm test
Remove-Item Env:PBZ_TEST_SAVE
```

POSIX shell：

```sh
PBZ_TEST_SAVE=/path/to/PBZSaveGame.sav npm test
```

UI 期望值应从所选存档与当前判定模块推导，不依赖特定玩家的槽位数量、缺少物品或任务状态。这项检查仍是 DOM 仿真，不是独立原生解码比对或真实浏览器验收。

#### 独立原生比对：解码器目录参数

若另有独立原生解码结果，可将外部目录路径作为参数传给解码测试：

```sh
node scripts/test_codec.mjs /path/to/private-fixture
```

目录约定如下；示例槽位名需替换为实际文件中的全部条目名称：

```text
private-fixture/
  source.sav             原始 PBZS 存档
  AutoSave0.json         对应槽位的独立原生解码结果
  ManualSave1.json       其他实际槽位（如有）
  __Advanced__.json      对应元数据条目的独立解码结果（如有）
  ...                    每个游戏槽位和元数据条目均须有同名 JSON
```

脚本先运行默认的 24 项合成检查，再对真实输入解码，并将所有游戏槽位和元数据与同名 JSON 进行规范化内容比较。应使用独立产生的对照结果；把同一浏览器解码器的输出充当对照，不能提供独立验证。

存档与对照目录应留在仓库外。不要为了重现问题而提交真实样本、解密 JSON 或测试过程中的私人进度。测试日志只保留必要的检查结论，避免输出整份原始数据。当前通过数量以本次命令输出为准。

## 隐私与前端安全

- 保持所选存档在本地处理，不新增上传、遥测、账号或浏览器持久化流程。
- 将文件名、槽位名、任务和其他动态文本作为文本节点插入；不要用 `innerHTML` 拼接存档内容。
- CSV 导出保留公式注入防护，负数坐标等合法数值应保持可用。
- 依赖与 WASM 从同源静态目录加载，不临时改为远程 CDN。
- 保留 CSP；使用 WASM 时所需的策略与页面当前实现保持一致。
- 清空会话应同时清除分析结果与任务记录。

## 静态部署

发布根目录为 `public/`，无需 Node 服务或数据库。站点资源需保持相对路径关系，并通过 HTTPS 提供。

在项目根目录执行：

```sh
npm test
npm run package
```

`npm run package` 调用 `python scripts/package.py`，也可以直接执行后者。打包脚本需要 Python 3，只读取 `public/`，输出 `dist/PBZItemlist.zip`；ZIP 内不再套一层 `public/` 目录。脚本会检查禁止分发的文件扩展名、路径结构、UTF-8 文本和 ZIP 完整性，并输出文件数量、大小与 SHA-256。

脚本不代替 `npm test`，因此发布前应先执行测试。发布清单不应包含个人存档、解密进度、开发缓存、`node_modules/`、服务器凭据或完整游戏解包资料。`dist/` 为生成目录，不作为源码提交。

项目源码直接在 GitHub 仓库提供，不生成 `source.zip` 或上游 tar 归档。第三方对应源码保留在 `public/vendor/ooz-wasm/source/`，随静态站点一起打包；发布时同时保留应用与第三方的许可证及归属信息。

## ooz-wasm 及对应源码

站点使用固定版本 ooz-wasm 2.0.0。来源、完整性记录、适配层说明以及对应源码见：

- [ATTRIBUTION.md](../public/vendor/ooz-wasm/ATTRIBUTION.md)
- [PROVENANCE.json](../public/vendor/ooz-wasm/PROVENANCE.json)
- [source/](../public/vendor/ooz-wasm/source/)

上游为 [SnosMe/ooz-wasm](https://github.com/SnosMe/ooz-wasm)，底层解码器为 [powzix/ooz](https://github.com/powzix/ooz)。如需重建，按归属说明准备 Emscripten 与 CMake，并保留上游构建信息和完整许可证。不要用游戏附带的专有 Oodle DLL 替代仓库中的开源分发内容。
