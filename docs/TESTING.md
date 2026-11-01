# 测试

公开仓库的基础测试不需要个人存档，也不需要安装或运行游戏。测试只读取仓库中的应用代码与整理后的静态目录，不连接生产站点。

## 环境与命令

使用 Node.js 20 或更新版本；本次核验使用 Node.js 24.21.0。打包另需 Python 3。`happy-dom` 仅用于开发测试，版本由 `package-lock.json` 固定，不参与静态站点运行。

在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm test
```

当前 `npm test` 按顺序运行四项检查，任何一项失败都会停止：

```sh
node scripts/validate_catalog.mjs
node tests/completion.test.mjs
node scripts/test_codec.mjs
node tests/ui.test.mjs
```

排查问题时可以单独执行对应命令；正常完整检查执行一次 `npm test` 即可。

## 不带个人存档时的覆盖范围

| 检查 | 命令 | 已核验的结果与范围 |
| --- | --- | --- |
| 静态目录 | `node scripts/validate_catalog.mjs` | 检查 698 个点位、13 类目录、187 个铃铛参照和 80 条任务元数据，以及 ID 唯一性、地图和类别引用、坐标、条件关系和运行时目录不含原始解包来源字段。 |
| 完成规则 | `node tests/completion.test.mjs` | 验证周目、Actor 与事件节点记录的存在性、已消耗钥匙、部分存档缺字段、任务关联与已知前置的区别，以及 13 类目录的状态统计。 |
| 存档容器 | `node scripts/test_codec.mjs` | 无私有样本时 24 项合成测试，`private_fixture_used` 为 `false`。检查 WebCrypto AES-GCM、zlib 解压、目录与数据段认证、时间与槽位选择、重复名称、越界、重叠、尾随数据、解压长度和资源限制，并运行真实 Oodle WASM 模块的 stored frame 烟测。 |
| 界面逻辑 | `node tests/ui.test.mjs` | 不设置 `PBZ_TEST_SAVE` 时 6 项通过：13 类目录、载入前中性计数、公开界面无私人路线区块、无独立攻略区块、未载入存档也可浏览点位，以及模拟网络调用只使用不带存档内容的 GET。 |

Oodle 烟测把自行生成的 JSON 包装为合成 stored frame，再经实际 WASM 模块解码，验证 WASM 的加载与调用链。stored frame 不需要执行真实 Mermaid 压缩数据的解码算法，因此这项测试不等同于真实游戏 Mermaid 压缩流的覆盖。

公开界面测试使用 Happy DOM，验证事件和 DOM 状态，不代表真实浏览器排版、浏览器 WebAssembly SIMD 或生产 HTTPS 环境已经通过检查。

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

UI 回归分支读取该 `.sav`，启用文件选择、槽位切换、状态重算、CSV 导出、清除和错误处理等额外检查；期望值由 `analyzeSlot` 从载入的槽位动态计算。它不需要 codec 回归目录中的同名 JSON，也不把环境变量作为 codec 的目录参数。默认 6 项 UI 检查指未设置该环境变量的情况。

回归样本请放在仓库外。不要将其放入 `public/`、提交 Git，或作为发布包附件。正常应用的存档选择与解码均在用户浏览器本地完成。

## 结果文件

- `scripts/test_codec.mjs` 会生成或覆盖 `scripts/test_codec_results.json`。无样本运行的预期为 24 项、`private_fixture_used: false`；提供有效私有回归目录时额外运行一项对照。
- `tests/ui.test.mjs` 会生成 `artifacts/ui-test-results.json`，其验证方式应标为 Happy DOM。
- 这些文件是运行结果，不是测试输入，不需要提交到 Git。

## 打包静态站点

在仓库根目录执行：

```sh
python scripts/package.py
```

也可以使用 `npm run package`。输出为 `dist/PBZItemlist.zip`，仅包含 `public/` 的内容，包括运行所需的应用、静态目录、许可证与解码器及其对应源码。它不依赖仓库外的解包文件，也不包含开发测试目录或个人回归样本。

压缩包内的 `index.html` 直接位于根目录。解压后以该目录作为静态服务器的文档根即可独立发布；无需 Node.js 服务端或存档上传接口。脚本会检查 ZIP 完整性和路径，并拒绝个人存档、密钥、原始 Unreal 资源及重复源码压缩包等文件。

## 手动浏览器检查

使用本机静态服务器提供 `public/`，例如：

```sh
python -m http.server 8767 --bind 127.0.0.1 --directory public
```

然后打开 `http://127.0.0.1:8767/`：

1. 不选存档，核对类别与地图筛选、点位列表及载入前的计数。
2. 选择自己的 `.sav`，核对进度、槽位、最新时间和状态重算；在网络面板检查没有携带存档内容的上传请求。
3. 切换类别与“仅未收”，点选坐标和铃铛近邻，检查窄屏布局与键盘操作。
4. 导出 CSV、切换槽位、清除数据，再选择无效文件，检查状态和错误提示。

WebCrypto 需要 HTTPS 或受信任的本机 localhost 环境。Oodle 解码还需要浏览器支持 WebAssembly SIMD；部署的 CSP 需要允许本站脚本及 `wasm-unsafe-eval`。原始游戏坐标的直线近邻仅用于定位，不代表道路可达性。

## ooz-wasm 的源码与构建

运行站点使用固定版本 `public/vendor/ooz-wasm/build/ooz.js`，其中内嵌 WASM；无需服务器端解码进程。相关 GPL、版权说明、版本与包校验信息应随代码保留。

`public/vendor/ooz-wasm/source/` 提供对应上游源码与 CMake 构建脚本。在安装 Emscripten、CMake 后，可在该目录运行：

```sh
emcmake cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

上游没有记录发布包所用的精确 Emscripten 版本。因此这里提供源码与构建步骤，不声称重建后能得到逐字节相同的二进制。
