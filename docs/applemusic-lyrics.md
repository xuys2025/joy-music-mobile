# Apple Music 风格歌词（仅 fork）

此功能只在 `xuys2025/joy-music-mobile` 的 `feature/applemusic-lyrics` 分支维护，不提交到原项目，也不更新之前修复 PR 所使用的 master 分支。

## 当前版本

使用 `@applemusic-like-lyrics/core` 0.6.0 和 `react-native-webview` 13.15.0。大字左对齐、弹簧滚动、焦点放大、远处歌词模糊，底层沿用应用的专辑封面背景；支持深浅主题、译文、点击歌词跳转。

普通 LRC 按行显示，不猜测逐字时长。网易云请求 YRC，有真实时间时逐词高亮；新接口无数据/错误回退原 LRC 接口。其他音源仍按原有获取逻辑使用逐行歌词。本版本未接入社区 TTML 数据库，未解密 QQ QRC，也未支持合唱/背景人声标记。

## 代码与构建

- `src/components/common/LyricsView.tsx`：原生 WebView 桥、应用前后台/可见性/辅助功能、跳转校验、错误回退。
- `NativeLyricsView.tsx`：原生歌词回退，读屏开启时也使用此组件。
- `src/components/lyrics/web/`：AMLL DOM 渲染器与样式。
- `src/components/lyrics/protocol.ts`：安全 JSON 桥、歌词格式转换、播放时钟插值和跳转后的旧进度保护。
- `src/core/lyric/{parser,fetcher,index}.ts`：真实逐词时间解析、YRC 请求及 LRC 回退、新缓存版本。
- `NowPlaying/index.tsx`：播放器同步及切歌时清空旧歌词。
- `scripts/build-lyrics.mjs`：编译成内嵌 HTML，由 npm postinstall 自动执行。

渲染 JS、CSS、许可声明随 IPA 打包，不从 CDN 加载。WebView 禁止网络连接和页面导航；歌词内容以 JSON 传输，由 AMLL 的 textContent 渲染。音源密钥和播放 URL 不传入 WebView。歌词 API 仍沿用原生网络请求。250 ms 原生进度在页面中插值；超过 1 秒没有新进度时停止外推，暂停、后台和离开歌词页停止播放时钟。

```sh
npm ci
npm run test:regression
npm run test:lyrics:web
npx tsc --noEmit
npx expo export --platform ios
```

已通过 28 项回归测试、TypeScript 检查及完整网页包的 DOM 冒烟测试（初始化、歌词结构、文本安全、点击跳转、主题、可见性、许可，以及可恢复布局通知与真实错误的区分）。DOM 测试模拟布局相关 API，不等同于真机视觉测试。

新增 `scripts/test-lyrics-webkit.swift`：在 macOS 和 iOS 模拟器的真实 WKWebView 内加载同一份编译 HTML，验证启动、原生注入、歌词/译文渲染、主题和点击跳转，并保存截图。`lyrics-webkit-check.yml` 自动执行两种环境；IPA 构建也先执行 iOS WebKit 检查。测试使用合成歌词，不携带音源密钥或用户数据。仍不能替代用户设备上包含 React Native 容器的完整播放器测试。

1.2.11 曾遗漏应用内硬编码版本（仍显示 1.2.10），并未同步 iOS buildNumber。1.2.12 将应用内版本直接读取 app.json，发版脚本同步 package.json、锁文件和 iOS buildNumber，自动校验一致性。歌词加载结束再次握手，布局的 ResizeObserver 延迟通知不再触发原生回退；失败时显示安全的阶段提示并提供重试。用户截图中的回退未在 macOS WebKit 重现，不能仅凭版本显示或这些防护修改声称用户设备问题已经解决。

未签名 IPA 在本 fork 的 `ios-unsigned-ipa.yml` 中构建，发布标签必须指向此功能分支的提交。

## 许可与源码

原项目代码的 MIT 许可保留于根目录 LICENSE 和 `licenses/Original-MIT.txt`。
AMLL 以 AGPL-3.0-only 发布（完整文本：`licenses/AMLL-AGPL-3.0.txt`）。本分支新增的 AMLL 集成代码以 AGPL-3.0-only 发布，分发此组合应用须遵守 AGPL 的相应要求。完整源码与构建脚本公开在本分支，歌词页提供源码与许可入口，编译 HTML 内包含 AMLL 与实际打包依赖的许可文本。不能将此组合版本声称为仅 MIT。

AMLL 上游：https://github.com/Steve-xmh/applemusic-like-lyrics
本分支源码：https://github.com/xuys2025/joy-music-mobile/tree/feature/applemusic-lyrics

实现由 GPT-6.1 sol 模型辅助。自动化结果详见 Actions 与测试文件；新增歌词的真机体验需用户安装后验证，不能沿用此前音源修复的用户测试结论。
