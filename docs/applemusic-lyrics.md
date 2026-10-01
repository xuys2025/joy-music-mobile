# Apple Music 风格歌词（仅 fork）

此功能只在 `xuys2025/joy-music-mobile` 的 `feature/applemusic-lyrics` 分支维护，不提交到原项目，也不更新之前修复 PR 所使用的 master 分支。

## 当前版本

使用 `@applemusic-like-lyrics/core` 0.6.0 和 `react-native-webview` 13.15.0。大字左对齐、弹簧滚动、焦点放大、远处歌词模糊，底层沿用应用的专辑封面背景；支持深浅主题、译文、点击歌词跳转。

1.2.13 支持原平台网易云 YRC、QQ 加密 QRC、酷狗压缩 KRC，以及带有效 `[kuwo:]` 校准元数据的酷我逐字歌词。普通 LRC 仍按行显示，不平均分字，也不利用 AI 生成未经验证的时间轴。原平台逐字数据优先；没有可靠逐字数据时，可尝试 AMLL 社区 TTML 和网易云/QQ/酷狗跨平台匹配。TTML 通过核验后保留译文、音译、和声和对唱属性。

## 准确性与回退（1.2.13）

- 原平台请求采用同一歌曲 ID；QQ 数字 songID 和 MID 分开保留，旧数据查详情时必须返回相同 MID。酷狗 hash 搜索结果仍可能包含其他歌手或用户投稿，逐字候选必须同时匹配歌名、歌手、毫秒时长（误差不超过 1 秒），拒绝非零 adjust。
- 单行逐字时间必须有限、非负、递增、正时长、不超出行尾/已知歌曲时长，字串拼接必须完整。只允许真实数据整数取整造成的最多 1 毫秒相邻重叠，保持原值，不裁剪或猜测；更大重叠整行回退。损坏的 YRC/QRC 文档不得只留下部分成功解析的行。
- 社区词库按平台数字 ID 获取，并检查文件内对应 ID；还必须用原平台逐行歌词独立核验。至少 3 个正文锚点、正文字符匹配率双向不低于 95%、每个匹配锚点相差不超过 250 毫秒、匹配行跨度达到两边的 80%。不推测整体偏移或变速。背景人声不参与主歌词匹配，但也需合法时间。
- 跨平台搜索最多各取 5 个结果，最多处理 2 个满足条件的候选。歌名保留 Live/Remix 等版本标识，歌手集合、专辑必须相同，时长都已知且相差不超过 1 秒；之后仍需通过上述时间轴核验。缺少专辑/时长/原歌词等证据时不做跨源替换。
- 先显示原平台歌词，再后台补充；可选增强最多等待 8 秒。超时/断网/404/解码失败/ID 错误/版本或时间轴不一致均保留原歌词，晚到结果不会更新页面。切歌监听有取消保护，两个播放器视图共用一份请求。
- 新缓存包含平台 ID、QQ 数字 ID、hash、时长、歌名、歌手和专辑，避免另一版本共用缓存。旧缓存前缀失效；逐行结果 6 小时后重试，逐字结果有效期 7 天。过期缓存先显示，断网时保留。

这些是保守的录音一致性筛选，并不构成对任意第三方音频的逐字准确性保证。应用尚未实现音频指纹比对或人工听音校正；音源服务若将同一 ID 指向不同剪辑，单凭目录信息无法完全证明实际播放文件一致。无法通过现有校验的结果必须回退逐行显示，不为了提高覆盖率放宽门槛。

## 代码与构建

- `src/components/common/LyricsView.tsx`：原生 WebView 桥、应用前后台/可见性/辅助功能、跳转校验、错误回退。
- `NativeLyricsView.tsx`：原生歌词回退，读屏开启时也使用此组件。
- `src/components/lyrics/web/`：AMLL DOM 渲染器与样式。
- `src/components/lyrics/protocol.ts`：安全 JSON 桥、歌词格式转换、播放时钟插值和跳转后的旧进度保护。
- `src/core/lyric/{parser,fetcher,index}.ts`：真实逐词时间解析、多平台请求、渐进更新和缓存。
- `accuracy.ts`：时间合法性、版本信息和整曲锚点核验；`codecs.ts`：复用 AMLL QRC/TTML 解析，兼容 Hermes 的 UTF-8/DOM 环境，KRC 解码；`wordSources.ts`：词库与严格跨源匹配；`network.ts`：超时和晚到结果隔离。
- `NowPlaying/index.tsx`：播放器同步及切歌时清空旧歌词。
- `scripts/build-lyrics.mjs`：编译成内嵌 HTML，由 npm postinstall 自动执行。

