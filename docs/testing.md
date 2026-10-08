# 1.0.0 验收记录

日期：2026-10-08（Asia/Shanghai）。使用临时浏览器配置，不读取用户日常 Chrome 配置。

## 自动检查

- `npm test`：8 个纯逻辑测试通过，覆盖精确去重、固定标签保护、追踪参数规则、网址限制、搜索、会话快照、备份校验与合并。
- `npm run check`：Manifest V3、包内引用、脚本语法与目录唯一性检查通过。
- 357 个目录链接实际 HTTP HEAD 请求全部返回 200：趁手 118 个去重入口，轻办 239 个。
- ZIP 根目录包含 manifest.json，所有文件与当前 extension/ 源码逐字节一致。

## 真实浏览器验收

Chromium 147.0.7727.15 与本机 Google Chrome 155.0.8059.40，macOS 15.7.7 ARM64。通过真实扩展加载与 Chrome API 验证；没有 mock chrome.*。

| 场景 | 结果 |
| --- | --- |
| 工具搜索、收藏、最近使用、网站目标网址 | 通过 |
| 多页面并发收藏写入 | 通过，后台串行处理，没有覆盖 |
| 重复标签预览、关闭、撤销重开重复副本 | 通过 |
| 稍后再看、备注搜索、归档 | 通过 |
| 多窗口、固定状态、标签组颜色与折叠恢复 | 通过，按目标窗口显式创建组 |
| 会话重复恢复 | 通过，跳过已打开网址 |
| 窗口视图、批量静音、跨窗口移动 | 通过 |
| 固定标签休眠保护 | 通过，保护页面未被丢弃 |
| 深色主题、实际下载 JSON 与合并导入 | 通过 |
| 并发内容交接与读取后清理 | 通过，内容使用独立一次性标识 |
| 工具栏 activeTab 授权、真实可见区域截图 | 通过 |
| 截图下载与轻办标注网址 | 通过 |
| 560px 宽度布局与扩展页面脚本错误 | 无横向溢出，无扩展脚本错误 |

截图见 screenshots/。报告输出在 output/playwright/（不提交临时用户数据）。新版浏览器的工具栏弹窗不一定以 Playwright Page 事件暴露：验收先通过真实工具栏动作获得 activeTab，再在同一窗口的非活动扩展渲染页触发相同截图按钮逻辑。没有额外授予全站权限。

## 实际休眠的独立验证

`npm run verify:discard` 启动独立 Chromium，通过原生调试协议只附加工作台，待休眠网页不附加调试器。实际操作界面选择后台页面、确认休眠，再查询真实 Chrome 标签状态，验证 discarded=true。

开发中在多窗口场景使用 Playwright 自动附加网页后，原生休眠曾触发 Chrome for Testing 147 和 Chrome 155 崩溃。没有将此类失败记为通过；成功路径改用独立验收脚本验证，主验收脚本验证保护规则。用户提供的崩溃报告还包含 macOS 窗口恢复弹窗堆栈，无法据此单独确定浏览器内部根因。插件确认操作使用页面内对话框。

## 如何复验

```sh
npm ci
npx playwright install chromium
npm test
npm run check
npm run verify:browser
npm run verify:discard
npm run package
```

主浏览器验收使用图形环境，并以浏览器调试接口触发工具栏动作；本版测试基线为配套 Chromium 147。指定本机 Chrome 二进制可运行同一套验收（仅作用于独立配置）：

```sh
BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run verify:browser
```

开发调试标志只用于隔离测试，不进入插件包或正常安装流程。独立休眠验收使用 Playwright 配套 Chromium，其命令行加载扩展的方式不适用于所有品牌浏览器。

Edge、Brave、Vivaldi、Opera 及 Windows、Linux 未逐一实测，不能用 Chrome 验收结果冒充这些平台的实测记录；兼容设计与安装方式见 compatibility.md。
