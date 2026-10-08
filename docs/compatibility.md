# 浏览器兼容说明

## 支持范围

桌面浏览器，Manifest V3，Chrome / Chromium 110+ 与使用对应新版内核和 Chrome 扩展 API 的 Edge、Brave、Vivaldi、Opera。

本版没有使用 Chrome processes、sidePanel、debugger 或浏览器厂商专用 API。源码仅加载扩展包内脚本，不运行远程代码。没有配置新标签页替换。

| 能力 | API / 处理 |
| --- | --- |
| 标签查询、关闭、移动、固定与静音 | chrome.tabs 与 chrome.windows |
| 会话、本地收藏与设置 | chrome.storage.local |
| 内容交接 | chrome.storage.session；要求内核 110+ |
| 截图 | chrome.tabs.captureVisibleTab + 用户点击图标授予的 activeTab |
| 标签组 | chrome.tabGroups / chrome.tabs.group，运行时检查是否存在 |
| 后台休眠 | chrome.tabs.discard，运行时检查是否存在 |

没有标签组 API 时会恢复页面和固定状态，跳过组信息。浏览器若不支持 Manifest 中所列权限或禁止加载本地扩展，会在安装阶段拒绝；这不属于可通过运行时降级解决的情况。

## 已验证与未实测

- macOS 15.7.7 ARM64，Playwright 配套 Chromium 147.0.7727.15：真实扩展加载、标签管理、布局恢复、截图、备份和内容交接。
- Google Chrome 155.0.8059.40：使用独立配置验收同样的核心流程。
- Edge、Brave、Vivaldi、Opera：按标准 Chromium 扩展 API 兼容设计，本机未安装，未逐品牌实测。
- Windows 与 Linux：相同源码和标准 API；没有在这些操作系统上实测。自动化截图验收需图形环境。

## 常见限制

- 企业策略可能禁止开发者模式或未上架扩展。
- 扩展快捷键可能被系统或其他扩展占用。
- Chrome 内部页面、商店页及部分受保护内容可能不能截图。
- 截图是可见区域，不是整页滚动截图。
- 网站之间没有通用输入接收协议，文字复制、图片下载后在网站继续处理。
- 会话只恢复 URL 和浏览器布局；已经打开的网址会保留当前所在窗口，不移动到会话窗口。
- 原窗口 ID 只用于分组，新窗口由浏览器重新分配 ID。
- 恢复固定标签时遵循浏览器固定标签排列规则；重复网址仅保留一份。
- 无痕页面不会纳入普通工作台，不能将无痕内容保存到本地会话。
