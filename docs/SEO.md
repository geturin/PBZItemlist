# 静态收集目录与搜索发现

检查器继续在浏览器中解析存档。供搜索访问的收集目录由 `scripts/build_guides.mjs` 从同一份公开图鉴和官方英文名称覆盖生成，不需要执行 JavaScript 才能看到清单。

Google 的 [JavaScript SEO 基础说明](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)解释了抓取、渲染与索引的区别，建议预渲染，并使用可抓取的普通链接。本项目据此将名称、计数、物品表格、铃铛参照和链接直接写入 HTML；这并不保证页面被抓取、收录或获得特定排名。

## 页面范围

- 中文目录：`/phantom-blade-zero/collectibles/`；英文目录：`/phantom-blade-zero/en/collectibles/`。
- 地图页：`collectibles/maps/<MapID>/`，只生成有原生预览且收集点非空的已确认地图。
- 类别页：`collectibles/categories/<CategoryID>/`，只列上述地图中的有效记录。
- 当前为 11 张地图、13 个类别和双语总目录，共 50 页、660 个已整理点位。空的断魂山和未确认附加定义不生成独立页面。

计数是目录点位口径，不是游戏内全部物品数量或完成率。整花聚合父项不重复统计。页面没有玩家的存档进度，不将任何项目预判为未完成。

每个地图页包含原生轻量预览和可点击点位；类别页按地图展示预览及物品清单。图像延迟加载，但全部表格和链接已经存在于 HTML。铃铛参照由同图原生 XYZ 计算直线距离，特殊高度区域缺少可靠参照时明确留空；这些参照不是行走路线，也不是任务或领取前置。

## 链接与语言

目录、地图、类别和检查器之间使用普通 `<a href>`。点位链接通过 `?map=...&category=...&item=...#workspace` 打开检查器筛选并进入清单区域，不为任意查询组合批量生成索引页。只有固定的静态目录路径进入页面清单。

每页有独立标题、描述、H1、自指 canonical，以及中文、英文和 `x-default` 互链。中英对应页各自列出自己和另一语言，符合 Google [本地化页面说明](https://developers.google.com/search/docs/specialty/international/localized-versions)中的双向 `hreflang` 规则。中文原名可作为英文条目的原文保留，缺少可靠英文时不编造译名。

页面的 `CollectionPage` / `ItemList` 及 `BreadcrumbList` 与可见清单和面包屑一致；它们不承诺搜索引擎展示特殊结果。没有为收集物编造产品价格、评分、评论、攻略步骤或领取条件。

## 生成与验证

```sh
node scripts/build_guides.mjs
node scripts/build_guides.mjs --check
node tests/guides.test.mjs
```

生成器只写两种语言的 `collectibles/` 目录、`public/data/guide-pages.json` 和 `public/js/guide-routes.js`。不改检查器页面或已有站点地图；主构建读取清单后统一接入站点地图和固定访问计数路由。清单包含固定路径、标题、对应语言路径与语言，不包含查询参数或玩家数据。

`--check` 比较全部生成结果，发现过期内容或多余页面会失败，不覆盖文件。测试使用 Happy DOM 读取静态 HTML，核对记录覆盖、计数、双语互链、标题、结构化数据、预览、筛选链接与本地资源引用；不启动浏览器，不代表真实搜索抓取或收录已经完成。

生成的页面不包含原始存档、账户信息、本机路径、资源包、原始事件匹配结构或私有分析文件。地图图像与游戏名称的权利归各自权利人所有。