渲染 JS、CSS、许可声明随 IPA 打包，不从 CDN 加载。WebView 禁止网络连接和页面导航；歌词内容以 JSON 传输，由 AMLL 的 textContent 渲染。音源密钥和播放 URL 不传入 WebView。歌词 API 仍沿用原生网络请求。250 ms 原生进度在页面中插值；超过 1 秒没有新进度时停止外推，暂停、后台和离开歌词页停止播放时钟。

```sh
npm ci
npm run test:regression
npm run test:lyrics:web
npm run test:lyrics:codecs
npx tsc --noEmit
npx expo export --platform ios
```

1.2.12 基线曾通过 28 项回归测试。1.2.13 增加时间合法性、错误版本/ID、坏密文、KRC 回退、社区 TTML、跨源匹配、超时、并发订阅和缓存验证。另有模拟 Hermes 环境（无 Node Buffer、无浏览器 DOM、无原生 TextEncoder/TextDecoder）的真实库解码测试。网页包的 DOM 冒烟测试覆盖初始化、歌词结构、文本安全、点击跳转、主题、可见性、许可，以及可恢复布局通知与真实错误的区分；不等同于真机视觉测试。

研发中对公开接口进行了小规模真实数据抽样：QQ 加密 QRC 解码得到 63 行；网易云 YRC 与 LRC 合并保留 69 行，其中 68 行具有合法逐字时间；酷狗 KRC 解码得到 63 行；社区 TTML 解析得到 17 行/164 个词；酷我样本具有 60 个带字时间的行，并验证校准标签与 1 毫秒量化重叠。只检查数据/解码/结构与已有歌词，不声称已逐曲听音实测，更不据此推算全曲库覆盖率。样本歌词正文、临时 accesskey、用户音源密钥均不提交。

新增 `scripts/test-lyrics-webkit.swift`：在 macOS 和 iOS 模拟器的真实 WKWebView 内加载同一份编译 HTML，验证启动、原生注入、歌词/译文渲染、主题和点击跳转，并保存截图。`lyrics-webkit-check.yml` 自动执行两种环境；IPA 构建也先执行 iOS WebKit 检查。测试使用合成歌词，不携带音源密钥或用户数据。仍不能替代用户设备上包含 React Native 容器的完整播放器测试。

1.2.11 曾遗漏应用内硬编码版本（仍显示 1.2.10），并未同步 iOS buildNumber。1.2.12 将应用内版本直接读取 app.json，发版脚本同步 package.json、锁文件和 iOS buildNumber，自动校验一致性。歌词加载结束再次握手，布局的 ResizeObserver 延迟通知不再触发原生回退；失败时显示安全的阶段提示并提供重试。用户截图中的回退未在 macOS WebKit 重现，不能仅凭版本显示或这些防护修改声称用户设备问题已经解决。

后续真实 WebKit 检查发现 iOS 和 macOS 都可能偶发报告不含堆栈的 `Script error.`；仅忽略已知布局通知不足以稳定解决。新增 `web/resizeObserver.ts`，将 AMLL 的尺寸回调合并到下一动画帧，避免在 ResizeObserver 通知阶段反复改写 DOM。断开观察时取消待执行工作；真正的回调异常仍上报并回退。测试覆盖延迟、合并、取消，以及每种 WebKit 环境连续三轮歌词重载、播放同步和跳转。用户设备的完整容器仍需安装后验证；`Script error.` 的完整原始堆栈未取得。

未签名 IPA 在本 fork 的 `ios-unsigned-ipa.yml` 中手动构建并交付 Artifact；本轮不创建公开 Release，也不向原项目提交 PR。

## 许可与源码

原项目代码的 MIT 许可保留于根目录 LICENSE 和 `licenses/Original-MIT.txt`。
AMLL 以 AGPL-3.0-only 发布（完整文本：`licenses/AMLL-AGPL-3.0.txt`）。本分支新增的 AMLL 集成代码以 AGPL-3.0-only 发布，分发此组合应用须遵守 AGPL 的相应要求。完整源码与构建脚本公开在本分支，歌词页提供源码与许可入口，编译 HTML 内包含 AMLL 与实际打包依赖的许可文本。不能将此组合版本声称为仅 MIT。

AMLL 上游：https://github.com/amll-dev/applemusic-like-lyrics
社区词库：https://github.com/amll-dev/amll-ttml-db（投稿者自主编写部分 CC0；外来部分沿用提供方许可）
本分支源码：https://github.com/xuys2025/joy-music-mobile/tree/feature/applemusic-lyrics

实现由 GPT-6.1 sol 模型辅助。自动化结果详见 Actions 与测试文件；新增歌词的真机体验需用户安装后验证，不能沿用此前音源修复的用户测试结论。
