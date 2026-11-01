# v2 地形视图与数据

v2 默认显示游戏导航表面的 2D 地形；3D 模式使用同一份真实 XYZ 数据。它们与“游戏地图”UV、“世界坐标”共同组成四种视图，均不改变收集判定或 CSV 原生坐标。

## 当前覆盖

`public/data/terrain/manifest.json` 是发布清单。当前包含 **9 个底层世界、12 个地图 ID、2,202,813 个顶点和 1,783,699 个三角形**。JSON 合计 101,762,411 字节；gzip 合计 **20,668,223 字节，约 20.7 MB**，按世界需要加载。

| 底层世界 | 使用该表面的地图 ID |
| --- | --- |
| `PBZ_Xigu_WP` | `XiGu` |
| `PBZ_Fujizhilin_WP` | `FuJiZhiLin` |
| `PBZ_Zhengdaodaying_WP` | `ZhengDaoDaYing`、`LuJiaCun` |
| `PBZ_Pangzhen_WP` | `PangZhen`、`MeiGuHu` |
| `PBZ_Duanhun_WP` | `DuanHunYa`、`DuanHunShan` |
| `PBZ_DengDingShanDao_WP` | `DengDingShanDao` |
| `PBZ_Houjie_WP` | `HouJie` |
| `PBZ_Ximeng_WP` | `XiMeng` |
| `PBZ_Huanshuyiji2_WP` | `MeiGu_YiJi` |

共享一个世界不代表共享全部地图边界。`mapFocus`、`focusByBand` 用于取景和绘制范围提示，`focusIsRegionBoundary` 为 `false`；不能将这些框当作游戏定义的精确区域边界。`DuanHunShan` 标记为 `limited-anchor-correspondence`，其分区焦点依据有限。

图鉴另有 `XueSeSenLin`、`HuanShuShi` 两个尚未确认对应地形的定义，当前不生成猜测别名。这些条目仍可浏览清单和可用坐标；不能将其与名称相似的地图直接合并。

## 发布的数据是什么

表面来自游戏 cooked 导航数据的普通地面多边形，整理为三角索引、去除未引用顶点并复用共享世界。off-mesh 连接多边形不作为地面发布；没有添加两点之间的推测通路。

每个压缩 JSON 使用 `format: 1`，主要字段如下：

| 字段 | 含义 |
| --- | --- |
| `unit`、`coordinateSystem` | `cm`、`Unreal Z-up` |
| `vertices` | 原生世界坐标 `[X,Y,Z]` |
| `indices` | 每三个索引组成一个真实表面三角形 |
| `bounds` | 几何包围范围 |
| `zBands` | 按高度场景组织的连续三角索引范围 |
| `mapFocus` | 各逻辑地图的默认高度区域及取景提示 |

清单记录每个世界的内容哈希、解压前后字节数、顶点数和三角形数。仓库不附带原始 Unreal 包、完整导航导出、地图贴图、场景模型或本地调查路径。当前几何不是以物品坐标重新拟合出的假地形。

## 加载与绘制

```text
选择地图
  → terrain-data.js：读取清单，按世界获取 gzip，检查大小、SHA-256 与索引
  → app.js：选择高度区域、物品与取景范围
  → terrain-2d.js：将真实三角形投到世界 XY，用 Canvas / Path2D 绘制
  或 terrain-view.js：按需初始化 Three.js / WebGL2
```

首次打开页面不会下载全部地形。加载器缓存一份世界；同一世界的子区域复用它，切换世界时清除加载器中的旧世界缓存。文件名包含内容哈希；如果服务器已经解压 gzip，加载器也接受解压后的 JSON 响应。

3D 依赖在选择 3D 时才加载。WebGL2 不可用或资源加载失败时，界面回到 2D。库从本站 `vendor/three/` 加载，不依赖 CDN。

高度区域将普通地图与远离主场景的独立高空场景分开。选中物品时可根据其真实 Z 选择区域；“只看选中物品附近高度”同时过滤表面和标记，不删除清单条目。有表面但没有物品标记的区域仍显示表面。

## 坐标与高度

离线读取导航数据时使用以下轴转换：

```text
Unreal (X,Y,Z) = (-RecastX,-RecastZ,RecastY)
```

发布文件已经是 Unreal XYZ 厘米，浏览器不应重复转换。Three.js 显示时先减去世界原点 `origin`，再转成以 Y 为上轴的米制坐标：

```text
Three = ((X-originX)/100, (Z-originZ)/100, -(Y-originY)/100)
```

2D 地形直接投影世界 XY，不套用美术地图的局部 UV 变形；“游戏地图”模式则显示独立的游戏 UV。因此两者的轮廓与朝向不要求逐像素重合。相关 UV 方法见[地图投影说明](MAP-PROJECTION.md)。

测试用血色森林杀气塔的大门、塔底和六层三个原生铃铛位置检查高度，分别要求对应导航顶点在 1.5 米以内。该检查支持轴、单位与分层对齐，不等于对全部地形的运行时验证。3D 边缘的薄厚度只是显示效果，不是真实建筑墙体或新增通行面。

## 不提供寻路

本功能不运行 A*、连接推断或自动路线计算。导航烘焙表面也不能表示当前存档下所有动态门锁、任务限制、跳跃动作和入口条件。附近铃铛仍按原生坐标的直线距离比较，不能代替可行走路线。

数据校验、UI 高度过滤与 WebGL 降级的测试范围见[测试说明](TESTING.md)。Three.js 0.187.0 使用 MIT 许可证；发布时保留其[归属说明](../public/vendor/three/ATTRIBUTION.md)、[许可证](../public/vendor/three/LICENSE)和[版本校验记录](../public/vendor/three/PROVENANCE.json)。
